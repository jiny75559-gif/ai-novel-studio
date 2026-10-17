import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const check = (s) => {
  checks.push(s);
  console.log(`PASS ${s}`);
};
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const load = (pid) => api("load_project", { projectId: pid });
const waitPages = async () => {
  await page.locator(".reader-view").waitFor();
  await expect
    .poll(() => page.locator(".book-leaf .leaf-body p").count(), {
      timeout: 30000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator(".reader-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => document.fonts.check("22px NanoOldSong", "风雨")),
      { timeout: 30000 },
    )
    .toBe(true);
};
const waitJob = async (pid, id) => {
  let j;
  await expect
    .poll(
      async () => {
        j = (await api("list_image_jobs", { projectId: pid })).find(
          (j) => j.id === id,
        );
        return j?.status;
      },
      { timeout: 20000, intervals: [100, 300] },
    )
    .not.toBe("running");
  return j;
};
const mutate = async (pid, mutation) => {
  const p = await load(pid);
  return api("mutate_project", {
    projectId: pid,
    expectedRevision: p.revision,
    mutation,
  });
};
await page.reload();
await page.waitForSelector(".app-shell");
await page
  .getByRole("button", { name: "继续阅读", exact: true })
  .first()
  .click();
await waitPages();
let book = (await api("list_projects", { trash: false })).find(
  (p) => p.title === "离线阅读测试",
);
book = await load(book.id);
assert.equal(book.bookSource, "txt");
assert.equal(book.chapters.length, 3);
assert.equal(book.settings.writerId, "");
assert.ok(
  await page.evaluate(() => document.fonts.check("22px NanoOldSong", "风雨")),
);
check("真实原生 TXT 导入，未配置 AI 即可用内置纳米老宋双页阅读");
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page
  .getByRole("combobox", { name: "阅读字号", exact: true })
  .selectOption("22");
await waitPages();
await expect.poll(async () => (await load(book.id)).reader.fontSize).toBe(22);
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await page.getByRole("button", { name: "目录与书签", exact: true }).click();
await page.locator(".reader-toc>button").first().click();
await waitPages();
await page.getByRole("button", { name: "目录与书签", exact: true }).click();
let end = 0;
let spread = 0;
const text = book.chapters[0].working;
while (end < text.length && spread++ < 100) {
  const visible = await page
    .locator(".book-leaf .leaf-body")
    .evaluateAll((bodies) => ({
      blocks: bodies.flatMap((e) =>
        Array.from(e.querySelectorAll("p"), (p) => ({
          start: +p.dataset.offset,
          end: +p.dataset.end,
          text: p.textContent,
        })),
      ),
      sizes: bodies.map((e) => [e.scrollHeight, e.clientHeight]),
    }));
  for (const [scroll, height] of visible.sizes)
    assert.ok(scroll <= height + 1, `overflow ${scroll}>${height}`);
  for (const b of visible.blocks) {
    assert.equal(b.start, end, "page boundaries lost or repeated text");
    assert.equal(
      b.text,
      text.slice(b.start, b.end).replace(/\r?\n$/, "") || "\u200b",
    );
    end = b.end;
  }
  if (end < text.length)
    await page.getByRole("button", { name: "下一页", exact: true }).click();
}
assert.equal(end, text.length);
check("逐页核对整章：正文位置连续，中文、段落与空行无漏字重叠，页面无隐藏溢出");
await page.getByRole("button", { name: "上一页", exact: true }).click();
await page.getByRole("button", { name: "上一页", exact: true }).click();
const anchor = +(await page
  .locator(".book-leaf .leaf-body p")
  .first()
  .getAttribute("data-offset"));
await expect.poll(async () => (await load(book.id)).reader.offset).toBe(anchor);
assert.ok(anchor > 0);
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page
  .getByRole("combobox", { name: "阅读字号", exact: true })
  .selectOption("18");
await waitPages();
await expect.poll(async () => (await load(book.id)).reader.fontSize).toBe(18);
assert.equal((await load(book.id)).reader.offset, anchor);
await page
  .getByRole("combobox", { name: "阅读主题", exact: true })
  .selectOption("night");
await page
  .getByRole("combobox", { name: "阅读缩放", exact: true })
  .selectOption("80");
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await page.getByRole("button", { name: "添加书签", exact: true }).click();
await expect
  .poll(async () => (await load(book.id)).reader.bookmarks.length)
  .toBeGreaterThan(0);
check("字号重排保留正文锚点，夜读、缩放与书签落盘");
await page.getByRole("button", { name: "目录与书签", exact: true }).click();
await page.locator(".reader-toc>button").nth(1).click();
await expect(page.locator(".reader-status")).toContainText("第二章 远行");
await waitPages();
await expect
  .poll(async () => (await load(book.id)).reader.chapterId)
  .toBe(book.chapters[1].id);
await page.locator(".reader-toc>button").first().click();
await waitPages();
await page.getByRole("button", { name: "目录与书签", exact: true }).click();
await page.getByRole("button", { name: "下一页", exact: true }).click();
const turned = await page.locator(".reader-status").innerText();
await page.keyboard.press("ArrowLeft");
await expect(page.locator(".reader-status")).not.toHaveText(turned);
check("目录跳章、左右按钮与键盘翻页正常");
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await page
  .getByRole("combobox", { name: "阅读字号", exact: true })
  .selectOption("20");
await waitPages();
await page
  .getByRole("combobox", { name: "阅读主题", exact: true })
  .selectOption("paper");
await page
  .getByRole("combobox", { name: "阅读缩放", exact: true })
  .selectOption("100");
await page.getByRole("button", { name: "关闭阅读设置" }).click();
await page.getByRole("button", { name: "下一页", exact: true }).click();
await expect
  .poll(async () => (await load(book.id)).reader.offset)
  .toBeGreaterThan(0);
const remembered = (await load(book.id)).reader;
await page.reload();
await page
  .getByRole("button", { name: "继续阅读", exact: true })
  .first()
  .click();
await waitPages();
assert.equal((await load(book.id)).reader.offset, remembered.offset);
await page.getByRole("button", { name: "阅读设置", exact: true }).click();
await expect(
  page.getByRole("combobox", { name: "阅读字号", exact: true }),
).toHaveValue("20");
await page.getByRole("button", { name: "关闭阅读设置" }).click();
check("界面重载后恢复字号、书签与阅读位置");
await page.getByRole("button", { name: "上一页", exact: true }).click();
await page.screenshot({ path: "../双页阅读预览.png" });
// Every media request below uses a local fixture server, with no model or paid API.
await page.getByRole("button", { name: "我的作品", exact: true }).click();
await page
  .getByRole("button", { name: "新建作品", exact: true })
  .last()
  .click();
await page.getByRole("button", { name: "创建示例", exact: true }).click();
await page
  .getByRole("textbox", { name: "章节正文", exact: true })
  .fill(
    "林舟剪短了头发。\n\n他站在灯塔的门边，雨水沿着石阶流淌。叶岚坐在窗边，拆开那封迟到的信。",
  );
await page.getByRole("button", { name: "插图与形象", exact: true }).click();
let p = (await api("list_projects", { trash: false })).find(
  (p) => p.genre !== "阅读",
);
p = await load(p.id);
const pid = p.id;
const cid = p.chapters[0].id;
await page
  .locator(".visual-profile-card")
  .first()
  .getByRole("button", { name: "编辑形象", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "固定外貌与辨识细节", exact: true })
  .fill("年轻男子，圆脸，灰色眼睛，黑色长发；鼻梁左侧有一颗小痣。");
await page.getByRole("button", { name: "确认并保存", exact: true }).click();
await page.getByRole("button", { name: "添加生图服务", exact: true }).click();
await page
  .getByRole("combobox", { name: "生图服务类型", exact: true })
  .selectOption("cloud");
await page
  .getByRole("textbox", { name: "配置名称", exact: true })
  .fill("QA 云端图像（模拟）");
await page
  .getByRole("textbox", { name: "服务地址", exact: true })
  .fill("http://127.0.0.1:8790/v1");
await page
  .getByRole("checkbox", { name: "允许本机 HTTP", exact: false })
  .check();
await page
  .getByRole("textbox", { name: "图像模型 ID", exact: true })
  .fill("mock-image");
await page.getByRole("button", { name: "保存生图配置", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await page
  .locator(".visual-profile-card")
  .first()
  .getByRole("button", { name: "生成定妆", exact: true })
  .click();
await expect(page.locator(".portrait-candidate")).toHaveCount(1, {
  timeout: 20000,
});
p = await load(pid);
assert.equal(p.visualProfiles[0].referenceImageId, "");
await page
  .getByRole("button", { name: "设为固定形象", exact: true })
  .first()
  .click();
await expect
  .poll(async () => (await load(pid)).visualProfiles[0].referenceImageId)
  .not.toBe("");
p = await load(pid);
const reference = p.visualProfiles[0].referenceImageId;
check("定妆生成结果先成为候选，作者确认后固定形象");
await page.locator(".scene-characters").getByRole("checkbox").first().check();
await page
  .getByRole("textbox", { name: "插图场景", exact: true })
  .fill("林舟在灯塔门边，雨夜，柔和灯光，半身人物。");
await page.getByRole("button", { name: "生成本章插图", exact: true }).click();
await expect(page.locator(".artwork-gallery article")).toHaveCount(1, {
  timeout: 20000,
});
assert.equal((await load(pid)).visualProfiles[0].referenceImageId, reference);
let stats = await (await fetch("http://127.0.0.1:8790/stats")).json();
assert.ok(
  stats.requests.some(
    (r) => r.path === "/v1/images/edits" && r.multipartBytes > 100,
  ),
);
await page.getByRole("button", { name: "放入本章", exact: true }).click();
await expect
  .poll(async () => (await load(pid)).artwork.filter((a) => a.approved).length)
  .toBe(1);
check(
  "云端章节图使用 multipart 固定参考图，结果不替换人物形象，确认后进入章节",
);
await page
  .locator(".visual-profile-card")
  .first()
  .getByRole("button", { name: "记录变化", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "原文依据", exact: false })
  .fill("林舟剪短了头发。");
await page
  .getByRole("textbox", { name: "外貌如何变化", exact: true })
  .fill("头发变为短发");
await page.getByRole("button", { name: "保存变化", exact: true }).click();
await expect.poll(async () => (await load(pid)).visualChanges.length).toBe(1);
const workflow = {
  4: {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "test-only.safetensors" },
  },
  6: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
  7: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["4", 1] } },
  10: { class_type: "LoadImage", inputs: { image: "old.png" } },
  12: { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } },
  3: {
    class_type: "KSampler",
    inputs: {
      seed: 123,
      steps: 20,
      cfg: 7,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 0.6,
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["12", 0],
    },
  },
  8: { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  9: {
    class_type: "SaveImage",
    inputs: { images: ["8", 0], filename_prefix: "NovelStudioQA" },
  },
};
await page.getByRole("button", { name: "添加生图服务", exact: true }).click();
await page
  .getByRole("textbox", { name: "配置名称", exact: true })
  .fill("QA ComfyUI（模拟）");
await page
  .getByRole("textbox", { name: "服务地址", exact: true })
  .fill("http://127.0.0.1:8790");
await page
  .getByRole("textbox", { name: "ComfyUI 工作流", exact: true })
  .fill(JSON.stringify(workflow));
await page
  .getByRole("textbox", { name: "人物参考图 LoadImage 节点 ID", exact: false })
  .fill("10");
await page.getByRole("button", { name: "保存生图配置", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await fetch("http://127.0.0.1:8790/control", {
  method: "POST",
  body: JSON.stringify({ hold: true }),
});
await page.getByRole("button", { name: "生成本章插图", exact: true }).click();
let j;
await expect
  .poll(
    async () => {
      j = (await api("list_image_jobs", { projectId: pid })).find(
        (j) => j.config.mode === "comfyui",
      );
      return j?.remotePromptId || "";
    },
    { timeout: 15000 },
  )
  .not.toBe("");
await page.getByRole("button", { name: "停止等待", exact: true }).click();
assert.equal((await waitJob(pid, j.id)).status, "cancelled");
stats = await (await fetch("http://127.0.0.1:8790/stats")).json();
const submits = stats.requests.filter((r) => r.path === "/prompt").length;
const submit = stats.requests.find((r) => r.path === "/prompt");
assert.equal(submit.body.prompt["10"].inputs.image, "novel/confirmed.png");
assert.ok(submit.body.prompt["6"].inputs.text.includes("头发变为短发"));
assert.equal(submit.body.prompt["3"].inputs.steps, 20);
await fetch("http://127.0.0.1:8790/control", {
  method: "POST",
  body: JSON.stringify({ hold: false }),
});
await page.getByRole("button", { name: "取回原任务", exact: true }).click();
await expect
  .poll(
    async () =>
      (await api("list_image_jobs", { projectId: pid })).find(
        (x) => x.id === j.id,
      )?.status,
    { timeout: 15000 },
  )
  .toBe("succeeded");
stats = await (await fetch("http://127.0.0.1:8790/stats")).json();
assert.equal(
  stats.requests.filter((r) => r.path === "/prompt").length,
  submits,
);
assert.ok(!stats.requests.some((r) => r.path === "/interrupt"));
check(
  "ComfyUI 上传参考、保留原工作流参数、原文变化入提示词；停止后按原任务取回且未再次提交",
);
await page.getByRole("button", { name: "书本阅读", exact: true }).click();
await waitPages();
while (!(await page.locator(".book-illustration").count())) {
  await page.getByRole("button", { name: "下一页", exact: true }).click();
}
await expect(page.locator(".book-illustration")).toBeVisible();
check("作者选定的本章插图在书本页中可离线读取");
await page.getByRole("button", { name: "编辑本章", exact: true }).click();
const editor = page.getByRole("textbox", { name: "章节正文", exact: true });
await editor.fill(
  (await editor.inputValue()) + "\n作者改稿：他将雨伞留在门边。",
);
await page.getByRole("button", { name: "插图与形象", exact: true }).click();
await expect(
  page.getByText("正文已变更", { exact: true }).first(),
).toBeVisible();
check("阅读页直接返回编辑，新版正文使旧插图显示变更提示");
assert.deepEqual(errors, []);
fs.writeFileSync(
  "../../work/qa-v02/desktop-reading-images.json",
  JSON.stringify(
    { checks, errors, bookId: book.id, projectId: pid, reference, remembered },
    null,
    2,
  ),
);
await browser.close();
