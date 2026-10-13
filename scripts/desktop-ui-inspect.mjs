import { chromium } from "@playwright/test";
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const p = b.contexts()[0].pages()[0];
await p.getByRole("button", { name: "书本阅读", exact: true }).click();
await p.getByRole("button", { name: "阅读设置", exact: true }).click();
await p.getByRole("button", { name: "夜读", exact: true }).click();
console.log(
  await p.evaluate(() =>
    [
      ".reader-view",
      ".reader-toolbar .button.is-open",
      ".sidebar nav button.active",
      ".reader-settings select",
    ].map((selector) => {
      const e = document.querySelector(selector),
        s = getComputedStyle(e);
      return {
        selector,
        bg: s.backgroundColor,
        ink: s.color,
        active: s.getPropertyValue("--reader-active"),
        forced: matchMedia("(forced-colors: active)").matches,
      };
    }),
  ),
);
await p.getByRole("button", { name: "暖纸", exact: true }).click();
await p.getByRole("button", { name: "关闭阅读设置" }).click();
process.exit(0);
