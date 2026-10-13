import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const b = await chromium.connectOverCDP("http://127.0.0.1:9223"),
  page = b.contexts()[0].pages()[0];
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
const data = JSON.parse(
  await readFile("../../work/qa-ebooks/large-results.json", "utf8"),
);
await page.getByRole("button", { name: "我的作品", exact: true }).click();
await page
  .locator(".project-card")
  .filter({
    has: page.getByRole("heading", { name: "三千章大文件测试", exact: true }),
  })
  .getByRole("button", { name: "电子书阅读" })
  .click();
await expect(page.locator(".book-leaf .leaf-body p").first()).toBeVisible({
  timeout: 30000,
});
await expect(page.locator(".reader-loading")).toHaveCount(0);
const times = await page.evaluate(async () => {
  const result = [];
  for (let i = 0; i < 8; i++) {
    const button = document.querySelector(
        `[aria-label="${i % 2 ? "上一页" : "下一页"}"]`,
      ),
      before = document.querySelector(".book-leaf p")?.dataset.offset,
      t = performance.now();
    button.click();
    await new Promise((resolve) => {
      const tick = () =>
        document.querySelector(".book-leaf p")?.dataset.offset !== before
          ? requestAnimationFrame(resolve)
          : requestAnimationFrame(tick);
      tick();
    });
    result.push(Math.round(performance.now() - t));
  }
  return result;
});
assert.ok(Math.max(...times) < 200, JSON.stringify(times));
const project = await api("load_project", { projectId: data.projectId });
const t = performance.now();
await api("save_reader", { projectId: project.id, reader: project.reader });
const writeMs = Math.round(performance.now() - t);
await writeFile(
  "../../work/qa-ebooks/latency-results.json",
  JSON.stringify(
    {
      pagePaintMs: times,
      progressWriteMs: writeMs,
      definition:
        "DOM button click through React to changed page and next animation frame; actual packaged WebView2",
    },
    null,
    2,
  ),
);
console.log(
  "PASS 17 MB / 3000 chapter book page-to-paint latency",
  times,
  "progress write ms",
  writeMs,
);
await page.getByRole("button", { name: "我的作品", exact: true }).click();
process.exit(0);
