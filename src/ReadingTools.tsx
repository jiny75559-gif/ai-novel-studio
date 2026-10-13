import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Copy,
  Download,
  Highlighter,
  MessageSquare,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Actions } from "./App";
import type { Project, ReadingMark, PdfRect, BookContent } from "./domain";
import { Button, Modal } from "./components";
import { command } from "./bridge";

export const markCurrent = (p: Project, m: ReadingMark) =>
  !!p.pdfBook ||
  p.chapters
    .find((c) => c.id === m.chapterId)
    ?.working.slice(m.start, m.end) === m.quote;
export type MarkSelection = Pick<
  ReadingMark,
  "chapterId" | "start" | "end" | "quote" | "pdfRects"
>;
export function useReadingMarks(project: Project, actions: Actions) {
  const [selection, select] = useState<MarkSelection | null>(null);
  const [editing, edit] = useState<ReadingMark | null>(null);
  const [saving, setSaving] = useState(false);
  const clear = () => {
    select(null);
    window.getSelection()?.removeAllRanges();
  };
  const draft = (note: boolean) => {
    if (!selection) return;
    const m = {
      ...selection,
      id: crypto.randomUUID(),
      color: "yellow",
      note: "",
    };
    if (note) {
      edit(m);
      clear();
    } else
      void actions.mutate({ type: "readingMark", mark: m }).then((p) => {
        if (p) clear();
      });
  };
  const collect = (root: HTMLElement) => {
    const s = window.getSelection();
    if (!s?.rangeCount || s.isCollapsed) return;
    const range = s.getRangeAt(0);
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    )
      return;
    if (project.pdfBook) {
      const rects: PdfRect[] = [];
      for (const leaf of root.querySelectorAll<HTMLElement>(".pdf-page")) {
        const box = leaf.getBoundingClientRect();
        for (const r of range.getClientRects()) {
          const x = Math.max(box.left, r.left),
            y = Math.max(box.top, r.top);
          const w = Math.min(box.right, r.right) - x,
            h = Math.min(box.bottom, r.bottom) - y;
          if (w > 0.5 && h > 0.5)
            rects.push({
              page: +leaf.dataset.page!,
              x: (x - box.left) / box.width,
              y: (y - box.top) / box.height,
              width: w / box.width,
              height: h / box.height,
            });
        }
      }
      if (rects.length && s.toString().trim())
        select({
          chapterId: "",
          start: 0,
          end: 0,
          quote: s.toString(),
          pdfRects: rects,
        });
    } else {
      const point = (node: Node, offset: number) => {
        const el = node instanceof Element ? node : node.parentElement;
        const p = el?.closest<HTMLElement>("p[data-offset]");
        if (!p) return null;
        const r = document.createRange();
        r.setStart(p, 0);
        r.setEnd(node, offset);
        return +(p.dataset.offset || 0) + r.toString().length;
      };
      const start = point(range.startContainer, range.startOffset),
        end = point(range.endContainer, range.endOffset);
      const cid = root.dataset.chapter!,
        c = project.chapters.find((c) => c.id === cid);
      if (
        start !== null &&
        end !== null &&
        c &&
        end > start &&
        c.working.slice(start, end).trim()
      )
        select({
          chapterId: cid,
          start,
          end,
          quote: c.working.slice(start, end),
          pdfRects: [],
        });
    }
  };
  const ui = (
    <>
      {selection && (
        <div
          className="reader-selection-tools"
          role="toolbar"
          aria-label="选中文字操作"
          onPointerDown={(e) => e.preventDefault()}
        >
          <Button onClick={() => draft(false)}>
            <Highlighter size={15} />
            高亮
          </Button>
          <Button onClick={() => draft(true)}>
            <MessageSquare size={15} />
            批注
          </Button>
          <Button
            onClick={() =>
              void actions.perform(async () => {
                await navigator.clipboard.writeText(selection.quote);
                actions.notice("已复制选中的文字。");
              })
            }
          >
            <Copy size={15} />
            复制
          </Button>
          <button className="icon-button" aria-label="取消选择" onClick={clear}>
            <X size={15} />
          </button>
        </div>
      )}
      {editing && (
        <Modal
          title="阅读批注"
          subtitle="高亮和想法保存在这部作品中。"
          onClose={() => edit(null)}
        >
          <blockquote className="annotation-quote">{editing.quote}</blockquote>
          {!markCurrent(project, editing) && !editing.pdfRects.length && (
            <p className="inline-note">
              原文已修改，请重新核对位置。你的批注会保留。
            </p>
          )}
          <div className="mark-colors" role="group" aria-label="高亮颜色">
            {[
              { id: "yellow", label: "黄色" },
              { id: "green", label: "绿色" },
              { id: "blue", label: "蓝色" },
              { id: "pink", label: "粉色" },
            ].map((c) => (
              <button
                key={c.id}
                className={`mark-${c.id}`}
                aria-label={c.label}
                aria-pressed={editing.color === c.id}
                onClick={() => edit({ ...editing, color: c.id })}
              />
            ))}
          </div>
          <label className="annotation-note">
            写下你的想法
            <textarea
              aria-label="批注内容"
              rows={5}
              value={editing.note}
              onChange={(e) => edit({ ...editing, note: e.target.value })}
              placeholder="可以只保留高亮，也可以写下批注…"
            />
          </label>
          <footer>
            {project.readingMarks.some((m) => m.id === editing.id) && (
              <Button
                variant="ghost"
                busy={saving}
                onClick={async () => {
                  setSaving(true);
                  const p = await actions.mutate({
                    type: "deleteReadingMark",
                    mark_id: editing.id,
                  });
                  setSaving(false);
                  if (p) edit(null);
                }}
              >
                <Trash2 size={15} />
                删除
              </Button>
            )}
            <Button onClick={() => edit(null)}>取消</Button>
            <Button
              variant="primary"
              busy={saving}
              onClick={async () => {
                setSaving(true);
                const p = await actions.mutate({
                  type: "readingMark",
                  mark: editing,
                });
                setSaving(false);
                if (p) edit(null);
              }}
            >
              保存批注
            </Button>
          </footer>
        </Modal>
      )}
    </>
  );
  return { collect, select, edit, ui, clear };
}

export function markedText(
  text: string,
  start: number,
  marks: ReadingMark[],
  edit: (m: ReadingMark) => void,
  footnotes: BookContent["footnotes"] = [],
  showFootnote: (s: string) => void = () => {},
) {
  const end = start + text.length,
    relevant = marks.filter((m) => m.start < end && m.end > start);
  const refs = footnotes.filter((n) => n.start < end && n.end > start);
  if (!relevant.length && !refs.length) return text || "\u200b";
  const boundaries = [
    ...new Set([
      start,
      end,
      ...relevant.flatMap((m) => [
        Math.max(start, m.start),
        Math.min(end, m.end),
      ]),
      ...refs.flatMap((n) => [Math.max(start, n.start), Math.min(end, n.end)]),
    ]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((a, i) => {
    const b = boundaries[i + 1],
      mark = relevant.find((m) => m.start <= a && m.end >= b),
      content = text.slice(a - start, b - start);
    const footnote = refs.find((n) => n.start <= a && n.end >= b);
    if (footnote)
      return (
        <span
          key={a}
          className="footnote-ref"
          role="button"
          tabIndex={0}
          title="查看脚注"
          onClick={() => showFootnote(footnote.text)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              showFootnote(footnote.text);
            }
          }}
        >
          {content}
        </span>
      );
    return mark ? (
      <mark
        key={a}
        data-mark-id={mark.id}
        className={`reading-highlight mark-${mark.color}`}
        title={mark.note || "点击编辑批注"}
        onClick={() => {
          if (window.getSelection()?.isCollapsed !== false) edit(mark);
        }}
      >
        {content}
      </mark>
    ) : (
      <span key={a}>{content}</span>
    );
  });
}
export interface ReadingSearchResult {
  chapterId: string;
  offset: number;
  label: string;
  snippet: string;
}
export function ReadingLibrary({
  project,
  actions,
  children,
  goto,
  edit,
  pdfSearch,
}: {
  project: Project;
  actions: Actions;
  children: ReactNode;
  goto: (cid: string, offset: number) => void;
  edit: (m: ReadingMark) => void;
  pdfSearch?: (
    query: string,
    signal: AbortSignal,
  ) => Promise<ReadingSearchResult[]>;
}) {
  const [tab, setTab] = useState("contents"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ReadingSearchResult[]>([]),
    [busy, setBusy] = useState(false);
  const cancel = useRef<AbortController | null>(null);
  useEffect(() => () => cancel.current?.abort(), []);
  const search = async () => {
    cancel.current?.abort();
    const controller = new AbortController();
    cancel.current = controller;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setBusy(true);
    try {
      if (pdfSearch) {
        const found = await pdfSearch(q, controller.signal);
        if (!controller.signal.aborted) setResults(found);
      } else {
        const found: ReadingSearchResult[] = [];
        for (const c of project.chapters) {
          const body = c.working.toLocaleLowerCase(),
            needle = q.toLocaleLowerCase();
          let i = body.indexOf(needle);
          while (i >= 0 && found.length < 200) {
            found.push({
              chapterId: c.id,
              offset: i,
              label: c.title,
              snippet: c.working.slice(Math.max(0, i - 20), i + q.length + 40),
            });
            i = body.indexOf(needle, i + Math.max(1, needle.length));
          }
        }
        setResults(found);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        await actions.perform(async () => {
          throw e;
        });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <aside className="reader-toc reader-library">
      <div className="reader-library-tabs">
        {[
          { id: "contents", name: "目录" },
          { id: "marks", name: "批注" },
          { id: "search", name: "搜索" },
        ].map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            className={tab === t.id ? "selected" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tab === "contents" && children}
      {tab === "marks" && (
        <>
          <div className="reader-notes-heading">
            <h3>高亮与批注 · {project.readingMarks.length}</h3>
            <Button
              variant="ghost"
              aria-label="导出批注"
              onClick={() =>
                void actions.perform(async () => {
                  if (
                    await command<boolean>("export_reading_notes", {
                      projectId: project.id,
                    })
                  )
                    actions.notice("阅读批注已导出。");
                })
              }
            >
              <Download size={14} />
            </Button>
          </div>
          {!project.readingMarks.length && (
            <p>选中文字后高亮或写批注。扫描 PDF 也可以框选区域。</p>
          )}
          {project.readingMarks.map((m) => (
            <div key={m.id} className="reading-note-card">
              <button
                onClick={() => {
                  if (markCurrent(project, m))
                    goto(
                      m.chapterId,
                      m.pdfRects.length ? m.pdfRects[0].page - 1 : m.start,
                    );
                  else actions.notice("原文已修改，请重新核对批注位置。");
                }}
              >
                <i className={`mark-${m.color}`} />
                <strong>{m.quote || "区域批注"}</strong>
              </button>
              {m.note && <p>{m.note}</p>}
              {!markCurrent(project, m) && <small>原文已修改 · 批注保留</small>}
              <button className="note-edit" onClick={() => edit(m)}>
                编辑批注
              </button>
            </div>
          ))}
        </>
      )}
      {tab === "search" && (
        <>
          <form
            className="reader-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input
              aria-label="搜索书籍内容"
              placeholder="搜索全书内容…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button aria-label="开始搜索" busy={busy}>
              <Search size={15} />
            </Button>
          </form>
          <p>
            {busy
              ? "正在搜索…"
              : `${results.length} 个结果${results.length === 200 ? "（显示前 200 项）" : ""}`}
            {project.pdfBook && " · 扫描页需有文字层才能搜索"}
          </p>
          {results.map((r, i) => (
            <button
              key={i}
              className="reading-search-result"
              onClick={() => goto(r.chapterId, r.offset)}
            >
              <small>{r.label}</small>
              <span>{r.snippet}</span>
            </button>
          ))}
        </>
      )}
    </aside>
  );
}
