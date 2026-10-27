// 扩展目录（catalog.json）构建与验证：供 GitHub Pages 等静态站点发布。
import { isPlainObject, sha256Hex } from './util.mjs';
import { signBytes, verifyBytes } from './crypto.mjs';
import { inspectPackage } from './verify.mjs';
import { validateManifest } from './validate.mjs';

/**
 * @param {Array<{fileName: string, buffer: Buffer}>} packages
 * @param {{ baseUrl: string, publicKeys: Record<string,string>, signPrivateKeyHex: string, signKeyId: string, generatedAt?: number }} options
 */
export function buildCatalog(packages, options) {
  const errors = [];
  const warnings = [];
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  if (!/^https:\/\//.test(baseUrl)) {
    return { errors: ['catalog 的 base URL 必须是 https://（客户端校验 download_url）'], warnings };
  }

  const extensions = [];
  const seen = new Set();
  for (const { fileName, buffer, expectedKeyId } of packages) {
    const result = inspectPackage(buffer, { publicKeys: options.publicKeys });
    if (result.errors.length > 0 || !result.manifest) {
      errors.push(`${fileName}: ${result.errors.join('; ') || '无法解析 manifest'}`);
      continue;
    }
    warnings.push(...result.warnings.map((warning) => `${fileName}: ${warning}`));
    if (expectedKeyId && result.keyId !== expectedKeyId) {
      errors.push(`${fileName}: 包签名密钥 ${result.keyId} 与期望的 ${expectedKeyId} 不一致`);
      continue;
    }
    if (!options.publicKeys[result.keyId]) {
      errors.push(`${fileName}: 未知签名密钥 ${result.keyId}`);
      continue;
    }
    if (seen.has(result.manifest.id)) {
      errors.push(`${fileName}: 扩展 id ${result.manifest.id} 重复出现在 dist 中`);
      continue;
    }
    seen.add(result.manifest.id);
    extensions.push({
      manifest: result.manifest,
      download_url: `${baseUrl}/${encodeURIComponent(fileName)}`,
      sha256: result.digest,
      signature: result.signatureHex,
      key_id: result.keyId,
      revoked: false,
      revocation_reason: null,
    });
  }

  if (errors.length > 0) return { errors, warnings };

  extensions.sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0));
  const catalog = {
    schema_version: 1,
    generated_at: options.generatedAt ?? Math.floor(Date.now() / 1000),
    extensions,
  };
  const catalogBytes = Buffer.from(JSON.stringify(catalog));
  const signature = signBytes(options.signPrivateKeyHex, catalogBytes);
  const signatureEnvelopeBytes = Buffer.from(
    JSON.stringify({ key_id: options.signKeyId, signature: signature.toString('hex') }),
  );
  return { catalog, catalogBytes, signatureEnvelopeBytes, errors, warnings };
}

/** 验证 catalog.json 与 .sig，规则与客户端 verify_catalog 一致。 */
export function verifyCatalog(catalogBytes, signatureEnvelope, publicKeys) {
  const errors = [];
  const warnings = [];
  let envelope;
  try {
    envelope = JSON.parse(Buffer.isBuffer(signatureEnvelope) ? signatureEnvelope.toString('utf8') : signatureEnvelope);
  } catch (cause) {
    return { errors: [`catalog 签名信封不是合法 JSON: ${cause.message}`], warnings };
  }
  if (!isPlainObject(envelope) || typeof envelope.key_id !== 'string' || typeof envelope.signature !== 'string') {
    return { errors: ['catalog 签名信封必须是 { key_id, signature }'], warnings };
  }
  if (Object.keys(publicKeys).length === 0) {
    warnings.push('未提供信任公钥，跳过 catalog 签名验证');
  } else if (!publicKeys[envelope.key_id]) {
    errors.push(`catalog 使用了未知签名密钥 ${envelope.key_id}`);
  } else if (!verifyBytes(publicKeys[envelope.key_id], catalogBytes, Buffer.from(envelope.signature, 'hex'))) {
    errors.push('catalog Ed25519 签名验证失败');
  }

  let catalog;
  try {
    catalog = JSON.parse(Buffer.isBuffer(catalogBytes) ? catalogBytes.toString('utf8') : catalogBytes);
  } catch (cause) {
    return { errors: [...errors, `catalog 不是合法 JSON: ${cause.message}`], warnings };
  }
  if (!isPlainObject(catalog) || catalog.schema_version !== 1) errors.push('catalog.schema_version 必须是 1');
  if (!Array.isArray(catalog.extensions)) errors.push('catalog.extensions 必须是数组');

  if (Array.isArray(catalog.extensions)) {
    const ids = new Set();
    for (const [index, entry] of catalog.extensions.entries()) {
      const label = `catalog.extensions[${index}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${label} 必须是对象`);
        continue;
      }
      const manifestResult = validateManifest(entry.manifest);
      errors.push(...manifestResult.errors.map((error) => `${label}: ${error}`));
      warnings.push(...manifestResult.warnings.map((warning) => `${label}: ${warning}`));
      if (typeof entry.download_url !== 'string' || !entry.download_url.startsWith('https://')) {
        errors.push(`${label}.download_url 必须以 https:// 开头`);
      }
      if (typeof entry.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(entry.sha256)) {
        errors.push(`${label}.sha256 必须是 64 位 hex`);
      }
      if (typeof entry.signature !== 'string' || !/^[0-9a-fA-F]{128}$/.test(entry.signature)) {
        errors.push(`${label}.signature 必须是 64 字节 hex`);
      }
      if (typeof entry.key_id !== 'string' || !publicKeys[entry.key_id]) {
        errors.push(`${label}.key_id 未被信任：${JSON.stringify(entry.key_id)}`);
      }
      const id = entry.manifest?.id;
      if (typeof id === 'string') {
        if (ids.has(id)) errors.push(`${label}: 扩展 id ${id} 重复`);
        ids.add(id);
      }
    }
  }
  return { catalog, errors, warnings };
}

export function catalogDigest(catalogBytes) {
  return sha256Hex(catalogBytes);
}
