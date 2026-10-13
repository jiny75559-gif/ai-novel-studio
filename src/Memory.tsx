import { useState } from "react";
import {
  Plus,
  LockKeyhole,
  Check,
  Trash2,
  ArrowUpRight,
  Sparkles,
  Layers3,
  Search,
  AlertCircle,
  FileText,
} from "lucide-react";
import type { Actions } from "./App";
import {
  type Project,
  type Fact,
  type Chapter,
  blankFact,
  categoryLabels,
  visibilityLabels,
} from "./domain";
import {
  Badge,
  Button,
  Details,
  Empty,
  Field,
  Modal,
  Toggle,
} from "./components";
export function Memory({
  project,
  actions,
}: {
  project: Project;
  actions: Actions;
}) {
  const [tab, setTab] = useState<
    "facts" | "pending" | "summaries" | "diagnostics"
  >("facts");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Fact | null>(null);
  const [summary, setSummary] = useState<Chapter | null>(null);
  const pending = project.proposals.filter((p) => p.status === "pending");
  const goSource = (vid: string) => {
    const c = project.chapters.find((c) =>
      c.versions.some((v) => v.id === vid),
    );
    if (c) void actions.navigate("writer", c.id);
  };
  const diagnostics = [
    ...project.chapters.flatMap((c, i) => [
      ...(!c.goal && !c.events
        ? [
            {
              label: `第 ${i + 1} 章缺少大纲`,
              view: "outline" as const,
              id: c.id,
            },
          ]
        : []),
      ...(c.summaryStale
        ? [
            {
              label: `第 ${i + 1} 章摘要待更新`,
              view: "writer" as const,
              id: c.id,
            },
          ]
        : []),
      ...(c.upstreamChanged
        ? [
            {
              label: `第 ${i + 1} 章需要检查前文变更`,
              view: "writer" as const,
              id: c.id,
            },
          ]
        : []),
    ]),
    ...project.facts
      .filter((f) => f.needsRevalidation)
      .map((f) => ({
        label: `记忆“${f.predicate}”需要重新核实`,
        view: "memory" as const,
        id: "",
      })),
    ...project.reports
      .filter((r) => r.stale)
      .map(() => ({
        label: "存在历史审稿报告，正文已更新",
        view: "writer" as const,
        id: "",
      })),
  ];
  return (
    <div className="content-page memory-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">STORY MEMORY</span>
          <h1>让前面的故事，有迹可循。</h1>
          <p>规则、状态、伏笔与人物知识。AI 提取的候选只有你确认后才生效。</p>
        </div>
        <Button variant="primary" onClick={() => setEditing(blankFact())}>
          <Plus size={16} />
          新增记忆
        </Button>
      </div>
      <div className="wide-tabs">
        {[
          { id: "facts", label: "已确认设定", count: project.facts.length },
          { id: "pending", label: "待审批候选", count: pending.length },
          {
            id: "summaries",
            label: "章节摘要",
            count: project.chapters.filter((c) => c.summary).length,
          },
          { id: "diagnostics", label: "一致性检查", count: diagnostics.length },
        ].map((t) => (
          <button
            className={tab === t.id ? "active" : ""}
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
          >
            {t.label}
            <span>{t.count}</span>
          </button>
        ))}
      </div>
      {tab === "facts" && (
        <>
          <div className="memory-toolbar">
            <div className="filter-chips">
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                全部
              </button>
              {Object.entries(categoryLabels).map(([k, v]) => (
                <button
                  className={filter === k ? "active" : ""}
                  key={k}
                  onClick={() => setFilter(k)}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="search-box">
              <Search size={15} />
              <input
                aria-label="搜索记忆"
                placeholder="搜索记忆…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="memory-grid">
            {project.facts
              .filter(
                (f) =>
                  (filter === "all" || f.category === filter) &&
                  (f.predicate + f.value).includes(search),
              )
              .map((f) => (
                <article className="fact-card" key={f.id}>
                  <header>
                    <Badge tone={f.locked ? "amber" : "neutral"}>
                      {f.locked && <LockKeyhole size={11} />}
                      {categoryLabels[f.category] || f.category}
                    </Badge>
                    {f.needsRevalidation && <Badge tone="red">待核实</Badge>}
                    <button className="text-link" onClick={() => setEditing(f)}>
                      编辑
                    </button>
                  </header>
                  <h3>{f.predicate}</h3>
                  <p>{f.value}</p>
                  <footer>
                    <span>
                      第 {f.startOrder || 1}～{f.endOrder || "以后"} 章 ·{" "}
                      {visibilityLabels[f.visibility]}
                    </span>
                    {f.sourceVersionId ? (
                      <button
                        className="text-link"
                        onClick={() => goSource(f.sourceVersionId)}
                      >
                        来源
                        <ArrowUpRight size={12} />
                      </button>
                    ) : (
                      <small>作者设定</small>
                    )}
                  </footer>
                  {f.excerpt && (
                    <Details title="原文依据">
                      <blockquote>{f.excerpt}</blockquote>
                    </Details>
                  )}
                </article>
              ))}
          </div>
          {!project.facts.length && (
            <Empty
              icon={<Layers3 size={30} />}
              title="写下第一条设定"
              description="可以是世界规则，也可以是伤势、道具持有者或尚未回收的伏笔。"
            />
          )}
        </>
      )}
      {tab === "pending" && (
        <div className="proposal-list">
          {pending.map((p) => (
            <article className="proposal-card" key={p.id}>
              <header>
                <Badge tone="amber">待审批</Badge>
                <Badge>{categoryLabels[p.fact.category]}</Badge>
                <span className="spacer" />
                <span className="muted">
                  {p.verified ? "引文已定位" : "来源待核实"}
                </span>
              </header>
              <h3>{p.fact.predicate}</h3>
              <p>{p.fact.value}</p>
              <blockquote>{p.fact.excerpt}</blockquote>
              {p.conflict && <div className="inline-note">{p.conflict}</div>}
              <footer>
                <button
                  className="text-link"
                  onClick={() => goSource(p.sourceVersionId)}
                >
                  查看来源正文
                  <ArrowUpRight size={13} />
                </button>
                <span className="spacer" />
                <Button
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
                  variant="primary"
                  onClick={() =>
                    void actions.mutate({
                      type: "proposal",
                      proposal_id: p.id,
                      accept: true,
                    })
                  }
                >
                  <Check size={14} />
                  纳入记忆
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setEditing({
                      ...p.fact,
                      id: "",
                      sourceVersionId: "",
                      excerpt: "",
                    })
                  }
                >
                  手动调整后新增
                </Button>
              </footer>
            </article>
          ))}
          {!pending.length && (
            <Empty
              icon={<Check size={30} />}
              title="没有待审批的记忆"
              description="确认一章后，在写作台提取摘要与记忆。你也可以随时手动增加设定。"
            />
          )}
        </div>
      )}
      {tab === "summaries" && (
        <div className="summary-list">
          {project.chapters.map((c, i) => (
            <article className="summary-card" key={c.id}>
              <div className="summary-heading">
                <span className="outline-order">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3>{c.title}</h3>
                {c.summaryStale && <Badge tone="amber">待更新</Badge>}
                <span className="spacer" />
                <Button
                  variant="ghost"
                  disabled={!c.approvedVersionId}
                  onClick={() => setSummary(c)}
                >
                  手动编辑
                </Button>
                <Button
                  disabled={!c.approvedVersionId}
                  onClick={() => void actions.run("remember", "", false, c.id)}
                >
                  <Sparkles size={14} />
                  AI 更新
                </Button>
              </div>
              <p>
                {c.summary || "还没有摘要。先确认正文，然后提取或手动填写。"}
              </p>
            </article>
          ))}
        </div>
      )}
      {tab === "diagnostics" && (
        <section className="panel diagnostics">
          <div className="section-heading">
            <div>
              <AlertCircle size={19} />
              <h2>需要留意的资料</h2>
            </div>
            <Badge>{diagnostics.length} 项</Badge>
          </div>
          {diagnostics.map((d, i) => (
            <button
              key={i}
              onClick={() => {
                if (d.view === "memory") {
                  setTab("facts");
                  return;
                }
                void actions.navigate(d.view, d.id || undefined);
              }}
            >
              <span>{d.label}</span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {!diagnostics.length && (
            <Empty
              icon={<Check size={25} />}
              title="资料状态正常"
              description="仍建议通过副 AI 和自己的阅读检查情节。"
            />
          )}
          <p className="muted">检查列出数据状态，不替作者判断作品内容。</p>
        </section>
      )}
      {editing && (
        <FactModal
          fact={editing}
          project={project}
          onClose={() => setEditing(null)}
          onSave={async (f) => {
            const p = await actions.mutate({ type: "fact", fact: f });
            if (p) setEditing(null);
          }}
          onDelete={async () => {
            const p = await actions.mutate({
              type: "deleteFact",
              fact_id: editing.id,
            });
            if (p) setEditing(null);
          }}
        />
      )}
      {summary && (
        <SummaryModal
          chapter={summary}
          onClose={() => setSummary(null)}
          onSave={async (text) => {
            const p = await actions.mutate({
              type: "summary",
              chapter_id: summary.id,
              summary: text,
            });
            if (p) setSummary(null);
          }}
        />
      )}
    </div>
  );
}
function FactModal({
  fact,
  project,
  onSave,
  onDelete,
  onClose,
}: {
  fact: Fact;
  project: Project;
  onSave: (f: Fact) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [f, setF] = useState(fact);
  const [busy, setBusy] = useState(false);
  const change = (key: keyof Fact, value: string | boolean | number | null) =>
    setF((f) => ({ ...f, [key]: value }));
  return (
    <Modal
      title={fact.id ? "编辑设定记忆" : "新增设定记忆"}
      subtitle="作者可修改任何设定。人物状态变化可以通过章节有效区间表达。"
      onClose={onClose}
      wide
    >
      <div className="form-grid">
        <Field label="类别">
          <select
            value={f.category}
            onChange={(e) => change("category", e.target.value)}
          >
            {Object.entries(categoryLabels).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="关联人物（可空）">
          <select
            value={f.subjectId}
            onChange={(e) => change("subjectId", e.target.value)}
          >
            <option value="">世界 / 不指定</option>
            {project.characters
              .filter((c) => !c.deleted)
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="属性 / 事项">
        <input
          value={f.predicate}
          onChange={(e) => change("predicate", e.target.value)}
          placeholder="例如：左臂伤势、铜钥匙持有者…"
        />
      </Field>
      <Field label="内容">
        <textarea
          rows={4}
          value={f.value}
          onChange={(e) => change("value", e.target.value)}
        />
      </Field>
      <div className="form-grid">
        <Field label="起始章节">
          <input
            type="number"
            min={1}
            value={f.startOrder || 1}
            onChange={(e) => change("startOrder", Number(e.target.value))}
          />
        </Field>
        <Field label="结束章节（可空）">
          <input
            type="number"
            min={1}
            value={f.endOrder || ""}
            onChange={(e) =>
              change("endOrder", e.target.value ? Number(e.target.value) : null)
            }
          />
        </Field>
        <Field label="确定性">
          <select
            value={f.certainty}
            onChange={(e) => change("certainty", e.target.value)}
          >
            <option value="confirmed">作者确认</option>
            <option value="rumor">传闻</option>
            <option value="hypothesis">假设</option>
          </select>
        </Field>
        <Field label="知识可见范围">
          <select
            value={f.visibility}
            onChange={(e) => change("visibility", e.target.value)}
          >
            {Object.entries(visibilityLabels).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Toggle
        checked={f.locked}
        onChange={(v) => change("locked", v)}
        label="作为必须遵循的作者设定"
        description="AI 应遵循此设定；作者仍可以随时修改。"
      />
      {fact.sourceVersionId && (
        <p className="muted">
          保存修改后以作者设定为来源，原来的提取候选与正文版本仍保留。
        </p>
      )}
      <footer>
        {fact.id && (
          <Button variant="danger" onClick={() => void onDelete()}>
            <Trash2 size={14} />
            删除
          </Button>
        )}
        <span className="spacer" />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!f.value.trim() || !f.predicate.trim()}
          onClick={async () => {
            setBusy(true);
            await onSave(f);
            setBusy(false);
          }}
        >
          保存记忆
        </Button>
      </footer>
    </Modal>
  );
}
function SummaryModal({
  chapter,
  onClose,
  onSave,
}: {
  chapter: Chapter;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(chapter.summary);
  return (
    <Modal title={`${chapter.title} · 章节摘要`} onClose={onClose}>
      <Field
        label="摘要"
        hint="写下重要事件、人物知识变化、道具去向和结尾状态。"
      >
        <textarea
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <footer>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={() => void onSave(text)}>
          <FileText size={14} />
          保存摘要
        </Button>
      </footer>
    </Modal>
  );
}
