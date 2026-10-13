import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
const b = await chromium.connectOverCDP("http://127.0.0.1:9223"),
  page = b.contexts()[0].pages()[0];
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
const cards = await api("list_projects", { trash: false });
cards.sort((a,b)=>a.id.localeCompare(b.id));
const snapshot = [];
for (const card of cards) {
  const p = await api("load_project", { projectId: card.id });
  snapshot.push({
    id: p.id,
    reader: p.reader,
    characters: p.characters,
    profiles: p.visualProfiles,
    changes: p.visualChanges,
    artwork: p.artwork,
  });
}
const file = "../../work/qa-ui/persistence.json";
if (process.argv.includes("--verify")) {
  assert.deepEqual(snapshot, JSON.parse(await readFile(file, "utf8")));
  console.log(
    "PASS actual process restart preserves reading progress, extracted characters, appearance changes and fixed image IDs",
  );
} else {
  await writeFile(file, JSON.stringify(snapshot));
  console.log("Persistence snapshot saved");
}
process.exit(0);
