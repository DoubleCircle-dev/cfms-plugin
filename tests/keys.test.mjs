import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createKeyRecord,
  loadPublisherConfig,
  resolveSigningKey,
  resolveTrustedKeys,
  saveKeyRecord,
  savePublisherConfig,
} from '../tools/lib/keys.mjs';

async function withTempDir(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cfms-plugin-keys-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('publisher.json 驱动签名私钥与信任公钥', async () => {
  await withTempDir(async (directory) => {
    const record = createKeyRecord('cfms-plugin-publisher');
    const keyPath = await saveKeyRecord(path.join(directory, 'keys'), record);
    const publisherFile = path.join(directory, 'publisher.json');
    await savePublisherConfig(publisherFile, record, { privateKeyFile: keyPath });

    const config = await loadPublisherConfig(publisherFile);
    assert.equal(config?.key_id, record.key_id);
    assert.equal(config?.public_key_hex, record.public_key_hex);

    const signingKey = await resolveSigningKey({
      publisherFile,
      keysDir: path.join(directory, 'empty'),
    });
    assert.equal(signingKey.private_key_hex, record.private_key_hex);

    const trusted = await resolveTrustedKeys({
      publisherFile,
      keysDir: path.join(directory, 'empty'),
    });
    assert.equal(trusted[record.key_id], record.public_key_hex);
  });
});

test('publisher.json 公钥与私钥文件不匹配时拒绝签名', async () => {
  await withTempDir(async (directory) => {
    const record = createKeyRecord('cfms-plugin-publisher');
    const keyPath = await saveKeyRecord(path.join(directory, 'keys'), record);
    const publisherFile = path.join(directory, 'publisher.json');
    await savePublisherConfig(publisherFile, { ...record, public_key_hex: 'ab'.repeat(32) }, {
      privateKeyFile: keyPath,
    });
    await assert.rejects(
      () => resolveSigningKey({ publisherFile, keysDir: path.join(directory, 'empty') }),
      /公钥/,
    );
  });
});

test('没有 publisher.json 时仍可用 keys/ 中的单把密钥', async () => {
  await withTempDir(async (directory) => {
    const record = createKeyRecord('dev-local');
    await saveKeyRecord(path.join(directory, 'keys'), record);
    const signingKey = await resolveSigningKey({
      publisherFile: path.join(directory, 'missing-publisher.json'),
      keysDir: path.join(directory, 'keys'),
    });
    assert.equal(signingKey.key_id, 'dev-local');
  });
});
