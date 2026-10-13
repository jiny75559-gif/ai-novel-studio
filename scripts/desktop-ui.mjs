// Real packaged WebView2 UI; test data lives in the explicitly isolated QA directory.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(
  info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"),
  info.dataDir,
);
assert.equal(info.version, "0.3.1");
console.log("QA data directory verified", info.version);
const checks = [];
const check = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const waitPages = async () => {
  await expect(page.locator(".reader-view")).toBeVisible();
  await expect
    .poll(() => page.locator(".book-leaf .leaf-body p").count(), {
      timeout: 30000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator(".reader-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => document.fonts.check("22px NanoOldSong", "风雨")),
      { timeout: 30000 },
    )
    .toBe(true);
};
if (process.argv.includes("--inspect")) {
  console.log(JSON.stringify(await api("list_projects", { trash: false })));
  console.log((await page.locator("body").innerText()).slice(0, 2000));
  process.exit(0);
}
// Preserve the reader fixture; hide historical mock projects in the copied QA library.
const cards = await api("list_projects", { trash: false });
for (const card of cards)
  if (card.title !== "离线阅读测试")
    await api("trash_project", { projectId: card.id, deleted: true });
await page.reload();
await page.waitForSelector(".home-page");
await page
  .getByRole("button", { name: "新建作品", exact: true })
  .last()
  .click();
await page.getByRole("button", { name: "创建示例", exact: true }).click();
await expect(
  page.getByRole("textbox", { name: "章节正文", exact: true }),
).toBeVisible();
await page.getByRole("button", { name: "我的作品", exact: true }).click();
await page.getByRole("button", { name: "搜索作品", exact: false }).count();
await page.screenshot({ path: "../新版书架预览.png", animations: "disabled" });
check("书架与示例创作入口在真实桌面程序中正常显示");
await page
  .getByRole("button", { name: "电子书阅读", exact: true })
  .first()
  .click();
await waitPages();
const bookCard = (await api("list_projects", { trash: false })).sort((a,b) => b.lastReadAt-a.lastReadAt).find(
  (p) => p.title === "离线阅读测试",
);
assert.ok(bookCard, "Import the TXT fixture before running this test");
const loadBook = () => api("load_project", { projectId: bookCard.id });
await expect(page.locator(".reader-font-name")).toHaveCount(0);
await expect(page.locator(".reader-toolbar")).not.toContainText("纳米老宋");
await expect(page.getByRole("combobox", { name: "阅读字号" })).toHaveCount(0);
check("字体名称和排版选项收进阅读设置，主阅读界面只保留轻量工具栏");
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await expect(
  page.getByRole("dialog", { name: "阅读设置", exact: true }),
).toBeVisible();
await expect(page.getByRole("combobox", { name: "阅读字体" })).toContainText("纳米老宋");
await page.getByRole("combobox", { name: "阅读主题" }).selectOption("paper");
await page.getByRole("combobox", { name: "阅读缩放" }).selectOption("100");
await page.getByRole("combobox", { name: "阅读版式" }).selectOption("double");
await page.getByRole("combobox", { name: "阅读字号" }).selectOption("20");
await waitPages();
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await page.getByRole("button", { name: "目录与书签" }).click();
await page.locator(".toc-tree-row button:last-child").first().click();
await page.getByRole("button", { name: "目录与书签" }).click();
await waitPages();
await page.screenshot({
  path: "../新版双页阅读预览.png",
  animations: "disabled",
});
// Verify actual displayed page text remains continuous and complete after visual changes.
const book = await loadBook();
const text = book.chapters[0].working;
let end = 0;
while (end < text.length) {
  const bodies = await page.locator(".book-leaf .leaf-body").evaluateAll((es) =>
    es.map((e) => ({
      height: e.clientHeight,
      scroll: e.scrollHeight,
      blocks: Array.from(e.querySelectorAll("p")).map((p) => ({
        start: +p.dataset.offset,
        end: +p.dataset.end,
        text: p.textContent,
      })),
    })),
  );
  for (const body of bodies) {
    assert.ok(body.scroll <= body.height + 1);
    for (const b of body.blocks) {
      assert.equal(b.start, end);
      assert.equal(
        b.text,
        text.slice(b.start, b.end).replace(/\r?\n$/, "") || "\u200b",
      );
      end = b.end;
    }
  }
  if (end < text.length)
    await page.getByRole("button", { name: "下一页", exact: true }).click();
}
check("逐页核对整章：双页正文无遗漏、重叠或高度溢出");
await page.getByRole("button", { name: "上一页", exact: true }).click();
const anchor = +(await page
  .locator(".book-leaf .leaf-body p")
  .first()
  .getAttribute("data-offset"));
await expect.poll(async () => (await loadBook()).reader.offset).toBe(anchor);
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page.getByRole("combobox", { name: "阅读字号" }).selectOption("22");
await page.getByRole("combobox", { name: "阅读行距" }).selectOption("1.8");
await waitPages();
await expect.poll(async () => (await loadBook()).reader.fontSize).toBe(22);
assert.equal((await loadBook()).reader.offset, anchor);
await page.screenshot({
  path: "../../work/qa-ui/preferences.png",
  animations: "disabled",
});
await page.keyboard.press("Escape");
await expect(
  page.getByRole("dialog", { name: "阅读设置", exact: true }),
).toHaveCount(0);
await expect(
  page.getByRole("button", { name: "阅读设置", exact: true }),
).toBeFocused();
check("设置实时重排并保留位置，Esc 关闭面板并返回按钮焦点");
await page.getByRole("button", { name: "专注阅读" }).click();
await expect(page.locator(".sidebar")).not.toBeVisible();
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page.keyboard.press("Escape");
await expect(page.locator(".sidebar")).not.toBeVisible();
await page.keyboard.press("Escape");
await expect(page.locator(".sidebar")).toBeVisible();
check("专注模式与设置面板的 Esc 行为互不干扰");
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page.getByRole("button", { name: "夜读", exact: true }).click();
await expect(page.locator(".reader-view")).toHaveClass(/reader-night/);
await page.screenshot({
  path: "../../work/qa-ui/night.png",
  animations: "disabled",
});
await page.getByRole("combobox", { name: "阅读版式" }).selectOption("single");
await expect(page.locator(".book-leaf")).toHaveCount(1);
await page.getByRole("combobox", { name: "阅读版式" }).selectOption("double");
await expect(page.locator(".book-leaf")).toHaveCount(2);
await page.getByRole("button", { name: "白纸", exact: true }).click();
await expect(page.locator(".reader-view")).toHaveClass(/reader-white/);
await page.getByRole("button", { name: "暖纸", exact: true }).click();
await page.getByRole("combobox", { name: "阅读字号" }).selectOption("20");
await page.getByRole("combobox", { name: "阅读行距" }).selectOption("1.9");
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await waitPages();
await page.getByRole("button", { name: "添加书签", exact: true }).click();
await expect
  .poll(async () => (await loadBook()).reader.bookmarks.length)
  .toBeGreaterThan(0);
check("暖纸、白纸、夜读、单/双页和书签保存可用");
await page.getByRole("button", { name: "编辑本章", exact: true }).click();
await expect(
  page.getByRole("textbox", { name: "章节正文", exact: true }),
).toHaveValue(text.replace(/\r\n?/g, "\n"));
await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10000 });
await page.screenshot({
  path: "../新版写作台预览.png",
  animations: "disabled",
});
check("从阅读返回写作台显示相同正文，编辑与自动保存链路保持可用");
const editor = page.getByRole("textbox", { name: "章节正文", exact: true });
const normalizedText = text.replace(/\r\n?/g, "\n");
const edited = normalizedText + "\n\n这是桌面界面的编辑保存验证。";
const originalVersions = JSON.stringify(
  (await loadBook()).chapters[0].versions,
);
await editor.fill(edited);
await expect
  .poll(async () => (await loadBook()).chapters[0].working)
  .toBe(edited);
assert.equal(
  JSON.stringify((await loadBook()).chapters[0].versions),
  originalVersions,
);
await editor.fill(normalizedText);
await expect
  .poll(async () => (await loadBook()).chapters[0].working)
  .toBe(normalizedText);
check("实际编辑正文自动保存，已有章节版本保持不变");
await page.getByRole("button", { name: "人物关系", exact: true }).click();
await page.screenshot({ path: "../../work/qa-ui/characters.png" });
await page.getByRole("button", { name: "模型与设置", exact: true }).click();
await page.screenshot({ path: "../../work/qa-ui/models.png" });
await page.getByRole("button", { name: "插图与形象", exact: true }).click();
await page.screenshot({ path: "../../work/qa-ui/illustrations.png" });
assert.deepEqual(failures, []);
check("人物、模型设置和插图页面正常，未捕获 JavaScript 错误为零");
await writeFile(
  "../../work/qa-ui/results.json",
  JSON.stringify({ version: info.version, checks }, null, 2),
);
process.exit(0);
