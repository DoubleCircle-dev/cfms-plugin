# CFMS Plugin

给 **CFMS Client custom 版本** 开发声明式扩展（`.cfmsext`）的仓库。
每个插件一个文件夹，可同时构建、签名并发布多个插件。

- 目标客户端：`../cfms_client_tauri`（`custom` 分支，`0.57.0-custom-0.1`，host API `1.0.0`）
- 运行环境：Node.js ≥ 20，零第三方依赖

## 目录

```
plugins/<plugin-name>/     # 每个插件一个文件夹：manifest.json + pages/ + workflows/
tools/                     # 构建、打包、签名、校验、发布工具
publisher.json             # 发布方签名配置（只有公钥）
keys/                      # 签名私钥（gitignored）
dist/                      # 构建产物（gitignored）
```

## 使用

```powershell
node tools/new-plugin.mjs com.example.my-plugin --dir plugins/my-plugin
node tools/build.mjs                                   # 构建 plugins/ 下的全部插件 -> dist/*.cfmsext
node tools/build.mjs my-plugin --base-url https://...  # 只构建一个并生成 catalog
node tools/publish.mjs                                 # 构建全部 + catalog + 发布到 GitHub Release
node tools/publish.mjs --dry-run                       # 只打印将执行的发布命令
node tools/pack.mjs plugins/my-plugin                  # 单插件打包（不经过构建管线）
node tools/verify.mjs dist/*.cfmsext                   # 校验包/索引/签名
node tools/enable-client-extensions.mjs --client ..\cfms_client_tauri
node --test                                            # 工具链测试
```

`build` 会重新生成 `dist/` 中的 `.cfmsext`，传 `--base-url` 时同时生成
`dist/catalog/catalog.json` 与 `.sig`。`publish` 需要本机 `gh` 已登录，
默认把附件发布到仓库的滚动 Release（tag `plugins`），已存在时以 `--clobber` 覆盖。

发布后的 catalog 地址（客户端 `DEFAULT_CATALOG_URL` 应指向它）：

```
https://github.com/DoubleCircle-dev/cfms-plugin/releases/download/plugins/catalog.json
```

## 签名

发布方用 Ed25519 私钥签插件包与 catalog：

- 签名 key id：`cfms-plugin`
- 签名公钥：`cf721edd3d63a06f07c1be2099e7dfbf407c11a4726ad422415314ce6ab961de`
- `publisher.json`：仓库内配置，记录上述 `key_id` 与公钥（**只有公钥**）。
- `keys/cfms-plugin.json`：私钥文件，已被 gitignore，绝不提交；轮换时
  `node tools/keygen.mjs --id <new-id> --publisher --force`。
- 构建与发布默认使用 `publisher.json` 指向的密钥签名，无需额外参数。

构建客户端时注入该公钥（key id 必须与签名包时使用的 `key_id` 完全一致）：

```powershell
$env:CFMS_EXTENSION_TRUSTED_KEYS = "cfms-plugin:cf721edd3d63a06f07c1be2099e7dfbf407c11a4726ad422415314ce6ab961de"
```

客户端当前 `USER_EXTENSIONS_ENABLED = false`，且只信任编译期注入的公钥
（`CFMS_EXTENSION_TRUSTED_KEYS`）；需按 `enable-client-extensions.mjs` 输出的命令
自行构建开发者版客户端后才能导入插件。已发布的安装包无法直接加载插件。
