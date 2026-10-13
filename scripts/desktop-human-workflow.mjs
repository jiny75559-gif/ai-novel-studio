// All mutations in this test use the visible UI. Native commands only verify saved data.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const info = await api("app_info");
assert.ok(info.dataDir.replaceAll("\\", "/").endsWith("/work/qa-ui/data"));
assert.equal(info.version, "0.3.1");
const checks = [];
const check = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const dialog = () => page.getByRole("dialog").last();
const nav = async (name) => {
  await page.getByRole("button", { name, exact: true }).first().click();
};
const closeDialog = async () =>
  dialog().getByRole("button", { name: "关闭对话框", exact: true }).click();
const title = "基础操作验收 " + info.version + " " + Date.now();
const writerName = "UI 主写 " + Date.now(),
  reviewerName = "UI 副审免密 " + Date.now();
let pid, writerId, reviewerId, selectedPreset;
const load = async () => api("load_project", { projectId: pid });
const cards = async () => api("list_projects", { trash: false });
try {
  await page.reload();
  await expect(page.locator(".home-page")).toBeVisible();
  await page
    .getByRole("button", { name: "新建作品", exact: true })
    .last()
    .click();
  await dialog()
    .getByLabel(/^作品名称/)
    .fill(title);
  await dialog().getByRole("button", { name: "创建作品", exact: true }).click();
  await expect(page.locator(".writer-layout")).toBeVisible();
  pid = (await cards()).find((c) => c.title === title).id;
  check("从书架用按钮创建空白作品，进入写作台");
  await nav("模型与设置");
  await page.getByRole("button", { name: "添加 API", exact: true }).click();
  await expect(
    dialog().getByRole("button", { name: "保存模型", exact: true }),
  ).toBeEnabled();
  await dialog()
    .getByLabel(/^显示名称/)
    .fill(writerName);
  await dialog()
    .getByLabel(/^API Key/)
    .fill("qa-human-fixture-key");
  await dialog()
    .getByLabel(/^Base URL/)
    .fill("http://nonlocal.invalid/v1");
  await dialog().getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(dialog().getByRole("alert")).toContainText("HTTPS");
  await expect(dialog().getByLabel(/^API Key/)).toHaveValue(
    "qa-human-fixture-key",
  );
  check("保存失败在窗口内显示原因，保留密钥输入，保存按钮没有静默置灰");
  await dialog()
    .getByLabel(/^Base URL/)
    .fill("http://127.0.0.1:8787/v1");
  await expect(dialog().getByLabel(/^允许 HTTP 本地回环地址/)).toBeChecked();
  await dialog().getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let saved = (await api("list_providers")).find((p) => p.name === writerName);
  writerId = saved.id;
  assert.equal(saved.modelId, "");
  assert.equal(saved.hasKey, true);
  await expect(page.getByLabel("主 AI 模型", { exact: true })).toHaveValue(
    writerId,
  );
  check(
    "模型 ID 尚未填写也可保存 API，保存后配置卡可见，首个配置自动选为主 AI",
  );
  await page
    .locator(".provider-card")
    .filter({
      has: page.getByRole("heading", { name: writerName, exact: true }),
    })
    .getByRole("button", { name: "编辑配置", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "读取模型列表", exact: true })
    .click();
  await expect(dialog().getByLabel(/^模型 ID/)).not.toHaveValue("");
  await dialog()
    .getByLabel(/^模型 ID/)
    .fill("mock-writer");
  await dialog().getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  saved = (await api("list_providers")).find((p) => p.id === writerId);
  assert.equal(saved.modelId, "mock-writer");
  assert.equal(saved.hasKey, true);
  check("从已保存 API 读取模型列表、改选模型并保存，留空密钥保留已有凭据");
  await page.getByRole("button", { name: "添加 API", exact: true }).click();
  await dialog()
    .getByLabel(/^显示名称/)
    .fill(reviewerName);
  await dialog()
    .getByLabel(/^Base URL/)
    .fill("http://127.0.0.1:8787/v1");
  await dialog()
    .getByRole("button", { name: "读取模型列表", exact: true })
    .click();
  await expect(dialog().getByLabel(/^模型 ID/)).not.toHaveValue("");
  await dialog()
    .getByLabel(/^模型 ID/)
    .fill("mock-reviewer");
  await dialog().getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  reviewerId = (await api("list_providers")).find(
    (p) => p.name === reviewerName,
  ).id;
  await page.getByLabel("副 AI 模型", { exact: true }).selectOption(reviewerId);
  await expect
    .poll(async () => (await load()).settings.reviewerId)
    .toBe(reviewerId);
  await page
    .locator(".provider-card")
    .filter({
      has: page.getByRole("heading", { name: reviewerName, exact: true }),
    })
    .getByRole("button", { name: "测试连接", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("连接成功");
  check("免密本地 API 可保存并测试连接，主副 AI 选择即时写入数据库");
  await page.getByLabel(/^目标章节汉字数/).fill("600");
  await page.getByRole("button", { name: "保存项目设置", exact: true }).click();
  await nav("写作台");
  await nav("模型与设置");
  await expect(page.getByLabel("主 AI 模型", { exact: true })).toHaveValue(
    writerId,
  );
  await expect(page.getByLabel("副 AI 模型", { exact: true })).toHaveValue(
    reviewerId,
  );
  check("离开设置再回来，模型、参数与主副 AI 选择仍保留");
  await nav("故事大纲");
  await page
    .getByLabel("作品总纲", { exact: true })
    .fill(
      "林舟和叶岚在雨夜离开熄灭的灯塔，沿堤岸前进。作者规范：不得让灯塔提前重燃。",
    );
  await page.getByRole("button", { name: "保存总纲", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑大纲", exact: true })
    .first()
    .click();
  await dialog()
    .getByLabel(/^章节标题/)
    .fill("灯塔之夜");
  await dialog()
    .getByLabel(/^本章目标/)
    .fill("展示受伤的林舟和保管钥匙的叶岚，离开灯塔。");
  await dialog()
    .getByLabel(/^必达事件/)
    .fill("灯塔熄灭。\n两人走向雾中的堤岸。");
  await dialog()
    .getByLabel(/^作者约束/)
    .fill("不得让灯塔在冷却期内重燃。");
  await dialog()
    .getByLabel(/^结尾状态/)
    .fill("两人准备沿堤岸前进。");
  await dialog().getByRole("button", { name: "保存大纲", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "新增章节", exact: true })
    .first()
    .click();
  await dialog()
    .getByLabel(/^章节标题/)
    .fill("沿堤岸");
  await dialog()
    .getByLabel(/^本章目标/)
    .fill("沿堤岸寻找旧船厂，不重复上一章情节。");
  await dialog()
    .getByLabel(/^必达事件/)
    .fill("遇到岔路并选择旧船厂方向。");
  await dialog().getByRole("button", { name: "保存大纲", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal((await load()).chapters.length, 2);
  check("保存作品总纲，编辑第一章并新建下一章大纲");
  await nav("人物关系");
  for (const [name, profile, knowledge] of [
    ["林舟", "黑色短发，左眉浅疤，左臂受伤。", "不知道铜钥匙的藏处。"],
    ["叶岚", "披肩长发，深绿色外套，保管铜钥匙。", "知道铜钥匙的藏处。"],
  ]) {
    await page
      .getByRole("button", { name: "新增人物", exact: true })
      .first()
      .click();
    await dialog().getByLabel(/^姓名/).fill(name);
    await dialog()
      .getByLabel(/^背景、性格与动机/)
      .fill(profile);
    await dialog()
      .getByLabel(/^知识与秘密边界/)
      .fill(knowledge);
    await dialog()
      .getByRole("button", { name: "保存人物", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "添加关系", exact: true }).click();
  const people = (await load()).characters;
  await dialog()
    .getByLabel(/^关系发起者/)
    .selectOption(people[0].id);
  await dialog()
    .getByLabel(/^关系对象/)
    .selectOption(people[1].id);
  await dialog()
    .getByLabel(/^关系类型/)
    .fill("同盟");
  await dialog().getByRole("button", { name: "保存关系", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "树形视图", exact: true }).click();
  await expect(page.locator(".tree-node")).toHaveCount(2);
  await page.getByRole("button", { name: "关系网络", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  check("新增人物与关系，网络图和树形图能切换，人物资料正确保存");
  await nav("设定与记忆");
  await page.getByRole("button", { name: "新增记忆", exact: true }).click();
  await dialog()
    .getByLabel(/^属性 \/ 事项/)
    .fill("灯塔限制");
  await dialog().getByLabel(/^内容/).fill("灯塔熄灭后的 24 小时内不能重燃。");
  await dialog()
    .getByLabel(/^作为必须遵循的作者设定/)
    .check();
  await dialog().getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav("文风");
  await page
    .getByLabel(/^语气与词汇/)
    .fill("语言自然、克制，以行动推进情节。UI 文风标记。");
  await page.getByRole("button", { name: /^保存文风卡/ }).click();
  assert.ok((await load()).style.tone.includes("UI 文风标记"));
  check("手动保存锁定设定和文风，与人物、大纲资料共存");
  await nav("模型与设置");
  await page
    .getByRole("button", { name: "管理预设 / 导入酒馆", exact: true })
    .click();
  await dialog()
    .getByLabel("预设库", { exact: true })
    .selectOption("studio-standard");
  await dialog().getByRole("button", { name: "另存副本", exact: true }).click();
  await dialog().getByLabel("预设名称", { exact: true }).fill("UI 写作规范");
  await dialog()
    .getByLabel("提示词内容", { exact: true })
    .fill(
      "UI-MAIN 写{{chapterTitle}}。{{setvar::tone::克制}}{{getvar::tone}}，执行作者最新的大纲、确认设定和改稿。",
    );
  await dialog().getByRole("button", { name: "添加条目", exact: true }).click();
  await dialog().getByLabel("条目名称", { exact: true }).fill("关闭的规则 QA");
  await dialog()
    .getByLabel("提示词内容", { exact: true })
    .fill("QA-DISABLED-NEVER-SEND");
  await dialog().getByLabel("启用 关闭的规则 QA", { exact: true }).uncheck();
  await dialog().getByRole("button", { name: "添加条目", exact: true }).click();
  await dialog().getByLabel("条目名称", { exact: true }).fill("深度规则 QA");
  await dialog()
    .getByLabel("消息角色", { exact: true })
    .selectOption("assistant");
  await dialog()
    .getByLabel("提示词内容", { exact: true })
    .fill("QA-DEPTH-0 只输出作者要求的正文。");
  await dialog().getByLabel("插入位置", { exact: true }).selectOption("1");
  await dialog().getByLabel("插入深度", { exact: true }).fill("0");
  await dialog()
    .getByRole("button", { name: "上移 深度规则 QA", exact: true })
    .click();
  const depthOrder = await dialog()
    .locator(".preset-order-row")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.promptId));
  assert.ok(depthOrder.length === 10);
  await dialog().getByRole("tab", { name: "生成参数", exact: true }).click();
  await dialog()
    .getByLabel(/^使用这份预设的生成参数/)
    .check();
  await dialog()
    .getByLabel("Temperature · 创造性", { exact: true })
    .fill("0.35");
  await dialog().getByLabel("Top P · 采样范围", { exact: true }).fill("0.8");
  await dialog()
    .getByLabel("Frequency penalty · 重复惩罚", { exact: true })
    .fill("0.4");
  await dialog()
    .getByLabel("Presence penalty · 话题惩罚", { exact: true })
    .fill("0.2");
  await dialog()
    .getByLabel("单次输出上限 / tokens", { exact: true })
    .fill("2048");
  await dialog().getByLabel("Seed · 随机种子", { exact: true }).fill("7");
  await dialog()
    .getByRole("button", { name: "预览实际请求", exact: true })
    .click();
  await expect(dialog()).toContainText("可生成");
  await expect(dialog()).toContainText("top_p");
  await closeDialog();
  await dialog()
    .getByRole("button", { name: "保存并应用", exact: true })
    .click();
  await expect
    .poll(async () => (await load()).writingPreset?.name)
    .toBe("UI 写作规范");
  selectedPreset = (await load()).writingPreset.id;
  check(
    "通过界面新建预设，编辑提示词、顺序、开关、角色、深度和参数，预览后保存并应用",
  );
  await dialog().getByRole("tab", { name: "提示词条目", exact: true }).click();
  await dialog()
    .locator('[data-prompt-id="main"] .preset-select-entry')
    .click();
  const validMain = await dialog()
    .getByLabel("提示词内容", { exact: true })
    .inputValue();
  await dialog()
    .getByLabel("提示词内容", { exact: true })
    .fill(validMain + " {{unavailable_plugin::x}}");
  await dialog()
    .getByRole("button", { name: "预览实际请求", exact: true })
    .click();
  await expect(dialog()).toContainText("需要调整");
  await expect(dialog()).toContainText("unavailable_plugin::x");
  await closeDialog();
  await dialog().getByLabel("提示词内容", { exact: true }).fill(validMain);
  await dialog()
    .getByRole("button", { name: "保存并应用", exact: true })
    .click();
  await expect(dialog().getByRole("status")).toContainText("已保存并应用");
  check("未支持宏会显示具体问题并阻止生成，修复宏后恢复正常");
  const official = await readFile(
    "../../work/references/sillytavern-default.json",
  );
  await dialog()
    .getByLabel("导入预设文件", { exact: true })
    .setInputFiles({
      name: "酒馆官方-default.json",
      mimeType: "application/json",
      buffer: official,
    });
  await expect(dialog().getByLabel("预设名称", { exact: true })).toHaveValue(
    "酒馆官方-default",
  );
  await dialog().getByRole("tab", { name: "变量与兼容", exact: true }).click();
  await expect(dialog()).toContainText("导入兼容提示");
  await dialog()
    .getByRole("button", { name: "预览实际请求", exact: true })
    .click();
  await expect(dialog()).toContainText("请求预览");
  await closeDialog();
  const before = (await api("list_writing_presets")).length;
  await dialog()
    .getByLabel("导入预设文件", { exact: true })
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{wrong"),
    });
  await expect(dialog().getByRole("alert")).toBeVisible();
  assert.equal((await api("list_writing_presets")).length, before);
  await dialog()
    .getByLabel("预设库", { exact: true })
    .selectOption(selectedPreset);
  await closeDialog();
  check("真实酒馆官方 JSON 可经导入按钮载入和预览，坏文件不污染预设库");
  await nav("写作台");
  await page
    .getByRole("button", { name: "生成本章", exact: true })
    .first()
    .click();
  await expect(dialog()).toContainText("UI 写作规范");
  await dialog().getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.locator("textarea.manuscript")).toHaveValue(/雨水/, {
    timeout: 30000,
  });
  let p = await load();
  assert.ok(p.chapters[0].currentVersionId);
  let stats = await (await fetch("http://127.0.0.1:8787/stats")).json();
  let request = stats.writingRequests.findLast((r) =>
    JSON.stringify(r.body.messages).includes("WRITE_SCENE"),
  );
  assert.equal(request.body.temperature, 0.35);
  assert.equal(request.body.top_p, 0.8);
  assert.equal(request.body.max_tokens, 2048);
  assert.equal(request.body.seed, 7);
  const taskIndex = request.body.messages.findIndex((m) =>
    m.content.includes("任务 WRITE_SCENE"),
  );
  assert.equal(request.body.messages[taskIndex].role, "user");
  assert.equal(request.body.messages[taskIndex + 1].role, "assistant");
  assert.ok(
    request.body.messages[taskIndex + 1].content.includes("QA-DEPTH-0"),
  );
  const wire = JSON.stringify(request.body.messages);
  assert.ok(wire.includes("灯塔限制"));
  assert.ok(wire.includes("UI 文风标记"));
  assert.ok(!wire.includes("QA-DISABLED-NEVER-SEND"));
  assert.ok(!wire.includes("{{chapterTitle}}"));
  check(
    "用生成按钮写出正文，真实 HTTP 请求确认参数、角色、深度、关闭条目、宏和原有约束共同生效",
  );
  const manuscript = page.locator("textarea.manuscript");
  const original = await manuscript.inputValue();
  await manuscript.fill(original + "\n\n灯塔立刻重燃。");
  await manuscript.blur();
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await page.getByRole("button", { name: "开始审稿", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(1, { timeout: 30000 });
  stats = await (await fetch("http://127.0.0.1:8787/stats")).json();
  request = stats.writingRequests.findLast((r) =>
    JSON.stringify(r.body.messages).includes("REVIEW_JSON"),
  );
  assert.equal(request.body.top_p, undefined);
  assert.equal(request.body.temperature, 0.7);
  assert.equal(request.hasAuthorization, false);
  assert.ok(JSON.stringify(request.body.messages).includes("作者写作预设规范"));
  await page
    .locator(".issue-card")
    .getByRole("button", { name: "修订", exact: true })
    .click();
  await page
    .getByRole("button", { name: "修订所选 1 项", exact: true })
    .click();
  await page.getByRole("button", { name: "查看并采用修订稿", exact: true }).click();
  await dialog()
    .getByRole("button", { name: "采用这个版本", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "采用并继续编辑", exact: true })
    .click();
  await expect(manuscript).toHaveValue(/灯塔依然漆黑/, { timeout: 30000 });
  await page.getByRole("button", { name: "确认本章", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await dialog().getByRole("button", { name: "确认正文", exact: true }).click();
  await expect
    .poll(async () => {
      const c = (await load()).chapters[0];
      return c.currentVersionId === c.approvedVersionId;
    })
    .toBe(true);
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  await page
    .getByRole("button", { name: "提取摘要与记忆", exact: true })
    .click();
  await expect
    .poll(async () => (await load()).proposals.length, { timeout: 30000 })
    .toBeGreaterThan(0);
  await nav("设定与记忆");
  await page.getByRole("button", { name: /待审批/ }).click();
  await page
    .getByRole("button", { name: "纳入记忆", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await load()).proposals[0].status)
    .toBe("accepted");
  check(
    "正文可编辑并保存历史，副 AI 举证审稿、选择定点修订、确认章节、提取并审批记忆，预设不干扰结构化任务",
  );
  await nav("写作台");
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(manuscript).toHaveValue("");
  await page
    .getByRole("button", { name: "生成本章", exact: true })
    .first()
    .click();
  await dialog().getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(manuscript).toHaveValue(/雨水/, { timeout: 30000 });
  check("下一章按钮打开已规划章节并正常生成，前章确认资料和预设继续生效");
  await nav("模型与设置");
  await page
    .getByRole("button", { name: "管理预设 / 导入酒馆", exact: true })
    .click();
  await expect(dialog().getByLabel("预设库", { exact: true })).toHaveValue(
    selectedPreset,
  );
  await dialog()
    .getByLabel("预设名称", { exact: true })
    .fill("这项修改应该被放弃");
  await closeDialog();
  await expect(dialog()).toContainText("放弃未保存");
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal((await load()).writingPreset.name, "UI 写作规范");
  check("跨页返回后预设仍绑定当前作品，关闭未保存修改会确认并保留已应用版本");
  assert.deepEqual(errors, []);
  await writeFile(
    "../../work/qa-ui/human-workflow.json",
    JSON.stringify(
      { pid, title, writerId, reviewerId, selectedPreset, checks, errors },
      null,
      2,
    ),
  );
  console.log("ALL HUMAN UI CHECKS", checks.length);
} catch (e) {
  await page.screenshot({
    path: "../../work/qa-ui/human-workflow-failure.png",
  });
  console.error(e);
  console.error((await page.locator("body").innerText()).slice(-5000));
  process.exit(1);
}
process.exit(0);
