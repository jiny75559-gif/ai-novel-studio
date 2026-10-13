# 第三方字体

本软件内置 NanoOldSong-A（纳米老宋 A）v1.3，来源：<https://github.com/Hansha2011/NanoOldSong/releases/tag/v1.3>，官方字体文件 NanoOldSongA-Regular.ttf。

制作者：H.S.S. - 寒沙（Hansha2011）；Scott0107000；不务正业的小鸡。项目授权允许在软件中嵌入、分发与格式转换。发行包使用完整字形的 WOFF2 转换，不修改字形。字体不得作为字体商品单独出售。

字体的完整原作者说明、授权和限制随软件分发，见 `public/fonts/NanoOldSong-LICENSE-and-README.md`（同一文件内置于桌面资源）。请以该完整授权为准。

React、Tauri、SQLite、reqwest、@xyflow/react、lucide-react 等代码依赖使用各自的许可证，依赖版本记录在 package-lock.json 和 Cargo.lock。浏览器篡改猴脚本仅用于用户授权下的实现研究，没有复制进本软件。

PDF 原版式阅读使用 Mozilla PDF.js / pdfjs-dist 6.4.299，Apache-2.0 授权。Worker、CMaps、标准字体、ICC 和 WASM 组件离线内置，完整许可证与资源各自说明在 `public/pdfjs/`。来源：https://github.com/mozilla/pdf.js 。

HTML 字符实体解码使用 html-escape 0.2.15（MIT）；完整许可证随软件资源分发于 `public/pdfjs/html-escape-LICENSE`。

新增 HTML5 解析使用 scraper 0.27.0（ISC），依赖 html5ever（MIT/Apache-2.0）；更新签名校验使用 minisign-verify 0.2.5（MIT），版本比较使用 semver 1.x（MIT/Apache-2.0）。完整版本与许可证字段以 Cargo.lock 和各依赖源 LICENSE 为准。
