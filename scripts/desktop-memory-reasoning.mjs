import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {version} from './qa-version.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223'),page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(20000);
const api=(name,args={})=>page.evaluate(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const info=await api('app_info');assert.equal(info.version,version);assert.ok(info.dataDir.replaceAll('\\','/').endsWith('/work/qa-ui/data'));
const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];const check=s=>{checks.push(s);console.log('PASS',s);};
const human=JSON.parse(await readFile('../../work/qa-ui/human-workflow.json','utf8'));const load=()=>api('load_project',{projectId:human.pid});
const original=await load();const provider=(await api('list_providers')).find(p=>p.id===human.writerId);const dialog=()=>page.getByRole('dialog').last();
const nav=name=>page.getByRole('button',{name,exact:true}).first().click();
await nav('我的作品');await page.getByLabel('搜索作品',{exact:true}).fill(human.title);await page.locator('.project-card').filter({has:page.getByRole('heading',{name:human.title,exact:true})}).getByRole('button',{name:'编辑作品',exact:true}).click();
await nav('模型与设置');await page.getByLabel(/^模型上下文窗口/).fill('500000');await page.getByRole('button',{name:'保存项目设置',exact:true}).click();await nav('写作台');await nav('模型与设置');await expect(page.getByLabel(/^模型上下文窗口/)).toHaveValue('500000');assert.equal((await load()).settings.contextTokens,500000);check('50万上下文通过界面和后端保存，离开页面再返回仍为50万');
const card=()=>page.locator('.provider-card').filter({has:page.getByRole('heading',{name:provider.name,exact:true})});
async function model(modelId,maxTokens=4096,thinking='auto'){
 await nav('模型与设置');await card().getByRole('button',{name:'编辑配置',exact:true}).click();
 await dialog().getByLabel(/^模型 ID/).fill(modelId);await dialog().getByLabel(/^输出上限/).fill(String(maxTokens));await dialog().getByLabel(/^思考模式/).selectOption(thinking);await dialog().getByRole('button',{name:'保存模型',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
}
await model('mock-memory-reasoning-length',65536,'enabled');await card().getByRole('button',{name:'编辑配置',exact:true}).click();await expect(dialog().getByLabel(/^输出上限/)).toHaveValue('65536');await expect(dialog().getByLabel(/^思考模式/)).toHaveValue('enabled');await dialog().getByRole('button',{name:'保存模型',exact:true}).click();check('65536输出与思考开关可以保存重开，模型和既有密钥保留');
const before=await load();const chapterId=before.chapters[0].id;const oldFacts=JSON.stringify(before.facts),oldVersions=JSON.stringify(before.chapters[0].versions);
async function openWriter(){await nav('写作台');await page.locator('.chapter-item').filter({hasText:before.chapters[0].title}).click();}
async function memory(modelId,button='提取摘要与记忆'){
 await model(modelId);await openWriter();await page.getByRole('button',{name:'记忆',exact:true}).click();
 const count=(await api('list_runs',{projectId:human.pid})).filter(r=>r.task==='remember'&&r.chapterId===chapterId).length;
 if(button!=='提取摘要与记忆')await page.getByRole('button',{name:'任务',exact:true}).click();
 await page.getByRole('button',{name:button,exact:true}).first().click();
 await expect.poll(async()=> (await api('list_runs',{projectId:human.pid})).filter(r=>r.task==='remember'&&r.chapterId===chapterId).length).toBe(count+1);
 await expect.poll(async()=> (await api('list_runs',{projectId:human.pid})).find(r=>r.task==='remember'&&r.chapterId===chapterId).status,{timeout:30000}).not.toBe('running');
 const run=(await api('list_runs',{projectId:human.pid})).find(r=>r.task==='remember'&&r.chapterId===chapterId);await page.getByRole('button',{name:'任务',exact:true}).click();return run;
}
const failed=await memory('mock-memory-reasoning-length');assert.equal(failed.error.code,'OUTPUT_TRUNCATED');assert.equal(failed.inputTokens,5629);assert.equal(failed.outputTokens,4096);assert.equal(failed.reasoningTokens,4000);await expect(page.locator('.task-card').first()).toContainText('推理 4000');await expect(page.locator('.task-card').first()).toContainText('增大上下文不会增加输出预算');assert.equal((await load()).chapters[0].summary,before.chapters[0].summary);check('复现仅推理加空正文的长度结束，显示原因和用量，不写入空摘要或推理');
await page.screenshot({path:'../../work/v032/memory-reasoning.png'});
const partial=await memory('mock-memory-partial','重新提取摘要与记忆');assert.equal(partial.error.code,'OUTPUT_TRUNCATED');assert.equal(partial.calls,1);assert.ok(partial.segments[0].text.includes('half JSON'));check('半截JSON保留为任务片段，不当作完整记忆，不自动重复请求');
const empty=await memory('mock-memory-empty');assert.equal(empty.error.code,'EMPTY_RESPONSE');assert.equal(empty.outputTokens,4096);check('JSON空正文有具体提示，失败用量保留，不把50万上下文误当输出容量');
const successful=await memory('mock-memory-fenced','重新提取摘要与记忆');assert.equal(successful.status,'succeeded');const after=await load();assert.equal(JSON.stringify(after.facts),oldFacts);assert.equal(JSON.stringify(after.chapters[0].versions),oldVersions);assert.ok(after.chapters[0].summary.length>0);assert.ok(!JSON.stringify(after).includes('TEST ONLY:'));check('调整后从失败任务手动重新提取成功，兼容代码块JSON，正文历史与确认事实均保留');
await model(provider.modelId,provider.maxTokens,provider.thinkingMode);await page.getByLabel(/^模型上下文窗口/).fill(String(original.settings.contextTokens));await page.getByRole('button',{name:'保存项目设置',exact:true}).click();await nav('我的作品');assert.deepEqual(errors,[]);check('恢复原模型配置、参数、主副选择和上下文，流程无未捕获JavaScript异常');
await writeFile('../../work/v032/desktop-memory-results.json',JSON.stringify({version,checks,errors},null,2));process.exit(0);
