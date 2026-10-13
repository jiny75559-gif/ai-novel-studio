// This deliberately refuses to mutate an ordinary user's application data.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa/desktop-data"));
const cards = await api("list_projects", { trash: false });
for (const card of cards) {
  const p = await api("load_project", { projectId: card.id });
  await api("mutate_project", {
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
        autoNext: false,
        autoReview: false,
      },
    },
  });
}
const providers = await api("list_providers");
for (const p of providers) await api("delete_provider", { providerId: p.id });
assert.equal((await api("list_providers")).length, 0);
console.log(
  `Removed ${providers.length} isolated QA credentials and configurations`,
);
await browser.close();
