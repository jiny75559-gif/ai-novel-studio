import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
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
import type { Project, ReadingMark, PdfRect, BookContent, ReaderState } from "./domain";
import { Button } from "./components";
import { command } from "./bridge";
import { ReadingAnnotationEditor } from "./ReadingAnnotationEditor";
import { readTextSelection, rowOf, sameRows, selectionRows } from "./text-selection";

export const markCurrent = (p: Project, m: ReadingMark) =>
  !!p.pdfBook ||
  p.chapters
    .find((c) => c.id === m.chapterId)
    ?.working.slice(m.start, m.end) === m.quote;
export type MarkSelection = Pick<
  ReadingMark,
  "chapterId" | "start" | "end" | "quote" | "pdfRects"
>;
export function useReadingMarks(
  project: Project,
  actions: Actions,
  /**
   * RF-REV-402：正文根节点（文本阅读器的 .book-stage）。提供后启用统一选区生命周期：
   * selectionchange 实时同步键盘/程序选区、正文外 mouseup 与失焦后采集、端点页块保护、原生复制取原文。
   * PDF 阅读器不传，沿用 mouseup 采集。
   */
  rootRef?: RefObject<HTMLElement | null>,
) {
  const [selection, setSelection] = useState<MarkSelection | null>(null);
  /** 只在内容真正变化时更新，避免 selectionchange 高频触发无意义重渲染 */
  const select = (next: MarkSelection | null) =>
    setSelection((prev) =>
      prev === next ||
      (prev &&
        next &&
        prev.chapterId === next.chapterId &&
        prev.start === next.start &&
        prev.end === next.end &&
        prev.quote === next.quote &&
        prev.pdfRects.length === 0 &&
        next.pdfRects.length === 0)
        ? prev
        : next,
    );
  const [editing, setEditing] = useState<ReadingMark | null>(null);
  const edit = (mark: ReadingMark | null) => setEditing(mark ? { ...mark } : null);
  const [saving, setSaving] = useState(false);
  /** 用户正在用鼠标拖动选择：mousedown 后、mouseup/失焦前不清除原生 Selection，也不中途采集 */
  const selecting = useRef(false);
  /** 鼠标按下时所在页块（拖动初期选区仍折叠时也要保护起点） */
  const dragRow = useRef<number | null>(null);
  /**
   * 需要保持挂载的选区端点页块（anchor/focus，最多 2 个）。
   * 用 state 而不是 ref：端点变化必须驱动 Reader 重新计算挂载行。
   */
  const [protectedRows, setProtectedRows] = useState<number[]>([]);
  const updateRows = (rows: number[]) =>
    setProtectedRows((prev) => (sameRows(prev, rows) ? prev : rows));
  const projectRef = useRef(project);
  projectRef.current = project;

  /** 文本阅读器：按当前原生选区同步端点保护与 MarkSelection（键盘/鼠标/程序选区共用） */
  const sync = (root: HTMLElement) => {
    const s = window.getSelection();
    const rows = selectionRows(root, s);
    if (selecting.current && dragRow.current !== null) rows.push(dragRow.current);
    const active = selecting.current || (!!s && !s.isCollapsed && rows.length > 0);
    updateRows(active ? [...new Set(rows)].sort((a, b) => a - b) : []);
    if (selecting.current) return; // 拖动中：松开时统一采集，避免工具栏闪烁
    const r = readTextSelection(root, projectRef.current.chapters, s);
    select(r ? { ...r, pdfRects: [] } : null);
  };

  const clear = () => {
    select(null);
    dragRow.current = null;
    updateRows([]); // 清除页块保护
    // 仅在没有活动选择时清除原生 Selection，避免打断跨页拖动
    const sel = window.getSelection();
    if (sel && !selecting.current) {
      sel.removeAllRanges();
    }
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
    selecting.current = false; // 捕获完成，允许后续清除
    dragRow.current = null;
    if (rootRef) {
      sync(root);
      return;
    }
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
      const r = readTextSelection(root, project.chapters, s);
      if (r) select({ ...r, pdfRects: [] });
    }
  };

  /** 原生复制（Ctrl+C/右键）：中间页块可能已虚拟化卸载，剪贴板写入完整原文 working.slice(start,end) */
  const copy = (e: ClipboardEvent<HTMLElement>) => {
    const root = rootRef?.current;
    if (!root || project.pdfBook) return;
    const r = readTextSelection(root, project.chapters);
    if (!r) return;
    e.clipboardData.setData("text/plain", r.quote);
    e.preventDefault();
  };

  // 统一选区生命周期：mousedown 标记拖动 → selectionchange 同步端点/键盘选区 → mouseup（含正文外）/失焦收尾。
  // 不使用延时计时器，旧的松开事件不会干扰新一次选择。
  useEffect(() => {
    const root = () => rootRef?.current || null;
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const r = root();
      const inText = r
        ? r.contains(target) &&
          !target.closest("button, input, select, textarea, [role=button]")
        : !!target.closest(".book-scroll-row, .book-leaf, .pdf-page");
      if (!inText) return;
      selecting.current = true;
      dragRow.current = rowOf(target);
      if (r) updateRows(dragRow.current === null ? [] : [dragRow.current]);
    };
    const finish = () => {
      if (!selecting.current) return;
      selecting.current = false;
      dragRow.current = null;
      const r = root();
      if (r) sync(r); // 正文外松开、失焦：仍按当前真实选区采集与保护
    };
    const handleSelectionChange = () => {
      const r = root();
      if (r) sync(r);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
    if (rootRef) document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [rootRef]);

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
        <ReadingAnnotationEditor
          editing={editing}
          project={project}
          actions={actions}
          onClose={() => {
            edit(null);
          }}
          saving={saving}
          onSave={async (mark) => {
            setSaving(true);
            try {
            const p = await actions.mutate({
              type: "readingMark",
              mark,
            });
            return !!p;
            } finally { setSaving(false); }
          }}
          onDelete={async (id) => {
            setSaving(true);
            const p = await actions.mutate({
              type: "deleteReadingMark",
              mark_id: id,
            });
            setSaving(false);
            if (p) {
              edit(null);
            }
          }}
        />
      )}
    </>
  );
  return { collect, copy, select, edit, ui, clear, protectedRows, selection };
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
  bookmarks,
  onBookmarkDelete,
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
  bookmarks: ReaderState["bookmarks"];
  onBookmarkDelete: (id: string) => void;
}) {
  const [tab, setTab] = useState("contents"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<ReadingSearchResult[]>([]),
    [busy, setBusy] = useState(false),
    [markSort, setMarkSort] = useState<"position" | "time-latest" | "time-earliest">("position");
  const cancel = useRef<AbortController | null>(null);
  const noteClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelNoteClick = () => {
    if (noteClick.current) clearTimeout(noteClick.current);
    noteClick.current = null;
  };
  useEffect(() => () => { if (noteClick.current) clearTimeout(noteClick.current); }, []);
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
          { id: "bookmarks", name: "书签" },
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
      {tab === "bookmarks" && (
        <>
          <h3>书签</h3>
          {bookmarks.length === 0 && (
            <p>翻到喜欢的一页，添加书签。</p>
          )}
          {bookmarks.map((b) => (
            <div className="reader-bookmark" key={b.id}>
              <button onClick={() => goto(b.chapterId, b.offset)}>
                {b.label}
              </button>
              <button
                aria-label="删除书签"
                onClick={() => onBookmarkDelete(b.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </>
      )}
      {tab === "marks" && (
        <>
          <div className="reader-notes-heading">
            <h3>高亮与批注 · {project.readingMarks.length}</h3>
            <div className="reader-marks-controls">
              <select
                aria-label="批注排序"
                value={markSort}
                onChange={(e) =>
                  setMarkSort(e.target.value as "position" | "time-latest" | "time-earliest")
                }
              >
                <option value="position">按书中顺序</option>
                <option value="time-latest">按时间 · 最新</option>
                <option value="time-earliest">按时间 · 最早</option>
              </select>
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
          </div>
          {!project.readingMarks.length && (
            <p>选中文字后高亮或写批注。扫描 PDF 也可以框选区域。</p>
          )}
          {[...project.readingMarks]
            .sort((a, b) => {
              if (markSort === "time-latest" || markSort === "time-earliest") {
                const aTime = a.createdAt ?? 0;
                const bTime = b.createdAt ?? 0;
                if (aTime === 0 && bTime === 0) {
                  // 都未知时回退到书中顺序
                  if (project.pdfBook) {
                    const aPage = a.pdfRects[0]?.page || 0;
                    const bPage = b.pdfRects[0]?.page || 0;
                    if (aPage !== bPage) return aPage - bPage;
                    const aY = a.pdfRects[0]?.y || 0;
                    const bY = b.pdfRects[0]?.y || 0;
                    if (Math.abs(aY - bY) > 0.01) return aY - bY;
                    return (a.pdfRects[0]?.x || 0) - (b.pdfRects[0]?.x || 0);
                  } else {
                    const aIdx = project.chapters.findIndex(
                      (c) => c.id === a.chapterId,
                    );
                    const bIdx = project.chapters.findIndex(
                      (c) => c.id === b.chapterId,
                    );
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return a.start - b.start;
                  }
                }
                if (aTime === 0) return 1; // 未知时间排后
                if (bTime === 0) return -1;
                // time-latest: 新的排前；time-earliest: 旧的排前
                return markSort === "time-latest" ? bTime - aTime : aTime - bTime;
              }
              // 按书中顺序：章节顺序 → UTF-16 起点；PDF：原页 → y → x
              if (project.pdfBook) {
                const aPage = a.pdfRects[0]?.page || 0;
                const bPage = b.pdfRects[0]?.page || 0;
                if (aPage !== bPage) return aPage - bPage;
                const aY = a.pdfRects[0]?.y || 0;
                const bY = b.pdfRects[0]?.y || 0;
                if (Math.abs(aY - bY) > 0.01) return aY - bY;
                return (a.pdfRects[0]?.x || 0) - (b.pdfRects[0]?.x || 0);
              } else {
                const aIdx = project.chapters.findIndex(
                  (c) => c.id === a.chapterId,
                );
                const bIdx = project.chapters.findIndex(
                  (c) => c.id === b.chapterId,
                );
                if (aIdx !== bIdx) return aIdx - bIdx;
                return a.start - b.start;
              }
            })
            .map((m) => {
              const chapter = project.chapters.find(
                (c) => c.id === m.chapterId,
              );
              return (
                <div
                  key={m.id}
                  className="reading-note-card"
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    cancelNoteClick();
                    edit(m);
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelNoteClick();
                      const locate = () => {
                        if (markCurrent(project, m))
                          goto(
                            m.chapterId,
                            m.pdfRects.length ? m.pdfRects[0].page - 1 : m.start,
                          );
                        else
                          actions.notice("原文已修改，请重新核对批注位置。");
                      };
                      if (e.detail === 0) locate();
                      else noteClick.current = setTimeout(locate, 350);
                    }}
                  >
                    <i className={`mark-${m.color}`} />
                    <strong>{m.quote || "区域批注"}</strong>
                  </button>
                  {m.note && <p>{m.note}</p>}
                  <small>
                    {chapter?.title || (m.pdfRects.length ? `第 ${m.pdfRects[0].page} 页` : "位置未知")}
                    {!markCurrent(project, m) && " · 原文已修改 · 批注保留"}
                  </small>
                  <button
                    className="note-edit"
                    onClick={() => edit(m)}
                  >
                    编辑批注
                  </button>
                </div>
              );
            })}
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
