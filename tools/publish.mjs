#!/usr/bin/env node
// 构建 plugins/ 下的所有插件，签名 catalog，并发布到 GitHub Releases。
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { buildPlugins } from './lib/build.mjs';
import {
  DEFAULT_RELEASE_TAG,
  buildReleaseNotes,
  parseGithubRepo,
  publishRelease,
  releaseAssetBaseUrl,
  validateReleaseTag,
} from './lib/publish.mjs';
import { fail, log, parseArgs, printErrors, printWarnings } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['dry-run'],
  values: ['tag', 'repo', 'plugins', 'out', 'keys', 'publisher', 'base-url', 'notes'],
});

try {
  let repo = args.values.repo;
  if (!repo) {
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (remote.status !== 0) {
      fail('无法从 git remote 推断仓库，请用 --repo owner/repo 指定');
    }
    repo = parseGithubRepo(remote.stdout);
    if (!repo) fail(`无法从 origin URL 解析 GitHub 仓库：${remote.stdout.trim()}，请用 --repo 指定`);
  }
  const tag = validateReleaseTag(args.values.tag ?? DEFAULT_RELEASE_TAG);
  const baseUrl = args.values['base-url'] ?? releaseAssetBaseUrl(repo, tag);
  const pluginsDir = path.resolve(args.values.plugins ?? 'plugins');
  const outDir = path.resolve(args.values.out ?? 'dist');

  const result = await buildPlugins({
    pluginsDir,
    outDir,
    keysDir: path.resolve(args.values.keys ?? 'keys'),
    publisherFile: path.resolve(args.values.publisher ?? 'publisher.json'),
    baseUrl,
  });
  printWarnings(result.warnings);
  if (result.errors.length > 0) {
    printErrors(result.errors);
    process.exit(1);
  }
  if (result.packages.length === 0) {
    fail(`没有可发布的插件：${pluginsDir} 下没有包含 manifest.json 的目录`);
  }

  const assetPaths = [
    ...result.packages.map((item) => item.path),
    result.catalog.path,
    result.catalog.signaturePath,
  ];
  const notes = args.values.notes ?? buildReleaseNotes(result.packages, tag);
  const title = `CFMS plugins (${tag})`;

  log.info('');
  log.step(`发布目标：${repo}@${tag}`);
  log.detail('插件数', String(result.packages.length));
  log.detail('catalog URL', result.catalog.url);
  for (const item of result.packages) {
    log.detail(item.name, `${item.fileName}（签名密钥 ${item.keyId}）`);
  }
  log.info('');

  if (args.flags['dry-run']) {
    log.info('发布说明：');
    log.info(notes);
    log.info('');
  }

  const outcome = await publishRelease({
    repo,
    tag,
    assetPaths,
    title,
    notes,
    dryRun: Boolean(args.flags['dry-run']),
  });

  if (args.flags['dry-run']) {
    log.info('dry-run：以上命令未执行。');
  } else {
    log.ok(`已发布 GitHub Release：https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`);
  }
  log.detail('catalog 地址', result.catalog.url);
  log.info('');
  log.info('客户端构建时把 catalog 地址指向上面的 URL（custom 分支默认值在');
  log.info('crates/service/src/extensions.rs 的 DEFAULT_CATALOG_URL），并信任发布公钥：');
  log.info('  $env:CFMS_EXTENSION_TRUSTED_KEYS = "<publisher.json 的 key_id>:<public_key_hex>"');
  if (!outcome.created && !args.flags['dry-run']) {
    log.info('（Release 已存在，本次以 --clobber 覆盖同名附件。）');
  }
} catch (cause) {
  fail(cause.message);
}
