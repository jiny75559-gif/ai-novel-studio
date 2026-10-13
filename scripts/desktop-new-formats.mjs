import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);
const api=(name,args={})=>page.evaluate(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const info=await api('app_info');assert.ok(info.dataDir.replaceAll('\\','/').endsWith('/work/qa-ui/data'));assert.equal(info.version,'0.3.1');
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const checks=[];const check=s=>{checks.push(s);console.log('PASS',s);};
const nav=name=>page.getByRole('button',{name,exact:true}).first().click();
const before=(await(await fetch('http://127.0.0.1:8787/stats')).json()).calls;
for(const [file,source,title,images,notes] of [
 ['book.html','html','HTML 测试书',1,'HTML 脚注解释'],
 ['book.fb2','fb2','FB2 测试书',1,'FB2 脚注解释'],
 ['book.fb2.zip','fb2','FB2 测试书',1,'FB2 脚注解释'],
 ['book.rtf','rtf','book',0,''],
 ['book.odt','odt','ODT 测试书',1,'ODT 脚注解释'],
 ['comic.cbz','cbz','comic',3,''],
 ['src-tauri/tests/fixtures/illustrated-epub2.epub','epub','多级目录与插图测试 EPUB 2',1,'港口北侧'],
 ['src-tauri/tests/fixtures/illustrated-epub3.epub','epub','多级目录与插图测试 EPUB 3',1,'港口北侧'],
]){
 await nav('我的作品');await page.getByRole('button',{name:'导入书籍',exact:true}).click();
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('../../work/qa-ui/native-file-dialog.ps1'),'-File',file.startsWith('src-tauri/')?resolve(file):resolve('../../work/qa-v031/books/'+file),'-Title','导入书籍 · 无需 AI'],{timeout:15000});
 await expect(page.locator('.reader-view')).toBeVisible({timeout:30000});
 await expect(page.locator('.reader-loading')).toHaveCount(0,{timeout:30000});
 const cards=await api('list_projects',{trash:false});const card=cards.filter(c=>c.title===title).sort((a,b)=>b.updatedAt-a.updatedAt)[0];assert.ok(card);
 let p=await api('load_project',{projectId:card.id});assert.equal(p.bookSource,source);
 assert.equal(p.bookContent.reduce((n,c)=>n+c.images.length,0),images);
 if(images){await expect(page.locator('.leaf-body img').first()).toBeVisible();await expect.poll(()=>page.locator('.leaf-body img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);}
 if(notes){assert.ok(p.bookContent.some(c=>c.footnotes.some(n=>n.text.includes(notes))));for(let i=0;i<5&&!await page.locator('.footnote-ref').count();i++){await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.reader-loading')).toHaveCount(0);}await page.locator('.footnote-ref').first().click();await expect(page.getByRole('dialog').last()).toContainText(notes);await page.getByRole('dialog').last().getByRole('button',{name:'关闭对话框',exact:true}).click();}
 if(source==='rtf'){await expect(page.locator('.leaf-body').first()).toContainText('中文正文');await expect(page.locator('.leaf-body').first()).toContainText('😀');}
 if(source==='cbz'){
  assert.deepEqual(p.chapters.map(c=>c.title.split(' · ')[1]),['1.png','2.png','10.png']);
  await page.getByLabel('阅读进度',{exact:true}).evaluate(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1000');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(page.locator('.breadcrumb')).toContainText(title);
  await expect(page.locator('.book-leaf header').first()).toContainText('10.png');
  await nav('我的作品');p=await api('load_project',{projectId:p.id});assert.equal(p.reader.chapterId,p.chapters[2].id);assert.equal(p.reader.offset,0);
  await page.getByLabel('搜索作品',{exact:true}).fill(title);await page.locator('.project-card').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'电子书阅读',exact:true}).click();
  await expect(page.locator('.book-leaf header').first()).toContainText('10.png');
 }
 check(`真实 Windows 文件对话框导入 ${file}：正文、图片、目录/脚注与阅读可用${source==='cbz'?'，自然排序与拖进度重开保留':''}`);
}
await nav('我的作品');assert.equal((await(await fetch('http://127.0.0.1:8787/stats')).json()).calls,before);assert.deepEqual(errors,[]);
check('所有新增格式离线阅读不调用 AI，完整界面流程没有未捕获 JavaScript 错误');
await writeFile('../../work/qa-v031/new-formats-results.json',JSON.stringify({checks,errors},null,2));process.exit(0);
