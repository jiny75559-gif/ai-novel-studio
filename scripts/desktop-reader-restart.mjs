import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const b = await chromium.connectOverCDP("http://127.0.0.1:9223"),
  page = b.contexts()[0].pages()[0];
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
const file = "../../work/qa-ebooks/restart.json";
if (process.argv.includes("--verify")) {
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  for (const expected of snapshot) {
    const p = await api("load_project", { projectId: expected.id });
    assert.deepEqual({ ...p.reader, lastReadAt: 0 }, expected.reader);
    assert.deepEqual(p.readingMarks, expected.marks);
    assert.equal(p.coverImageId, expected.cover);
  }
  const pdf = snapshot.find((s) => s.pdf);
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({
      has: page.getByRole("heading", { name: pdf.title, exact: true }),
    })
    .getByRole("button", { name: "打开阅读" })
    .click();
  await expect(
    page.locator(
      `.pdf-page[data-page="${pdf.reader.offset + 1}"][data-ready="true"]`,
    ),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  console.log(
    "PASS actual process restart restores exact PDF/text progress, settings, bookmarks, annotations and image IDs",
  );
} else {
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  const snapshot = [];
  for (const card of await api("list_projects", { trash: false })) {
    const p = await api("load_project", { projectId: card.id });
    snapshot.push({
      id: p.id,
      title: p.title,
      pdf: !!p.pdfBook,
      reader: { ...p.reader, lastReadAt: 0 },
      marks: p.readingMarks,
      cover: p.coverImageId,
    });
  }
  await writeFile(file, JSON.stringify(snapshot));
  console.log(
    "Reader restart snapshot saved after all pending positions committed",
  );
}
process.exit(0);
