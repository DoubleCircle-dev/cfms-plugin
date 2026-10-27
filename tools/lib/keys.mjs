// 本地开发签名密钥：生成、保存、加载；以及发布方签名密钥配置（publisher.json）。
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair } from './crypto.mjs';
import { isPlainObject } from './util.mjs';

export const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const DEFAULT_PUBLISHER_FILE = 'publisher.json';

/** @returns {{key_id: string, private_key_hex: string, public_key_hex: string, created_at: string}} */
export function createKeyRecord(keyId) {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`key id 必须匹配 ${KEY_ID_PATTERN}，当前为 ${JSON.stringify(keyId)}`);
  }
  const { privateKeyHex, publicKeyHex } = generateKeyPair();
  return {
    key_id: keyId,
    private_key_hex: privateKeyHex,
    public_key_hex: publicKeyHex,
    created_at: new Date().toISOString(),
  };
}

export async function saveKeyRecord(keysDir, record, { force = false } = {}) {
  await mkdir(keysDir, { recursive: true });
  const target = path.join(keysDir, `${record.key_id}.json`);
  if (!force) {
    try {
      await readFile(target);
      throw new Error(`密钥已存在：${target}（如需覆盖请加 --force）`);
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
    }
  }
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return target;
}

export async function loadKeyFile(target) {
  let raw;
  try {
    raw = await readFile(target, 'utf8');
  } catch (cause) {
    throw new Error(`无法读取密钥文件 ${target}: ${cause.message}`);
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`密钥文件 ${target} 不是合法 JSON: ${cause.message}`);
  }
  if (!isPlainObject(record)
    || typeof record.key_id !== 'string'
    || !KEY_ID_PATTERN.test(record.key_id)
    || !/^[0-9a-fA-F]{64}$/.test(record.private_key_hex ?? '')
    || !/^[0-9a-fA-F]{64}$/.test(record.public_key_hex ?? '')) {
    throw new Error(`密钥文件 ${target} 结构不正确（需要 key_id / private_key_hex / public_key_hex）`);
  }
  return record;
}

/** 读取目录中所有密钥文件，返回 key_id -> record。 */
export async function loadKeysDirectory(keysDir) {
  const keys = new Map();
  let entries;
  try {
    entries = await readdir(keysDir, { withFileTypes: true });
  } catch (cause) {
    if (cause.code === 'ENOENT') return keys;
    throw cause;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const record = await loadKeyFile(path.join(keysDir, entry.name));
    keys.set(record.key_id, record);
  }
  return keys;
}

/** 读取发布方签名配置（publisher.json）；不存在返回 null。 */
export async function loadPublisherConfig(file = DEFAULT_PUBLISHER_FILE) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw new Error(`无法读取 ${file}: ${cause.message}`);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${file} 不是合法 JSON: ${cause.message}`);
  }
  if (!isPlainObject(config)
    || typeof config.key_id !== 'string'
    || !KEY_ID_PATTERN.test(config.key_id)
    || !/^[0-9a-fA-F]{64}$/.test(config.public_key_hex ?? '')) {
    throw new Error(`${file} 结构不正确（需要 key_id 与 64 hex 的 public_key_hex）`);
  }
  if (config.private_key_file !== undefined && typeof config.private_key_file !== 'string') {
    throw new Error(`${file}.private_key_file 必须是字符串`);
  }
  return { ...config, public_key_hex: config.public_key_hex.toLowerCase() };
}

/** 写入/覆盖发布方配置；public_key_hex 会进入仓库，私钥不会。 */
export async function savePublisherConfig(file, record, { force = false, privateKeyFile } = {}) {
  if (!force) {
    try {
      await readFile(file);
      throw new Error(`${file} 已存在（轮换密钥请加 --force）`);
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
    }
  }
  const config = {
    key_id: record.key_id,
    public_key_hex: record.public_key_hex,
    private_key_file: privateKeyFile ?? `keys/${record.key_id}.json`,
  };
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

/** 解析签名私钥：--key > publisher.json > keys 目录中的唯一密钥。 */
export async function resolveSigningKey({ keyPath, keysDir = 'keys', publisherFile = DEFAULT_PUBLISHER_FILE } = {}) {
  if (keyPath) return loadKeyFile(keyPath);
  const publisher = await loadPublisherConfig(publisherFile);
  if (publisher) {
    const keyFile = path.resolve(publisher.private_key_file ?? path.join(keysDir, `${publisher.key_id}.json`));
    let record;
    try {
      record = await loadKeyFile(keyFile);
    } catch (cause) {
      throw new Error(`发布方私钥不可用（${keyFile}）：${cause.message}`);
    }
    if (record.key_id !== publisher.key_id) {
      throw new Error(`${publisherFile} 的 key_id 与 ${keyFile} 不一致`);
    }
    if (record.public_key_hex.toLowerCase() !== publisher.public_key_hex) {
      throw new Error(`${publisherFile} 的公钥与 ${keyFile} 不匹配`);
    }
    return record;
  }
  const keys = await loadKeysDirectory(keysDir);
  if (keys.size === 0) {
    throw new Error(`未找到签名密钥。先运行 node tools/keygen.mjs --publisher，或用 --key 指定`);
  }
  if (keys.size === 1) return [...keys.values()][0];
  const dev = keys.get('dev-local');
  if (dev) return dev;
  throw new Error(`密钥目录中有多个密钥（${[...keys.keys()].join(', ')}），请用 --key 指定`);
}

/** 解析信任公钥集合：--key / keys 目录 + publisher.json / --public-key keyid:hex。 */
export async function resolveTrustedKeys({
  keyPaths = [],
  keysDir = 'keys',
  publicKeyArgs = [],
  publisherFile = DEFAULT_PUBLISHER_FILE,
} = {}) {
  const result = new Map();
  for (const keyPath of keyPaths) {
    const record = await loadKeyFile(keyPath);
    result.set(record.key_id, record.public_key_hex);
  }
  if (keyPaths.length === 0) {
    const keys = await loadKeysDirectory(keysDir);
    for (const record of keys.values()) result.set(record.key_id, record.public_key_hex);
  }
  const publisher = await loadPublisherConfig(publisherFile);
  if (publisher) result.set(publisher.key_id, publisher.public_key_hex);
  for (const value of publicKeyArgs) {
    const [keyId, hex] = value.split(':', 2);
    if (!keyId || !/^[0-9a-fA-F]{64}$/.test(hex ?? '')) {
      throw new Error(`--public-key 需要 key_id:<64 hex> 形式，当前为 ${JSON.stringify(value)}`);
    }
    result.set(keyId, hex.toLowerCase());
  }
  return Object.fromEntries(result);
}

export function trustedKeysEnvValue(keys) {
  return Object.entries(keys).map(([keyId, hex]) => `${keyId}:${hex}`).join(',');
}
