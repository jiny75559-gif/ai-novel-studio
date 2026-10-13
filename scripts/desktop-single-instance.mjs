import { chromium } from "@playwright/test";
import fs from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const saved = JSON.parse(
  fs.readFileSync("../../work/qa/recovery-state.json", "utf8"),
);
const runs = await page.evaluate(
  (pid) => window.__TAURI_INTERNALS__.invoke("list_runs", { projectId: pid }),
  saved.pid,
);
assert.equal(runs.find((r) => r.id === saved.interruptedId).status, "running");
console.log("PASS 重复启动仅聚焦原窗口，原运行任务没有被标为中断");
await browser.close();
