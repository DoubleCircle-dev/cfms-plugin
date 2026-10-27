#!/usr/bin/env node
// 生成 Ed25519 签名密钥。--publisher 会同时写入 publisher.json（只含公钥与私钥路径）。
import path from 'node:path';
import process from 'node:process';
import { createKeyRecord, saveKeyRecord, savePublisherConfig } from './lib/keys.mjs';
import { fail, log, parseArgs } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['force', 'json', 'publisher'],
  values: ['id', 'out', 'publisher-file'],
});
const keyId = args.values.id ?? 'dev-local';
const keysDir = path.resolve(args.values.out ?? 'keys');
const publisherFile = path.resolve(args.values['publisher-file'] ?? 'publisher.json');

try {
  const record = createKeyRecord(keyId);
  const target = await saveKeyRecord(keysDir, record, { force: Boolean(args.flags.force) });
  let publisherConfig = null;
  if (args.flags.publisher) {
    const privateKeyFile = path.relative(process.cwd(), target).split(path.sep).join('/');
    publisherConfig = await savePublisherConfig(publisherFile, record, {
      force: Boolean(args.flags.force),
      privateKeyFile,
    });
  }

  if (args.flags.json) {
    console.log(JSON.stringify({ path: target, publisherFile: publisherConfig ? publisherFile : null, ...record }, null, 2));
  } else {
    log.ok(`已生成密钥 ${record.key_id}`);
    log.info(`  私钥：${target}（已被 .gitignore 忽略，切勿提交）`);
    log.info(`  公钥：${record.public_key_hex}`);
    if (publisherConfig) {
      log.info(`  发布方配置：${publisherFile}（已提交到仓库，只含公钥与私钥相对路径）`);
    }
    log.info('');
    log.info('构建客户端前注入信任公钥（PowerShell）：');
    log.info(`  $env:CFMS_EXTENSION_TRUSTED_KEYS = "${record.key_id}:${record.public_key_hex}"`);
    log.info('');
    log.info('之后打包/签名 catalog（默认自动使用 publisher.json 指向的这把密钥）：');
    log.info('  node tools/pack.mjs plugins/<name> --out dist');
    log.info('  node tools/catalog.mjs build --base-url https://...');
  }
} catch (cause) {
  fail(cause.message);
}
