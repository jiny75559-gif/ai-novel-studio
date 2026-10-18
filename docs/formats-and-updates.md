# 电子书格式与软件更新 · v0.3.3

不使用 AI 也可导入阅读。书架分别提供“编辑作品”和“电子书阅读”；作者已有的 AI 作品也可直接阅读。

## 格式

| 格式 | 本版支持 |
| --- | --- |
| TXT、MD / Markdown | UTF-8、UTF-16 BOM、GB18030；识别常见中英章节和 Markdown 标题 |
| EPUB 2 / 3 | spine 顺序，nav / NCX 多级目录、章节锚点、常见插图与脚注；未加密文件 |
| PDF | 原页面与图片，单/双页、缩放，文字与区域批注；带文字层时支持全文搜索 |
| DOCX | 正文、标题、常见内嵌图片与脚注 |
| HTML / HTM / XHTML | 标题目录、纯文本正文、本地或内嵌图片、常见脚注；不运行脚本或联网下载图片 |
| FB2、FB2.ZIP、FB2Z、FBZ | 书名、层级章节、内嵌图片和脚注 |
| ODT | 正文、标题、常见图片与脚注 |
| RTF | 中文与 Unicode 正文；不还原图片或复杂页式 |
| CBZ | PNG/JPEG/WebP/GIF 漫画页，按自然文件名排序，默认单页；支持翻页、进度与恢复 |

文本类使用软件书本排版，可调字号、行段距、页边距与主题。PDF 和漫画保留页面/图片，使用页面缩放；纯图片没有可选文字，可用 PDF 区域批注。正文高亮、批注、书签、目录、搜索和阅读位置均保存在本机。

TXT 最大 20 MB；DOCX/EPUB 25 MB；PDF 100 MB；新增文本类输入 25 MB，压缩格式最多展开 100 MB / 10000 文件；CBZ 文件 100 MB、最多 3000 页。全书搜索最多展示前 200 个命中。HTML 图片限定在所选文档目录内或 data 图片，网页请先保存为带本地资源的文件。

不支持带 DRM 的书籍、MOBI/AZW3、DjVu、旧 DOC 或 CBR。本轮选择不依赖额外转换器的格式；有权转换的文件可先用 Calibre 等转换为 EPUB/PDF。扫描 PDF 暂无 OCR。HTML/EPUB/DOCX/ODT 不完整复刻出版社 CSS、复杂表格、公式、交互媒体或 Word/LibreOffice 精确页式。

格式范围参考 [Calibre 官方格式说明](https://manual.calibre-ebook.com/faq.html#what-formats-does-calibre-support-conversion-to-from) 与 [SumatraPDF 官方支持格式](https://www.sumatrapdfreader.org/docs/Supported-document-formats)，以上表格是本软件实际实现范围。

## 更新

正式发布在 https://github.com/jiny75559-gif/ai-novel-studio/releases ，与酒馆插件仓库分开。

1. 首次安装使用离线安装包（约 246 MiB），包含 WebView2，无需开发环境。
2. 从 v0.3.1 起，侧栏“软件更新”检查新版，再点“下载并更新”。应用更新约 39 MiB，沿用已安装的 WebView2。需要能够访问 GitHub；没有发布新版时显示当前最新版。
3. 离线或网络不便时，取得官方 `.nsupdate` 文件，点“选择本地更新包”并安装。同版本支持修复，更旧版本禁止降级。

软件核验完整清单的发布者签名、平台、版本、下载来源、安装器 SHA-256 与大小。安装前保存正文工作副本和阅读状态，并在数据目录 `updates/` 生成 `before-update-时间.sqlite3` 备份，然后执行安装器并重启。运行中的生成任务会阻止安装；更新失败后仍可使用已安装软件或运行完整安装包修复。数据库和 Windows 凭据沿用；更新不会上传作品，不会把密钥放进发布文件。

离线完整安装器可在新电脑安装；小更新器用于已有 WebView2 的电脑。应用 EXE 尚未做 Windows Authenticode 签名；更新包的发布者签名用于软件内的真实性校验，两者用途不同。


v0.3.3 调整慢网络下载时限：连接15秒，单次读取停滞45秒，整包全程最多30分钟；清单查询仍为20秒。失败时显示具体错误并恢复重试或本地更新入口，不保留误导的“正在下载/正在安装”状态。