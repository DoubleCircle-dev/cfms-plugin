import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReleaseNotes,
  parseGithubRepo,
  releaseAssetBaseUrl,
  validateReleaseTag,
} from '../tools/lib/publish.mjs';

test('从 HTTPS/SSH remote 解析 GitHub 仓库', () => {
  assert.equal(parseGithubRepo('https://github.com/DoubleCircle-dev/cfms-plugin.git'), 'DoubleCircle-dev/cfms-plugin');
  assert.equal(parseGithubRepo('git@github.com:DoubleCircle-dev/cfms-plugin.git'), 'DoubleCircle-dev/cfms-plugin');
  assert.equal(parseGithubRepo('https://github.com/Owner/repo'), 'Owner/repo');
  assert.equal(parseGithubRepo('https://gitlab.com/Owner/repo.git'), null);
  assert.equal(parseGithubRepo('not a url'), null);
});

test('release tag 校验与下载前缀', () => {
  assert.equal(validateReleaseTag('plugins'), 'plugins');
  assert.equal(validateReleaseTag('plugins-2026.10.28'), 'plugins-2026.10.28');
  assert.throws(() => validateReleaseTag('bad/tag'), /非法/);
  assert.throws(() => validateReleaseTag('-leading'), /非法/);
  assert.equal(
    releaseAssetBaseUrl('DoubleCircle-dev/cfms-plugin', 'plugins'),
    'https://github.com/DoubleCircle-dev/cfms-plugin/releases/download/plugins',
  );
  assert.throws(() => releaseAssetBaseUrl('bad repo/x', 'plugins'), /仓库名非法/);
});

test('release notes 列出每个插件', () => {
  const notes = buildReleaseNotes([
    { manifest: { name: '插件 A', id: 'com.example.a', version: '1.0.0' } },
    { manifest: { name: '插件 B', id: 'com.example.b', version: '2.1.0' } },
  ], 'plugins');
  assert.match(notes, /插件 A v1\.0\.0/);
  assert.match(notes, /com\.example\.b/);
  assert.match(notes, /plugins/);
});
