import { chromium, expect } from "@playwright/test";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector(".app-shell");
await page
  .getByRole("button", { name: "继续创作", exact: true })
  .first()
  .click();
await expect(page.getByRole("textbox", { name: "章节正文" })).not.toHaveValue(
  "",
);
await page.screenshot({ path: "../写作台预览.png" });
await page
  .getByRole("button", { name: "人物关系", exact: false })
  .first()
  .click();
await page.locator(".graph-canvas").waitFor();
await page.screenshot({ path: "../人物关系预览.png" });
await browser.close();
