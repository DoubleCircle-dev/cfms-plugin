import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packPluginDirectory } from '../tools/lib/pack.mjs';
import { buildCatalog, verifyCatalog } from '../tools/lib/catalog.mjs';
import { createKeyRecord } from '../tools/lib/keys.mjs';
import { createFixturePlugin } from './fixtures.mjs';

async function buildPackages(key) {
  const fixtures = [
    await createFixturePlugin({ id: 'com.example.alpha' }),
    await createFixturePlugin({ id: 'com.example.beta' }),
  ];
  try {
    const packages = [];
    for (const fixture of fixtures) {
      const result = await packPluginDirectory(fixture.dir, {
        privateKeyHex: key.private_key_hex,
        keyId: key.key_id,
      });
      assert.deepEqual(result.errors, [], fixture.dir);
      packages.push({
        fileName: `${result.manifest.id.split('.').pop()}-${result.manifest.version}.cfmsext`,
        buffer: result.buffer,
      });
    }
    return packages;
  } finally {
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
  }
}

test('catalog 构建与验证往返', async () => {
  const key = createKeyRecord('dev-local');
  const publicKeys = { [key.key_id]: key.public_key_hex };
  const packages = await buildPackages(key);
  const result = buildCatalog(packages, {
    baseUrl: 'https://example.github.io/cfms-plugin/v1',
    publicKeys,
    signPrivateKeyHex: key.private_key_hex,
    signKeyId: key.key_id,
    generatedAt: 1_700_000_000,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.catalog.extensions.length, 2);
  assert.ok(result.catalog.extensions.every((entry) => entry.download_url.startsWith('https://')));
  assert.ok(result.catalog.extensions.every((entry) => entry.signature.length === 128));

  const verified = verifyCatalog(result.catalogBytes, result.signatureEnvelopeBytes, publicKeys);
  assert.deepEqual(verified.errors, []);
});

test('catalog 只接受 https base url', async () => {
  const key = createKeyRecord('dev-local');
  const packages = await buildPackages(key);
  const result = buildCatalog(packages, {
    baseUrl: 'http://example.com/v1',
    publicKeys: { [key.key_id]: key.public_key_hex },
    signPrivateKeyHex: key.private_key_hex,
    signKeyId: key.key_id,
  });
  assert.ok(result.errors.some((error) => error.includes('https')));
});

test('catalog 内容被篡改后验签失败', async () => {
  const key = createKeyRecord('dev-local');
  const publicKeys = { [key.key_id]: key.public_key_hex };
  const packages = await buildPackages(key);
  const result = buildCatalog(packages, {
    baseUrl: 'https://example.github.io/cfms-plugin/v1',
    publicKeys,
    signPrivateKeyHex: key.private_key_hex,
    signKeyId: key.key_id,
  });
  const tampered = Buffer.from(result.catalogBytes);
  const index = tampered.indexOf(Buffer.from('alpha'));
  assert.ok(index >= 0, '测试需要找到可篡改的字符串');
  tampered[index] = 'A'.charCodeAt(0);
  const verified = verifyCatalog(tampered, result.signatureEnvelopeBytes, publicKeys);
  assert.ok(verified.errors.some((error) => error.includes('签名验证失败')));
});
