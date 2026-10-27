import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildPlugins } from '../tools/lib/build.mjs';
import { buildCatalog, verifyCatalog } from '../tools/lib/catalog.mjs';
import { createKeyRecord, saveKeyRecord, savePublisherConfig } from '../tools/lib/keys.mjs';
import { writeFixturePlugin } from './fixtures.mjs';

async function withWorkspace(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cfms-plugin-build-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function prepareSigning(directory) {
  const record = createKeyRecord('cfms-plugin');
  const keysDir = path.join(directory, 'keys');
  const keyPath = await saveKeyRecord(keysDir, record);
  const publisherFile = path.join(directory, 'publisher.json');
  await savePublisherConfig(publisherFile, record, { privateKeyFile: keyPath });
  return { record, keysDir, publisherFile };
}

test('多插件构建：每个插件一个目录，产物文件名互不冲突', async () => {
  await withWorkspace(async (directory) => {
    const pluginsDir = path.join(directory, 'plugins');
    await writeFixturePlugin(path.join(pluginsDir, 'demo-a'), { id: 'com.example.alpha' });
    await writeFixturePlugin(path.join(pluginsDir, 'demo-b'), { id: 'com.example.beta', version: '2.0.0' });
    const outDir = path.join(directory, 'dist');
    const { record, keysDir, publisherFile } = await prepareSigning(directory);
    const baseUrl = 'https://example.github.io/cfms-plugin/releases/download/plugins';

    const result = await buildPlugins({ pluginsDir, outDir, keysDir, publisherFile, baseUrl });
    assert.deepEqual(result.errors, []);
    assert.equal(result.packages.length, 2);
    assert.deepEqual(result.packages.map((item) => item.fileName), [
      'demo-a-1.0.0.cfmsext',
      'demo-b-2.0.0.cfmsext',
    ]);
    assert.ok(result.catalog);
    assert.equal(
      result.catalog.url,
      'https://example.github.io/cfms-plugin/releases/download/plugins/catalog.json',
    );

    const catalogBytes = await readFile(result.catalog.path);
    const signatureBytes = await readFile(result.catalog.signaturePath);
    const verified = verifyCatalog(catalogBytes, signatureBytes, {
      [record.key_id]: record.public_key_hex,
    });
    assert.deepEqual(verified.errors, []);
    assert.equal(verified.catalog.extensions.length, 2);
  });
});

test('插件目录为空时构建成功但没有产物', async () => {
  await withWorkspace(async (directory) => {
    const result = await buildPlugins({
      pluginsDir: path.join(directory, 'plugins'),
      outDir: path.join(directory, 'dist'),
      keysDir: path.join(directory, 'keys'),
      publisherFile: path.join(directory, 'publisher.json'),
    });
    assert.deepEqual(result.packages, []);
    assert.deepEqual(result.errors, []);
  });
});

test('指定不存在的插件名会报错', async () => {
  await withWorkspace(async (directory) => {
    const pluginsDir = path.join(directory, 'plugins');
    await writeFixturePlugin(path.join(pluginsDir, 'demo'));
    const result = await buildPlugins({
      pluginsDir,
      outDir: path.join(directory, 'dist'),
      keysDir: path.join(directory, 'keys'),
      publisherFile: path.join(directory, 'publisher.json'),
      only: ['missing'],
    });
    assert.ok(result.errors.some((error) => error.includes('找不到插件目录')));
  });
});

test('构建会清理上一次遗留的 .cfmsext', async () => {
  await withWorkspace(async (directory) => {
    const pluginsDir = path.join(directory, 'plugins');
    const outDir = path.join(directory, 'dist');
    await writeFixturePlugin(path.join(pluginsDir, 'demo'));
    const { keysDir, publisherFile } = await prepareSigning(directory);

    const first = await buildPlugins({ pluginsDir, outDir, keysDir, publisherFile });
    assert.equal(first.packages.length, 1);
    const stale = path.join(outDir, 'stale-0.1.0.cfmsext');
    await (await import('node:fs/promises')).writeFile(stale, 'stale');

    const second = await buildPlugins({ pluginsDir, outDir, keysDir, publisherFile });
    assert.equal(second.packages.length, 1);
    await assert.rejects(() => readFile(stale), /ENOENT/);
  });
});

test('buildCatalog 与构建器共用同一签名密钥', async () => {
  await withWorkspace(async (directory) => {
    const pluginsDir = path.join(directory, 'plugins');
    const outDir = path.join(directory, 'dist');
    await writeFixturePlugin(path.join(pluginsDir, 'demo'));
    const { record, keysDir, publisherFile } = await prepareSigning(directory);
    const result = await buildPlugins({
      pluginsDir,
      outDir,
      keysDir,
      publisherFile,
      baseUrl: 'https://example.github.io/cfms-plugin/releases/download/plugins',
    });
    const built = buildCatalog(
      [{ fileName: result.packages[0].fileName, buffer: result.packages[0].buffer }],
      {
        baseUrl: 'https://example.github.io/cfms-plugin/releases/download/plugins',
        publicKeys: { [record.key_id]: record.public_key_hex },
        signPrivateKeyHex: record.private_key_hex,
        signKeyId: record.key_id,
      },
    );
    assert.deepEqual(built.errors, []);
  });
});
