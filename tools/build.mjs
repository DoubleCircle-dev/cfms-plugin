#!/usr/bin/env node
// 构建 plugins/ 下的所有（或指定）插件，并可选生成 catalog。
import path from 'node:path';
import process from 'node:process';
import { buildPlugins } from './lib/build.mjs';
import { fail, formatBytes, log, parseArgs, printErrors, printWarnings } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['json'],
  values: ['plugins', 'out', 'keys', 'publisher', 'base-url'],
});
const pluginsDir = path.resolve(args.values.plugins ?? 'plugins');
const outDir = path.resolve(args.values.out ?? 'dist');
const only = args._;

try {
  const result = await buildPlugins({
    pluginsDir,
    outDir,
    keysDir: path.resolve(args.values.keys ?? 'keys'),
    publisherFile: path.resolve(args.values.publisher ?? 'publisher.json'),
    baseUrl: args.values['base-url'],
    only,
  });
  printWarnings(result.warnings);
  if (result.errors.length > 0) {
    printErrors(result.errors);
    process.exit(1);
  }
  if (result.packages.length === 0) {
    log.warn(`没有插件可构建：${pluginsDir} 下没有包含 manifest.json 的目录`);
    process.exit(0);
  }

  for (const item of result.packages) {
    log.ok(`${item.name} -> ${item.path}`);
    log.detail('扩展', `${item.manifest.name} (${item.manifest.id}) v${item.manifest.version}`);
    log.detail('大小', formatBytes(item.size));
    log.detail('SHA-256', item.digest);
    log.detail('签名密钥', item.keyId);
  }
  if (result.catalog) {
    log.ok(`catalog -> ${result.catalog.path}`);
    log.detail('catalog URL', result.catalog.url);
  } else {
    log.info('未生成 catalog（传 --base-url 可在构建时一并生成）');
  }

  if (args.flags.json) {
    console.log(JSON.stringify({
      packages: result.packages.map((item) => ({
        name: item.name,
        fileName: item.fileName,
        manifest: item.manifest,
        digest: item.digest,
        size: item.size,
        keyId: item.keyId,
      })),
      catalog: result.catalog
        ? { path: result.catalog.path, signature: result.catalog.signaturePath, url: result.catalog.url }
        : null,
    }, null, 2));
  }
} catch (cause) {
  fail(cause.message);
}
