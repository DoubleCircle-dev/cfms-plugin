// 本地开发签名密钥：生成、保存、加载。
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair } from './crypto.mjs';
import { isPlainObject } from './util.mjs';

export const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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

/** 解析 --key 参数、密钥目录与默认密钥。 */
export async function resolveSigningKey({ keyPath, keysDir = 'keys' } = {}) {
  if (keyPath) return loadKeyFile(keyPath);
  const keys = await loadKeysDirectory(keysDir);
  if (keys.size === 0) {
    throw new Error(`未找到签名密钥。先运行 node tools/keygen.mjs 生成 ${keysDir}/dev-local.json，或用 --key 指定`);
  }
  if (keys.size === 1) return [...keys.values()][0];
  const dev = keys.get('dev-local');
  if (dev) return dev;
  throw new Error(`密钥目录中有多个密钥（${[...keys.keys()].join(', ')}），请用 --key 指定`);
}

/** 解析信任公钥集合：--key / keys 目录 / --public-key keyid:hex。 */
export async function resolveTrustedKeys({ keyPaths = [], keysDir = 'keys', publicKeyArgs = [] } = {}) {
  const result = new Map();
  for (const keyPath of keyPaths) {
    const record = await loadKeyFile(keyPath);
    result.set(record.key_id, record.public_key_hex);
  }
  if (keyPaths.length === 0) {
    const keys = await loadKeysDirectory(keysDir);
    for (const record of keys.values()) result.set(record.key_id, record.public_key_hex);
  }
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
