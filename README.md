# CFMS Plugin

给 **CFMS Client custom 版本** 开发声明式扩展（`.cfmsext`）的工具仓库。
扩展是签名数据包（manifest + 声明式页面 + 工作流），不含可执行代码。

- 目标客户端：`../cfms_client_tauri`（`custom` 分支，`0.57.0-custom-0.1`，host API `1.0.0`）
- 运行环境：Node.js ≥ 20，零第三方依赖

## 使用

```powershell
node tools/keygen.mjs                                  # 生成开发签名密钥（keys/，gitignored）
node tools/new-plugin.mjs com.example.my-plugin        # 生成插件骨架（plugins/）
node tools/pack.mjs plugins/my-plugin                  # 打包签名 -> dist/*.cfmsext
node tools/verify.mjs dist/*.cfmsext                   # 校验包/索引/签名
node tools/catalog.mjs build --base-url https://...    # 生成 catalog + 签名
node tools/enable-client-extensions.mjs --client ..\cfms_client_tauri
node --test                                            # 工具链测试
```

客户端当前 `USER_EXTENSIONS_ENABLED = false`，且只信任编译期注入的公钥
（`CFMS_EXTENSION_TRUSTED_KEYS`）；需按 `enable-client-extensions.mjs` 输出的命令
自行构建开发者版客户端后才能导入插件。已发布的安装包无法直接加载插件。

`docs/` 与 `AGENTS.md` 为本地参考资料，已 gitignore，不属于仓库内容。
