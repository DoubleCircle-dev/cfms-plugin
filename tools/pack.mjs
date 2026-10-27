#!/usr/bin/env node
// 把插件源码目录打包并签名为 .cfmsext。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { defaultPackageFileName, packPluginDirectory } from './lib/pack.mjs';
import { resolveSigningKey } from './lib/keys.mjs';
import { fail, formatBytes, log, parseArgs, printErrors, printWarnings } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['json', 'force'],
  values: ['key', 'keys', 'out'],
});
const sourceDir = args._[0];
if (!sourceDir) {
  fail('用法：node tools/pack.mjs <plugin-dir> [--key keys/dev-local.json] [--out dist]');
}

const keysDir = path.resolve(args.values.keys ?? 'keys');
const outDir = path.resolve(args.values.out ?? 'dist');

try {
  const key = await resolveSigningKey({
    keyPath: args.values.key,
    keysDir,
    publisherFile: path.resolve('publisher.json'),
  });
  const result = await packPluginDirectory(path.resolve(sourceDir), {
    privateKeyHex: key.private_key_hex,
    keyId: key.key_id,
  });
  printWarnings(result.warnings);
  if (result.errors.length > 0 || !result.buffer) {
    printErrors(result.errors);
    log.error(`打包失败：${sourceDir}`);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  const fileName = defaultPackageFileName(result.manifest);
  const target = path.join(outDir, fileName);
  await writeFile(target, result.buffer);

  if (args.flags.json) {
    console.log(JSON.stringify({
      path: target,
      fileName,
      sha256: result.digest,
      size: result.buffer.length,
      keyId: result.keyId,
      manifest: result.manifest,
    }, null, 2));
  } else {
    log.ok(`已生成 ${target}`);
    log.detail('扩展 id', result.manifest.id);
    log.detail('版本', result.manifest.version);
    log.detail('大小', formatBytes(result.buffer.length));
    log.detail('SHA-256', result.digest);
    log.detail('签名密钥', result.keyId);
    log.info('');
    log.info('在已启用扩展功能并信任该公钥的客户端中：设置 → 扩展 → 导入（选择上面的 .cfmsext）');
  }
} catch (cause) {
  fail(cause.message);
}
