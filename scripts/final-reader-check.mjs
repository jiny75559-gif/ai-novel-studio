import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const api = (name, args = {}) => page.evaluate(({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
await page.getByRole("button", { name: "继续阅读", exact: true }).first().click();
await expect.poll(() => page.locator(".book-leaf .leaf-body p").count(), { timeout: 30000 }).toBeGreaterThan(0);
await expect(page.locator(".reader-loading")).toHaveCount(0);
const beginning = async () => {
  await page.getByRole("button", { name: "目录与书签", exact: true }).click();
  await page.locator(".reader-toc>button").first().click();
  await page.getByRole("button", { name: "目录与书签", exact: true }).click();
};
await beginning();
const card = (await api("list_projects", { trash: false })).find(p => p.title === "离线阅读测试");
const book = await api("load_project", { projectId: card.id });
const text = book.chapters[0].working;
let end = 0;
let count = 0;
const closers = new Set(Array.from("，。！？；：、）》】」』”’…,.!?;:)]}"));
while (end < text.length && count++ < 100) {
  const blocks = await page.locator(".book-leaf .leaf-body p").evaluateAll(es => es.map(e => ({ start: +e.dataset.offset, end: +e.dataset.end, text: e.textContent })));
  const first = await page.locator(".book-leaf .leaf-body").evaluateAll(es => es.map(e => Array.from(e.querySelectorAll("p")).find(e => e.textContent.trim() && e.textContent !== "\u200b")?.textContent[0]));
  for (const c of first) if (c) assert.ok(!closers.has(c), "page starts with closing punctuation");
  for (const b of blocks) {
    assert.equal(b.start, end);
    assert.equal(b.text, text.slice(b.start, b.end).replace(/\r?\n$/, "") || "\u200b");
    end = b.end;
  }
  assert.ok(await page.locator(".book-leaf .leaf-body").evaluateAll(es => es.every(e => e.scrollHeight <= e.clientHeight + 1)));
  if (end < text.length) await page.getByRole("button", { name: "下一页", exact: true }).click();
}
assert.equal(end, text.length);
await beginning();
await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10000 });
await page.screenshot({ path: "../双页阅读预览.png" });
console.log("PASS 最终发行版再次逐页验证正文完整、无溢出、页首无孤立闭标点，离线可读");
await browser.close();
