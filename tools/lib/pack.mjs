// 打包：源码目录 -> 已签名的 .cfmsext（确定性 ZIP）。
import { collectFiles, sha256Hex } from './util.mjs';
import { MAX_PACKAGE_BYTES, validatePluginSource } from './validate.mjs';
import { writeZip } from './zip.mjs';
import { signBytes } from './crypto.mjs';

export function buildFileIndex(files) {
  const entries = [...files.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => {
      const data = files.get(path);
      return { path, sha256: sha256Hex(data), size: data.length };
    });
  return { files: entries };
}

/** 校验源码并生成签名包；失败时返回 { errors } 而不抛错。 */
export async function packPluginDirectory(sourceDir, { privateKeyHex, keyId }) {
  const files = await collectFiles(sourceDir);
  const { manifest, errors, warnings } = validatePluginSource(files);
  if (!manifest || errors.length > 0) {
    return { errors, warnings };
  }

  const index = buildFileIndex(files);
  // serde_json 的紧凑序列化与 JSON.stringify 在字段顺序相同时字节一致。
  const indexBytes = Buffer.from(JSON.stringify(index));
  const signature = signBytes(privateKeyHex, indexBytes);
  const signatureHex = signature.toString('hex');
  const envelope = Buffer.from(JSON.stringify({ key_id: keyId, signature: signatureHex }));

  const zipEntries = [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, data]) => ({ path, data }));
  zipEntries.push(
    { path: 'META-INF/files.json', data: indexBytes },
    { path: 'META-INF/signature.ed25519', data: envelope },
  );
  const buffer = writeZip(zipEntries);
  if (buffer.length > MAX_PACKAGE_BYTES) {
    return { errors: [`打包结果 ${buffer.length} 字节超过上限 ${MAX_PACKAGE_BYTES} 字节`], warnings };
  }

  return {
    manifest,
    buffer,
    index,
    indexBytes,
    signatureHex,
    keyId,
    digest: sha256Hex(buffer),
    errors: [],
    warnings,
  };
}

/** 由 manifest 生成默认产物文件名，如 file-stats-1.0.0.cfmsext。 */
export function defaultPackageFileName(manifest) {
  const shortId = manifest.id.split('.').pop();
  return `${shortId}-${manifest.version}.cfmsext`;
}
