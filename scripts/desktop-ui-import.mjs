import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const info = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("app_info"),
);
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
await page.getByRole("button", { name: "导入书籍", exact: true }).click();
console.log("Native import dialog opened for QA fixture");
process.exit(0);
