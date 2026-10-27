import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packPluginDirectory } from '../tools/lib/pack.mjs';
import { inspectPackage } from '../tools/lib/verify.mjs';
import { createKeyRecord } from '../tools/lib/keys.mjs';
import { createFixturePlugin } from './fixtures.mjs';

test('打包 fixture 并通过验签', async () => {
  const fixture = await createFixturePlugin();
  try {
    const key = createKeyRecord('dev-local');
    const result = await packPluginDirectory(fixture.dir, {
      privateKeyHex: key.private_key_hex,
      keyId: key.key_id,
    });
    assert.deepEqual(result.errors, []);
    const inspected = inspectPackage(result.buffer, { publicKeys: { [key.key_id]: key.public_key_hex } });
    assert.deepEqual(inspected.errors, []);
    assert.equal(inspected.manifest.id, 'com.example.fixture');
    assert.equal(inspected.keyId, 'dev-local');

    const entries = inspected.entries;
    assert.ok(entries.has('META-INF/files.json'));
    assert.ok(entries.has('META-INF/signature.ed25519'));
    const index = JSON.parse(entries.get('META-INF/files.json').toString('utf8'));
    assert.deepEqual(index.files.map((file) => file.path), [
      'manifest.json',
      'pages/overview.json',
      'workflows/hello.json',
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test('打包是确定性的', async () => {
  const fixture = await createFixturePlugin();
  try {
    const key = createKeyRecord('dev-local');
    const options = { privateKeyHex: key.private_key_hex, keyId: key.key_id };
    const first = await packPluginDirectory(fixture.dir, options);
    const second = await packPluginDirectory(fixture.dir, options);
    assert.deepEqual(first.buffer, second.buffer);
    assert.equal(first.digest, second.digest);
  } finally {
    await fixture.cleanup();
  }
});

test('用不匹配的公钥校验会报签名失败', async () => {
  const fixture = await createFixturePlugin();
  try {
    const signer = createKeyRecord('dev-local');
    const other = createKeyRecord('dev-local');
    const result = await packPluginDirectory(fixture.dir, {
      privateKeyHex: signer.private_key_hex,
      keyId: signer.key_id,
    });
    const inspected = inspectPackage(result.buffer, {
      publicKeys: { 'dev-local': other.public_key_hex },
    });
    assert.ok(inspected.errors.some((error) => error.includes('签名验证失败')));
  } finally {
    await fixture.cleanup();
  }
});

test('未提供公钥时只跳过签名验证，其余结构仍校验', async () => {
  const fixture = await createFixturePlugin();
  try {
    const key = createKeyRecord('dev-local');
    const result = await packPluginDirectory(fixture.dir, {
      privateKeyHex: key.private_key_hex,
      keyId: key.key_id,
    });
    const inspected = inspectPackage(result.buffer, { publicKeys: {} });
    assert.deepEqual(inspected.errors, []);
    assert.ok(inspected.warnings.some((warning) => warning.includes('跳过签名验证')));
  } finally {
    await fixture.cleanup();
  }
});
