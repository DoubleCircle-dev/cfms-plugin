#!/usr/bin/env node
// 构建/验证扩展目录 catalog.json（及 catalog.json.sig）。
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildCatalog, catalogDigest, verifyCatalog } from './lib/catalog.mjs';
import { resolveSigningKey, resolveTrustedKeys } from './lib/keys.mjs';
import { fail, log, parseArgs, printErrors, printWarnings } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['json'],
  values: ['base-url', 'dist', 'keys', 'key', 'sign-key', 'out', 'sig', 'public-key'],
});
const command = args._[0] ?? 'build';

try {
  const keysDir = path.resolve(args.values.keys ?? 'keys');
  if (command === 'build') {
    const baseUrl = args.values['base-url'];
    if (!baseUrl) fail('用法：node tools/catalog.mjs build --base-url https://user.github.io/cfms-plugin/v1 [--dist dist] [--out dist/catalog]');
    const distDir = path.resolve(args.values.dist ?? 'dist');
    const outDir = path.resolve(args.values.out ?? path.join('dist', 'catalog'));
    const publicKeys = await resolveTrustedKeys({
      keyPaths: args.values.key ? [args.values.key] : [],
      keysDir,
      publicKeyArgs: args.values['public-key'] ? args.values['public-key'].split(',') : [],
    });
    const signKey = args.values['sign-key']
      ? await resolveSigningKey({ keyPath: args.values['sign-key'] })
      : await resolveSigningKey({ keysDir });
    if (!publicKeys[signKey.key_id]) {
      publicKeys[signKey.key_id] = signKey.public_key_hex;
    }

    const entries = await readdir(distDir, { withFileTypes: true });
    const packageFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.cfmsext'))
      .map((entry) => entry.name)
      .sort();
    if (packageFiles.length === 0) fail(`目录 ${distDir} 中没有 .cfmsext，请先运行 node tools/pack.mjs`);

    const packages = [];
    for (const fileName of packageFiles) {
      packages.push({ fileName, buffer: await readFile(path.join(distDir, fileName)) });
    }
    const result = buildCatalog(packages, {
      baseUrl,
      publicKeys,
      signPrivateKeyHex: signKey.private_key_hex,
      signKeyId: signKey.key_id,
      generatedAt: process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) : undefined,
    });
    printWarnings(result.warnings);
    if (result.errors.length > 0) {
      printErrors(result.errors);
      process.exit(1);
    }
    await mkdir(outDir, { recursive: true });
    const catalogPath = path.join(outDir, 'catalog.json');
    const signaturePath = path.join(outDir, 'catalog.json.sig');
    await writeFile(catalogPath, result.catalogBytes);
    await writeFile(signaturePath, result.signatureEnvelopeBytes);

    if (args.flags.json) {
      console.log(JSON.stringify({
        catalog: catalogPath,
        signature: signaturePath,
        digest: catalogDigest(result.catalogBytes),
        extensions: result.catalog.extensions.map((entry) => ({
          id: entry.manifest.id,
          version: entry.manifest.version,
          download_url: entry.download_url,
        })),
      }, null, 2));
    } else {
      log.ok(`已生成 ${catalogPath} 与 ${signaturePath}`);
      for (const entry of result.catalog.extensions) {
        log.detail(`${entry.manifest.id}@${entry.manifest.version}`, entry.download_url);
      }
      log.detail('catalog SHA-256', catalogDigest(result.catalogBytes));
      log.info('');
      log.info('把 catalog.json、catalog.json.sig 与所有 .cfmsext 一起发布到静态站点的对应路径（默认客户端读取 .../v1/catalog.json）。');
    }
  } else if (command === 'verify') {
    const catalogPath = args._[1];
    if (!catalogPath) fail('用法：node tools/catalog.mjs verify <catalog.json> [--sig catalog.json.sig] [--keys keys]');
    const signaturePath = args.values.sig ?? `${catalogPath}.sig`;
    const catalogBytes = await readFile(catalogPath);
    const signatureBytes = await readFile(signaturePath);
    const publicKeys = await resolveTrustedKeys({
      keysDir,
      publicKeyArgs: args.values['public-key'] ? args.values['public-key'].split(',') : [],
    });
    const result = verifyCatalog(catalogBytes, signatureBytes, publicKeys);
    printWarnings(result.warnings);
    if (result.errors.length > 0) {
      printErrors(result.errors);
      process.exit(1);
    }
    if (args.flags.json) {
      console.log(JSON.stringify(result.catalog, null, 2));
    } else {
      log.ok(`catalog 校验通过：${(result.catalog.extensions ?? []).length} 个扩展`);
    }
  } else {
    fail(`未知子命令 ${command}（支持 build / verify）`);
  }
} catch (cause) {
  fail(cause.message);
}
