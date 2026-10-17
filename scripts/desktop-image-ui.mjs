import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const b=await chromium.connectOverCDP("http://127.0.0.1:9223"),page=b.contexts()[0].pages()[0];page.setDefaultTimeout(15000);
const api=(name,args={})=>page.evaluate(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
const info=await api("app_info");assert.ok(info.dataDir.replaceAll("\\","/").endsWith("/work/qa-ui/data"));
const human=JSON.parse(await readFile("../../work/qa-ui/human-workflow.json","utf8"));
let pid;const load=()=>api("load_project",{projectId:pid});const dialog=()=>page.getByRole("dialog").last();
const nav=name=>page.getByRole("button",{name,exact:true}).first().click();
const checks=[];const check=s=>{checks.push(s);console.log("PASS",s);};const stamp=Date.now();
try{
 await nav("我的作品");await page.getByLabel("搜索作品",{exact:true}).fill("");const beforeIds=new Set((await api("list_projects",{trash:false})).map(c=>c.id));await page.getByRole("button",{name:"新建作品",exact:true}).last().click();await dialog().getByRole("button",{name:"创建示例",exact:true}).click();await expect(page.locator(".writer-layout")).toBeVisible();pid=(await api("list_projects",{trash:false})).find(c=>!beforeIds.has(c.id)).id;await page.getByLabel("章节正文",{exact:true}).fill("林舟留着黑色短发，左眉有一道浅疤，穿深灰色外套。林舟站在雨夜灯塔门口，护着受伤的左臂。叶岚穿深绿色外套，保管铜钥匙。两人准备离开灯塔。");await page.getByRole("button",{name:"保存版本",exact:true}).click();await nav("插图与形象");
 const addService=async (mode)=>{
  await page.getByRole("button",{name:"添加生图服务",exact:true}).click();await dialog().getByLabel("生图服务类型",{exact:true}).selectOption(mode);const name=`UI ${mode} ${stamp}`;
  await dialog().getByLabel(/^配置名称/).fill(name);await dialog().getByLabel(/^服务地址/).fill(mode==="cloud"?"http://127.0.0.1:8790/v1":"http://127.0.0.1:8790");await dialog().getByLabel(/^允许本机 HTTP/).check();
  if(mode==="cloud")await dialog().getByLabel(/^图像模型 ID/).fill("mock-image");
  if(mode==="comfyui"){
    await dialog().getByLabel("ComfyUI 工作流",{exact:true}).fill(JSON.stringify({
     4:{class_type:"CheckpointLoaderSimple",inputs:{ckpt_name:"fixture.safetensors"}},10:{class_type:"LoadImage",inputs:{image:"unused.png"}},11:{class_type:"VAEEncode",inputs:{pixels:["10",0],vae:["4",2]}},6:{class_type:"CLIPTextEncode",inputs:{text:"",clip:["4",1]}},7:{class_type:"CLIPTextEncode",inputs:{text:"",clip:["4",1]}},3:{class_type:"KSampler",inputs:{seed:1,model:["4",0],steps:20,cfg:7,sampler_name:"euler",scheduler:"normal",denoise:0.5,positive:["6",0],negative:["7",0],latent_image:["11",0]}},8:{class_type:"VAEDecode",inputs:{samples:["3",0],vae:["4",2]}},9:{class_type:"SaveImage",inputs:{images:["8",0]}}
    }));await dialog().getByLabel(/^人物参考图 LoadImage 节点 ID/).fill("10");
  }
  await dialog().getByRole("button",{name:"保存生图配置",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);const c=(await api("list_image_configs")).find(c=>c.name===name);assert.ok(c);await page.getByLabel("生图服务",{exact:true}).selectOption(c.id);await page.locator(".visual-service-row").getByRole("button",{name:"保存",exact:true}).click();await page.locator(".visual-service-row").getByRole("button",{name:"测试连接",exact:true}).click();await expect(page.locator(".toast")).toContainText(/成功|可用|连接/);return c;
 };
 await addService("cloud");const first=(await load()).characters[0];const card=()=>page.locator(".visual-profile-card").filter({has:page.getByRole("heading",{name:new RegExp("^"+first.name)})});
 await card().getByRole("button",{name:"编辑形象",exact:true}).click();await dialog().getByLabel(/^固定外貌与辨识细节/).fill("黑色短发，左眉浅疤，深灰色外套，左臂受伤。");await dialog().getByRole("button",{name:"确认并保存",exact:true}).click();await card().getByRole("button",{name:"生成定妆",exact:true}).click();await page.getByRole("button",{name:"设为固定形象",exact:true}).first().click();await expect.poll(async()=>(await load()).visualProfiles.find(v=>v.characterId===first.id)?.referenceImageId,{timeout:30000}).toBeTruthy();const reference=(await load()).visualProfiles.find(v=>v.characterId===first.id).referenceImageId;
 check("从界面新增云端兼容生图服务、测试连接、编辑外貌、生成定妆并确认固定形象");
 const generate=async()=>{
  for(const person of (await load()).characters) {const label=page.locator(".scene-characters label").filter({hasText:person.name});if(await label.count())await label.getByRole("checkbox").setChecked(person.id===first.id);}
  await page.getByLabel("插图场景",{exact:true}).fill("林舟在雨夜灯塔门口，左臂受伤，黑色短发、左眉浅疤、深灰色外套。");const before=(await load()).artwork.filter(a=>a.kind==="chapter").length;await page.getByRole("button",{name:"生成本章插图",exact:true}).click();await expect.poll(async()=>(await load()).artwork.filter(a=>a.kind==="chapter").length,{timeout:30000}).toBe(before+1);assert.equal((await load()).visualProfiles.find(v=>v.characterId===first.id).referenceImageId,reference);
 };
 await generate();let stats=await(await fetch("http://127.0.0.1:8790/stats")).json();stats=stats.requests;assert.ok(stats.some(r=>r.path==="/v1/images/edits"&&r.multipartBytes>0));
 await page.getByRole("button",{name:"放入本章",exact:true}).first().click();await expect.poll(async()=>(await load()).artwork.some(a=>a.kind==="chapter"&&a.approved)).toBe(true);
 check("云端插图实际携带固定参考图，作者可把图片放入章节");
 for(const mode of ["webui","comfyui"]){await addService(mode);await generate();check(`${mode} 经配置按钮保存和测试，再生成本章插图；原固定形象保持不变`);}
 stats=await(await fetch("http://127.0.0.1:8790/stats")).json();stats=stats.requests;assert.ok(stats.some(r=>r.path==="/sdapi/v1/img2img"&&r.body?.init_images?.length===1));assert.ok(stats.some(r=>r.path==="/upload/image"&&r.multipartBytes>0));assert.ok(stats.some(r=>r.path==="/prompt"));
 const imagePath=`../../work/qa-ui/image-ui-${stamp}.png`;await page.getByRole("button",{name:"保存图片",exact:true}).first().click();execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",resolve("../../work/qa-ui/native-file-dialog.ps1"),"-File",resolve(imagePath),"-Title","保存插图"],{timeout:15000});await expect.poll(async()=>{try{return (await stat(imagePath)).size;}catch{return 0;}}).toBeGreaterThan(0);assert.equal((await readFile(imagePath)).subarray(1,4).toString(),"PNG");
 check("保存图片按钮经 Windows 对话框导出真实 PNG 文件");
 await nav("书本阅读");await expect(page.locator(".reader-view")).toBeVisible();await expect(page.locator(".chapter-artwork-image").or(page.locator(".book-leaf img")).first()).toBeVisible({timeout:30000});check("放入章节的插图可在电子书阅读页显示");
 await writeFile("../../work/qa-ui/image-ui-results.json",JSON.stringify({pid,checks,reference,imagePath},null,2));
}catch(e){await page.screenshot({path:"../../work/qa-ui/image-ui-failure.png"});console.error(e.message);console.error((await page.locator("body").innerText()).slice(-1800));process.exit(1);}
process.exit(0);
