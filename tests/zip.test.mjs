import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { crc32, readZip, writeZip } from '../tools/lib/zip.mjs';

test('writeZip/readZip：store 模式往返一致', () => {
  const buffer = writeZip([
    { path: 'manifest.json', data: Buffer.from('{"hello":"world"}') },
    { path: 'pages/overview.json', data: Buffer.from('{"title":"hi"}') },
  ]);
  const entries = readZip(buffer);
  assert.deepEqual([...entries.keys()], ['manifest.json', 'pages/overview.json']);
  assert.equal(entries.get('manifest.json').toString(), '{"hello":"world"}');
});

test('writeZip：同样输入产生同样字节', () => {
  const files = [
    { path: 'a.json', data: Buffer.from('a') },
    { path: 'b.json', data: Buffer.from('b') },
  ];
  assert.deepEqual(writeZip(files), writeZip([...files].reverse()));
});

test('readZip：可以读取 deflate 压缩条目', () => {
  const buffer = makeDeflateZip('manifest.json', Buffer.from('{"a":1}'));
  const entries = readZip(buffer);
  assert.equal(entries.get('manifest.json').toString(), '{"a":1}');
});

test('readZip：CRC 被破坏时报错', () => {
  const buffer = writeZip([{ path: 'a.txt', data: Buffer.from('hello') }]);
  const index = buffer.indexOf(Buffer.from('hello'));
  buffer[index] ^= 0xff;
  assert.throws(() => readZip(buffer), /CRC/);
});

function makeDeflateZip(name, data) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const local = Buffer.alloc(30 + nameBuffer.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  nameBuffer.copy(local, 30);
  const central = Buffer.alloc(46 + nameBuffer.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42);
  nameBuffer.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}
