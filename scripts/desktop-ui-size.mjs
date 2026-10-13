import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const info = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("app_info"),
);
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
await expect(page.locator(".reader-view")).toBeVisible();
const size = await page.evaluate(() => ({
  width: innerWidth,
  height: innerHeight,
}));
console.log("Actual WebView viewport", size);
assert.equal(size.width, 1080);
assert.equal(size.height, 720);
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
const boxes = await page
  .locator(".book-zoom-frame, .reader-settings")
  .evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    }),
  );
assert.equal(boxes.length, 2);
for (const r of boxes) {
  assert.ok(
    r.left >= 0 &&
      r.top >= 0 &&
      r.right <= size.width + 1 &&
      r.bottom <= size.height + 1,
    JSON.stringify(r),
  );
}
await page.screenshot({ path: "../../work/qa-ui/minimum-window.png" });
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "目录与书签" }).click();
await page.screenshot({ path: "../../work/qa-ui/minimum-toc.png" });
await page.getByRole("button", { name: "目录与书签" }).click();
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page.getByRole("combobox", { name: "阅读缩放" }).selectOption("160");
await page.keyboard.press("Escape");
const scroll = await page.locator(".book-stage").evaluate((e) => ({
  scrollWidth: e.scrollWidth,
  clientWidth: e.clientWidth,
  scrollHeight: e.scrollHeight,
  clientHeight: e.clientHeight,
}));
assert.ok(
  scroll.scrollWidth > scroll.clientWidth &&
    scroll.scrollHeight > scroll.clientHeight,
);
const large = await page.locator(".book-zoom-frame").boundingBox();
assert.ok(
  large.x >= 178 && large.y >= 72,
  "Zoomed book begins in scrollable viewport",
);
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page.getByRole("combobox", { name: "阅读缩放" }).selectOption("100");
await page.keyboard.press("Escape");
console.log(
  "PASS 1080×720 actual desktop window: double spread and settings fit; enlarged pages remain scrollable",
);
process.exit(0);
