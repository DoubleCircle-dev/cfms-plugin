// 测试用临时插件目录（不依赖仓库内示例）。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function baseManifest(id) {
  return {
    schema_version: 1,
    id,
    name: 'Fixture',
    description: '测试用扩展',
    publisher: 'Tests',
    version: '1.0.0',
    host_api: '1.x',
    min_client_version: '0.57.0-custom-0.1',
    platforms: ['windows'],
    entrypoints: {
      navigation: [{ id: 'overview', label: 'Fixture', icon: 'extensions', page: 'overview' }],
      settings: [],
      workflows: [{ id: 'hello', label: 'Hello', workflow: 'hello' }],
    },
    requested_capabilities: ['account.summary.read', 'ui.notify'],
    background_triggers: [],
    content_hashes: {},
  };
}

/** 创建临时插件目录，返回 { dir, manifest, cleanup }。 */
export async function createFixturePlugin({ id = 'com.example.fixture', version = '1.0.0' } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cfms-plugin-fixture-'));
  const manifest = baseManifest(id);
  manifest.version = version;
  const page = {
    schema_version: 1,
    title: 'Fixture',
    blocks: [
      { type: 'text', text: 'fixture' },
      { type: 'actions', actions: [{ id: 'hello', label: 'Hello', workflow: 'hello' }] },
    ],
  };
  const workflow = {
    schema_version: 1,
    start: 'hello',
    nodes: [{ id: 'hello', type: 'result', value: true }],
  };
  await mkdir(path.join(dir, 'pages'), { recursive: true });
  await mkdir(path.join(dir, 'workflows'), { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(dir, 'pages', 'overview.json'), `${JSON.stringify(page, null, 2)}\n`);
  await writeFile(path.join(dir, 'workflows', 'hello.json'), `${JSON.stringify(workflow, null, 2)}\n`);
  return {
    dir,
    manifest,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
