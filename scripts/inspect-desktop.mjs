import { chromium } from "@playwright/test";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector(".app-shell", { timeout: 20000 });
console.log((await page.locator("body").innerText()).slice(0, 3000));
await page.screenshot({ path: "../../work/qa/home.png" });
await browser.close();
