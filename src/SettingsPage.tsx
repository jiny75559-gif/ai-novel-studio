import { useEffect, useState } from "react";
import {
  Plus,
  Check,
  KeyRound,
  Server,
  Trash2,
  PlugZap,
  ArrowRight,
  ShieldCheck,
  HardDrive,
  Settings2,
} from "lucide-react";
import type { Actions } from "./App";
import { command, errorMessage } from "./bridge";
import {
  type Project,
  type Provider,
  type Settings,
  blankProvider,
} from "./domain";
import { Badge, Button, Confirm, Field, Modal, Toggle } from "./components";
import { PresetEntryPoint } from "./PresetStudio";
interface GenerationAdvice {
  scenes: number;
  charsPerScene: number;
  estimatedRequestTokens: number;
  suggestedContextTokens: number;
  timeoutSeconds: number;
  outputTokens: number;
  problems: string[];
  warnings: string[];
}
export function SettingsPage({
  project,
  providers,
  actions,
}: {
  project: Project;
  providers: Provider[];
  actions: Actions;
}) {
  const [settings, setSettings] = useState<Settings>(project.settings);
  const [title, setTitle] = useState(project.title);
  const [genre, setGenre] = useState(project.genre);
  const [perspective, setPerspective] = useState(project.perspective);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [confirmNext, setConfirmNext] = useState(false);
  const [selectingModel, setSelectingModel] = useState(false);
  const [advice, setAdvice] = useState<GenerationAdvice | null>(null);
  const [adviceError, setAdviceError] = useState("");
  const [info, setInfo] = useState<{
    dataDir: string;
    version: string;
    privacy: string;
  } | null>(null);
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  useEffect(() => {
    let disposed = false;
    setAdvice(null);
    setAdviceError("");
    const timer = setTimeout(() => {
      void command<GenerationAdvice>("generation_settings_advice", {
        projectId: project.id,
        settings,
      })
        .then((result) => {
          if (!disposed) setAdvice(result);
        })
        .catch((e) => {
          if (!disposed) setAdviceError(errorMessage(e));
        });
    }, 350);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [project.id, project.writingPreset, providers, settings]);
  useEffect(() => {
    void actions
      .perform(() =>
        command<{ dataDir: string; version: string; privacy: string }>(
          "app_info",
        ),
      )
      .then((data) => {
        if (data) setInfo(data);
      });
  }, []);
  const save = async () => {
    const p = await actions.mutate({
      type: "metadata",
      title,
      genre,
      perspective,
      outline: project.outline,
      settings,
    });
    if (p) actions.notice("项目设置已保存。");
  };
  const test = async (provider: Provider) => {
    const r = await actions.perform(() =>
      command<{ message: string }>("test_provider", {
        providerId: provider.id,
      }),
    );
    if (r) actions.notice(`${provider.name}：${r.message}`);
  };
  const modelSelect = (key: "writerId" | "reviewerId") => (
    <select
      aria-label={key === "writerId" ? "主 AI 模型" : "副 AI 模型"}
      value={settings[key]}
      disabled={selectingModel}
      onChange={async (e) => {
        const id = e.target.value;
        const old = settings[key];
        change(key, id);
        setSelectingModel(true);
        try {
          const saved = await actions.mutate({
            type: "modelSelection",
            role: key === "writerId" ? "writer" : "reviewer",
            provider_id: id,
          });
          if (saved)
            actions.notice(
              `${key === "writerId" ? "主" : "副"} AI 选择已保存。`,
            );
          else change(key, old);
        } finally {
          setSelectingModel(false);
        }
      }}
    >
      <option value="">请选择模型配置</option>
      {providers.map((p) => (
        <option value={p.id} key={p.id}>
          {p.name} · {p.modelId}
        </option>
      ))}
    </select>
  );
  return (
    <div className="content-page settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>选择你的 AI 搭档。</h1>
          <p>自定义服务商与模型，主写和副审可以分别配置。</p>
        </div>
        <Button variant="primary" onClick={() => void save()}>
          <Check size={15} />
          保存项目设置
        </Button>
      </div>
      <section className="panel provider-section">
        <div className="section-heading">
          <div>
            <Server size={19} />
            <h2>模型配置</h2>
          </div>
          <Button onClick={() => setEditing(blankProvider())}>
            <Plus size={15} />
            添加 API
          </Button>
        </div>
        <div className="provider-grid">
          {providers.map((p) => (
            <article className="provider-card" key={p.id}>
              <div className="provider-card-heading">
                <span className="provider-symbol">
                  <Server size={21} />
                </span>
                <div>
                  <h3>{p.name}</h3>
                  <p>{p.modelId}</p>
                </div>
                <Badge tone={p.hasKey ? "green" : "amber"}>
                  {!p.modelId
                    ? "待选模型"
                    : p.hasKey
                      ? "已配置"
                      : p.allowLocalHttp
                        ? "本地免密 / 待测试"
                        : "待填密钥"}
                </Badge>
              </div>
              <p className="provider-url">{p.baseUrl}</p>
              <footer>
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  编辑配置
                  <ArrowRight size={13} />
                </Button>
                <Button onClick={() => void test(p)}>
                  <PlugZap size={14} />
                  测试连接
                </Button>
              </footer>
              {p.keyStorage === "session" && (
                <small className="inline-note">
                  密钥库不可用，目前仅当前会话保存；退出后需要重填。
                </small>
              )}
            </article>
          ))}
          {!providers.length && (
            <button
              className="provider-add"
              onClick={() => setEditing(blankProvider())}
            >
              <KeyRound size={23} />
              <strong>添加你的第一个 API</strong>
              <span>支持 Chat Completions 兼容接口</span>
            </button>
          )}
        </div>
        <PresetEntryPoint project={project} actions={actions} />
      </section>
      <div className="settings-columns">
        <div>
          <section className="panel">
            <div className="section-heading">
              <div>
                <Settings2 size={19} />
                <h2>当前作品</h2>
              </div>
            </div>
            <Field label="作品名称">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
            </Field>
            <div className="form-grid">
              <Field label="题材">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="可以自由填写"
                />
              </Field>
              <Field label="叙事视角">
                <input
                  value={perspective}
                  onChange={(e) => setPerspective(e.target.value)}
                />
              </Field>
            </div>
            <Field label="主 AI · 写作 / 修订 / 摘要">
              {modelSelect("writerId")}
            </Field>
            <Field label="副 AI · 审稿 / 校对">
              {modelSelect("reviewerId")}
            </Field>
            <p className="muted">
              可以使用同一模型；选择不同模型有助于提供不同的审稿视角。
            </p>
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <HardDrive size={19} />
                <h2>本地数据</h2>
              </div>
            </div>
            <p>
              {info?.privacy ||
                "项目保存在本机。模型只接收你发起请求时选取的资料。"}
            </p>
            <div className="data-path">{info?.dataDir || "读取数据位置…"}</div>
            <p className="muted">
              SQLite
              自动保存正文工作副本；“保存版本”保留历史。项目备份和正文导出位于窗口右上角。
            </p>
            <Badge>v{info?.version || "0.1.0"} · SQLite WAL</Badge>
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="section-heading">
              <div>
                <ShieldCheck size={19} />
                <h2>生成与工作流</h2>
              </div>
            </div>
            <div className="form-grid">
              <Field
                label="目标章节汉字数"
                hint="默认 3000，按场景拆分；字数允许模型输出偏差。"
              >
                <input
                  type="number"
                  min={200}
                  max={8000}
                  step={100}
                  value={settings.targetChars}
                  onChange={(e) =>
                    change("targetChars", Number(e.target.value))
                  }
                />
              </Field>
              <Field
                label="单章最多调用"
                hint="1～6 次，为单章上限；软件按字数计算实际场景数。"
              >
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={settings.maxCalls}
                  onChange={(e) => change("maxCalls", Number(e.target.value))}
                />
              </Field>
            </div>
            <Field
              label="模型上下文窗口 / tokens"
              hint="从服务商查询并填写。软件用保守字符估算，不伪造精确 token。"
            >
              <input
                type="number"
                min={4000}
                max={200000}
                step={1000}
                value={settings.contextTokens}
                onChange={(e) =>
                  change("contextTokens", Number(e.target.value))
                }
              />
            </Field>
            <div
              className="generation-advice"
              aria-label="生成设置检查"
              aria-live="polite"
            >
              <strong>生成设置检查</strong>
              {advice ? (
                <>
                  <p>
                    预计 {advice.scenes} 次正文调用，每次约{" "}
                    {advice.charsPerScene}{" "}
                    汉字。调用次数是上限，并不会让单次请求的超时变长。
                  </p>
                  {advice.problems.map((s, i) => (
                    <p className="advice-problem" key={`p${i}`}>
                      {s}
                    </p>
                  ))}
                  {advice.warnings.map((s, i) => (
                    <p className="advice-warning" key={`w${i}`}>
                      {s}
                    </p>
                  ))}
                  {advice.suggestedContextTokens > 0 && (
                    <small>
                      按第一章资料和目标正文估算，带余量建议约{" "}
                      {advice.suggestedContextTokens.toLocaleString()}{" "}
                      tokens；窗口须按模型真实能力填写。生成前还会检查当前章节的后续场景，正文超过目标仍可能增加用量。
                    </small>
                  )}
                  {!advice.problems.length && !advice.warnings.length && (
                    <p>当前组合未发现明显冲突，实际生成仍会检查每次请求。</p>
                  )}
                </>
              ) : (
                <p>
                  {adviceError || "正在检查字数、调用次数、输出预算与超时…"}
                </p>
              )}
            </div>
            <Toggle
              checked={settings.autoReview}
              onChange={(v) => change("autoReview", v)}
              label="生成后自动审稿"
              description="正文提交为草稿后，副 AI 独立检查，失败不影响正文。"
            />
            <Toggle
              checked={settings.autoNext}
              onChange={(v) => {
                if (v) {
                  if (!settings.writerId) {
                    actions.notice("先选择主 AI，再启用一键续写。");
                    return;
                  }
                  setConfirmNext(true);
                } else {
                  change("autoNext", false);
                }
              }}
              label="下一章一键续写"
              description="当前章确认后，进入已规划的下一章并自动开始写作。"
            />
            <p className="workflow-note">
              软件不添加题材或内容过滤。作者可以修改正文和设定，忽略审稿意见。生成内容取决于所选模型和服务商。
            </p>
          </section>
        </div>
      </div>
      {editing && (
        <ProviderModal
          provider={editing}
          existing={providers.some((p) => p.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={async (provider, key) => {
            const result = await command<Provider>("save_provider", {
              provider,
              apiKey: key || null,
            });
            if (result) {
              setEditing(null);
              await actions.refreshProviders();
              if (!settings.writerId) {
                const chosen = await actions.mutate({
                  type: "modelSelection",
                  role: "writer",
                  provider_id: result.id,
                });
                if (chosen) change("writerId", result.id);
              }
              actions.notice(
                result.keyStorage === "session"
                  ? "模型已保存，密钥仅保留当前会话。"
                  : !result.modelId
                    ? "API 配置已保存。请补充模型 ID，或读取模型列表后选择。"
                    : result.hasKey
                      ? "模型配置已保存，API Key 保存在系统凭据库。"
                      : "API 与模型已保存；本地免密服务可直接使用，云端服务可稍后补填密钥。",
              );
            }
          }}
          onDelete={async () => {
            await command("delete_provider", { providerId: editing.id });
            setEditing(null);
            await actions.refreshProviders();
          }}
        />
      )}
      {confirmNext && (
        <Confirm
          title="启用下一章一键续写"
          description={`你授权在已规划的新章节中自动调用选定主 AI，每章目标 ${settings.targetChars} 汉字、最多 ${settings.maxCalls} 次写作调用。已有正文会直接打开。缺大纲或资料需要核实时仍提示你处理。`}
          label="启用，保存设置后生效"
          onClose={() => setConfirmNext(false)}
          onConfirm={async () => {
            change("autoNext", true);
            setConfirmNext(false);
          }}
        />
      )}
    </div>
  );
}
function ProviderModal({
  provider,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  provider: Provider;
  existing: boolean;
  onSave: (p: Provider, key: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [p, setP] = useState(provider);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelInfo, setModelInfo] = useState("");
  const change = <K extends keyof Provider>(k: K, v: Provider[K]) =>
    setP((p) => ({ ...p, [k]: v }));
  return (
    <Modal
      title="模型 API 配置"
      subtitle="支持兼容 Chat Completions 的云端服务和本地模型。"
      onClose={() => {
        setKey("");
        onClose();
      }}
      wide
    >
      <div className="form-grid">
        <Field label="显示名称">
          <input
            autoFocus
            value={p.name}
            onChange={(e) => change("name", e.target.value)}
          />
        </Field>
        <Field
          label="模型 ID"
          hint="可手动填写，也可读取模型列表；暂时留空也能先保存 API。"
        >
          <input
            value={p.modelId}
            onChange={(e) => change("modelId", e.target.value)}
            placeholder="填写服务商提供的准确模型名称"
            list="provider-model-options"
          />
          <datalist id="provider-model-options">
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field
        label="Base URL"
        hint="例如 https://你的服务商/v1；也可输入完整 /chat/completions 路径。"
      >
        <input
          value={p.baseUrl}
          onChange={(e) => {
            const url = e.target.value;
            change("baseUrl", url);
            try {
              const u = new URL(url.trim());
              if (
                u.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
              )
                change("allowLocalHttp", true);
            } catch {
              /* The address can be incomplete while typing. */
            }
            setModels([]);
            setModelInfo("");
          }}
          placeholder="https://api.example.com/v1"
        />
      </Field>
      <div className="provider-model-discovery">
        <Button
          busy={loadingModels}
          onClick={async () => {
            setLoadingModels(true);
            setError("");
            setModelInfo("");
            try {
              const items = await command<string[]>("list_provider_models", {
                provider: p,
                apiKey: key || null,
              });
              setModels(items);
              if (!p.modelId.trim()) change("modelId", items[0]);
              setModelInfo(
                `已读取 ${items.length} 个模型，可在模型 ID 输入框选择或自行填写。`,
              );
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setLoadingModels(false);
            }
          }}
        >
          读取模型列表
        </Button>
        <small>
          {modelInfo || "从所填地址读取；不支持列表的服务可手动填写。"}
        </small>
      </div>
      <Field
        label="API Key"
        hint={
          p.hasKey
            ? "已有密钥。留空保留；填写则更新系统凭据。"
            : "可先留空保存。免密本地模型无需填写；云端调用前需配置。密钥存入系统凭据库。"
        }
      >
        <input
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={p.hasKey ? "已配置 · 留空保留" : "粘贴你的 API Key"}
        />
      </Field>
      <div className="form-grid">
        <Field label="输出上限 / tokens">
          <input
            type="number"
            min={256}
            max={32768}
            value={p.maxTokens}
            onChange={(e) => change("maxTokens", Number(e.target.value))}
          />
        </Field>
        <Field label="输出参数">
          <select
            value={p.tokenParameter}
            onChange={(e) => change("tokenParameter", e.target.value)}
          >
            <option value="max_tokens">max_tokens（多数兼容服务）</option>
            <option value="max_completion_tokens">max_completion_tokens</option>
            <option value="none">不传输出上限参数</option>
          </select>
        </Field>
        <Field label="Temperature（可留空关闭）">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={p.temperature ?? ""}
            onChange={(e) =>
              change(
                "temperature",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </Field>
        <Field
          label="请求超时 / 秒"
          hint={
            p.timeoutSeconds < 120
              ? "当前超时偏短。慢模型或较长正文建议 120～300 秒；这是每次请求的超时。"
              : "每次请求独立计时；慢模型可按需要调至 300～600 秒。"
          }
        >
          <input
            type="number"
            min={10}
            max={600}
            value={p.timeoutSeconds}
            onChange={(e) => change("timeoutSeconds", Number(e.target.value))}
          />
        </Field>
      </div>
      <Toggle
        checked={p.jsonMode}
        onChange={(v) => change("jsonMode", v)}
        label="接口支持 JSON object"
        description="不确定时保持关闭。软件仍会校验审稿与记忆 JSON。"
      />
      <Toggle
        checked={p.allowLocalHttp}
        onChange={(v) => change("allowLocalHttp", v)}
        label="允许 HTTP 本地回环地址"
        description="仅用于 localhost、127.0.0.1、::1 的本地模型或模拟服务。"
      />
      <p className="destination">
        AI 请求将把所选正文与资料发送至：{p.baseUrl}
      </p>
      {error && (
        <p className="inline-note" role="alert">
          {error}
        </p>
      )}
      <footer>
        {existing && (
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onDelete();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={14} />
            删除配置
          </Button>
        )}
        <span className="spacer" />
        <Button
          onClick={() => {
            setKey("");
            onClose();
          }}
        >
          取消
        </Button>
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(p, key);
              setKey("");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={14} />
          保存模型
        </Button>
      </footer>
    </Modal>
  );
}
