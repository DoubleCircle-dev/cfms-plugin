// 极简确定性 ZIP 读写：写只使用 store（不压缩），读支持 store 与 deflate。
// 目的是让打包结果不依赖第三方库，且与 cfms_client_tauri 的 zip crate 读取兼容。
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[n] = value >>> 0;
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 固定时间戳（1980-01-01 00:00）保证同样输入得到同样 zip 字节。
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const UNIX_FILE_MODE = 0o100644;

/**
 * @param {Array<{path: string, data: Buffer}>} files
 * @returns {Buffer}
 */
export function writeZip(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('writeZip 需要至少一个文件');
  }
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const localChunks = [];
  const centralChunks = [];
  const seen = new Set();
  let offset = 0;

  for (const file of sorted) {
    if (seen.has(file.path)) throw new Error(`ZIP 内重复路径：${file.path}`);
    seen.add(file.path);
    const name = Buffer.from(file.path, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((UNIX_FILE_MODE << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    localChunks.push(local, data);
    centralChunks.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, end]);
}

/**
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>} 按中央目录顺序保存文件内容
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('readZip 需要 Buffer');
  if (buffer.length < 22) throw new Error('不是合法的 ZIP：文件过短');

  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  let endOffset = -1;
  for (let i = buffer.length - 22; i >= minimum; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) throw new Error('不是合法的 ZIP：未找到中央目录结尾');

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize > buffer.length) {
    throw new Error('ZIP 中央目录越界');
  }

  const entries = new Map();
  let pointer = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) {
      throw new Error('ZIP 中央目录项损坏');
    }
    const flags = buffer.readUInt16LE(pointer + 8);
    const method = buffer.readUInt16LE(pointer + 10);
    const crc = buffer.readUInt32LE(pointer + 16);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const uncompressedSize = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const externalAttributes = buffer.readUInt32LE(pointer + 38);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    if (flags & 0x1) throw new Error(`ZIP 条目已加密：${name}`);
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      throw new Error(`ZIP 内不允许符号链接：${name}`);
    }
    if (!name.endsWith('/')) {
      if (entries.has(name)) throw new Error(`ZIP 内重复路径：${name}`);
      entries.set(name, readEntryData(buffer, { name, method, localOffset, compressedSize, uncompressedSize, crc }));
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(buffer, entry) {
  if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`ZIP 本地文件头损坏：${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new Error(`ZIP 数据越界：${entry.name}`);
  const raw = buffer.subarray(dataStart, dataEnd);
  let data;
  if (entry.method === 0) data = Buffer.from(raw);
  else if (entry.method === 8) data = inflateRawSync(raw);
  else throw new Error(`不支持的 ZIP 压缩方式 ${entry.method}：${entry.name}`);
  if (data.length !== entry.uncompressedSize) {
    throw new Error(`ZIP 解压后大小不符：${entry.name}`);
  }
  if (crc32(data) !== entry.crc) {
    throw new Error(`ZIP CRC 校验失败：${entry.name}`);
  }
  return data;
}
