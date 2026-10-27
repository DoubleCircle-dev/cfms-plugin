#!/usr/bin/env node
// 生成一个新插件（扩展包）的源码骨架。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { TARGET_CLIENT } from './lib/client.mjs';
import { isValidExtensionId } from './lib/validate.mjs';
import { fail, log, parseArgs, pathExists } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['force'],
  values: ['name', 'publisher', 'description', 'dir', 'version', 'capabilities'],
});
const extensionId = args._[0];
if (!extensionId) {
  fail('用法：node tools/new-plugin.mjs <extension-id> [--name "显示名"] [--publisher "发布者"] [--dir plugins/<slug>]');
}
if (!isValidExtensionId(extensionId)) {
  fail(`扩展 id 非法：${extensionId}。要求反向域名格式，例如 com.example.my-plugin（小写字母/数字/-，至少一个 "."）`);
}

const slug = extensionId.split('.').pop();
const displayName = args.values.name ?? slug;
const publisher = args.values.publisher ?? 'Example Publisher';
const description = args.values.description ?? '一个 CFMS Client 声明式扩展。';
const version = args.values.version ?? '0.1.0';
const capabilities = (args.values.capabilities ?? 'account.summary.read,ui.notify')
  .split(',').map((value) => value.trim()).filter(Boolean);
const directory = path.resolve(args.values.dir ?? path.join('plugins', slug));

if (!args.flags.force && await pathExists(directory)) {
  fail(`目录已存在：${directory}（如需覆盖请加 --force，但会覆盖同名文件）`);
}

const manifest = {
  schema_version: 1,
  id: extensionId,
  name: displayName,
  description,
  publisher,
  version,
  host_api: '1.x',
  min_client_version: TARGET_CLIENT.version,
  platforms: ['windows', 'linux', 'macos'],
  entrypoints: {
    navigation: [{ id: 'overview', label: displayName, icon: 'extensions', page: 'overview' }],
    settings: [],
    workflows: [{ id: 'hello', label: '运行示例工作流', workflow: 'hello' }],
  },
  requested_capabilities: capabilities,
  background_triggers: [],
  content_hashes: {},
};

const page = {
  schema_version: 1,
  title: displayName,
  description,
  blocks: [
    {
      type: 'status_card',
      title: '扩展已加载',
      value: `v${version}`,
      description: '声明式数据包，不包含可执行代码',
      tone: 'success',
    },
    {
      type: 'text',
      style: 'body',
      text: '这是 new-plugin 生成的示例页面。修改 pages/overview.json 开始构建界面。',
    },
    {
      type: 'actions',
      actions: [
        { id: 'hello', label: '运行示例工作流', workflow: 'hello', tone: 'primary' },
      ],
    },
  ],
};

const workflow = {
  schema_version: 1,
  start: 'account',
  nodes: [
    {
      id: 'account',
      type: 'host_call',
      capability: 'account.summary.read',
      arguments: {},
      result: 'account',
      next: 'message',
    },
    {
      id: 'message',
      type: 'transform',
      expression: { op: 'concat', args: ['当前登录用户：', '$results.account.username'] },
      result: 'message',
      next: 'notify',
    },
    { id: 'notify', type: 'notify', tone: 'success', message: '$results.message', next: 'done' },
    { id: 'done', type: 'result', value: '$results.message' },
  ],
};

await mkdir(path.join(directory, 'pages'), { recursive: true });
await mkdir(path.join(directory, 'workflows'), { recursive: true });
await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(path.join(directory, 'pages', 'overview.json'), `${JSON.stringify(page, null, 2)}\n`, 'utf8');
await writeFile(path.join(directory, 'workflows', 'hello.json'), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

log.ok(`已创建插件 ${extensionId}`);
log.detail('目录', directory);
log.info('');
log.info('下一步：');
log.info(`  1. 编辑 ${path.join(directory, 'manifest.json')} 与 pages/、workflows/`);
log.info(`  2. node tools/pack.mjs ${directory}`);
try {
  await readFile('publisher.json');
} catch {
  log.info('  0. 还没有发布方密钥？先运行 node tools/keygen.mjs --publisher');
}
