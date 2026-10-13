import { chromium,expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223'),page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(20000);
const api=(name,args={})=>page.evaluate(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const info=await api('app_info');assert.ok(info.dataDir.replaceAll('\\','/').endsWith('/work/qa-ui/data'));assert.equal(info.version,'0.3.1');
const dialog=()=>page.getByRole('dialog').last();
const nav=name=>page.getByRole('button',{name,exact:true}).first().click();
const checks=[];const check=s=>{checks.push(s);console.log('PASS',s);};
const open=async()=>{await page.getByRole('button',{name:'软件更新',exact:true}).click();await expect(dialog()).toContainText('当前版本 v0.3.1');};
const choose=async path=>{await dialog().getByRole('button',{name:'选择本地更新包',exact:true}).click();execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('../../work/qa-ui/native-file-dialog.ps1'),'-File',resolve(path),'-Title','选择叙事更新包'],{timeout:15000});};
const close=()=>dialog().getByRole('button',{name:'关闭',exact:true}).click();
if(process.argv.includes('--verify')){
 const expected=JSON.parse(await readFile('../../work/qa-v031/update-restart.json','utf8'));
 const p=await api('load_project',{projectId:expected.pid});
 assert.equal(p.chapters[0].working,expected.body);assert.equal(p.chapters[0].versions.length,expected.versions);
 assert.deepEqual(p.settings,expected.settings);assert.deepEqual(p.writingPreset,expected.preset);
 assert.deepEqual((await api('list_providers')).sort((a,b)=>a.id.localeCompare(b.id)),expected.providers);
 assert.equal((await api('test_provider',{providerId:p.settings.writerId})).message,'连接成功');
 check('真实安装更新并启动新进程后，正文工作副本、不可变版本、主副配置、预设和凭据均保留');
 const {writeFile:save}=await import('node:fs/promises');await save('../../work/qa-v031/update-restart-results.json',JSON.stringify({checks},null,2));process.exit(0);
}
if(process.argv.includes('--install')){
 const human=JSON.parse(await readFile('../../work/qa-ui/human-workflow.json','utf8'));const p=await api('load_project',{projectId:human.pid});
 await nav('我的作品');await page.getByLabel('搜索作品',{exact:true}).fill(human.title);
 await page.locator('.project-card').filter({has:page.getByRole('heading',{name:human.title,exact:true})}).getByRole('button',{name:'编辑作品',exact:true}).click();await expect(page.locator('.writer-layout')).toBeVisible();
 const body=p.chapters[0].working+'\n\n更新之前的作者工作副本：保存并保留这句话。';
 await page.getByRole('textbox',{name:'章节正文',exact:true}).fill(body);
 await open();await choose('../../work/release-v031/AI-Novel-Studio-0.3.1.nsupdate');await expect(dialog().getByRole('status')).toContainText('已校验');
 const providers=(await api('list_providers')).sort((a,b)=>a.id.localeCompare(b.id));
 await writeFile('../../work/qa-v031/update-restart.json',JSON.stringify({pid:p.id,body,versions:p.chapters[0].versions.length,settings:p.settings,preset:p.writingPreset,providers},null,2));
 await page.screenshot({path:'../../work/qa-v031/update-ready.png'});
 // Native installation deliberately exits the application after saving/backup.
 await dialog().getByRole('button',{name:'安装此更新包',exact:true}).click();
 console.log('UPDATE_INSTALL_TRIGGERED');process.exit(0);
}
await open();await dialog().getByRole('textbox',{name:'GitHub 更新仓库',exact:true}).fill('https://github.com/jiny75559-gif/ai-novel-studio');await dialog().getByRole('button',{name:'保存仓库',exact:true}).click();await expect(dialog().getByRole('status')).toContainText('仓库已保存');assert.equal((await api('update_config')).repository,'jiny75559-gif/ai-novel-studio');
check('软件更新入口、仓库链接规范化与保存正常，和插件仓库独立');
await dialog().getByRole('button',{name:'检查新版',exact:true}).click();
if(process.argv.includes('--online')){
 await expect(dialog().getByRole('status')).toContainText('最新版本',{timeout:40000});await page.screenshot({path:'../../work/qa-v031/update-online.png'});check('实际从 GitHub 正式发布读取说明与签名，校验通过并识别当前为最新版本');
}else{
 await expect(dialog().getByRole('alert')).toContainText('暂未找到可用更新',{timeout:40000});check('发布文件尚未配置时显示明确原因，不误报最新版且可继续使用本地更新');
}
await choose('../../work/qa-v031/damaged.nsupdate');await expect(dialog().getByRole('alert')).toContainText('损坏');await expect(dialog().getByRole('button',{name:'安装此更新包',exact:true})).toHaveCount(0);check('本地包被篡改时拒绝安装，软件与作品保留');
await choose('../../work/qa-ui/old-signed-fixture.nsupdate');await expect(dialog().getByRole('status')).toContainText('更旧');await expect(dialog().getByRole('button',{name:'安装此更新包',exact:true})).toBeDisabled();check('签名正确但版本更旧的本地包被降级保护拦截');
await choose('../../work/release-v031/AI-Novel-Studio-0.3.1.nsupdate');await expect(dialog().getByRole('status')).toContainText('已校验');await expect(dialog().getByRole('button',{name:'安装此更新包',exact:true})).toBeEnabled();await page.screenshot({path:'../../work/qa-v031/update-panel.png'});check('正式本地更新包通过真实文件对话框、签名、完整性和版本校验，可一键安装');
await close();await writeFile('../../work/qa-v031/update-ui-results.json',JSON.stringify({checks},null,2));process.exit(0);
