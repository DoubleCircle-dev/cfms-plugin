#!/usr/bin/env node
// 校验一个或多个 .cfmsext：结构、索引、签名、manifest 与声明式文档。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inspectPackage } from './lib/verify.mjs';
import { resolveTrustedKeys } from './lib/keys.mjs';
import { fail, formatBytes, log, parseArgs, printErrors, printWarnings } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['json'],
  values: ['key', 'keys', 'public-key'],
});
if (args._.length === 0) {
  fail('用法：node tools/verify.mjs <package.cfmsext ...> [--key keys/dev-local.json] [--public-key id:hex]');
}

try {
  const publicKeys = await resolveTrustedKeys({
    keyPaths: args.values.key ? [args.values.key] : [],
    keysDir: path.resolve(args.values.keys ?? 'keys'),
    publicKeyArgs: args.values['public-key'] ? args.values['public-key'].split(',') : [],
  });
  const results = [];
  let failed = false;
  const packagePaths = await expandPackagePaths(args._);
  for (const packagePath of packagePaths) {
    const absolute = path.resolve(packagePath);
    const buffer = await readFile(absolute);
    const result = inspectPackage(buffer, { publicKeys, sourceName: absolute });
    const ok = result.errors.length === 0;
    failed ||= !ok;
    results.push({ path: absolute, ok, ...result });

    if (args.flags.json) continue;
    if (ok) log.ok(`校验通过：${path.basename(packagePath)}`);
    else log.error(`校验失败：${path.basename(packagePath)}`);
    log.detail('大小', formatBytes(result.size ?? buffer.length));
    log.detail('SHA-256', result.digest);
    if (result.manifest) {
      const manifest = result.manifest;
      log.detail('扩展', `${manifest.name} (${manifest.id}) v${manifest.version}`);
      log.detail('发布者', manifest.publisher);
      log.detail('host_api', manifest.host_api);
      log.detail('签名密钥', result.keyId);
      log.detail('能力', manifest.requested_capabilities.join(', ') || '（无）');
      const entrypoints = manifest.entrypoints ?? {};
      log.detail(
        '入口',
        [
          (entrypoints.navigation ?? []).length ? `导航 ${(entrypoints.navigation ?? []).length}` : null,
          (entrypoints.settings ?? []).length ? `设置 ${(entrypoints.settings ?? []).length}` : null,
          (entrypoints.workflows ?? []).length ? `工作流 ${(entrypoints.workflows ?? []).length}` : null,
        ].filter(Boolean).join(' / ') || '（无）',
      );
    }
    printWarnings(result.warnings);
    printErrors(result.errors);
  }

  if (args.flags.json) {
    console.log(JSON.stringify(results, null, 2));
  }
  if (failed) process.exit(1);
} catch (cause) {
  fail(cause.message);
}

/** 支持 Windows PowerShell 下不会被 shell 展开的通配符，如 dist/*.cfmsext。 */
async function expandPackagePaths(patterns) {
  const result = [];
  for (const pattern of patterns) {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      result.push(pattern);
      continue;
    }
    const directory = path.dirname(pattern);
    const namePattern = path.basename(pattern);
    const regex = new RegExp(
      `^${namePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    );
    let entries;
    try {
      entries = await readdir(directory);
    } catch (cause) {
      throw new Error(`无法展开 ${pattern}: ${cause.message}`);
    }
    const matches = entries
      .filter((name) => regex.test(name))
      .sort()
      .map((name) => path.join(directory, name));
    if (matches.length === 0) throw new Error(`没有匹配的文件：${pattern}`);
    result.push(...matches);
  }
  return result;
}
