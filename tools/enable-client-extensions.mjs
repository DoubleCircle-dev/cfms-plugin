#!/usr/bin/env node
// 为 custom 版客户端打开扩展入口，并打印开发构建所需的信任公钥环境变量。
//
// 背景：cfms_client_tauri custom 分支把扩展功能整体关闭在
// src/lib/feature-flags.ts 的 USER_EXTENSIONS_ENABLED 后面；同时扩展包签名
// 依赖编译期注入的 CFMS_EXTENSION_TRUSTED_KEYS。此脚本只改这一个开关，
// 不触碰其它文件。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { TARGET_CLIENT } from './lib/client.mjs';
import { resolveTrustedKeys, trustedKeysEnvValue } from './lib/keys.mjs';
import { fail, log, parseArgs, pathExists } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['enable', 'disable', 'check', 'json'],
  values: ['client', 'key', 'keys'],
});
if (!args.values.client) {
  fail('用法：node tools/enable-client-extensions.mjs --client <cfms_client_tauri 路径> [--enable|--disable|--check] [--key keys/dev-local.json]');
}

const clientDir = path.resolve(args.values.client);
const flagFile = path.join(clientDir, TARGET_CLIENT.extensionUiFlagFile);
const handlersFile = path.join(clientDir, 'src-tauri', 'src', 'lib.rs');
const enable = !args.flags.disable;
const checkOnly = Boolean(args.flags.check);

try {
  if (!await pathExists(path.join(clientDir, 'package.json'))) {
    fail(`不是客户端仓库：${clientDir} 缺少 package.json`);
  }
  if (!await pathExists(flagFile)) {
    fail(`找不到 ${flagFile}。客户端上游可能调整了扩展功能开关的位置，请参考 docs/client-dev-setup.md 手动处理。`);
  }

  const source = await readFile(flagFile, 'utf8');
  const match = TARGET_CLIENT.extensionUiFlagPattern.exec(source);
  if (!match) {
    fail(`${TARGET_CLIENT.extensionUiFlagFile} 中没有找到 USER_EXTENSIONS_ENABLED 声明；上游可能已改变实现方式，请手动确认。`);
  }
  const currentlyEnabled = match[1] === 'true';

  if (checkOnly) {
    log.info(`扩展入口：${currentlyEnabled ? '已启用' : '未启用'}（${flagFile}）`);
  } else if (currentlyEnabled === enable) {
    log.ok(`扩展入口已是${enable ? '启用' : '关闭'}状态，无需修改`);
  } else {
    const updated = source.replace(TARGET_CLIENT.extensionUiFlagPattern, `export const USER_EXTENSIONS_ENABLED = ${enable};`);
    await writeFile(flagFile, updated, 'utf8');
    log.ok(`已${enable ? '启用' : '关闭'}扩展入口：${flagFile}`);
    log.info('  用 git checkout -- src/lib/feature-flags.ts 可随时还原此改动。');
  }

  // 确认扩展后端命令仍然注册（上游若删除功能，这里会提醒）。
  if (await pathExists(handlersFile)) {
    const handlers = await readFile(handlersFile, 'utf8');
    const missing = ['get_extension_overview', 'import_extension_package', 'execute_extension_host_call']
      .filter((command) => !handlers.includes(command));
    if (missing.length > 0) {
      log.warn(`客户端未注册扩展命令：${missing.join(', ')}；扩展界面可能仍然无法工作。`);
    }
  } else {
    log.warn(`未找到 ${handlersFile}，跳过扩展命令注册检查。`);
  }

  if (!enable || checkOnly) {
    process.exit(0);
  }

  const publicKeys = await resolveTrustedKeys({
    keyPaths: args.values.key ? [args.values.key] : [],
    keysDir: path.resolve(args.values.keys ?? 'keys'),
  });
  if (Object.keys(publicKeys).length === 0) {
    log.warn('没有找到任何开发密钥，构建出的客户端将不信任任何扩展包。先运行 node tools/keygen.mjs。');
  } else {
    const envValue = trustedKeysEnvValue(publicKeys);
    log.info('');
    log.info('用以下命令构建/运行客户端（必须重新编译 Rust 才能注入信任公钥）：');
    log.info('');
    log.info(`  cd "${clientDir}"`);
    log.info(`  $env:CFMS_EXTENSION_TRUSTED_KEYS = "${envValue}"`);
    log.info('  pnpm tauri dev');
    log.info('');
    log.info('构建安装包：');
    log.info('  pnpm tauri build');
    log.info('');
    log.info(`信任的签名密钥：${Object.keys(publicKeys).join(', ')}`);
  }
  log.info('');
  log.info(`客户端数据目录：${TARGET_CLIENT.appDataDirPattern}`);
  log.info(`目标客户端版本：${TARGET_CLIENT.version}（host API ${TARGET_CLIENT.hostApi}）`);
} catch (cause) {
  fail(cause.message);
}
