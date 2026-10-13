// Packaged desktop host and explicit local fixture services; no paid models.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const api = async (name, args = {}) => {
  const r = await page.evaluate(
    async ({ name, args }) => {
      try {
        return {
          ok: true,
          value: await window.__TAURI_INTERNALS__.invoke(name, args),
        };
      } catch (error) {
        return { ok: false, error };
      }
    },
    { name, args },
  );
  if (!r.ok)
    throw Object.assign(
      new Error(r.error.userMessage || "Native command failed"),
      r.error,
    );
  return r.value;
};
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
const checks = [];
const check = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
let project = await api("create_project", {
  title: "自动形象读取测试",
  demo: true,
});
const pid = project.id;
const load = () => api("load_project", { projectId: pid });
const mutate = async (mutation) => {
  const p = await load();
  return api("mutate_project", {
    projectId: pid,
    expectedRevision: p.revision,
    mutation,
  });
};
let provider = await api("save_provider", {
  provider: {
    id: crypto.randomUUID(),
    name: "自动形象 QA（模拟）",
    baseUrl: "http://127.0.0.1:8787/v1",
    modelId: "mock-writer",
    allowLocalHttp: true,
    tokenParameter: "max_tokens",
    jsonMode: true,
    maxTokens: 4096,
    timeoutSeconds: 10,
    temperature: 0.2,
  },
  apiKey: "qa-ui-text-fixture",
});
project = await mutate({
  type: "metadata",
  title: "自动形象读取测试",
  genre: project.genre,
  perspective: project.perspective,
  outline: project.outline,
  settings: { ...project.settings, writerId: provider.id },
});
const image = await api("save_image_config", {
  config: {
    id: crypto.randomUUID(),
    name: "自动形象图 QA（测试像素）",
    mode: "cloud",
    baseUrl: "http://127.0.0.1:8788/v1",
    allowLocalHttp: true,
    modelId: "mock-image",
    timeoutSeconds: 60,
  },
  key: "",
});
await mutate({
  type: "visualSettings",
  settings: { providerId: image.id, style: "测试画风", negativePrompt: "" },
});
const cid = project.chapters[0].id;
const original =
  "林舟留着黑色短发，左眉有一道浅疤，穿深灰色外套。\n\n顾青戴着银框眼镜。灯塔外，雨雾笼罩着码头。";
let p = await load();
await api("save_working", {
  projectId: pid,
  chapterId: cid,
  expectedRevision: p.chapters[0].editRevision,
  content: original,
});
p = await load();
await api("save_working", {
  projectId: pid,
  chapterId: p.chapters[2].id,
  expectedRevision: p.chapters[2].editRevision,
  content: "FUTURE_CHAPTER_MUST_NOT_BE_SENT",
});
for (const card of await api("list_projects", { trash: false }))
  if (card.title === "自动形象读取测试" && card.id !== pid)
    await api("trash_project", { projectId: card.id, deleted: true });
await page.reload();
await page
  .locator(".project-card")
  .filter({
    has: page.getByRole("heading", { name: "自动形象读取测试", exact: true }),
  })
  .getByRole("button", { name: "编辑作品", exact: true })
  .click();
await page.getByRole("button", { name: "插图与形象", exact: true }).click();
await expect(page.locator(".visual-profile-card")).toHaveCount(2);
assert.equal((await load()).visualProfiles.length, 0);
await page
  .locator(".visual-profile-card")
  .first()
  .getByRole("button", { name: "生成定妆", exact: true })
  .click();
await expect(page.locator(".portrait-candidate")).toHaveCount(1, {
  timeout: 30000,
});
p = await load();
assert.equal(p.visualProfiles[0].appearance, "黑色短发，左眉浅疤，深灰色外套");
assert.equal(p.visualProfiles[0].referenceImageId, "");
assert.equal(p.chapters[0].working, original);
check("未手填外貌：点击生成定妆先调用主 AI 读取原文，再把提取外貌交给生图服务");
await page.getByRole("button", { name: "设为固定形象", exact: true }).click();
await expect
  .poll(async () => (await load()).visualProfiles[0].referenceImageId)
  .not.toBe("");
const reference = (await load()).visualProfiles[0].referenceImageId;
await page.getByRole("button", { name: "写作台", exact: true }).click();
await page
  .getByRole("textbox", { name: "章节正文", exact: true })
  .fill(original + "\n\n林舟换上了深蓝色外套。");
await page.getByRole("button", { name: "插图与形象", exact: true }).click();
await page.getByRole("button", { name: "从正文读取形象", exact: true }).click();
const dialog = page.getByRole("dialog", {
  name: "从正文读取的形象",
  exact: true,
});
await expect(dialog).toBeVisible({ timeout: 20000 });
await expect(dialog).toContainText("林舟换上了深蓝色外套。");
await expect(
  dialog.getByRole("checkbox", { name: "林舟", exact: true }),
).toBeDisabled();
await page.screenshot({
  path: "../自动读取形象预览.png",
  animations: "disabled",
});
await dialog.getByRole("button", { name: "采用所选形象与变化" }).click();
await expect(dialog).toHaveCount(0);
p = await load();
assert.ok(p.characters.some((c) => c.name === "顾青"));
assert.equal(
  p.visualProfiles.find((v) => v.characterId === p.characters[0].id)
    .referenceImageId,
  reference,
);
assert.ok(
  p.visualChanges.some(
    (v) => v.description === "深蓝色外套" && v.startOrder === 1,
  ),
);
check(
  "批量读取显示原文依据，补建新人物；固定人物不可覆盖，仅采用文中明确的服装变化",
);
const plan = await api("extract_visual_characters", {
  projectId: pid,
  chapterId: cid,
  characterId: null,
});
p = await load();
await api("save_working", {
  projectId: pid,
  chapterId: cid,
  expectedRevision: p.chapters[0].editRevision,
  content: p.chapters[0].working + "\n作者再次改稿。",
});
const newPerson = plan.profiles.find((v) => v.name === "顾青");
await assert.rejects(
  () =>
    mutate({
      type: "visualExtraction",
      profiles: [newPerson],
      changes: [],
      overwrite_existing: true,
    }),
  (e) => e.code === "SOURCE_CHANGED",
);
check("读取后正文发生修改时拒绝采用旧结果，未部分写入人物资料");
provider = await api("save_provider", {
  provider: { ...provider, modelId: "mock-invalid-visual" },
  apiKey: "",
});
await assert.rejects(
  () =>
    api("extract_visual_characters", {
      projectId: pid,
      chapterId: cid,
      characterId: p.characters[0].id,
    }),
  (e) => e.code === "INVALID_EVIDENCE",
);
provider = await api("save_provider", {
  provider: { ...provider, modelId: "mock-truncated" },
  apiKey: "",
});
await assert.rejects(
  () =>
    api("extract_visual_characters", {
      projectId: pid,
      chapterId: cid,
      characterId: p.characters[0].id,
    }),
  (e) => e.code === "OUTPUT_TRUNCATED",
);
check("伪造原文引用和被截断的模型回复均不形成形象设定");
const stats = await (await fetch("http://127.0.0.1:8787/stats")).json();
assert.ok(stats.visualRequests.length >= 3);
assert.ok(
  !JSON.stringify(stats.visualRequests).includes(
    "FUTURE_CHAPTER_MUST_NOT_BE_SENT",
  ),
);
assert.ok(stats.visualRequests[0].onlyCharacterId === p.characters[0].id);
check("请求只含当前及之前正文，首次定妆只读取指定人物；没有发送未来章节");
p = await load();
await mutate({
  type: "metadata",
  title: p.title,
  genre: p.genre,
  perspective: p.perspective,
  outline: p.outline,
  settings: { ...p.settings, writerId: "", reviewerId: "" },
});
await mutate({
  type: "visualSettings",
  settings: { ...p.visualSettings, providerId: "" },
});
await api("delete_provider", { providerId: provider.id });
await api("delete_image_config", { configId: image.id });
await writeFile(
  "../../work/qa-ui/visual-extract-results.json",
  JSON.stringify({ checks }, null, 2),
);
console.log("QA model credentials removed");
process.exit(0);
