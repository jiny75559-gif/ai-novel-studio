import { useState } from "react";
import {
  BookOpen,
  Plus,
  Sparkles,
  ChevronRight,
  Check,
  History,
  ShieldCheck,
  Layers3,
  FileText,
  Play,
  Square,
  RotateCcw,
  GitBranch,
  Clock,
  Eye,
  Copy,
  ArrowUpRight,
  Search,
} from "lucide-react";
import { command } from "./bridge";
import {
  type Chapter,
  type Project,
  type Provider,
  type Run,
  type Preflight,
  type Version,
  blankChapter,
  status,
  approved,
  hanCount,
  taskLabels,
  runLabels,
  categoryLabels,
} from "./domain";
import { Badge, Button, Details, Empty, Modal } from "./components";
import type { Actions } from "./App";
interface Props {
  project: Project;
  chapter: Chapter | undefined;
  body: string;
  onBody: (s: string) => void;
  onBlur: () => void;
  saveState: string;
  providers: Provider[];
  runs: Run[];
  context: Preflight | null;
  actions: Actions;
  onSave: () => void;
  onApprove: () => void;
  onNext: () => void;
  onRestore: (id: string) => void;
  onCancel: (id: string) => void;
}
export function Writer({
  project,
  chapter,
  body,
  onBody,
  onBlur,
  saveState,
  providers,
  runs,
  context,
  actions,
  onSave,
  onApprove,
  onNext,
  onRestore,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<"review" | "memory" | "context" | "tasks">(
    "review",
  );
  const [history, setHistory] = useState(false);
  const [compare, setCompare] = useState<Version | null>(null);
  const [chapterSearch, setChapterSearch] = useState("");
  const [preview, setPreview] = useState<Preflight | null>(null);
  const current = runs.filter((r) => r.chapterId === chapter?.id);
  const running = current.filter((r) => r.status === "running");
  const writer = providers.find((p) => p.id === project.settings.writerId);
  const reviewer = providers.find((p) => p.id === project.settings.reviewerId);
  const report = project.reports
    .filter((r) => chapter?.versions.some((v) => v.id === r.chapterVersionId))
    .at(-1);
  const selected =
    report?.issues.filter((i) => i.decision === "revise").length || 0;
  const revisionDraft = current
    .filter((r) => r.task === "revise" && r.status === "succeeded")
    .map((r) => chapter?.versions.find((v) => v.id === r.resultVersionId))
    .find((v) => v?.branch && v.baseVersionId === chapter?.currentVersionId);
  const pending = project.proposals.filter((p) => p.status === "pending");
  const index = project.chapters.findIndex((c) => c.id === chapter?.id);
  return (
    <div className="writer-layout">
      <aside className="chapter-pane">
        <header>
          <span>章节目录</span>
          <button
            className="icon-button"
            aria-label="新增章节"
            onClick={async () => {
              const p = await actions.mutate({
                type: "addChapter",
                chapter: blankChapter(`新的章节`),
              });
              if (p) await actions.navigate("outline", p.chapters.at(-1)!.id);
            }}
          >
            <Plus size={17} />
          </button>
        </header>
        <div className="chapter-search">
          <Search size={14} />
          <input
            placeholder="查找章节"
            aria-label="查找章节"
            value={chapterSearch}
            onChange={(e) => setChapterSearch(e.target.value)}
          />
        </div>
        <div className="chapter-list">
          {[...new Set(project.chapters.map((c) => c.volume || "未分卷"))].map(
            (volume) => (
              <div key={volume}>
                <div className="volume-label">
                  <BookOpen size={13} />
                  {volume}
                </div>
                {project.chapters
                  .map((c, i) => ({ c, i }))
                  .filter(
                    ({ c }) =>
                      (c.volume || "未分卷") === volume &&
                      c.title.includes(chapterSearch),
                  )
                  .map(({ c, i }) => (
                    <button
                      className={`chapter-item ${c.id === chapter?.id ? "active" : ""}`}
                      key={c.id}
                      onClick={() => void actions.navigate("writer", c.id)}
                    >
                      <span className="chapter-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{c.title}</strong>
                        <small>
                          {hanCount(c.working).toLocaleString()} 字 ·{" "}
                          {status(c)}
                        </small>
                      </div>
                      {approved(c) ? (
                        <Check size={13} className="green-icon" />
                      ) : (
                        <i
                          className={`chapter-dot ${c.working ? "draft" : ""}`}
                        />
                      )}
                    </button>
                  ))}
              </div>
            ),
          )}
        </div>
        <div className="chapter-pane-bottom">
          <small>创作进度</small>
          <strong>
            {project.chapters.filter(approved).length}
            <span> / {project.chapters.length} 章</span>
          </strong>
          <div className="progress-track">
            <i
              style={{
                width: `${(project.chapters.filter(approved).length / Math.max(project.chapters.length, 1)) * 100}%`,
              }}
            />
          </div>
          <button onClick={() => void actions.navigate("outline")}>
            编辑故事大纲
            <ArrowUpRight size={13} />
          </button>
        </div>
      </aside>
      <section className="manuscript-pane">
        {chapter ? (
          <>
            <header className="editor-toolbar">
              <div>
                <Badge tone={approved(chapter) ? "green" : "amber"}>
                  {status(chapter)}
                </Badge>
                <span className="save-indicator">
                  <i
                    className={`status-dot ${saveState.includes("失败") ? "amber" : ""}`}
                  />
                  {saveState}
                </span>
              </div>
              <div>
                <Button variant="ghost" onClick={() => setHistory(true)}>
                  <History size={15} />
                  版本 <span className="count">{chapter.versions.length}</span>
                </Button>
                <Button variant="ghost" onClick={onSave}>
                  保存版本
                </Button>
              </div>
            </header>
            {chapter.upstreamChanged && (
              <div className="upstream-banner">
                <GitBranch size={15} />
                前文已修改，建议检查本章的衔接。
                <button
                  onClick={() =>
                    void actions.mutate({
                      type: "acknowledge",
                      chapter_id: chapter.id,
                    })
                  }
                >
                  已核实
                </button>
              </div>
            )}
            <div className="manuscript-scroll">
              <div className="chapter-title">
                <span className="eyebrow">
                  CHAPTER {String(index + 1).padStart(2, "0")}{" "}
                  <span> / {chapter.volume}</span>
                </span>
                <h1>{chapter.title}</h1>
                <p>
                  {chapter.goal ||
                    "在故事大纲中填写本章目标，让 AI 清楚你想写什么。"}
                </p>
              </div>
              {!body && (
                <div className="blank-page-hint">
                  <FeatherIllustration />
                  <h3>这一章，从你的想法开始。</h3>
                  <p>
                    直接在下方写作，或让主 AI 按大纲起草。
                    <br />
                    每一句都可以修改，下一章会记住你的决定。
                  </p>
                  <Button
                    variant="primary"
                    disabled={running.some((r) => r.task === "write")}
                    onClick={() => void actions.run("write")}
                  >
                    <Sparkles size={16} />
                    生成本章
                  </Button>
                </div>
              )}
              <textarea
                className={`manuscript ${!body ? "empty-manuscript" : ""}`}
                aria-label="章节正文"
                placeholder="在这里写下第一句话…"
                value={body}
                onChange={(e) => onBody(e.target.value)}
                onBlur={onBlur}
                spellCheck={false}
              />
            </div>
            <div className="editor-bottom">
              <span>
                {hanCount(body).toLocaleString()}
                <small>
                  {" "}
                  / 目标 {project.settings.targetChars.toLocaleString()} 汉字
                </small>
              </span>
              <div>
                <Button
                  disabled={running.some((r) => r.task === "write")}
                  onClick={() => void actions.run("write")}
                >
                  <Sparkles size={15} />
                  {body ? "重新生成" : "生成本章"}
                </Button>
                <Button disabled={!body.trim()} onClick={onApprove}>
                  <Check size={15} />
                  {approved(chapter) ? "已确认" : "确认本章"}
                </Button>
                <Button variant="primary" onClick={onNext}>
                  下一章
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            icon={<BookOpen />}
            title="先规划第一章"
            description="添加章节大纲，然后开始写作。"
          >
            <Button
              variant="primary"
              onClick={() => void actions.navigate("outline")}
            >
              打开故事大纲
            </Button>
          </Empty>
        )}
      </section>
      <aside className="ai-pane">
        <header>
          <span className="ai-mark">
            <Sparkles size={15} />
          </span>
          <strong>创作助手</strong>
          <span className="ai-state">{running.length ? "工作中" : "就绪"}</span>
        </header>
        <div className="model-slots">
          <div>
            <span className="slot-dot writer" />
            <span>主 AI</span>
            <strong title={writer?.modelId}>{writer?.name || "待配置"}</strong>
          </div>
          <div>
            <span className="slot-dot reviewer" />
            <span>副 AI</span>
            <strong title={reviewer?.modelId}>
              {reviewer?.name || "待配置"}
            </strong>
          </div>
          {(!writer || !reviewer) && (
            <button onClick={() => void actions.navigate("settings")}>
              配置模型
              <ChevronRight size={12} />
            </button>
          )}
        </div>
        <div className="assistant-tabs">
          {[
            { id: "review", label: "审稿", icon: ShieldCheck },
            { id: "memory", label: "记忆", icon: Layers3 },
            { id: "context", label: "资料", icon: FileText },
            { id: "tasks", label: "任务", icon: Clock },
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id as typeof tab)}
            >
              <t.icon size={14} />
              {t.label}
              {t.id === "tasks" && running.length > 0 && <i />}
            </button>
          ))}
        </div>
        <div className="assistant-content">
          {running.length > 0 && (
            <div className="running-card">
              <div>
                <span className="pulse-dot" />
                <strong>{taskLabels[running[0].task]}</strong>
                <button
                  aria-label="取消任务"
                  onClick={() => onCancel(running[0].id)}
                >
                  <Square size={12} />
                </button>
              </div>
              <p>
                {running[0].task === "write"
                  ? `已保存 ${running[0].segments.filter((s) => s.status === "complete").length} / ${running[0].snapshot.sceneCount} 个场景`
                  : `已发起 ${running[0].calls} 次请求`}
              </p>
              <div className="indeterminate" />
            </div>
          )}
          {tab === "review" && (
            <>
              <div className="panel-heading">
                <div>
                  <h3>独立审稿</h3>
                  <p>逻辑、知识边界与前后文衔接</p>
                </div>
                <Button
                  variant="ghost"
                  disabled={
                    !body.trim() || running.some((r) => r.task === "review")
                  }
                  onClick={() => void actions.run("review")}
                >
                  <Play size={13} />
                  {report ? "重新审稿" : "开始审稿"}
                </Button>
              </div>
              {report ? (
                <>
                  <div
                    className={`review-summary ${report.stale ? "stale" : ""}`}
                  >
                    <div>
                      <ShieldCheck size={16} />
                      <strong>
                        {report.stale ? "报告已过期" : "审稿报告"}
                      </strong>
                      <Badge>{report.issues.length} 项</Badge>
                    </div>
                    <p>{report.summary}</p>
                    {report.stale && (
                      <small>
                        正文已经修改；旧意见保留供参考，重新审稿后可处理。
                      </small>
                    )}
                  </div>
                  {report.issues.map((issue, i) => (
                    <article
                      className={`issue-card ${issue.decision ? "decided" : ""}`}
                      key={issue.issueId}
                    >
                      <div className="issue-top">
                        <Badge
                          tone={
                            issue.severity === "blocker"
                              ? "red"
                              : issue.severity === "major"
                                ? "amber"
                                : "neutral"
                          }
                        >
                          {
                            {
                              blocker: "阻断意见",
                              major: "重要疑点",
                              minor: "一般建议",
                              style: "文风/校对",
                            }[issue.severity]
                          }
                        </Badge>
                        <span>
                          {issue.verified ? "引文已核实" : "证据未核实"}
                        </span>
                      </div>
                      <h4>
                        {String(i + 1).padStart(2, "0")} {issue.claim}
                      </h4>
                      <blockquote>
                        {issue.quote || "未提供可定位原文"}
                      </blockquote>
                      {issue.conflictEvidence && (
                        <Details title="设定依据">
                          <p>{issue.conflictEvidence.quote}</p>
                          <small>
                            {issue.conflictEvidence.sourceId} ·{" "}
                            {issue.conflictEvidence.sourceVersionId.slice(0, 8)}
                          </small>
                        </Details>
                      )}
                      <p className="suggestion">{issue.suggestion}</p>
                      <div className="issue-actions">
                        {[
                          { id: "revise", label: "修订" },
                          { id: "ignore", label: "忽略" },
                          { id: "foreshadow", label: "有意安排" },
                        ].map((d) => (
                          <button
                            disabled={report.stale}
                            className={
                              issue.decision === d.id ? "selected" : ""
                            }
                            key={d.id}
                            onClick={() =>
                              void actions.mutate({
                                type: "issue",
                                report_id: report.id,
                                issue_id: issue.issueId,
                                decision: issue.decision === d.id ? "" : d.id,
                                note: "",
                              })
                            }
                          >
                            {issue.decision === d.id && <Check size={11} />}
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!report.issues.length && (
                    <div className="review-clear">
                      <Check size={25} />
                      <p>未发现明确问题</p>
                      <small>你仍可以继续编辑或直接确认。</small>
                    </div>
                  )}
                  {selected > 0 && !report.stale && (
                    <Button
                      variant="primary"
                      className="full-width"
                      disabled={running.some((r) => r.task === "revise")}
                      onClick={() => void actions.run("revise")}
                    >
                      <Sparkles size={14} />
                      修订所选 {selected} 项
                    </Button>
                  )}
                  {revisionDraft && (
                    <div className="revision-ready">
                      <strong>修订稿已生成</strong>
                      <p>先查看差异，确认采用后才会成为当前正文。</p>
                      <Button onClick={() => setCompare(revisionDraft)}>
                        <Eye size={14} />
                        查看并采用修订稿
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  icon={<ShieldCheck size={30} />}
                  title="多一个视角，检查故事"
                  description="副 AI 会引用正文和设定提出意见。你可以采纳、忽略，或标为有意安排。"
                />
              )}
              <p className="panel-footnote">审稿提供建议，创作决定属于作者。</p>
            </>
          )}
          {tab === "memory" && (
            <>
              <div className="panel-heading">
                <div>
                  <h3>这一章的记忆</h3>
                  <p>确认正文后提取，候选由你审批</p>
                </div>
              </div>
              {chapter?.approvedVersionId ? (
                <>
                  <Button
                    className="full-width"
                    disabled={running.some((r) => r.task === "remember")}
                    onClick={() => void actions.run("remember")}
                  >
                    <Sparkles size={14} />
                    提取摘要与记忆
                  </Button>
                  <div className="memory-snippet">
                    <h4>
                      章节摘要{" "}
                      {chapter.summaryStale && (
                        <Badge tone="amber">待更新</Badge>
                      )}
                    </h4>
                    <p>
                      {chapter.summary || "尚未提取。也可在设定页手动填写。"}
                    </p>
                  </div>
                </>
              ) : (
                <div className="inline-note">
                  先确认本章，AI 才能从确定的正文版本提取记忆。
                </div>
              )}
              {pending
                .filter((p) =>
                  chapter?.versions.some((v) => v.id === p.sourceVersionId),
                )
                .map((p) => (
                  <div className="proposal-mini" key={p.id}>
                    <Badge>{categoryLabels[p.fact.category]}</Badge>
                    <h4>{p.fact.predicate}</h4>
                    <p>{p.fact.value}</p>
                    <small>
                      {p.verified ? "来源引文已定位" : "来源待核实"}
                      {p.conflict && " · 存在冲突"}
                    </small>
                    <div>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void actions.mutate({
                            type: "proposal",
                            proposal_id: p.id,
                            accept: false,
                          })
                        }
                      >
                        拒绝
                      </Button>
                      <Button
                        disabled={!p.verified || !!p.conflict}
                        onClick={() =>
                          void actions.mutate({
                            type: "proposal",
                            proposal_id: p.id,
                            accept: true,
                          })
                        }
                      >
                        纳入记忆
                      </Button>
                    </div>
                  </div>
                ))}
              <Button
                className="full-width"
                variant="ghost"
                onClick={() => void actions.navigate("memory")}
              >
                查看全部设定与记忆
                <ArrowUpRight size={14} />
              </Button>
            </>
          )}
          {tab === "context" && (
            <>
              <div className="panel-heading">
                <div>
                  <h3>AI 的上下文</h3>
                  <p>查看它本次会读取哪些资料</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!chapter) return;
                    const info = await actions.perform(() =>
                      command<Preflight>("preflight", {
                        projectId: project.id,
                        chapterId: chapter.id,
                        task: "write",
                      }),
                    );
                    if (info) setPreview(info);
                  }}
                >
                  <Eye size={14} />
                  预览
                </Button>
              </div>
              {preview || context ? (
                <>
                  <div className="context-total">
                    <strong>
                      {(preview ||
                        context)!.context.estimatedTokens.toLocaleString()}
                    </strong>
                    <span>估算上下文 tokens</span>
                  </div>
                  {(preview || context)!.context.items.map((i) => (
                    <Details
                      key={i.id}
                      title={
                        <>
                          <span className="source-priority">
                            {i.priority === 0 ? "必需" : "参考"}
                          </span>
                          {i.label}
                        </>
                      }
                    >
                      <pre>{i.text}</pre>
                      <small>
                        来源 {i.id} · 版本 {i.versionId.slice(0, 12)}
                      </small>
                    </Details>
                  ))}
                  {!!(preview || context)!.context.omitted.length && (
                    <div className="inline-note">
                      已裁剪：{(preview || context)!.context.omitted.join("、")}
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  icon={<FileText size={28} />}
                  title="资料透明可查"
                  description="点击预览，查看锁定设定、人物知识、关系和上一章结尾。候选记忆不会混入已确认事实。"
                />
              )}
            </>
          )}
          {tab === "tasks" && (
            <>
              <div className="panel-heading">
                <div>
                  <h3>任务与恢复</h3>
                  <p>失败时保留已完成片段</p>
                </div>
              </div>
              {current.length ? (
                current.map((r) => (
                  <div className="task-card" key={r.id}>
                    <div>
                      <strong>{taskLabels[r.task]}</strong>
                      <Badge
                        tone={
                          r.status === "succeeded"
                            ? "green"
                            : r.status === "running"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {runLabels[r.status]}
                      </Badge>
                    </div>
                    <small>
                      {new Date(r.createdAt).toLocaleTimeString("zh-CN")} ·{" "}
                      {r.calls} 次调用{" "}
                      {r.inputTokens + r.outputTokens > 0 &&
                        `· ${r.inputTokens + r.outputTokens} tokens（服务商返回）`}
                    </small>
                    {(r.inputTokens > 0 || r.outputTokens > 0) && (
                      <small>
                        输入 {r.inputTokens} · 输出 {r.outputTokens}
                        {(r.reasoningTokens ?? 0) > 0
                          ? ` · 推理 ${r.reasoningTokens}`
                          : ""}{" "}
                        tokens
                      </small>
                    )}
                    {r.error && (
                      <p className="task-error">{r.error.userMessage}</p>
                    )}
                    {r.segments.length > 0 && (
                      <Details title={`查看 ${r.segments.length} 个片段`}>
                        {r.segments.map((s) => (
                          <div className="segment-view" key={s.index}>
                            <strong>
                              片段 {s.index + 1} ·{" "}
                              {s.status === "complete"
                                ? "已完成"
                                : s.status === "partial"
                                  ? "未完整"
                                  : "原始响应"}{" "}
                              · {s.hanCount} 汉字
                            </strong>
                            <pre>{s.text}</pre>
                            <button
                              className="text-link"
                              onClick={() =>
                                void actions.perform(async () => {
                                  await navigator.clipboard.writeText(s.text);
                                  actions.notice("片段已复制。");
                                })
                              }
                            >
                              <Copy size={12} />
                              复制片段
                            </button>
                          </div>
                        ))}
                      </Details>
                    )}
                    {r.resultVersionId && r.task === "revise" && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const v = chapter?.versions.find(
                            (v) => v.id === r.resultVersionId,
                          );
                          if (v) setCompare(v);
                        }}
                      >
                        查看修订对比
                        <ChevronRight size={13} />
                      </Button>
                    )}
                    {["failed", "cancelled", "interrupted"].includes(
                      r.status,
                    ) &&
                      r.task === "write" && (
                        <Button onClick={() => void actions.run(r.task, r.id)}>
                          <RotateCcw size={13} />
                          从未完成场景恢复
                        </Button>
                      )}
                    {["failed", "cancelled", "interrupted"].includes(
                      r.status,
                    ) &&
                      r.task === "remember" && (
                        <Button
                          disabled={!chapter || !approved(chapter)}
                          onClick={() => void actions.run("remember")}
                        >
                          <RotateCcw size={13} />
                          重新提取摘要与记忆
                        </Button>
                      )}
                    {r.status === "running" && (
                      <Button onClick={() => onCancel(r.id)}>
                        <Square size={12} />
                        取消任务
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  icon={<Clock size={28} />}
                  title="每一步都留有记录"
                  description="开始生成或审稿后，任务进度和片段会出现在这里。"
                />
              )}
            </>
          )}
        </div>
      </aside>
      {history && chapter && (
        <Modal
          title="正文版本"
          subtitle="每一次生成、保存和回滚都有自己的记录。"
          onClose={() => setHistory(false)}
          wide
        >
          <div className="version-list">
            {[...chapter.versions].reverse().map((v) => (
              <button
                key={v.id}
                className="version-row"
                onClick={() => {
                  setCompare(v);
                  setHistory(false);
                }}
              >
                <span className="version-number">v{v.number}</span>
                <div>
                  <strong>
                    {{
                      manual: "手动保存",
                      ai: "AI 生成",
                      revision: "定点修订",
                      rollback: "历史恢复",
                    }[v.author] || v.author}
                  </strong>
                  <small>
                    {new Date(v.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {hanCount(v.content)} 汉字
                  </small>
                </div>
                {v.branch && <Badge tone="amber">待比较版本</Badge>}
                {v.id === chapter.currentVersionId && (
                  <Badge tone="green">当前</Badge>
                )}
                <ChevronRight size={15} />
              </button>
            ))}
            {!chapter.versions.length && (
              <Empty
                icon={<History />}
                title="还没有正文版本"
                description="写下正文后点击保存版本，或生成第一章。"
              />
            )}
          </div>
        </Modal>
      )}
      {compare && (
        <Modal
          title={`与版本 v${compare.number} 比较`}
          subtitle="采用后会成为新的可编辑草稿。"
          onClose={() => setCompare(null)}
          wide
        >
          <div className="version-compare">
            <div>
              <h4>当前正文</h4>
              <pre>{body || "暂无正文"}</pre>
            </div>
            <div>
              <h4>
                版本 v{compare.number} ·{" "}
                {compare.branch ? "待采用" : "历史记录"}
              </h4>
              <pre>{compare.content}</pre>
            </div>
          </div>
          <footer>
            <Button onClick={() => setCompare(null)}>关闭</Button>
            <Button
              variant="primary"
              onClick={() => {
                onRestore(compare.id);
                setCompare(null);
              }}
            >
              <Check size={14} />
              采用这个版本
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
function FeatherIllustration() {
  return (
    <div className="feather-illustration">
      <FileText size={30} />
      <Sparkles size={17} />
    </div>
  );
}
