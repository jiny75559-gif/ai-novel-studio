# 发布更新

仓库：`jiny75559-gif/ai-novel-studio`。请勿发布到酒馆插件仓库。源码与应用版本需同步递增；Windows x64 为当前唯一发行平台。

## 构建与签名

完成代码和实际桌面验收后，在有 Node.js、Rust 和 Windows 构建工具的发布电脑运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1
```

脚本先生成含 WebView2 的完整离线安装器，再通过 `tauri.update.conf.json` 生成不重复捆绑组件的小更新器；生成并签名 `update-manifest.json`，最后打包 `.nsupdate`。全量安装器必须单独保存，后一次构建会覆盖 Tauri 默认输出名。

私钥默认为 `%LOCALAPPDATA%\NovelStudioPublisher\updates.key`，不在 Git、源码 ZIP 或安装包中。**请单独安全备份该发布私钥**；丢失后不能凭新密钥给已有安装提供可信更新。软件只内置 `src-tauri/src/update-public-key.txt`。发布前确认公钥匹配；不要把私钥上传为 release 资产或 GitHub 文件。

清单中版本、仓库、HTTPS release 下载 URL、平台、大小和 SHA-256 被完整签名。手工改变内容后必须重新签名。签名针对清单；软件校验其中的安装器哈希。

## 发布顺序

先将最终源码提交到 main，再创建版本标签 `v版本号` 的草稿 release。上传：

- 完整离线安装 ZIP 和源码 ZIP；
- `AI-Novel-Studio-版本-Update.exe`；
- `update-manifest.json` 与 `update-manifest.json.sig`；
- `AI-Novel-Studio-版本.nsupdate`。

检查文件名称、大小和哈希后发布草稿，确保清单指向已就绪文件。正式 release 应为非 prerelease；软件读取 GitHub latest。不将带私钥的配置、作者作品、凭据或 QA 数据发布。

必须验证软件内在线检查、签名与下载，以及本地包安装后的实际重启和作品/阅读状态恢复。更新器使用标准 NSIS `/S /UPDATE /R /D=现有程序目录`，安装前创建数据库快照。它直接使用经过验证的签名清单，不依赖 Tauri updater 插件的 bundler type marker。
