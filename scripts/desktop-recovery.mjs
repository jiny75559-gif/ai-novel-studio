// Run against a real Tauri WebView launched with a dedicated QA data directory.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const api = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const savedFile = "../../work/qa/recovery-state.json";
const checks = [];
const check = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
const waitRun = async (pid, rid) => {
  let run;
  await expect
    .poll(
      async () => {
        run = (await api("list_runs", { projectId: pid })).find(
          (r) => r.id === rid,
        );
        return run?.status;
      },
      { timeout: 35000, intervals: [150, 300, 600] },
    )
    .not.toBe("running");
  assert.ok(run);
  return run;
};
await page.waitForSelector(".app-shell");
if (process.argv.includes("--prepare-restart")) {
  const saved = JSON.parse(fs.readFileSync(savedFile, "utf8"));
  const config = (await api("list_providers")).find(
    (c) => c.id === saved.providerId,
  );
  await api("save_provider", {
    provider: { ...config, modelId: "mock-scene2-timeout" },
    apiKey: null,
  });
  let p = await api("create_project", { title: "真正重启检查", demo: true });
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
        writerId: config.id,
        reviewerId: config.id,
        targetChars: 2800,
        maxCalls: 2,
        autoReview: false,
        autoNext: false,
      },
    },
  });
  const run = await api("start_run", {
    projectId: p.id,
    chapterId: p.chapters[0].id,
    task: "write",
    runId: crypto.randomUUID(),
    resumeId: "",
    overrideReason: "",
  });
  await expect
    .poll(async () => {
      const r = (await api("list_runs", { projectId: p.id })).find(
        (r) => r.id === run.id,
      );
      return r?.segments.filter((s) => s.status === "complete").length;
    })
    .toBe(1);
  fs.writeFileSync(
    savedFile,
    JSON.stringify(
      { pid: p.id, providerId: config.id, interruptedId: run.id },
      null,
      2,
    ),
  );
  console.log("READY_FOR_PROCESS_RESTART");
  await browser.close();
  process.exit(0);
}
if (process.argv.includes("--after-restart")) {
  const saved = JSON.parse(fs.readFileSync(savedFile, "utf8"));
  let p = await api("load_project", { projectId: saved.pid });
  const config = (await api("list_providers")).find(
    (c) => c.id === saved.providerId,
  );
  assert.ok(config?.hasKey);
  assert.equal(config.keyStorage, "credential");
  assert.equal(
    (await api("test_provider", { providerId: config.id })).message,
    "连接成功",
  );
  check("Windows 凭据库密钥在真正重启后可用，前端不返回密钥");
  const run = (await api("list_runs", { projectId: p.id })).find(
    (r) => r.id === saved.interruptedId,
  );
  assert.equal(run.status, "interrupted");
  assert.equal(run.segments.filter((s) => s.status === "complete").length, 1);
  check("真正结束进程并重启后，运行中任务转为中断并保留片段");
  await api("save_provider", {
    provider: { ...config, modelId: "mock-writer" },
    apiKey: null,
  });
  const recovered = await api("start_run", {
    projectId: p.id,
    chapterId: p.chapters[0].id,
    task: "write",
    runId: crypto.randomUUID(),
    resumeId: run.id,
    overrideReason: "",
  });
  const done = await waitRun(p.id, recovered.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.calls, 1);
  assert.equal(done.segments.filter((s) => s.status === "complete").length, 2);
  p = await api("load_project", { projectId: p.id });
  assert.equal(p.chapters[0].versions.length, 1);
  check("重启后恢复只请求缺失场景，合成正文保存为一个新版本");
  fs.writeFileSync(
    "../../work/qa/restart-result.json",
    JSON.stringify({ checks }, null, 2),
  );
  await browser.close();
  process.exit(0);
}
let config = await api("save_provider", {
  provider: {
    id: crypto.randomUUID(),
    name: "异常恢复测试（仅 QA）",
    baseUrl: "http://127.0.0.1:8787/v1",
    modelId: "mock-scene2-timeout",
    allowLocalHttp: true,
    tokenParameter: "max_tokens",
    jsonMode: false,
    temperature: 0.7,
    maxTokens: 4096,
    timeoutSeconds: 10,
    hasKey: false,
    keyStorage: "none",
  },
  apiKey: "mock-recovery-qa",
});
const configure = async (p, targetChars) =>
  api("mutate_project", {
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
        writerId: config.id,
        reviewerId: config.id,
        targetChars,
        maxCalls: 2,
        autoReview: false,
        autoNext: false,
      },
    },
  });
const start = (p, id = crypto.randomUUID(), resumeId = "") =>
  api("start_run", {
    projectId: p.id,
    chapterId: p.chapters[0].id,
    task: "write",
    runId: id,
    resumeId,
    overrideReason: "",
  });
const create = async (target) =>
  configure(
    await api("create_project", { title: "异常恢复检查", demo: true }),
    target,
  );
let p = await create(2800);
let run = await start(p);
run = await waitRun(p.id, run.id);
assert.equal(run.status, "failed");
assert.equal(run.error.code, "TIMEOUT");
assert.equal(run.segments.filter((s) => s.status === "complete").length, 1);
assert.equal(
  (await api("load_project", { projectId: p.id })).chapters[0].working,
  "",
);
check("真实 Rust HTTP 超时后仅保留第一场景，整章未提交");
config = await api("save_provider", {
  provider: { ...config, modelId: "mock-writer" },
  apiKey: null,
});
let recovered = await start(p, crypto.randomUUID(), run.id);
recovered = await waitRun(p.id, recovered.id);
assert.equal(recovered.status, "succeeded");
assert.equal(recovered.calls, 1);
check("手动恢复不重复生成已完成场景");
config = await api("save_provider", {
  provider: { ...config, modelId: "mock-truncated" },
  apiKey: null,
});
p = await create(600);
run = await start(p);
run = await waitRun(p.id, run.id);
assert.equal(run.status, "failed");
assert.equal(run.error.code, "OUTPUT_TRUNCATED");
assert.ok(run.segments.some((s) => s.status === "partial"));
assert.equal(
  (await api("load_project", { projectId: p.id })).chapters[0].versions.length,
  0,
);
check("length 截断保留片段供查看，不伪装成成功章节");
config = await api("save_provider", {
  provider: { ...config, modelId: "mock-slow" },
  apiKey: null,
});
p = await create(600);
const before = await (await fetch("http://127.0.0.1:8787/stats")).json();
const rid = crypto.randomUUID();
const [a, b] = await Promise.all([start(p, rid), start(p, rid)]);
assert.equal(a.id, b.id);
await new Promise((r) => setTimeout(r, 300));
const after = await (await fetch("http://127.0.0.1:8787/stats")).json();
assert.equal(after.calls - before.calls, 1);
await api("cancel_run", { runId: rid });
await new Promise((r) => setTimeout(r, 3300));
run = (await api("list_runs", { projectId: p.id })).find((r) => r.id === rid);
assert.equal(run.status, "cancelled");
assert.equal(
  (await api("load_project", { projectId: p.id })).chapters[0].versions.length,
  0,
);
check("同时两次同 ID 请求只计一次调用，取消后迟到响应不提交");
config = await api("save_provider", {
  provider: { ...config, modelId: "mock-scene2-timeout" },
  apiKey: null,
});
p = await create(2800);
run = await start(p);
await expect
  .poll(async () => {
    const r = (await api("list_runs", { projectId: p.id })).find(
      (r) => r.id === run.id,
    );
    return r?.segments.filter((s) => s.status === "complete").length;
  })
  .toBe(1);
assert.equal(
  (await api("list_runs", { projectId: p.id })).find((r) => r.id === run.id)
    .status,
  "running",
);
fs.writeFileSync(
  savedFile,
  JSON.stringify(
    { pid: p.id, providerId: config.id, interruptedId: run.id },
    null,
    2,
  ),
);
fs.writeFileSync(
  "../../work/qa/recovery-result.json",
  JSON.stringify({ checks }, null, 2),
);
console.log("READY_FOR_PROCESS_RESTART");
await browser.close();
