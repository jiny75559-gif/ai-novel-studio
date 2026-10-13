# 阅读与插图（更新至 v0.3.1）

## 书本阅读

主页“导入书籍”支持 TXT、Markdown、DOCX、未加密 EPUB、PDF、HTML/HTM/XHTML、FB2（含 FB2.ZIP/FB2Z/FBZ）、RTF、ODT 和 CBZ；也可把文件拖入窗口。不需要配置或调用任何 AI。TXT 自动识别 UTF-8、带 BOM 的 UTF-16 和 GB18030；TXT 上限 20 MB，DOCX/EPUB 上限 25 MB，PDF 上限 100 MB。旧 DOC 和加密 EPUB 需先转换。中文章节标题、英文 Chapter 和 Markdown 标题用于 TXT 目录识别；长章节按段落分节，保留完整正文。

作品卡有“编辑作品”和“电子书阅读”两种入口。写好的 AI 作品也可直接进入纯阅读，阅读页随时可以返回“编辑本章”。PDF 是原版式阅读，保留原字体、图片、扫描页与页尺寸；支持内置目录、页码、单/双页和最高 400% 页面缩放。加密 PDF 会要求提供阅读密码，密码不保存在备份中。PDF 不重新排版为可编辑的小说正文。

EPUB 按 spine 顺序导入，解析 EPUB 3 nav 与 EPUB 2 NCX 的多级目录和章节锚点，保留正文内嵌插图和脚注引用。DOCX 导入正文、标题、常见内嵌图片和脚注。两者使用本软件的书本排版，不还原出版社 CSS、Word 精确页式、复杂表格、交互表单或媒体脚本。PNG、JPEG、WebP、GIF 和可作为静态图片显示的 SVG 可用于书籍插图。

阅读器支持字体、字号、行距、段距、页边距、单/双页、暖纸/白纸/夜读、书签、专注模式。正文首行缩进两字，中英文按字形测量，分页避开孤立开闭标点。正文图片自适应页幅，点击可独立放大查看。目录窗口支持多级展开和章节筛选，大目录只渲染附近 45 行；到章节末尾预排下一章。设置与批注窗口打开时不会误触底下的翻页。

选中文字后可高亮、写批注、复制，四种高亮色可选。“目录 → 批注”查看、编辑、删除或导出 Markdown。PDF 有文字层时可选择文字；扫描页可用“区域批注”框选图片区域。批注不改写正文。改稿后不再匹配的文字批注保留并提示重新核对，避免附到另一段文字。

底部显示页码、当前章节进度与全书进度，可拖动全书进度条或输入页码跳转。阅读位置和排版设置单独存入 SQLite/WAL，避免翻页时传送整本作品；重新从书架打开会继续上次阅读位置。书架显示书名、封面和阅读进度，可按最近阅读、最近编辑或书名排序。无封面时显示本软件的默认书封。全书搜索可跳转命中位置；扫描 PDF 必须已有文字层才能搜索，本版不含 OCR。最多显示前 200 个命中结果。

内置官方 [纳米老宋 A v1.3](https://github.com/Hansha2011/NanoOldSong/releases/tag/v1.3)，TTF 转 WOFF2，保留所有字形；完整授权与作者说明在 `public/fonts/NanoOldSong-LICENSE-and-README.md`。没有把系统宋体冒充为此字体。

新增格式、大小限制与更新方式见 [格式与更新说明](formats-and-updates.md)。CBZ 按漫画页计算进度；拖动与重新打开不会固定在 0%。

## 生图接入

“插图与形象”可保存多个配置，并给每部作品选择一个。无需把生图 API 与主写模型绑定：

| 方式 | 接口与配置 | 人物参考 |
| --- | --- | --- |
| 云端 Images 兼容接口 | 自填 HTTPS 基址、模型 ID、尺寸、可选 Key；`images/generations` / `images/edits` | 需要声明 edits 支持，multipart `image[]` 或 `image`，实际兼容性由服务决定 |
| 本地 ComfyUI | 默认 `http://127.0.0.1:8188`；导入 API 格式工作流，填写提示词、参考图、SaveImage、种子节点 | 上传确认的图片到 LoadImage 节点，保留工作流里的 LoRA/IP-Adapter/自定义节点 |
| WebUI / Forge 兼容服务 | 默认 `http://127.0.0.1:7860`；WebUI 开启 `--api`，设置步数、CFG、种子和尺寸 | 无参考图 txt2img，有参考图 img2img；基础接入限一位人物，重绘不等同于身份锁定 |

本地模式通常不填 Key，勾选允许本机 HTTP。连接测试只读取服务状态或模型列表，不生成图片。云端 Key/可选本地 Bearer Token 保存到 Windows 凭据管理器，不进入数据库正文、工作流或项目备份。不要将密码写入工作流 JSON。

## ComfyUI 工作流

1. 在 ComfyUI 开启开发者选项并导出 **API 格式**工作流；包含画布 nodes/links 的 JSON 不能直接提交。
2. 导入此 JSON，填写正面提示词节点 ID；可选负面提示词与种子节点 ID。提示词节点输入为 `text`，种子输入为 `seed` 或 `noise_seed`。
3. 指定输出节点，类型需要是 `SaveImage`；指定人物参考图节点，类型需要是 `LoadImage`，按出场人物选择的顺序填写，如 `20,35`。
4. 参考图节点必须通过你的处理链连接到输出；有几位人物就需要几个已配置的节点。人物节点不足时不提交，也不会悄悄改成无参考图生图。
5. 软件只替换指定提示词、种子、参考图输入，模型、采样器、LoRA、ControlNet、IP-Adapter 与自定义节点由工作流控制。首次定妆没有参考图时，使用适合文生图的配置；确认后可切换到带参考图的工作流配置。

提交采用 `POST /prompt`；人物图先 `POST /upload/image`；保留 prompt_id，轮询 `GET /history/{prompt_id}`，从指定输出节点以 `GET /view` 取得图片并保存本机。暂停等待不调用 ComfyUI 全局 `/interrupt`，避免停止酒馆或其他窗口的任务；本地服务可能继续生成。“取回原任务”只查询已有任务，不重新提交。

实现参考了用户授权读取的 Firefox 篡改猴“SillyTavern ComfyUI/WebUI 生图助手”的联动流程，独立编写桌面适配器，没有复制脚本源码或导出浏览器配置。没有修改 Firefox、插件、酒馆或 ComfyUI 的文件。

## 固定人物与章节插图

人物外貌可手填，也可由主 AI 从当前及之前正文读取并核对原文引用。空形象卡首次生成定妆时自动读取，批量读取还可补建新人物。已有固定形象不会自动覆盖，明确的衣着等变化单独由作者确认。再生成定妆候选，点击“设为固定形象”；也可以导入自己的 PNG/JPEG/WebP。后续章节传入固定参考图、外貌描述和本章有效的变化。模型生成结果不会自动替换固定形象。作者可明确修改形象卡。

文中出现剪发、受伤、换装等变化时，记录人物、原文引用和生效章节；不存在的引用不能保存，来源文字被改掉后该变化暂不应用。固定外貌也加入写作 AI 的上下文。图片模型的相似程度需要作者查看；参考图、角色 LoRA 和合适的工作流能加强一致性，软件不保证随机模型每次得到完全相同的脸。

章节默认用当前正文作为场景材料。配置主写 AI 后，可点“AI 提炼场景”生成简短提示词与出场人物，宿主核对原文引文；不使用文本 AI 时可以直接手写提示词。所有提示词均可继续编辑。“生成本章插图”后先预览，点击“放入本章”才出现在书本阅读末尾。图片可单独保存。正文或人物形象改变后旧图显示提示，是否保留由作者决定。

## 数据与备份

升级沿用原数据库，旧作品缺少的新字段补默认值。图片以不可变内容保存在 SQLite，形象卡引用图片 ID。新版项目备份 schema 2 包括书签、阅读设置、高亮、批注、多级目录、脚注、人物形象、图片和 PDF 原文件；导入时重新映射项目、人物和章节 ID，检查图片完整性，原子保存。旧 schema 1 备份仍可导入。备份不含主写、副审或生图密钥和服务绑定。完整备份上限 200 MB。

## 接口依据

- [ComfyUI 官方服务器路由](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI 官方 API 示例](https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/basic_api_example.py)
- [WebUI 官方 API 文档入口](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API)
- [Images API 图像生成与编辑](https://developers.openai.com/api/docs/guides/image-generation)
- [纳米老宋官方项目与授权](https://github.com/Hansha2011/NanoOldSong)

- [Mozilla PDF.js 官方示例与 API](https://mozilla.github.io/pdf.js/examples/index.html)

- [EPUB 3.3 导航文档规范](https://www.w3.org/TR/epub-33/)

正文与全部版本历史合计上限 100 MB，单个完整项目备份上限 200 MB；超限会明确提示分卷，不静默截断正文。
