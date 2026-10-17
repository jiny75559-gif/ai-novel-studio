import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  GripVertical,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { command, errorMessage } from "./bridge";
import type { Actions } from "./App";
import type {
  PresetParameters,
  PresetPreview,
  Project,
  PromptEntry,
  WritingPreset,
} from "./domain";
import { MAX_OUTPUT_TOKENS } from "./domain";
import {
  Badge,
  Button,
  Confirm,
  Details,
  Field,
  Modal,
  Toggle,
} from "./components";

const markerNames: Record<string, string> = {
  worldInfoBefore: "确认设定与记忆",
  worldInfoAfter: "人物关系",
  charDescription: "人物与固定外貌",
  charPersonality: "人物性格与背景",
  scenario: "大纲与文风",
  personaDescription: "作者身份描述",
  dialogueExamples: "对话示例",
  chatHistory: "前文、作者改稿与当前任务",
};
const blankEntry = (): PromptEntry => ({
  identifier: crypto.randomUUID(),
  name: "新的规范",
  role: "system",
  content: "",
  marker: false,
  system_prompt: false,
  injection_position: 0,
  injection_depth: 4,
  injection_order: 100,
  injection_trigger: [],
});

export function PresetStudio({
  project,
  actions,
  onClose,
}: {
  project: Project;
  actions: Actions;
  onClose: () => void;
}) {
  const [library, setLibrary] = useState<WritingPreset[]>([]);
  const [draft, setDraft] = useState<WritingPreset | null>(
    project.writingPreset,
  );
  const [baseline, setBaseline] = useState(
    JSON.stringify(project.writingPreset),
  );
  const [entryId, setEntryId] = useState(
    project.writingPreset?.orders[project.writingPreset.activeOrder]?.order[0]
      ?.identifier || "",
  );
  const [tab, setTab] = useState("entries");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const [preview, setPreview] = useState<PresetPreview | null>(null);
  const [chapterId, setChapterId] = useState(project.chapters[0]?.id || "");
  const [sceneIndex, setSceneIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragging = useRef("");
  const dirty = JSON.stringify(draft) !== baseline;
  const reload = async () => {
    try {
      const items = await command<WritingPreset[]>("list_writing_presets");
      setLibrary(items);
      return items;
    } catch (e) {
      setError(errorMessage(e));
      return [];
    }
  };
  useEffect(() => {
    void reload().then((items) => {
      if (!project.writingPreset && items[0]) select(items[0]);
    });
  }, []);
  const select = (preset: WritingPreset) => {
    const next = structuredClone(preset);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setPreview(null);
    setInfo("");
    setError("");
    setEntryId(
      next.orders[next.activeOrder]?.order[0]?.identifier ||
        next.prompts[0]?.identifier ||
        "",
    );
  };
  const guarded = (run: () => void) => {
    if (!dirty) {
      run();
      return;
    }
    setConfirm({
      title: "放弃未保存的预设修改？",
      description: "已应用到作品的预设会保留；这个窗口中尚未保存的修改会放弃。",
      run: async () => {
        setConfirm(null);
        run();
      },
    });
  };
  const change = <K extends keyof WritingPreset>(
    key: K,
    value: WritingPreset[K],
  ) => {
    setDraft((p) => (p ? { ...p, [key]: value } : p));
    setPreview(null);
    setInfo("");
  };
  const order = draft?.orders[draft.activeOrder]?.order || [];
  const entry = draft?.prompts.find((p) => p.identifier === entryId);
  const changeEntry = <K extends keyof PromptEntry>(
    key: K,
    value: PromptEntry[K],
  ) => {
    if (draft && entry)
      change(
        "prompts",
        draft.prompts.map((p) =>
          p.identifier === entryId ? { ...p, [key]: value } : p,
        ),
      );
  };
  const changeOrder = (next: typeof order) => {
    if (draft)
      change(
        "orders",
        draft.orders.map((o, i) =>
          i === draft.activeOrder ? { ...o, order: next } : o,
        ),
      );
  };
  const move = (identifier: string, to: number) => {
    const next = [...order];
    const from = next.findIndex((o) => o.identifier === identifier);
    if (from < 0 || to < 0 || to >= next.length || from === to) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    changeOrder(next);
  };
  const save = async (apply: boolean) => {
    if (!draft) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const saved = await command<WritingPreset>("save_writing_preset", {
        preset: draft,
      });
      setDraft(saved);
      setBaseline(JSON.stringify(saved));
      await reload();
      if (apply) {
        const result = await actions.mutate({
          type: "writingPreset",
          preset: saved,
        });
        if (!result) {
          setError("已保存到预设库，应用作品失败。请刷新作品后重试。");
          return;
        }
      }
      const text = apply
        ? "已保存并应用到当前作品，下一次正文生成使用这份预设。"
        : "已保存到预设库。当前作品继续使用已应用的版本。";
      setInfo(text);
      actions.notice(text);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const newPreset = (copy: boolean) => {
    if (!draft) return;
    const next = structuredClone(draft);
    next.id = crypto.randomUUID();
    next.name = copy ? `${next.name} · 副本` : "我的写作预设";
    next.source = "studio";
    next.importWarnings = [];
    if (!copy) {
      next.description = "按自己的习惯设置写法和输出。";
      next.parameters = {
        temperature: null,
        topP: null,
        frequencyPenalty: null,
        presencePenalty: null,
        maxTokens: null,
        seed: null,
        stop: [],
      };
      next.useParameters = false;
      next.prompts = next.prompts
        .filter((p) => p.marker || ["main", "jailbreak"].includes(p.identifier))
        .map((p) =>
          p.marker
            ? p
            : {
                ...p,
                content:
                  p.identifier === "main"
                    ? "按作者要求创作小说。"
                    : "按作者要求输出当前场景。",
              },
        );
      next.orders = [
        {
          character_id: 100000,
          order: next.prompts.map((p) => ({
            identifier: p.identifier,
            enabled: true,
          })),
        },
      ];
      next.activeOrder = 0;
    }
    select(next);
    setInfo("新预设尚未保存；完成后选择「保存并应用」。");
  };
  const runPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await command<PresetPreview>("preview_writing_preset", {
          projectId: project.id,
          chapterId,
          preset: draft,
          sceneIndex,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportFile = async (tavern: boolean) => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const path = await command<string | null>("export_writing_preset", {
        preset: draft,
        tavern,
      });
      if (path) setInfo(`预设已导出：${path}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const parameterField = (
    key: keyof Omit<PresetParameters, "stop">,
    label: string,
    min?: number,
    max?: number,
    step = 0.1,
  ) => (
    <Field label={label} hint="留空沿用模型配置 / 不发送">
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft?.parameters[key] ?? ""}
        disabled={!draft?.useParameters}
        onChange={(e) =>
          draft &&
          change("parameters", {
            ...draft.parameters,
            [key]: e.target.value === "" ? null : Number(e.target.value),
          })
        }
      />
    </Field>
  );
  return (
    <div className="preset-dialog-host">
      <Modal
        title="主 AI · 写作预设"
        subtitle="把写法、规则和输出握在作者手里。适用于当前作品的正文生成。"
        wide
        onClose={() => guarded(onClose)}
      >
        <div className="preset-toolbar">
          <select
            aria-label="预设库"
            value={draft?.id || ""}
            disabled={busy}
            onChange={(e) => {
              const next = library.find((p) => p.id === e.target.value);
              if (next) guarded(() => select(next));
            }}
          >
            {draft && !library.some((p) => p.id === draft.id) && (
              <option value={draft.id}>{draft.name} · 未保存</option>
            )}
            {library.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            disabled={!draft || busy}
            onClick={() => guarded(() => newPreset(false))}
          >
            <Plus size={14} />
            新建
          </Button>
          <Button
            disabled={!draft || busy}
            onClick={() => guarded(() => newPreset(true))}
          >
            <Copy size={14} />
            另存副本
          </Button>
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload size={14} />
            导入酒馆 / JSON
          </Button>
          <input
            ref={fileInput}
            className="preset-file-input"
            type="file"
            accept=".json,application/json"
            aria-label="导入预设文件"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                if (file.size > 4 * 1024 * 1024)
                  throw new Error("预设文件超过 4 MB。");
                const result = await command<WritingPreset>(
                  "parse_writing_preset",
                  {
                    text: await file.text(),
                    filename: file.name.replace(/\.json$/i, ""),
                  },
                );
                guarded(() => {
                  select(result);
                  setInfo(
                    "预设已载入。请检查兼容提示和请求预览，再保存并应用。",
                  );
                });
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <div className="preset-status">
          <span>
            当前作品：
            <strong>{project.writingPreset?.name || "原有默认写作"}</strong>
          </span>
          <Badge tone={dirty ? "amber" : "neutral"}>
            {dirty
              ? "有未保存修改"
              : draft?.source === "sillytavern"
                ? "酒馆预设"
                : "作者预设"}
          </Badge>
          <Button
            variant="ghost"
            disabled={busy || !project.writingPreset}
            onClick={async () => {
              const result = await actions.mutate({
                type: "writingPreset",
                preset: null,
              });
              if (result) {
                setInfo("当前作品已恢复原有默认写作，预设仍保存在库中。");
                setPreview(null);
              }
            }}
          >
            恢复默认写作
          </Button>
        </div>
        {error && (
          <p className="preset-feedback error" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="preset-feedback" role="status">
            {info}
          </p>
        )}
        {draft && (
          <>
            <div className="preset-meta">
              <input
                aria-label="预设名称"
                value={draft.name}
                maxLength={120}
                placeholder="预设名称"
                onChange={(e) => change("name", e.target.value)}
              />
              <input
                aria-label="预设说明"
                value={draft.description}
                placeholder="这份预设适合怎样的写作？"
                onChange={(e) => change("description", e.target.value)}
              />
            </div>
            <div className="preset-tabs" role="tablist">
              {[
                ["entries", "提示词条目"],
                ["parameters", "生成参数"],
                ["compatibility", "变量与兼容"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="preset-body">
              {tab === "entries" && (
                <div className="preset-entry-layout">
                  <aside className="preset-order-panel">
                    <div className="preset-order-heading">
                      <strong>发送顺序</strong>
                      <small>拖动或点箭头调整</small>
                      {draft.orders.length > 1 && (
                        <select
                          aria-label="酒馆顺序组"
                          value={draft.activeOrder}
                          onChange={(e) => {
                            change("activeOrder", Number(e.target.value));
                            setEntryId(
                              draft.orders[Number(e.target.value)].order[0]
                                ?.identifier || "",
                            );
                          }}
                        >
                          {draft.orders.map((o, i) => (
                            <option key={i} value={i}>
                              顺序组 {String(o.character_id)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="preset-order-list">
                      {order.map((o, index) => {
                        const p = draft.prompts.find(
                          (p) => p.identifier === o.identifier,
                        )!;
                        return (
                          <div
                            key={o.identifier}
                            className={`preset-order-row ${entryId === o.identifier ? "selected" : ""} ${o.enabled ? "" : "disabled"}`}
                            data-prompt-id={o.identifier}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              move(dragging.current, index);
                              dragging.current = "";
                            }}
                          >
                            <button
                              className="preset-drag"
                              draggable
                              aria-label={`拖动 ${p.name}`}
                              onDragStart={(e) => {
                                dragging.current = o.identifier;
                                e.dataTransfer.setData(
                                  "text/plain",
                                  o.identifier,
                                );
                              }}
                            >
                              <GripVertical size={14} />
                            </button>
                            <input
                              type="checkbox"
                              checked={o.enabled}
                              aria-label={`启用 ${p.name}`}
                              onChange={(e) =>
                                changeOrder(
                                  order.map((x) =>
                                    x.identifier === o.identifier
                                      ? { ...x, enabled: e.target.checked }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <button
                              className="preset-select-entry"
                              onClick={() => setEntryId(o.identifier)}
                            >
                              <strong>{p.name || p.identifier}</strong>
                              <small>
                                {p.marker ? "作品资料" : p.role}
                                {p.injection_position === 1
                                  ? ` · 深度 ${p.injection_depth}`
                                  : ""}
                              </small>
                            </button>
                            <span className="preset-move-buttons">
                              <button
                                aria-label={`上移 ${p.name}`}
                                disabled={index === 0}
                                onClick={() => move(o.identifier, index - 1)}
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                aria-label={`下移 ${p.name}`}
                                disabled={index === order.length - 1}
                                onClick={() => move(o.identifier, index + 1)}
                              >
                                <ArrowDown size={12} />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        const p = blankEntry();
                        change("prompts", [...draft.prompts, p]);
                        changeOrder([
                          ...order,
                          { identifier: p.identifier, enabled: true },
                        ]);
                        setEntryId(p.identifier);
                      }}
                    >
                      <Plus size={14} />
                      添加条目
                    </Button>
                    {draft.prompts.some(
                      (p) => !order.some((o) => o.identifier === p.identifier),
                    ) && (
                      <select
                        aria-label="插入未使用条目"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            changeOrder([
                              ...order,
                              { identifier: e.target.value, enabled: true },
                            ]);
                            setEntryId(e.target.value);
                          }
                        }}
                      >
                        <option value="">插入预设中未使用的条目…</option>
                        {draft.prompts
                          .filter(
                            (p) =>
                              !order.some((o) => o.identifier === p.identifier),
                          )
                          .map((p) => (
                            <option key={p.identifier} value={p.identifier}>
                              {p.name || p.identifier}
                            </option>
                          ))}
                      </select>
                    )}
                  </aside>
                  <section className="preset-entry-editor">
                    {entry ? (
                      <>
                        <div className="form-grid">
                          <Field label="条目名称">
                            <input
                              aria-label="条目名称"
                              value={entry.name}
                              onChange={(e) =>
                                changeEntry("name", e.target.value)
                              }
                            />
                          </Field>
                          <Field label="消息角色">
                            <select
                              aria-label="消息角色"
                              value={entry.role}
                              onChange={(e) =>
                                changeEntry(
                                  "role",
                                  e.target.value as PromptEntry["role"],
                                )
                              }
                            >
                              <option value="system">System · 系统</option>
                              <option value="user">User · 用户</option>
                              <option value="assistant">
                                Assistant · 助手
                              </option>
                            </select>
                          </Field>
                        </div>
                        {entry.marker ? (
                          <div className="preset-data-description">
                            <Badge>作品资料占位条目</Badge>
                            <p>
                              此处插入：
                              {markerNames[entry.identifier] ||
                                entry.identifier}
                              。内容来自当前作品，生成前会读取最新保存的资料。
                            </p>
                            <p>
                              开关和顺序控制这一位置是否插入。关闭后，已有作品资料由工作流补齐；大纲、确认设定、作者改稿与预设共同生效。
                            </p>
                          </div>
                        ) : (
                          <Field
                            label="提示词内容"
                            hint="可写叙事规范、禁用表达、排版或输出要求。支持 {{char}}、{{user}}、{{chapterTitle}} 等宏。"
                          >
                            <textarea
                              aria-label="提示词内容"
                              className="preset-prompt-text"
                              value={entry.content}
                              onChange={(e) =>
                                changeEntry("content", e.target.value)
                              }
                              spellCheck={false}
                            />
                          </Field>
                        )}
                        {!entry.marker && (
                          <>
                            <div className="form-grid">
                              <Field label="插入位置">
                                <select
                                  aria-label="插入位置"
                                  value={entry.injection_position}
                                  onChange={(e) =>
                                    changeEntry(
                                      "injection_position",
                                      Number(e.target.value),
                                    )
                                  }
                                >
                                  <option value={0}>按条目顺序</option>
                                  <option value={1}>前文内 · 按深度插入</option>
                                </select>
                              </Field>
                              <Field
                                label="插入深度"
                                hint="0 = 当前任务之后；1 = 当前任务之前。"
                              >
                                <input
                                  aria-label="插入深度"
                                  type="number"
                                  min={0}
                                  max={10000}
                                  disabled={entry.injection_position !== 1}
                                  value={entry.injection_depth}
                                  onChange={(e) =>
                                    changeEntry(
                                      "injection_depth",
                                      Number(e.target.value),
                                    )
                                  }
                                />
                              </Field>
                              <Field
                                label="同深度顺序"
                                hint="同角色同深度时，数字越小越先发送。"
                              >
                                <input
                                  aria-label="同深度顺序"
                                  type="number"
                                  disabled={entry.injection_position !== 1}
                                  value={entry.injection_order}
                                  onChange={(e) =>
                                    changeEntry(
                                      "injection_order",
                                      Number(e.target.value),
                                    )
                                  }
                                />
                              </Field>
                            </div>
                            <div className="preset-triggers">
                              <span>发送时机 · 不选则每次都发送</span>
                              {[
                                ["normal", "首次生成"],
                                ["continue", "后续场景"],
                                ["regenerate", "重新生成"],
                              ].map(([value, label]) => (
                                <label key={value}>
                                  <input
                                    type="checkbox"
                                    checked={entry.injection_trigger.includes(
                                      value,
                                    )}
                                    onChange={(e) =>
                                      changeEntry(
                                        "injection_trigger",
                                        e.target.checked
                                          ? [...entry.injection_trigger, value]
                                          : entry.injection_trigger.filter(
                                              (t) => t !== value,
                                            ),
                                      )
                                    }
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setConfirm({
                              title: "从顺序组移除此条目？",
                              description:
                                "条目保留在预设中，可以从「插入未使用条目」加回来。",
                              run: async () => {
                                changeOrder(
                                  order.filter((o) => o.identifier !== entryId),
                                );
                                setEntryId(
                                  order.find((o) => o.identifier !== entryId)
                                    ?.identifier || "",
                                );
                                setConfirm(null);
                              },
                            });
                          }}
                        >
                          <Trash2 size={14} />
                          从此顺序组移除
                        </Button>
                      </>
                    ) : (
                      <p className="muted">
                        选一个条目编辑，或添加自己的写作规范。
                      </p>
                    )}
                  </section>
                </div>
              )}
              {tab === "parameters" && (
                <section className="preset-scroll-panel">
                  <Toggle
                    checked={draft.useParameters}
                    onChange={(v) => change("useParameters", v)}
                    label="使用这份预设的生成参数"
                    description="只用于正文生成，不修改 API 地址、模型和副 AI 的参数；关闭则沿用模型配置。"
                  />
                  <div className="form-grid">
                    {parameterField(
                      "temperature",
                      "Temperature · 创造性",
                      0,
                      2,
                    )}
                    {parameterField("topP", "Top P · 采样范围", 0, 1, 0.05)}
                    {parameterField(
                      "frequencyPenalty",
                      "Frequency penalty · 重复惩罚",
                      -2,
                      2,
                    )}
                    {parameterField(
                      "presencePenalty",
                      "Presence penalty · 话题惩罚",
                      -2,
                      2,
                    )}
                    {parameterField(
                      "maxTokens",
                      "单次输出上限 / tokens",
                      256,
                      MAX_OUTPUT_TOKENS,
                      256,
                    )}
                    {parameterField(
                      "seed",
                      "Seed · 随机种子",
                      undefined,
                      undefined,
                      1,
                    )}
                  </div>
                  <Field
                    label="停止词 · 每行一条，最多 4 条"
                    hint="输出遇到停止词可能提前结束。停止词不足以替代输出提示词。"
                  >
                    <textarea
                      aria-label="停止词"
                      disabled={!draft.useParameters}
                      value={draft.parameters.stop.join("\n")}
                      onChange={(e) =>
                        change("parameters", {
                          ...draft.parameters,
                          stop: e.target.value
                            .split("\n")
                            .filter((s) => s.length > 0),
                        })
                      }
                    />
                  </Field>
                  <p className="muted">
                    留空的字段不会额外发送。服务商接受的参数不同，可清空不支持的字段。章节目标字数、调用上限和上下文窗口仍按作品设置。
                  </p>
                </section>
              )}
              {tab === "compatibility" && (
                <section className="preset-scroll-panel">
                  <Toggle
                    checked={draft.blockUnknownMacros}
                    onChange={(v) => change("blockUnknownMacros", v)}
                    label="遇到未支持宏时暂停生成"
                    description="预览会指出具体宏。关闭后保留宏原文发送，由作者决定是否继续。"
                  />
                  <div className="form-grid">
                    <Field
                      label="{{char}} 对应名称"
                      hint="留空时用第一个人物名称，没有人物时用作品名。"
                    >
                      <input
                        aria-label="角色宏名称"
                        value={draft.charName}
                        onChange={(e) => change("charName", e.target.value)}
                      />
                    </Field>
                    <Field label="{{user}} 对应名称">
                      <input
                        aria-label="作者宏名称"
                        value={draft.userName}
                        onChange={(e) => change("userName", e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="作者身份 / {{persona}}">
                    <textarea
                      value={draft.persona}
                      onChange={(e) => change("persona", e.target.value)}
                    />
                  </Field>
                  <Field label="对白示例 / {{mesExamples}}">
                    <textarea
                      value={draft.examples}
                      onChange={(e) => change("examples", e.target.value)}
                    />
                  </Field>
                  <Details title="可用宏与酒馆资料对应关系">
                    <p>
                      名称：
                      {
                        "{{char}}、{{user}}、{{novelTitle}}、{{chapterTitle}}、{{chapterNumber}}"
                      }
                      。
                    </p>
                    <p>
                      作品资料：
                      {
                        "{{description}}、{{personality}}、{{scenario}}、{{persona}}、{{mesExamples}}、{{wiBefore}}、{{wiAfter}}、{{chatHistory}}、{{outline}}、{{chapterOutline}}、{{style}}、{{characters}}、{{relations}}、{{memory}}、{{context}}"
                      }
                      。
                    </p>
                    <p>
                      任务：
                      {
                        "{{targetChars}}、{{sceneNumber}}、{{sceneCount}}、{{lastMessage}}、{{lastCharMessage}}、{{lastUserMessage}}"
                      }
                      ；lastMessage / lastCharMessage
                      优先用已完成场景，首场景用可用前文。
                    </p>
                    <p>
                      支持注释、newline、trim / noop 和 :: 变量宏 setvar /
                      getvar / addvar / incvar / decvar / hasvar / deletevar
                      及其 globalvar
                      版本。变量仅在一次请求内生效，稿件中的宏不被执行。
                    </p>
                    <p>
                      支持 Chat Completion 预设、Prompt Manager
                      提示词列表、系统提示词及旧 main_prompt
                      格式。酒馆插件、正则脚本、STscript 和 Text Completion 的
                      Instruct 模板需要各自运行环境；无法执行的字段会提示。
                    </p>
                  </Details>
                  {draft.importWarnings.length > 0 && (
                    <div className="preset-import-report">
                      <strong>导入兼容提示</strong>
                      {draft.importWarnings.map((s, i) => (
                        <p key={i}>{s}</p>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
            <div className="preset-preview-toolbar">
              <select
                aria-label="预览章节"
                value={chapterId}
                onChange={(e) => {
                  setChapterId(e.target.value);
                  setPreview(null);
                }}
              >
                {project.chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    第{i + 1}章 · {c.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="预览场景"
                value={sceneIndex}
                onChange={(e) => {
                  setSceneIndex(Number(e.target.value));
                  setPreview(null);
                }}
              >
                {Array.from(
                  {
                    length: Math.min(
                      6,
                      Math.ceil(project.settings.targetChars / 1400),
                    ),
                  },
                  (_, i) => (
                    <option key={i} value={i}>
                      场景 {i + 1}
                    </option>
                  ),
                )}
              </select>
              <Button
                disabled={!chapterId}
                busy={busy}
                onClick={() => void runPreview()}
              >
                <Eye size={14} />
                预览实际请求
              </Button>
              <small>不调用模型、不计费</small>
            </div>
            <footer>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void exportFile(true)}
              >
                <Download size={14} />
                导出酒馆 JSON
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void exportFile(false)}
              >
                导出完整预设
              </Button>
              {!draft.id.startsWith("studio-") &&
                library.some((p) => p.id === draft.id) && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label="删除预设"
                    onClick={() =>
                      setConfirm({
                        title: "删除预设库中的这份预设？",
                        description: "已经应用到作品的副本会保留。",
                        run: async () => {
                          try {
                            await command("delete_writing_preset", {
                              presetId: draft.id,
                            });
                            const items = await reload();
                            if (items[0]) select(items[0]);
                            setConfirm(null);
                          } catch (e) {
                            setError(errorMessage(e));
                            setConfirm(null);
                          }
                        },
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              <span className="spacer" />
              <Button disabled={busy} onClick={() => void save(false)}>
                保存到预设库
              </Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void save(true)}
              >
                <Check size={14} />
                保存并应用
              </Button>
            </footer>
          </>
        )}
      </Modal>
      {preview && (
        <Modal
          title={`请求预览 · ${preview.presetName}`}
          subtitle="来自当前保存的作品资料；这里不调用 AI。后续场景预览尚未包含将生成的正文。"
          wide
          onClose={() => setPreview(null)}
        >
          <div className="preset-request-preview">
            <div className="preset-request-metrics">
              <Badge tone={preview.canGenerate ? "green" : "amber"}>
                {preview.canGenerate ? "可生成" : "需要调整"}
              </Badge>
              <span>
                {preview.messages.length} 条消息 · 估算{" "}
                {preview.estimatedTokens.toLocaleString()} tokens
              </span>
            </div>
            {preview.warnings.map((s, i) => (
              <p className="inline-note" key={i}>
                {s}
              </p>
            ))}
            <Details title="实际生成参数" open>
              <pre>{JSON.stringify(preview.parameters, null, 2)}</pre>
            </Details>
            {preview.messages.map((m, i) => (
              <Details key={i} title={`${i + 1}. ${m.role}`} open={i === 0}>
                <pre>{m.content}</pre>
              </Details>
            ))}
          </div>
          <footer>
            <Button onClick={() => setPreview(null)}>返回编辑</Button>
          </footer>
        </Modal>
      )}
      {confirm && (
        <Confirm
          title={confirm.title}
          description={confirm.description}
          onClose={() => setConfirm(null)}
          onConfirm={confirm.run}
        />
      )}
    </div>
  );
}

export function PresetEntryPoint({
  project,
  actions,
}: {
  project: Project;
  actions: Actions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="preset-entry-point">
        <div>
          <SlidersHorizontal size={19} />
          <span>
            <strong>主 AI 写作预设</strong>
            <small>
              {project.writingPreset?.name || "原有默认写作"} ·
              与大纲、文风及确认设定一起生效
            </small>
          </span>
        </div>
        <Button onClick={() => setOpen(true)}>管理预设 / 导入酒馆</Button>
      </div>
      {open && (
        <PresetStudio
          project={project}
          actions={actions}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
