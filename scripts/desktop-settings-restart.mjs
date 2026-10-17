import { version as expectedVersion } from "./qa-version.mjs";
// Verify persisted settings using the real host and visible model test buttons.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const api = (name, args = {}) => page.evaluate(
  ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args), { name, args });
const info = await api('app_info');
assert.ok(info.dataDir.replaceAll('\\', '/').endsWith('/work/qa-ui/data'));
assert.equal(info.version, expectedVersion);
const human = JSON.parse(await readFile('../../work/qa-ui/human-workflow.json', 'utf8'));
const snapshotFile = '../../work/qa-ui/settings-restart.json';
const p = await api('load_project', { projectId: human.pid });
const providers = (await api('list_providers')).sort((a, b) => a.id.localeCompare(b.id));
const snapshot = { providers, settings: p.settings, preset: p.writingPreset };
const nav = name => page.getByRole('button', { name, exact: true }).first().click();
const card = title => page.locator('.project-card').filter({
  has: page.getByRole('heading', { name: title, exact: true }) });
if (!process.argv.includes('--verify')) {
  await nav('我的作品');
  await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
  console.log('Saved API/model/role/preset snapshot for actual process restart');
  process.exit(0);
}
const checks = [];
const check = s => { checks.push(s); console.log('PASS', s); };
assert.deepEqual(snapshot, JSON.parse(await readFile(snapshotFile, 'utf8')));
check('实际退出重开后，API 配置、模型 ID、参数、主副 AI 选择和作品预设完整保留');
await nav('我的作品');
await page.getByLabel('搜索作品', { exact: true }).fill(human.title);
await card(human.title).getByRole('button', { name: '编辑作品', exact: true }).click();
await expect(page.locator('.writer-layout')).toBeVisible();
await expect(page.locator('.breadcrumb')).toContainText(human.title);
await nav('模型与设置');
await expect(page.getByLabel('主 AI 模型', { exact: true })).toHaveValue(human.writerId);
await expect(page.getByLabel('副 AI 模型', { exact: true })).toHaveValue(human.reviewerId);
for (const [id, hasAuthorization] of [[human.writerId, true], [human.reviewerId, false]]) {
  const provider = providers.find(c => c.id === id);
  const before = (await (await fetch('http://127.0.0.1:8787/stats')).json()).writingRequests.length;
  await page.locator('.provider-card').filter({
    has: page.getByRole('heading', { name: provider.name, exact: true })
  }).getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.locator('.toast')).toContainText(provider.name + '：连接成功');
  const requests = (await (await fetch('http://127.0.0.1:8787/stats')).json()).writingRequests;
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).body.model, provider.modelId);
  assert.equal(requests.at(-1).hasAuthorization, hasAuthorization);
}
check('重开后无需重新填 Key，主 AI 从 Windows 凭据库恢复并实际连接；免密本地副 AI 也连接成功');

// Preview is read-only. Verify the final native code with a modified draft.
const draft = structuredClone(p.writingPreset);
draft.prompts.find(c => !c.marker).content = '{{original}}';
draft.parameters.maxTokens = 256;
draft.useParameters = true;
const preview = await api('preview_writing_preset', {
  projectId: p.id, chapterId: p.chapters[0].id, preset: draft, sceneIndex: 0 });
assert.equal(preview.canGenerate, false);
assert.ok(preview.unresolvedMacros.includes('original'));
assert.equal(preview.parameters.model, providers.find(c => c.id === human.writerId).modelId);
assert.equal(preview.parameters.max_tokens, 256);
assert.ok(preview.warnings.some(c => c.includes('可能截断')));
assert.ok(!Object.values(preview.parameters).includes(null));
assert.deepEqual((await api('load_project', { projectId: p.id })).writingPreset, p.writingPreset);
check('最终宿主请求预览展示实际模型/输出字段，过小输出提示，未知 original 宏暂停，预览不修改作品');

await nav('我的作品');
await page.getByLabel('搜索作品', { exact: true }).fill('');
const books = await api('list_projects', { trash: false });
let pdf;
for (const book of books) {
  if (book.title !== 'illustrated') continue;
  const q = await api('load_project', { projectId: book.id });
  if (q.pdfBook && q.readingMarks.length) { pdf = q; break; }
}
assert.ok(pdf, 'No annotated PDF fixture');
// Match the visible recent-edit ordering for duplicate fixture titles.
await page.getByLabel('搜索作品', { exact: true }).fill(pdf.title);
await page.getByLabel('书架排序', { exact: true }).selectOption('edited');
const pdfCards = card(pdf.title);
const pdfIndex = books.filter(c => c.title === pdf.title)
  .sort((a, b) => b.updatedAt - a.updatedAt).findIndex(c => c.id === pdf.id);
await pdfCards.nth(pdfIndex).getByRole('button', { name: '打开阅读', exact: true }).click();
await expect(page.locator('.pdf-reader')).toBeVisible();
await expect(page.locator(`.pdf-page[data-page="${pdf.reader.offset + 1}"][data-ready="true"]`))
  .toBeVisible({ timeout: 30000 });
await page.getByRole('button', { name: '目录与书签', exact: true }).click();
await page.locator('.reader-library-tabs').getByRole('button', { name: '批注', exact: true }).click();
const notesPath = resolve('../../work/qa-ui/notes-export.md');
await page.getByRole('button', { name: '导出批注', exact: true }).click();
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  resolve('../../work/qa-ui/native-file-dialog.ps1'), '-File', notesPath, '-Title', '导出阅读批注'], { timeout: 15000 });
await expect.poll(async () => { try { return (await stat(notesPath)).size; } catch { return 0; } }).toBeGreaterThan(0);
const notes = await readFile(notesPath, 'utf8');
assert.ok(notes.includes(pdf.title));
for (const mark of pdf.readingMarks) {
  if (mark.note) assert.ok(notes.includes(mark.note));
  if (mark.quote) assert.ok(notes.includes(mark.quote));
}
check('重开后 PDF 恢复原页，已有文字及区域批注可通过真实 Windows 保存对话框导出完整 Markdown');
await nav('我的作品');
await writeFile('../../work/qa-ui/settings-restart-results.json', JSON.stringify({ checks, notesPath }, null, 2));
process.exit(0);
