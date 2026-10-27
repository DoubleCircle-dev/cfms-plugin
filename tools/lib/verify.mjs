// 校验 .cfmsext 包：ZIP 结构、路径白名单、文件索引、Ed25519 签名、manifest 与声明式文档。
import { sha256Hex, formatBytes, isPlainObject } from './util.mjs';
import { readZip } from './zip.mjs';
import { verifyBytes } from './crypto.mjs';
import {
  MAX_EXPANDED_BYTES,
  MAX_FILES,
  MAX_PACKAGE_BYTES,
  isAllowedPackagePath,
  maxBytesForPath,
  validatePluginSource,
} from './validate.mjs';

const REQUIRED_META = ['META-INF/files.json', 'META-INF/signature.ed25519'];

/**
 * @param {Buffer} buffer .cfmsext 内容
 * @param {{ publicKeys?: Record<string, string>, sourceName?: string }} [options]
 *   publicKeys: key_id -> 32 字节公钥 hex。传空对象表示跳过签名验证。
 */
export function inspectPackage(buffer, options = {}) {
  const errors = [];
  const warnings = [];
  const publicKeys = options.publicKeys ?? {};

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { errors: ['包内容为空或不是 Buffer'], warnings };
  }
  if (buffer.length > MAX_PACKAGE_BYTES) {
    errors.push(`包大小 ${formatBytes(buffer.length)} 超过上限 ${formatBytes(MAX_PACKAGE_BYTES)}`);
  }

  let entries;
  try {
    entries = readZip(buffer);
  } catch (cause) {
    return { errors: [`ZIP 读取失败：${cause.message}`], warnings };
  }

  if (entries.size > MAX_FILES) errors.push(`文件数 ${entries.size} 超过上限 ${MAX_FILES}`);
  let expandedBytes = 0;
  for (const [path, data] of entries) {
    if (!isAllowedPackagePath(path)) errors.push(`包内包含不允许的文件：${path}`);
    const limit = maxBytesForPath(path);
    if (data.length > limit) errors.push(`${path} 大小 ${data.length} 字节超过上限 ${limit}`);
    expandedBytes += data.length;
  }
  if (expandedBytes > MAX_EXPANDED_BYTES) {
    errors.push(`解压后总大小 ${formatBytes(expandedBytes)} 超过上限 ${formatBytes(MAX_EXPANDED_BYTES)}`);
  }
  for (const required of REQUIRED_META) {
    if (!entries.has(required)) errors.push(`缺少 ${required}`);
  }
  if (!entries.has('manifest.json')) errors.push('缺少 manifest.json');
  if (errors.length > 0) return { errors, warnings, digest: sha256Hex(buffer) };

  const indexBytes = entries.get('META-INF/files.json');
  let index;
  try {
    index = JSON.parse(indexBytes.toString('utf8'));
  } catch (cause) {
    return { errors: [`META-INF/files.json 不是合法 JSON: ${cause.message}`], warnings, digest: sha256Hex(buffer) };
  }
  if (!isPlainObject(index) || !Array.isArray(index.files)) {
    return { errors: ['META-INF/files.json 结构必须是 { "files": [...] }'], warnings, digest: sha256Hex(buffer) };
  }

  let envelope;
  try {
    envelope = JSON.parse(entries.get('META-INF/signature.ed25519').toString('utf8'));
  } catch (cause) {
    return { errors: [`META-INF/signature.ed25519 不是合法 JSON: ${cause.message}`], warnings, digest: sha256Hex(buffer) };
  }
  if (!isPlainObject(envelope) || typeof envelope.key_id !== 'string' || typeof envelope.signature !== 'string') {
    return { errors: ['签名信封必须是 { "key_id": "...", "signature": "<hex>" }'], warnings, digest: sha256Hex(buffer) };
  }

  // 签名验证（对 files.json 的精确字节）。
  const publicKeyHex = publicKeys[envelope.key_id];
  if (Object.keys(publicKeys).length === 0) {
    warnings.push('未提供信任公钥，跳过签名验证（结构已校验）');
  } else if (!publicKeyHex) {
    errors.push(`未知签名密钥 ${envelope.key_id}（未提供对应公钥）`);
  } else if (!/^[0-9a-fA-F]{128}$/.test(envelope.signature)) {
    errors.push('signature 必须是 64 字节 hex');
  } else if (!verifyBytes(publicKeyHex, indexBytes, Buffer.from(envelope.signature, 'hex'))) {
    errors.push('Ed25519 签名验证失败');
  }

  // 文件索引必须与包内容精确一致（META-INF/* 除外）。
  const indexedPaths = new Set();
  for (const entry of index.files) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string'
      || typeof entry.sha256 !== 'string' || typeof entry.size !== 'number') {
      errors.push('files.json 的条目必须包含 path/sha256/size');
      continue;
    }
    if (!isAllowedPackagePath(entry.path) || entry.path.startsWith('META-INF/')) {
      errors.push(`索引中包含不允许的路径：${entry.path}`);
    }
    if (indexedPaths.has(entry.path)) errors.push(`索引重复路径：${entry.path}`);
    indexedPaths.add(entry.path);
    const data = entries.get(entry.path);
    if (!data) {
      errors.push(`索引中的文件在包内缺失：${entry.path}`);
      continue;
    }
    if (data.length !== entry.size) {
      errors.push(`${entry.path} 大小与索引不符（包内 ${data.length}，索引 ${entry.size}）`);
    }
    if (sha256Hex(data) !== entry.sha256.toLowerCase()) {
      errors.push(`${entry.path} SHA-256 与索引不符`);
    }
  }
  const actualPaths = new Set([...entries.keys()].filter((path) => !path.startsWith('META-INF/')));
  if (actualPaths.size !== indexedPaths.size || [...actualPaths].some((path) => !indexedPaths.has(path))) {
    errors.push('files.json 索引与包内文件集合不精确一致');
  }

  // 复用源码校验：manifest、入口引用、页面与工作流文档。
  const sourceFiles = new Map([...entries].filter(([path]) => !path.startsWith('META-INF/')));
  const sourceResult = validatePluginSource(sourceFiles, options);
  errors.push(...sourceResult.errors);
  warnings.push(...sourceResult.warnings);

  return {
    manifest: sourceResult.manifest,
    digest: sha256Hex(buffer),
    keyId: envelope.key_id,
    signatureHex: envelope.signature,
    index,
    entries,
    size: buffer.length,
    expandedBytes,
    errors,
    warnings,
  };
}
