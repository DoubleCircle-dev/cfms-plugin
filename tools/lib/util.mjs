// 通用小工具：参数解析、文件遍历、哈希、日志。
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export function parseArgs(argv, spec = {}) {
  const flags = new Set(spec.flags ?? []);
  const values = new Set(spec.values ?? []);
  const result = { _: [], flags: {}, values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split('=', 2);
    if (values.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--')) {
        fail(`参数 --${name} 缺少取值`);
      }
      result.values[name] = value;
    } else if (flags.has(name) || inline === undefined) {
      result.flags[name] = true;
    } else {
      result.values[name] = inline;
    }
  }
  return result;
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(target) {
  let raw;
  try {
    raw = await readFile(target, 'utf8');
  } catch (cause) {
    throw new Error(`无法读取 ${target}: ${cause.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${target} 不是合法 JSON: ${cause.message}`);
  }
}

/**
 * 递归收集目录下的普通文件；拒绝符号链接。
 * 返回 Map<relativePosixPath, Buffer>，按路径排序。
 */
export async function collectFiles(directory) {
  const files = new Map();
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`不允许符号链接：${absolute}`);
      }
      if (info.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!info.isFile()) {
        throw new Error(`不支持的目录项类型：${absolute}`);
      }
      files.set(relative, await readFile(absolute));
    }
  }
  await walk(directory, '');
  return files;
}

export function rel(from, to) {
  const value = path.relative(from, to) || '.';
  return value.split(path.sep).join('/');
}

const green = (text) => `\u001b[32m${text}\u001b[0m`;
const yellow = (text) => `\u001b[33m${text}\u001b[0m`;
const red = (text) => `\u001b[31m${text}\u001b[0m`;
const dim = (text) => `\u001b[2m${text}\u001b[0m`;

export const log = {
  step: (text) => console.log(`${dim('›')} ${text}`),
  info: (text) => console.log(text),
  ok: (text) => console.log(`${green('✓')} ${text}`),
  warn: (text) => console.warn(`${yellow('!')} ${text}`),
  error: (text) => console.error(`${red('✗')} ${text}`),
  detail: (label, value) => console.log(`  ${label}: ${value}`),
};

export function fail(message) {
  log.error(message);
  process.exit(1);
}

export function printWarnings(warnings, label = '警告') {
  if (!warnings || warnings.length === 0) return;
  log.warn(`${label}（${warnings.length}）`);
  for (const warning of warnings) log.info(`  - ${warning}`);
}

export function printErrors(errors, label = '错误') {
  if (!errors || errors.length === 0) return;
  log.error(`${label}（${errors.length}）`);
  for (const error of errors) log.info(`  - ${error}`);
}
