// 与本仓库插件对应的客户端事实。修改前请先同步 cfms_client_tauri 的 custom 分支源码。
export const TARGET_CLIENT = {
  /** custom 分支发布版本，对应 package.json / tauri.conf.json 中的版本号 */
  version: '0.57.0-custom-0.1',
  /** cfms_service::extensions::HOST_API_VERSION */
  hostApi: '1.0.0',
  /** 扩展系统在 custom 分支中被 src/lib/feature-flags.ts 关闭；启用方法见 docs/client-dev-setup.md */
  extensionUiFlagFile: 'src/lib/feature-flags.ts',
  extensionUiFlagPattern: /export const USER_EXTENSIONS_ENABLED = (true|false);/,
  /** 客户端按标识符存放扩展数据（Tauri app_data_dir） */
  appDataDirPattern: '%APPDATA%\\org.crpteam.cfms-client-tauri\\extensions',
};

/** semver：解析 major/minor/patch/prerelease；失败返回 null。 */
export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    value,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** 返回 -1/0/1；参数非法时抛错。语义与 semver crate 一致（含 prerelease 排序）。 */
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a) throw new Error(`非法 semver: ${left}`);
  if (!b) throw new Error(`非法 semver: ${right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;
  const length = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < length; i += 1) {
    const x = aPre[i];
    const y = bPre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
