import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
await page.waitForSelector(".app-shell");
if (process.argv.includes("--verify")) {
  const saved = JSON.parse(
    fs.readFileSync("../../work/qa/close-state.json", "utf8"),
  );
  const p = await api("load_project", { projectId: saved.pid });
  assert.equal(p.chapters[0].working, saved.body);
  assert.equal(p.chapters[0].versions.length, 0);
  console.log("PASS 离线输入后立即正常关闭，重启仍恢复未存为版本的工作副本");
} else {
  await page
    .getByRole("button", { name: "新建作品", exact: true })
    .last()
    .click();
  await page
    .getByRole("textbox", { name: "作品名称", exact: true })
    .fill("离线关闭保存测试");
  await page.getByRole("button", { name: "创建作品", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.waitFor();
  const p = (await api("list_projects", { trash: false })).find(
    (p) => p.title === "离线关闭保存测试",
  );
  const body =
    "离线作者手稿：风吹过没有点灯的房间。她将信折好，决定明天再出发。\n\n这些文本尚未手动保存为版本，关闭窗口必须先落盘。";
  fs.writeFileSync(
    "../../work/qa/close-state.json",
    JSON.stringify({ pid: p.id, body }, null, 2),
  );
  await editor.fill(body);
  await expect(page.getByText("编辑中…", { exact: true })).toBeVisible();
  console.log("READY_FOR_NATIVE_CLOSE");
}
await browser.close();
