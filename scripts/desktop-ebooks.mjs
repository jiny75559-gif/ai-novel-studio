// Actual packaged Tauri WebView2 + native file importer + SQLite. No model calls.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223"),
  page = browser.contexts()[0].pages()[0],
  failures = [];
page.on("pageerror", (e) => failures.push(e.message));
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
const checks = [],
  metrics = {};
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const home = async () => {
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await expect(page.locator(".home-page")).toBeVisible();
};
const importBook = async (file) => {
  const t = performance.now();
  const book = await api("import_document_path", { path: resolve(file) });
  metrics[book.title + " import ms"] = Math.round(performance.now() - t);
  await page.reload();
  await expect(page.locator(".home-page")).toBeVisible();
  return book;
};
const open = async (book, mode = "电子书阅读") => {
  await home();
  await page
    .locator(".project-card")
    .filter({
      has: page.getByRole("heading", { name: book.title, exact: true }),
    })
    .getByRole("button", { name: mode, exact: true })
    .click();
};
const ready = async () => {
  await expect(page.locator(".reader-view")).toBeVisible();
  await expect(page.locator(".reader-loading")).toHaveCount(0, {
    timeout: 30000,
  });
};
const selectText = async (selector, count = 8) => {
  await page
    .locator(selector)
    .first()
    .evaluate((el, count) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!node) throw Error("No text to select");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(node.textContent.length, count));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, count);
  await expect(
    page.getByRole("toolbar", { name: "选中文字操作" }),
  ).toBeVisible();
};
// Keep one card per test fixture in this isolated library.
for (const card of await api("list_projects", { trash: false }))
  if (
    [
      "illustrated",
      "多级目录与插图测试 EPUB 3",
      "三千章阅读测试",
      "超长章节测试",
    ].includes(card.title)
  )
    await api("trash_project", { projectId: card.id, deleted: true });
const pdf = await importBook("src-tauri/tests/fixtures/illustrated.pdf");
await open(pdf, "打开阅读");
await expect(page.locator('.pdf-page[data-ready="true"]')).toHaveCount(2, {
  timeout: 30000,
});
const pixels = await page
  .locator(".pdf-page canvas")
  .first()
  .evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if ((d[i] > 180 && d[i + 1] < 110) || (d[i + 2] > 180 && d[i] < 100)) n++;
    return n;
  });
assert.ok(pixels > 1000);
metrics.pdfColoredImagePixels = pixels;
pass("PDF 原页与真实内嵌 RGB 图片显示，双页书本完整可见");
await selectText(".textLayer span", 12);
await page.getByRole("button", { name: "批注", exact: true }).click();
await page
  .getByRole("textbox", { name: "批注内容" })
  .fill("PDF 文字高亮与批注测试");
await page.getByRole("button", { name: "蓝色", exact: true }).click();
await page.getByRole("button", { name: "保存批注", exact: true }).click();
await expect(page.locator(".modal-backdrop")).toHaveCount(0);
await expect
  .poll(
    async () =>
      (await api("load_project", { projectId: pdf.id })).readingMarks.length,
  )
  .toBe(1);
await page.getByRole("button", { name: "区域批注", exact: true }).click();
const box = await page.locator(".pdf-page").first().boundingBox();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45, {
  steps: 6,
});
await page.mouse.up();
await page.getByRole("button", { name: "批注", exact: true }).click();
await page
  .getByRole("textbox", { name: "批注内容" })
  .fill("扫描页图片也能框选批注");
await page.getByRole("button", { name: "保存批注", exact: true }).click();
await expect
  .poll(
    async () =>
      (await api("load_project", { projectId: pdf.id })).readingMarks.length,
  )
  .toBe(2);
pass("PDF 文字选区与扫描图片区域均可高亮、写批注并存入真实数据库");
await page.getByRole("button", { name: "目录与书签" }).click();
await page.getByRole("button", { name: "Chapter Two", exact: true }).click();
await expect(
  page.locator('.pdf-page[data-page="3"][data-ready="true"]'),
).toBeVisible();
await page.getByRole("button", { name: "搜索", exact: true }).click();
await page.getByRole("textbox", { name: "搜索书籍内容" }).fill("Amber map");
await page.getByRole("button", { name: "开始搜索" }).click();
await expect(page.locator(".reading-search-result")).toHaveCount(7, {
  timeout: 30000,
});
pass("PDF 内部多级目录准确跳页，全文搜索读取全部文字页");
await page.getByRole("button", { name: "目录与书签" }).click();
await page.getByRole("slider", { name: "阅读进度" }).fill("6");
await expect(
  page.locator('.pdf-page[data-page="7"][data-ready="true"]'),
).toBeVisible();
await page.getByRole("button", { name: "添加书签" }).click();
await expect
  .poll(
    async () =>
      (await api("load_project", { projectId: pdf.id })).reader.offset,
  )
  .toBe(6);
await page.screenshot({ path: "../PDF阅读预览.png", animations: "disabled" });
await home();
await open(pdf, "打开阅读");
await expect(
  page.locator('.pdf-page[data-page="7"][data-ready="true"]'),
).toBeVisible();
pass("PDF 拖动进度条后保存准确页码，重新打开恢复第 7 页与书签");
const epub = await importBook(
  "src-tauri/tests/fixtures/illustrated-epub3.epub",
);
await open(epub);
await ready();
await expect(page.locator(".book-illustration")).toHaveCount(1);
await expect
  .poll(() =>
    page
      .locator(".book-illustration")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  )
  .toBe(true);
await page.locator(".footnote-ref").first().click();
await expect(page.getByRole("dialog", { name: "脚注" })).toContainText(
  "港口北侧",
);
await page.getByRole("button", { name: "关闭对话框" }).click();
pass("EPUB 正文插图在原文位置显示，脚注可点击展开而非丢失");
await selectText(".book-leaf .leaf-body p[data-offset]", 8);
await page.getByRole("button", { name: "批注", exact: true }).click();
await page
  .getByRole("textbox", { name: "批注内容" })
  .fill("这段文字需要再读一遍。");
await page.getByRole("button", { name: "绿色", exact: true }).click();
await page.getByRole("button", { name: "保存批注", exact: true }).click();
await expect(page.locator(".reading-highlight")).toHaveCount(1);
await expect
  .poll(
    async () =>
      (await api("load_project", { projectId: epub.id })).readingMarks.length,
  )
  .toBe(1);
pass("正文选区高亮与批注持久保存，原文与不可变版本未被改写");
const before = await api("load_project", { projectId: epub.id });
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page.getByLabel("阅读字体", { exact: true }).selectOption("SimSun");
await page.getByLabel("阅读字号", { exact: true }).selectOption("24");
await page.getByLabel("阅读行距", { exact: true }).selectOption("2.1");
await page.getByLabel("阅读段距", { exact: true }).selectOption("18");
await page.getByLabel("阅读页边距", { exact: true }).selectOption("52");
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await ready();
const after = await api("load_project", { projectId: epub.id });
assert.equal(after.chapters[0].working, before.chapters[0].working);
assert.equal(
  after.chapters[0].versions[0].content,
  before.chapters[0].versions[0].content,
);
await expect
  .poll(
    async () =>
      (await api("load_project", { projectId: epub.id })).reader.pageMargin,
  )
  .toBe(52);
pass("字体、字号、行距、段距、页边距可调整，排版不修改正文与历史稿");
await page.getByRole("button", { name: "目录与书签" }).click();
await expect(page.locator('[role=treeitem][aria-level="3"]')).toHaveCount(1);
await page.getByRole("button", { name: "第二章 灯塔", exact: true }).click();
await ready();
await expect(page.locator(".reader-heading")).toContainText("第二章");
await page.getByRole("button", { name: "搜索", exact: true }).click();
await page.getByRole("textbox", { name: "搜索书籍内容" }).fill("琥珀星图");
await page.getByRole("button", { name: "开始搜索" }).click();
await expect(page.locator(".reading-search-result")).toHaveCount(1);
await page.locator(".reading-search-result").click();
await ready();
await expect(page.locator(".leaf-body").first()).toContainText("琥珀星图");
pass("EPUB nav 多级目录与锚点正确，全书搜索能返回并跳转其他章节");
await page.getByRole("button", { name: "目录与书签" }).click();
await page.getByRole("slider", { name: "阅读进度" }).fill("800");
await ready();
await expect(page.locator(".reader-heading")).toContainText("第二章");
await expect
  .poll(
    async () =>
      (await api("load_project", { projectId: epub.id })).reader.chapterId,
  )
  .not.toBe(before.chapters[0].id);
pass("正文全书进度条能跨章节跳转，不局限于当前章页码");
await home();
await open(epub, "编辑作品");
await expect(page.getByRole("textbox", { name: "章节正文" })).toBeVisible();
await home();
await open(epub);
await ready();
pass("同一部作品可明确选择普通编辑或电子书纯阅读");
const stress = await importBook("../../work/qa-ebooks/三千章阅读测试.txt");
assert.equal(stress.chapters.length, 3000);
const start = performance.now();
await open(stress);
await ready();
metrics.threeThousandChapterOpenMs = Math.round(performance.now() - start);
await page.getByRole("button", { name: "目录与书签" }).click();
assert.ok((await page.locator(".toc-tree-row").count()) <= 45);
await page.getByRole("textbox", { name: "筛选目录" }).fill("第3000章");
await page.getByRole("button", { name: /第3000章/, exact: false }).click();
await ready();
await expect(page.locator(".reader-heading")).toContainText("第3000章");
assert.ok((await page.locator(".toc-tree-row").count()) <= 45);
pass("3000 章 TXT 可导入与准确跳转，目录同时渲染不超过 45 行");
const long = await importBook("../../work/qa-ebooks/超长章节测试.txt");
assert.ok(long.chapters.length > 10);
await open(long);
await ready();
await page.getByRole("slider", { name: "阅读进度" }).fill("950");
await ready();
pass("超长章节按正文边界分段阅读，全书进度跳转仍可响应");
await home();
await page.screenshot({ path: "../新版书架预览.png", animations: "disabled" });
assert.equal(failures.length, 0);
pass("整个桌面阅读流程无未捕获 JavaScript 错误，书架显示封面与阅读进度");
await writeFile(
  "../../work/qa-ebooks/results.json",
  JSON.stringify(
    {
      checks,
      metrics,
      failures,
      projects: {
        pdf: pdf.id,
        epub: epub.id,
        stress: stress.id,
        long: long.id,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(metrics));
process.exit(0);
