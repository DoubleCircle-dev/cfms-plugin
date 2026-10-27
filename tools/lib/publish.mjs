// 通过 GitHub Releases 发布插件包与 catalog。
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_RELEASE_TAG = 'plugins';

/** 从 git remote URL 解析 owner/repo。 */
export function parseGithubRepo(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null;
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

/** release tag 会成为下载 URL 的一段，限制在安全字符内。 */
export function validateReleaseTag(tag) {
  if (typeof tag !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(tag)) {
    throw new Error(`release tag 非法：${JSON.stringify(tag)}（只允许字母/数字/._-，且不以符号开头）`);
  }
  return tag;
}

/** Releases 资源的公开下载前缀；catalog 与 .cfmsext 都放在同一 tag 下。 */
export function releaseAssetBaseUrl(repo, tag) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`GitHub 仓库名非法：${JSON.stringify(repo)}（应为 owner/repo）`);
  }
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(validateReleaseTag(tag))}`;
}

export function buildReleaseNotes(packages, tag) {
  const lines = [
    `CFMS 插件发布（tag: ${tag}）`,
    '',
    ...packages.map((item) => `- ${item.manifest.name} v${item.manifest.version} (\`${item.manifest.id}\`)`),
    '',
    '附件中的 catalog.json/.sig 与各插件 .cfmsext 均使用同一发布密钥签名。',
  ];
  return lines.join('\n');
}

function quote(arg) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function runGh(args, { dryRun = false, quiet = false } = {}) {
  if (dryRun) {
    if (!quiet) console.log(`  gh ${args.map(quote).join(' ')}`);
    return { status: 0, stdout: '', stderr: '' };
  }
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`无法执行 gh：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`gh ${args[0]} 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

/**
 * 创建或更新 GitHub Release，并上传 catalog 与所有插件包。
 * @returns {Promise<{created: boolean, tag: string, repo: string, assets: string[]}>}
 */
export async function publishRelease({ repo, tag, assetPaths, title, notes, dryRun = false }) {
  validateReleaseTag(tag);
  if (!Array.isArray(assetPaths) || assetPaths.length === 0) {
    throw new Error('没有可上传的发布资源');
  }
  const assets = assetPaths.map(String);
  const common = ['--repo', repo];

  if (dryRun) {
    console.log('  # 若 release 不存在：');
    runGh(
      ['release', 'create', tag, ...common, '--title', title, '--notes-file', '<release-notes.md>', ...assets],
      { dryRun: true },
    );
    console.log('  # 若 release 已存在：');
    runGh(['release', 'upload', tag, ...common, '--clobber', ...assets], { dryRun: true });
    return { created: false, tag, repo, assets, dryRun: true };
  }

  runGh(['auth', 'status'], { quiet: true });
  const view = spawnSync('gh', ['release', 'view', tag, ...common], { encoding: 'utf8' });
  const exists = view.status === 0;

  const notesDir = await mkdtemp(path.join(os.tmpdir(), 'cfms-release-notes-'));
  const notesFile = path.join(notesDir, 'release-notes.md');
  await writeFile(notesFile, notes, 'utf8');
  try {
    if (exists) {
      runGh(['release', 'upload', tag, ...common, '--clobber', ...assets]);
    } else {
      runGh(['release', 'create', tag, ...common, '--title', title, '--notes-file', notesFile, ...assets]);
    }
  } finally {
    await rm(notesDir, { recursive: true, force: true });
  }
  return { created: !exists, tag, repo, assets };
}
