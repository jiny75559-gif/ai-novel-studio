import {chromium,expect} from "@playwright/test";
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
const b=await chromium.connectOverCDP("http://127.0.0.1:9223"),p=b.contexts()[0].pages()[0];
const info=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke("app_info"));assert.ok(info.dataDir.replaceAll("\\","/").endsWith("/work/qa-ui/data"));
await writeFile("../../work/qa-ui/markdown-book.md","# 第一章 夜雨\n\n一盏灯在雨中亮着。\n\n# 第二章 晨光\n\n天亮后，他们沿着堤岸前行。", "utf8");
const before=(await(await fetch("http://127.0.0.1:8787/stats")).json()).calls;
const checks=[];
for(const file of ["../../work/qa-ebooks/三千章阅读测试.txt","../../work/qa-ui/markdown-book.md","src-tauri/tests/fixtures/illustrated.docx","src-tauri/tests/fixtures/illustrated-epub2.epub"]){
 await p.getByRole("button",{name:"我的作品",exact:true}).click();await p.getByLabel("搜索作品",{exact:true}).fill("");
 await p.getByRole("button",{name:"导入书籍",exact:true}).click();execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",resolve("../../work/qa-ui/native-file-dialog.ps1"),"-File",resolve(file),"-Title","导入书籍 · 无需 AI"],{timeout:15000});
 await expect(p.locator(".reader-view")).toBeVisible({timeout:30000});await expect(p.locator(".book-leaf .leaf-body").first()).toBeVisible({timeout:30000});await expect.poll(()=>p.locator(".book-leaf p").count()).toBeGreaterThan(0);
 checks.push(file);console.log("PASS native book dialog import and read",file);
}
assert.equal((await(await fetch("http://127.0.0.1:8787/stats")).json()).calls,before);
await writeFile("../../work/qa-ui/import-formats.json",JSON.stringify({checks,aiCalls:0}));process.exit(0);
