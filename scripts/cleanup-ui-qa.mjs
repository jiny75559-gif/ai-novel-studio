import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const b = await chromium.connectOverCDP("http://127.0.0.1:9223"),
  page = b.contexts()[0].pages()[0];
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
for (const card of await api("list_projects", {trash:true})) {
  if (card.title!=="自动形象读取测试") continue;
  await api("trash_project",{projectId:card.id,deleted:false});
  const p=await api("load_project",{projectId:card.id});
  if (p.visualProfiles.some(v=>v.referenceImageId)) break;
  await api("trash_project",{projectId:card.id,deleted:true});
}
for (const card of await api("list_projects", {trash:false})) {
  let p = await api("load_project", { projectId: card.id });
  p = await api("mutate_project", {
    projectId: p.id,
    expectedRevision: p.revision,
    mutation: {
      type: "metadata",
      title: p.title,
      genre: p.genre,
      perspective: p.perspective,
      outline: p.outline,
      settings: {
        ...p.settings,
        writerId: "",
        reviewerId: "",
        autoReview: false,
        autoNext: false,
      },
    },
  });
  await api("mutate_project", {
    projectId: p.id,
    expectedRevision: p.revision,
    mutation: {
      type: "visualSettings",
      settings: { ...p.visualSettings, providerId: "" },
    },
  });
}
for (const p of await api("list_providers"))
  await api("delete_provider", { providerId: p.id });
for (const p of await api("list_image_configs"))
  await api("delete_image_config", { configId: p.id });
assert.equal((await api("list_providers")).length, 0);
assert.equal((await api("list_image_configs")).length, 0);
console.log(
  "All isolated UI QA provider credentials and image configurations removed",
);
process.exit(0);
