#!/usr/bin/env node
// 生成开发用 Ed25519 签名密钥。
import path from 'node:path';
import process from 'node:process';
import { createKeyRecord, saveKeyRecord } from './lib/keys.mjs';
import { fail, log, parseArgs } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['force', 'json'], values: ['id', 'out'] });
const keyId = args.values.id ?? 'dev-local';
const keysDir = path.resolve(args.values.out ?? 'keys');

try {
  const record = createKeyRecord(keyId);
  const target = await saveKeyRecord(keysDir, record, { force: Boolean(args.flags.force) });
  if (args.flags.json) {
    console.log(JSON.stringify({ path: target, ...record }, null, 2));
  } else {
    log.ok(`已生成密钥 ${record.key_id}`);
    log.info(`  私钥：${target}（已在 .gitignore 中，切勿提交）`);
    log.info(`  公钥：${record.public_key_hex}`);
    log.info('');
    log.info('在构建客户端前注入信任公钥（PowerShell）：');
    log.info(`  $env:CFMS_EXTENSION_TRUSTED_KEYS = "${record.key_id}:${record.public_key_hex}"`);
    log.info('');
    log.info('之后打包插件：');
    log.info('  node tools/pack.mjs plugins/<name>');
  }
} catch (cause) {
  fail(cause.message);
}
