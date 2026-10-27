import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateManifest,
  validatePageDocument,
  validatePluginSource,
  validateWorkflowDocument,
} from '../tools/lib/validate.mjs';

function baseManifest() {
  return {
    schema_version: 1,
    id: 'com.example.demo',
    name: 'Demo',
    description: 'Demo extension',
    publisher: 'Example',
    version: '1.0.0',
    host_api: '1.x',
    min_client_version: '0.57.0-custom-0.1',
    platforms: ['windows'],
    entrypoints: {
      navigation: [{ id: 'overview', label: 'Demo', icon: 'extensions', page: 'overview' }],
      settings: [],
      workflows: [{ id: 'hello', label: 'Hello', workflow: 'hello' }],
    },
    requested_capabilities: ['account.summary.read'],
    background_triggers: [],
    content_hashes: {},
  };
}

test('合法 manifest 没有错误', () => {
  const result = validateManifest(baseManifest());
  assert.deepEqual(result.errors, []);
});

test('manifest 校验覆盖 id/host_api/能力/触发器/最低版本', () => {
  const manifest = baseManifest();
  manifest.id = 'Bad_ID';
  manifest.host_api = '2.0.0';
  manifest.requested_capabilities = ['account.summary.read', 'account.summary.read', 'evil.capability'];
  manifest.background_triggers = [
    { type: 'interval', workflow: 'hello', minutes: 5 },
    { type: 'event', workflow: 'hello', event: 'files.changed' },
  ];
  manifest.min_client_version = '99.0.0';
  const { errors } = validateManifest(manifest);
  assert.ok(errors.some((error) => error.includes('反向域名')));
  assert.ok(errors.some((error) => error.includes('host_api')));
  assert.ok(errors.some((error) => error.includes('不支持的能力')));
  assert.ok(errors.some((error) => error.includes('重复声明能力')));
  assert.ok(errors.some((error) => error.includes('minutes')));
  assert.ok(errors.some((error) => error.includes('event')));
  assert.ok(errors.some((error) => error.includes('高于目标客户端版本')));
});

test('工作流：未知节点、悬空 next、非法表达式、越界导航都报错', () => {
  const workflow = {
    schema_version: 1,
    start: 'a',
    nodes: [
      { id: 'a', type: 'teleport', next: 'missing' },
      { id: 'b', type: 'transform', expression: { op: 'explode', args: [] } },
      { id: 'c', type: 'navigate', to: '/settings' },
    ],
  };
  const { errors } = validateWorkflowDocument(workflow, 'workflows/x.json');
  assert.ok(errors.some((error) => error.includes('不受当前客户端支持')));
  assert.ok(errors.some((error) => error.includes('指向不存在的节点')));
  assert.ok(errors.some((error) => error.includes('explode')));
  assert.ok(errors.some((error) => error.includes('/home/')));
});

test('页面：未知 block 仅警告，合法 block 通过', () => {
  const page = {
    schema_version: 1,
    title: 'Demo',
    blocks: [
      { type: 'text', text: 'hi' },
      { type: 'unknown_widget' },
      { type: 'form', id: 'f', fields: [{ id: 'x', label: 'X', type: 'text' }] },
    ],
  };
  const { errors, warnings } = validatePageDocument(page, 'pages/overview.json');
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => warning.includes('unknown_widget')));
});

test('源码校验：入口引用的页面/工作流必须存在', () => {
  const files = new Map([
    ['manifest.json', Buffer.from(JSON.stringify(baseManifest()))],
  ]);
  const { errors } = validatePluginSource(files);
  assert.ok(errors.some((error) => error.includes('pages/overview.json')));
  assert.ok(errors.some((error) => error.includes('workflows/hello.json')));
});

test('源码校验：禁止任意文件', () => {
  const manifest = baseManifest();
  const files = new Map([
    ['manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['pages/overview.json', Buffer.from('{"schema_version":1,"title":"x","blocks":[]}')],
    ['workflows/hello.json', Buffer.from('{"schema_version":1,"start":"n","nodes":[{"id":"n","type":"result"}]}')],
    ['run.js', Buffer.from('alert(1)')],
  ]);
  const { errors } = validatePluginSource(files);
  assert.ok(errors.some((error) => error.includes('不允许的源码文件')));
});
