import { useState } from "react";
import {
  Plus,
  LockKeyhole,
  LockKeyholeOpen,
  ArrowUp,
  ArrowDown,
  Feather,
  Check,
  BookOpen,
} from "lucide-react";
import type { Actions } from "./App";
import { type Project, type Chapter, blankChapter, status } from "./domain";
import { Badge, Button, Field, Modal, Toggle } from "./components";
export function Outline({
  project,
  actions,
}: {
  project: Project;
  actions: Actions;
}) {
  const [outline, setOutline] = useState(project.outline);
  const [editing, setEditing] = useState<Chapter | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="content-page outline-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">STORY ARCHITECTURE</span>
          <h1>给故事一条清晰的路。</h1>
          <p>大纲与设定由你决定，AI 负责沿着它写作。</p>
        </div>
        <Button variant="primary" onClick={() => setEditing(blankChapter())}>
          <Plus size={16} />
          新增章节
        </Button>
      </div>
      <section className="panel master-outline">
        <div className="section-heading">
          <div>
            <BookOpen size={19} />
            <h2>作品总纲</h2>
          </div>
          <Button
            onClick={async () => {
              const p = await actions.mutate({
                type: "metadata",
                title: project.title,
                genre: project.genre,
                perspective: project.perspective,
                outline,
                settings: project.settings,
              });
              if (p) actions.notice("作品总纲已保存。");
            }}
          >
            <Check size={14} />
            保存总纲
          </Button>
        </div>
        <textarea
          aria-label="作品总纲"
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
          placeholder="故事讲什么？主角想得到什么？主要冲突、世界背景与最终走向…"
          rows={5}
        />
      </section>
      <div className="section-heading chapters-heading">
        <h2>
          章节计划 <span>{project.chapters.length}</span>
        </h2>
        <p>生成只针对当前一章；缺少下一章大纲时会停在规划步骤。</p>
      </div>
      <div className="outline-grid">
        {project.chapters.map((c, i) => (
          <article className="outline-card" key={c.id}>
            <header>
              <span className="outline-order">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Badge tone={c.working ? "green" : "neutral"}>{status(c)}</Badge>
              {c.locked && <LockKeyhole size={14} />}
            </header>
            <small>{c.volume}</small>
            <h3>{c.title}</h3>
            <p>{c.goal || "还没有章节目标，点击编辑补充。"}</p>
            <div className="outline-events">
              {c.events
                .split("\n")
                .filter(Boolean)
                .slice(0, 3)
                .map((event, index) => (
                  <div key={index}>
                    <i />
                    {event}
                  </div>
                ))}
            </div>
            {c.forbidden && (
              <div className="outline-forbidden">作者约束：{c.forbidden}</div>
            )}
            <footer>
              <Button variant="ghost" onClick={() => setEditing(c)}>
                编辑大纲
              </Button>
              <div>
                <button
                  className="icon-button"
                  aria-label="章节上移"
                  onClick={() =>
                    void actions.mutate({
                      type: "moveChapter",
                      chapter_id: c.id,
                      direction: -1,
                    })
                  }
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label="章节下移"
                  onClick={() =>
                    void actions.mutate({
                      type: "moveChapter",
                      chapter_id: c.id,
                      direction: 1,
                    })
                  }
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label="打开章节写作"
                  onClick={() => void actions.navigate("writer", c.id)}
                >
                  <Feather size={15} />
                </button>
              </div>
            </footer>
          </article>
        ))}
        <button
          className="outline-add"
          onClick={() => setEditing(blankChapter())}
        >
          <Plus size={22} />
          <span>下一段故事</span>
        </button>
      </div>
      {editing && (
        <ChapterModal
          chapter={editing}
          onClose={() => setEditing(null)}
          busy={busy}
          onSave={async (c) => {
            setBusy(true);
            if (c.locked && editing.locked) {
              const unlocked = await actions.mutate({
                type: "outline",
                chapter: { ...editing, locked: false },
              });
              if (!unlocked) {
                setBusy(false);
                return;
              }
            }
            const p = await actions.mutate({
              type: c.id ? "outline" : "addChapter",
              chapter: c,
            });
            setBusy(false);
            if (p) {
              setEditing(null);
              actions.notice("章节大纲已保存。");
            }
          }}
        />
      )}
    </div>
  );
}
function ChapterModal({
  chapter,
  onSave,
  onClose,
  busy,
}: {
  chapter: Chapter;
  onSave: (c: Chapter) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [data, setData] = useState(chapter);
  const change = (key: keyof Chapter, value: string | boolean) =>
    setData((p) => ({ ...p, [key]: value }));
  return (
    <Modal
      title={chapter.id ? "编辑章节大纲" : "规划新的章节"}
      subtitle="必达事件按顺序分场景写作；约束完全来自你的创作决定。"
      onClose={onClose}
      wide
    >
      <div className="form-grid">
        <Field label="章节标题">
          <input
            value={data.title}
            onChange={(e) => change("title", e.target.value)}
          />
        </Field>
        <Field label="所属卷">
          <input
            value={data.volume}
            onChange={(e) => change("volume", e.target.value)}
          />
        </Field>
      </div>
      <Field label="本章目标">
        <textarea
          rows={2}
          value={data.goal}
          onChange={(e) => change("goal", e.target.value)}
          placeholder="本章要推进什么？人物应该发生什么变化？"
        />
      </Field>
      <Field label="必达事件" hint="每行一项，按剧情顺序填写。">
        <textarea
          rows={4}
          value={data.events}
          onChange={(e) => change("events", e.target.value)}
          placeholder="事件一\n事件二\n事件三"
        />
      </Field>
      <div className="form-grid">
        <Field label="作者约束（可选）">
          <textarea
            rows={3}
            value={data.forbidden}
            onChange={(e) => change("forbidden", e.target.value)}
            placeholder="例如：暂时不揭露真相…"
          />
        </Field>
        <Field label="结尾状态">
          <textarea
            rows={3}
            value={data.ending}
            onChange={(e) => change("ending", e.target.value)}
            placeholder="这一章结束时停在哪里？"
          />
        </Field>
      </div>
      <Toggle
        checked={data.locked}
        onChange={(v) => change("locked", v)}
        label="锁定这一版大纲"
        description="用于防止误改。作者可以随时解锁与调整。"
      />
      <footer>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!data.title.trim()}
          onClick={() => void onSave(data)}
        >
          {data.locked ? (
            <LockKeyhole size={14} />
          ) : (
            <LockKeyholeOpen size={14} />
          )}
          保存大纲
        </Button>
      </footer>
    </Modal>
  );
}
