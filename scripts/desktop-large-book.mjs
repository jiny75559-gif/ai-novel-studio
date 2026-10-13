import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile, stat } from "node:fs/promises";
const b = await chromium.connectOverCDP("http://127.0.0.1:9223"),
  page = b.contexts()[0].pages()[0],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
assert.ok(
  (await api("app_info")).dataDir
    .replaceAll("\\", "/")
    .endsWith("/work/qa-ui/data"),
);
const path = resolve("../../work/qa-ebooks/三千章大文件测试.txt"),
  start = performance.now(),
  book = await api("import_document_path", { path }),
  importMs = Math.round(performance.now() - start);
assert.equal(book.chapters.length, 3000);
await page.getByRole("button", { name: "我的作品", exact: true }).click();
const opening = performance.now();
await page
  .locator(".project-card")
  .filter({ has: page.getByRole("heading", { name: book.title, exact: true }) })
  .getByRole("button", { name: "电子书阅读" })
  .click();
await expect(page.locator(".book-leaf .leaf-body p").first()).toBeVisible({
  timeout: 30000,
});
await expect(page.locator(".reader-loading")).toHaveCount(0, {
  timeout: 30000,
});
const openMs = Math.round(performance.now() - opening);
await page.getByRole("slider", { name: "阅读进度" }).fill("950");
await expect(page.locator(".reader-loading")).toHaveCount(0, {
  timeout: 30000,
});
await expect
  .poll(() => page.locator(".reader-heading").innerText())
  .toMatch(/第28[45][0-9]章/);
const turn = performance.now();
await page.getByRole("button", { name: "下一页", exact: true }).click();
await expect(page.locator(".reader-loading")).toHaveCount(0);
const turnMs = Math.round(performance.now() - turn);
await page.getByRole("button", { name: "目录与书签" }).click();
assert.ok((await page.locator(".toc-tree-row").count()) <= 45);
await page.getByRole("textbox", { name: "筛选目录" }).fill("第3000章");
await page.getByRole("button", { name: /第3000章/ }).click();
await expect(page.locator(".reader-heading")).toContainText("第3000章");
await page.getByRole("button", { name: "目录与书签" }).click();
await page.getByRole("button", { name: "我的作品", exact: true }).click();
const saved = await api("load_project", { projectId: book.id });
assert.equal(saved.reader.chapterId, book.chapters[2999].id);
assert.equal(errors.length, 0);
const result = {
  projectId: book.id,
  sizeMiB: Math.round(((await stat(path)).size / 2 ** 20) * 100) / 100,
  chapters: 3000,
  importMs,
  openMs,
  turnMs,
  errors,
};
await writeFile(
  "../../work/qa-ebooks/large-results.json",
  JSON.stringify(result, null, 2),
);
console.log(
  "PASS realistic large 3000-chapter TXT import, reading, full-book slider, page turn and last chapter jump",
  JSON.stringify(result),
);
process.exit(0);
