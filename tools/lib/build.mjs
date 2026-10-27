// 多插件构建：发现 plugins/*/manifest.json，逐个打包签名、校验并生成 catalog。
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { packPluginDirectory } from './pack.mjs';
import { inspectPackage } from './verify.mjs';
import { buildCatalog } from './catalog.mjs';
import { resolveSigningKey, resolveTrustedKeys } from './keys.mjs';

/** 发现插件目录（含 manifest.json 的直接子目录），按名称排序。 */
export async function discoverPlugins(pluginsDir) {
  let entries;
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true });
  } catch (cause) {
    if (cause.code === 'ENOENT') return [];
    throw new Error(`无法读取插件目录 ${pluginsDir}: ${cause.message}`);
  }
  const plugins = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(pluginsDir, entry.name);
    try {
      const info = await stat(path.join(directory, 'manifest.json'));
      if (!info.isFile()) continue;
    } catch {
      continue;
    }
    plugins.push({ name: entry.name, directory });
  }
  return plugins;
}

async function cleanPackages(outDir) {
  let entries;
  try {
    entries = await readdir(outDir, { withFileTypes: true });
  } catch (cause) {
    if (cause.code === 'ENOENT') return;
    throw cause;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.cfmsext'))
      .map((entry) => rm(path.join(outDir, entry.name), { force: true })),
  );
}

/**
 * 构建多个插件。
 * @returns {Promise<{plugins: object[], packages: object[], catalog: null|object, errors: string[], warnings: string[]}>}
 */
export async function buildPlugins({
  pluginsDir = 'plugins',
  outDir = 'dist',
  keysDir = 'keys',
  publisherFile = 'publisher.json',
  baseUrl,
  only = [],
} = {}) {
  const allPlugins = await discoverPlugins(pluginsDir);
  const errors = [];
  const warnings = [];
  for (const plugin of allPlugins) {
    if (!/^[A-Za-z0-9._-]+$/.test(plugin.name)) {
      errors.push(`插件目录名 ${JSON.stringify(plugin.name)} 只能包含字母/数字/._-（会作为发布附件文件名）`);
    }
  }
  const knownNames = new Set(allPlugins.map((plugin) => plugin.name));
  for (const name of only) {
    if (!knownNames.has(name)) errors.push(`找不到插件目录：${pluginsDir}/${name}`);
  }
  const selected = only.length > 0
    ? allPlugins.filter((plugin) => only.includes(plugin.name))
    : allPlugins;
  if (selected.length === 0 || errors.length > 0) {
    return { plugins: selected, packages: [], catalog: null, errors, warnings };
  }

  const signingKey = await resolveSigningKey({ keysDir, publisherFile });
  const publicKeys = await resolveTrustedKeys({ keysDir, publisherFile });
  if (!publicKeys[signingKey.key_id]) {
    publicKeys[signingKey.key_id] = signingKey.public_key_hex;
  }

  await mkdir(outDir, { recursive: true });
  await cleanPackages(outDir);

  const packages = [];
  for (const plugin of selected) {
    const result = await packPluginDirectory(plugin.directory, {
      privateKeyHex: signingKey.private_key_hex,
      keyId: signingKey.key_id,
    });
    warnings.push(...result.warnings.map((warning) => `${plugin.name}: ${warning}`));
    if (result.errors.length > 0 || !result.buffer) {
      errors.push(...result.errors.map((error) => `${plugin.name}: ${error}`));
      continue;
    }
    const fileName = `${plugin.name}-${result.manifest.version}.cfmsext`;
    const target = path.join(outDir, fileName);
    await writeFile(target, result.buffer);

    const inspected = inspectPackage(result.buffer, { publicKeys });
    if (inspected.errors.length > 0) {
      errors.push(...inspected.errors.map((error) => `${plugin.name}: ${error}`));
      continue;
    }
    warnings.push(...inspected.warnings.map((warning) => `${plugin.name}: ${warning}`));
    packages.push({
      name: plugin.name,
      fileName,
      path: target,
      buffer: result.buffer,
      manifest: result.manifest,
      digest: result.digest,
      signature: result.signatureHex,
      keyId: result.keyId,
      size: result.buffer.length,
    });
  }

  if (errors.length > 0) {
    return { plugins: selected, packages: [], catalog: null, errors, warnings };
  }

  let catalog = null;
  if (baseUrl) {
    const built = buildCatalog(
      packages.map((item) => ({ fileName: item.fileName, buffer: item.buffer })),
      {
        baseUrl,
        publicKeys,
        signPrivateKeyHex: signingKey.private_key_hex,
        signKeyId: signingKey.key_id,
        generatedAt: process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) : undefined,
      },
    );
    warnings.push(...built.warnings);
    if (built.errors.length > 0) {
      errors.push(...built.errors);
    } else {
      const catalogDir = path.join(outDir, 'catalog');
      await mkdir(catalogDir, { recursive: true });
      const catalogPath = path.join(catalogDir, 'catalog.json');
      const signaturePath = path.join(catalogDir, 'catalog.json.sig');
      await writeFile(catalogPath, built.catalogBytes);
      await writeFile(signaturePath, built.signatureEnvelopeBytes);
      catalog = {
        path: catalogPath,
        signaturePath,
        url: `${baseUrl.replace(/\/+$/, '')}/catalog.json`,
        document: built.catalog,
      };
    }
  }

  return { plugins: selected, packages, catalog, errors, warnings };
}
