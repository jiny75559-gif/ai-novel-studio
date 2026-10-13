import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BookOpen,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize2,
  Minimize2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Actions } from "./App";
import type { Project, ReaderState } from "./domain";
import { Button } from "./components";
import { BookPage, pageAt } from "./reader-pagination";
import { paginateBook } from "./book-pagination";
import { MediaImage, preloadMedia } from "./MediaImage";
import { ReaderPreferences } from "./ReaderPreferences";
import {
  ReadingLibrary,
  useReadingMarks,
  markedText,
  markCurrent,
} from "./ReadingTools";
import { BookContents } from "./BookContents";
import { Modal } from "./components";
import { errorMessage } from "./bridge";

export function Reader({
  project,
  chapterId,
  actions,
}: {
  project: Project;
  chapterId: string;
  actions: Actions;
}) {
  const chapter =
    project.chapters.find((c) => c.id === chapterId) || project.chapters[0];
  const marks = useReadingMarks(project, actions);
  const [footnote, setFootnote] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(100);
  const [settings, setSettings] = useState<ReaderState>(() => ({
    ...project.reader,
    chapterId: chapter?.id || "",
    offset:
      project.reader.chapterId === chapter?.id ? project.reader.offset : 0,
  }));
  const [pages, setPages] = useState<BookPage[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toc, setToc] = useState(false);
  const [focus, setFocus] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const pageCache = useRef(new Map<string, BookPage[]>());
  const [fit, setFit] = useState(1);
  const preferencesRef = useRef<HTMLDivElement>(null);
  const preferencesButton = useRef<HTMLButtonElement>(null);
  const preferencesOpen = useRef(preferences);
  preferencesOpen.current = preferences;
  const stage = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const saved = useRef(settings);
  const saveFn = useRef(actions.saveReader);
  saveFn.current = actions.saveReader;
  const anchor = useRef(settings.offset);
  const pendingChapter = useRef("");
  const touch = useRef(0);
  const double = settings.layout === "double";
  const step = double ? 2 : 1;
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () =>
      setFit(
        Math.min(
          1,
          Math.max(0.3, (element.clientWidth - 104) / (double ? 860 : 430)),
          Math.max(0.3, (element.clientHeight - 64) / 640),
        ),
      );
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [double]);
  useEffect(() => {
    if (!preferences) return;
    preferencesRef.current
      ?.querySelector<HTMLButtonElement>(".reader-settings-close")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (
        e.target instanceof Node &&
        !preferencesRef.current?.contains(e.target)
      )
        setPreferences(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPreferences(false);
        preferencesButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [preferences]);
  const artworkKey = project.artwork
    .filter(
      (a) => a.approved && a.kind === "chapter" && a.chapterId === chapter?.id,
    )
    .map((a) => a.imageId)
    .join(",");
  const content = project.bookContent.find((c) => c.chapterId === chapter?.id);
  const layoutKey = `${settings.fontFamily}/${settings.fontSize}/${settings.lineHeight}/${settings.paragraphSpacing}/${settings.pageMargin}`;
  const cacheKey = (c: typeof chapter) =>
    c
      ? `${c.id}/${c.editRevision}/${c.working.length}/${layoutKey}/${project.bookContent
          .find((b) => b.chapterId === c.id)
          ?.images.map((i) => i.imageId)
          .join(",")}/${project.artwork
          .filter(
            (a) => a.chapterId === c.id && a.approved && a.kind === "chapter",
          )
          .map((a) => a.imageId)
          .join(",")}`
      : "";
  useEffect(() => {
    if (pendingChapter.current && chapter?.id !== pendingChapter.current)
      return;
    if (pendingChapter.current === chapter?.id) pendingChapter.current = "";
    if (!chapter || settings.chapterId === chapter.id) return;
    anchor.current = 0;
    setSettings((s) => ({ ...s, chapterId: chapter.id, offset: 0 }));
  }, [chapter?.id, settings.chapterId]);
  useEffect(() => {
    if (!chapter || !probe.current) return;
    let aborted = false;
    const measure = probe.current;
    setBusy(true);
    const key = cacheKey(chapter);
    const cached = pageCache.current.get(key);
    void (
      cached
        ? Promise.resolve(cached)
        : paginateBook(
            chapter.working,
            measure,
            content,
            artworkKey ? artworkKey.split(",") : [],
            () => aborted,
          )
    )
      .then((result) => {
        if (aborted) return;
        const next = result;
        pageCache.current.set(key, next);
        if (pageCache.current.size > 6)
          pageCache.current.delete(pageCache.current.keys().next().value!);
        setPages(next);
        const image = settings.imageId
          ? next.findIndex((p) => p.imageId === settings.imageId)
          : -1;
        const page = image >= 0 ? image : pageAt(next, anchor.current);
        setIndex(Math.floor(page / step) * step);
        setBusy(false);
      })
      .catch((e) => {
        if (!aborted) {
          actions.notice(errorMessage(e));
          setBusy(false);
        }
      });
    return () => {
      aborted = true;
    };
  }, [
    chapter?.id,
    chapter?.working,
    settings.fontSize,
    settings.lineHeight,
    layoutKey,
    step,
    artworkKey,
  ]);
  useEffect(() => {
    if (!chapter || busy || index < pages.length - 4 || !probe.current) return;
    const next =
      project.chapters[
        project.chapters.findIndex((c) => c.id === chapter.id) + 1
      ];
    if (!next) return;
    const key = cacheKey(next);
    if (pageCache.current.has(key)) return;
    let cancelled = false;
    const clone = probe.current.cloneNode(false) as HTMLElement;
    clone.setAttribute("aria-hidden", "true");
    document.body.append(clone);
    const timer = setTimeout(() => {
      void paginateBook(
        next.working,
        clone,
        project.bookContent.find((c) => c.chapterId === next.id),
        project.artwork
          .filter(
            (a) =>
              a.chapterId === next.id && a.approved && a.kind === "chapter",
          )
          .map((a) => a.imageId),
        () => cancelled,
      )
        .then((result) => {
          if (!cancelled) {
            pageCache.current.set(key, result);
            if (pageCache.current.size > 6)
              pageCache.current.delete(pageCache.current.keys().next().value!);
            for (const p of result.filter((p) => p.imageId).slice(0, 2))
              void preloadMedia(p.imageId!).catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => clone.remove());
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clone.remove();
    };
  }, [chapter?.id, index, pages.length, busy, layoutKey]);
  useEffect(() => {
    saved.current = settings;
    void saveFn.current(project.id, settings);
  }, [settings, project.id]);
  useEffect(
    () => () => {
      void saveFn.current(project.id, saved.current);
    },
    [project.id],
  );
  useEffect(() => {
    document
      .querySelector(".app-shell")
      ?.classList.toggle("reader-focus", focus);
    return () =>
      document.querySelector(".app-shell")?.classList.remove("reader-focus");
  }, [focus]);
  const turn = async (direction: number) => {
    if (busy || !chapter) return;
    marks.clear();
    const next = index + direction * step;
    if (next >= 0 && next < pages.length) {
      setIndex(next);
      anchor.current = pages[next].start;
      setSettings((s) => ({
        ...s,
        offset: anchor.current,
        imageId: pages[next].imageId || "",
      }));
      return;
    }
    const chapterIndex =
      project.chapters.findIndex((c) => c.id === chapter.id) + direction;
    const target = project.chapters[chapterIndex];
    if (!target) return;
    const offset = direction < 0 ? target.working.length : 0;
    pendingChapter.current = target.id;
    anchor.current = offset;
    setSettings((s) => ({ ...s, chapterId: target.id, offset, imageId: "" }));
    await actions.navigate("reader", target.id);
  };
  const turnRef = useRef(turn);
  turnRef.current = turn;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        preferencesOpen.current ||
        document.querySelector('.modal[role="dialog"]') ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey
      )
        return;
      if (e.key === " " && (e.target as HTMLElement)?.closest("button")) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        void turnRef.current(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        void turnRef.current(-1);
      } else if (e.key === "Escape" && !preferencesOpen.current)
        setFocus(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const goto = async (cid: string, offset = 0) => {
    if (cid !== chapter?.id) pendingChapter.current = cid;
    anchor.current = offset;
    setSettings((s) => ({ ...s, chapterId: cid, offset, imageId: "" }));
    if (cid === chapter?.id) {
      const i = pageAt(pages, offset);
      setIndex(Math.floor(i / step) * step);
    }
    await actions.navigate("reader", cid);
  };
  const change = (patch: Partial<ReaderState>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const font: CSSProperties = {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    fontFamily: `"${settings.fontFamily}", serif`,
    width: 430 - settings.pageMargin * 2,
    height: 510,
    "--paragraph-spacing": `${settings.paragraphSpacing}px`,
  } as CSSProperties;
  const currentMarks = project.readingMarks.filter(
    (m) => m.chapterId === chapter?.id && markCurrent(project, m),
  );
  const notes =
    project.bookContent.find((c) => c.chapterId === chapter?.id)?.footnotes ||
    [];
  const lengths = useMemo(() => {
    let total = 0;
    const rows = project.chapters.map((c) => {
      const length = project.bookSource === "cbz" ? 1 : c.working.length;
      const row = { id: c.id, start: total, length };
      total += length;
      return row;
    });
    return { rows, total };
  }, [project.chapters, project.bookSource]);
  const currentPosition =
    (lengths.rows.find((c) => c.id === chapter?.id)?.start || 0) +
    (project.bookSource === "cbz" ? 1 : settings.offset);
  const fullProgress = lengths.total
    ? Math.min(1, currentPosition / lengths.total)
    : 0;
  const jumpProgress = (value: number) => {
    if (project.bookSource === "cbz") {
      const index = Math.max(
        0,
        Math.min(
          lengths.rows.length - 1,
          Math.round((value / 1000) * lengths.rows.length) - 1,
        ),
      );
      const target = lengths.rows[index];
      if (target) void goto(target.id, 0);
      return;
    }
    const offset = Math.round((value / 1000) * lengths.total),
      target =
        lengths.rows.find((c) => c.start + c.length > offset) ||
        lengths.rows.at(-1);
    if (target) void goto(target.id, Math.max(0, offset - target.start));
  };
  const zoom = (settings.zoom / 100) * fit;
  const width = double ? 860 : 430;
  const renderPage = (page: BookPage | undefined, n: number) => (
    <article
      className={`book-leaf ${n % 2 === 0 ? "left-leaf" : "right-leaf"}`}
      key={n}
    >
      <header>
        <span>{project.title}</span>
        <span>{chapter?.title}</span>
      </header>
      <div
        className="leaf-body"
        style={{ ...font, left: settings.pageMargin }}
        onClick={(e) => {
          const p = (e.target as HTMLElement).closest<HTMLElement>(
            "p[data-offset]",
          );
          if (!p || window.getSelection()?.isCollapsed === false) return;
          const r = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (!r) return;
          const before = document.createRange();
          before.setStart(p, 0);
          before.setEnd(r.startContainer, r.startOffset);
          const offset = +(p.dataset.offset || 0) + before.toString().length;
          const n = notes.find(
            (n) =>
              n.start <= offset &&
              n.end > offset &&
              chapter?.working.slice(n.start, n.end) === n.label,
          );
          if (n) setFootnote(n.text);
        }}
      >
        {page?.imageId ? (
          <div
            className="book-illustration-container"
            role="button"
            tabIndex={0}
            aria-label="放大查看插图"
            onClick={() => {
              setImageZoom(100);
              setImagePreview(page.imageId!);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                setImageZoom(100);
                setImagePreview(page.imageId!);
              }
            }}
          >
            <MediaImage
              id={page.imageId}
              alt={page.caption || `${chapter?.title} 插图`}
              className="book-illustration"
            />
          </div>
        ) : (
          page?.blocks.map((b) => (
            <p
              key={b.start}
              data-offset={b.start}
              data-end={b.end}
              className={`${b.continued ? "continued" : ""} ${!b.text.trim() ? "blank" : ""}`}
            >
              {markedText(
                b.text.replace(/\r?\n$/, ""),
                b.start,
                currentMarks,
                marks.edit,
                notes.filter(
                  (n) => chapter?.working.slice(n.start, n.end) === n.label,
                ),
                setFootnote,
              )}
            </p>
          ))
        )}
      </div>
      <footer>{page ? n + 1 : ""}</footer>
    </article>
  );
  return (
    <section className={`reader-view reader-${settings.theme}`}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-start">
          <Button
            variant="ghost"
            aria-label="目录与书签"
            aria-expanded={toc}
            onClick={() => setToc((v) => !v)}
          >
            <List size={17} />
            目录
          </Button>
        </div>
        <div className="reader-heading">
          <strong>{project.title}</strong>
          <span>{chapter?.title || "暂无章节"}</span>
        </div>
        <div className="reader-toolbar-end">
          <ReaderPreferences
            state={settings}
            change={change}
            open={preferences}
            setOpen={setPreferences}
            panelRef={preferencesRef}
            buttonRef={preferencesButton}
          />
          <Button
            variant="ghost"
            aria-label="专注阅读"
            title={focus ? "退出专注阅读 · Esc" : "专注阅读"}
            aria-pressed={focus}
            onClick={() => setFocus((v) => !v)}
          >
            {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </Button>
        </div>
      </div>
      <div className="reading-area">
        {toc && (
          <ReadingLibrary
            project={project}
            actions={actions}
            goto={(cid, offset) => void goto(cid, offset)}
            edit={marks.edit}
          >
            <h3>
              <BookOpen size={16} />
              {project.title}
            </h3>
            <BookContents
              project={project}
              chapterId={chapter?.id || ""}
              goto={(cid, offset) => void goto(cid, offset)}
            />
            <h3>书签</h3>
            {settings.bookmarks.length === 0 && (
              <p>翻到喜欢的一页，添加书签。</p>
            )}
            {settings.bookmarks.map((b) => (
              <div className="reader-bookmark" key={b.id}>
                <button onClick={() => void goto(b.chapterId, b.offset)}>
                  {b.label}
                </button>
                <button
                  aria-label="删除书签"
                  onClick={() =>
                    change({
                      bookmarks: settings.bookmarks.filter(
                        (x) => x.id !== b.id,
                      ),
                    })
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </ReadingLibrary>
        )}
        <div
          ref={stage}
          className="book-stage"
          data-chapter={chapter?.id}
          onMouseUp={(e) => marks.collect(e.currentTarget)}
          onTouchStart={(e) => {
            touch.current = e.changedTouches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const delta = e.changedTouches[0].clientX - touch.current;
            if (
              Math.abs(delta) > 70 &&
              window.getSelection()?.isCollapsed !== false
            )
              void turn(delta < 0 ? 1 : -1);
          }}
        >
          <button
            className="page-turn turn-left"
            aria-label="上一页"
            disabled={
              busy || (index === 0 && project.chapters[0]?.id === chapter?.id)
            }
            onClick={() => void turn(-1)}
          >
            <ChevronLeft size={28} />
          </button>
          <div
            className={`book-zoom-frame ${busy ? "paginating" : ""}`}
            style={{ width: width * zoom, height: 640 * zoom }}
          >
            <div
              className={`book-spread ${double ? "double" : "single"}`}
              style={{ width, transform: `scale(${zoom})` }}
            >
              {renderPage(pages[index], index)}
              {double && renderPage(pages[index + 1], index + 1)}
            </div>
          </div>
          <button
            className="page-turn turn-right"
            aria-label="下一页"
            disabled={
              busy ||
              (index + step >= pages.length &&
                project.chapters.at(-1)?.id === chapter?.id)
            }
            onClick={() => void turn(1)}
          >
            <ChevronRight size={28} />
          </button>
          {busy && <div className="reader-loading">正在排版…</div>}
        </div>
      </div>
      <div className="reader-status">
        <div className="reader-progress" aria-hidden="true">
          <i
            style={{
              width: `${pages.length ? Math.min(100, ((index + step) / pages.length) * 100) : 0}%`,
            }}
          />
        </div>
        <div className="reader-position">
          <input
            aria-label="阅读进度"
            type="range"
            min="0"
            max="1000"
            value={Math.round(fullProgress * 1000)}
            onChange={(e) => jumpProgress(+e.target.value)}
          />
          <span>
            {pages.length
              ? Math.min(100, Math.round(((index + step) / pages.length) * 100))
              : 0}
            %
          </span>
          <label>
            页
            <input
              aria-label="跳转页码"
              type="number"
              min="1"
              max={pages.length}
              key={`${chapter?.id}-${index}`}
              defaultValue={index + 1}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n =
                    Math.floor(
                      Math.max(
                        0,
                        Math.min(pages.length - 1, +e.currentTarget.value - 1),
                      ) / step,
                    ) * step;
                  setIndex(n);
                  anchor.current = pages[n]?.start || 0;
                  change({
                    offset: anchor.current,
                    imageId: pages[n]?.imageId || "",
                  });
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
        <span>
          全书 {Math.round(fullProgress * 100)}% ·{" "}
          {chapter?.title || "暂无章节"} ·{" "}
          {pages.length
            ? `${index + 1}${double && index + 1 < pages.length ? `–${index + 2}` : ""} / ${pages.length} 页`
            : ""}
        </span>
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              if (!chapter) return;
              const b = {
                id: crypto.randomUUID(),
                chapterId: chapter.id,
                offset: pages[index]?.start || 0,
                label: `${chapter.title} · 第 ${index + 1} 页`,
              };
              change({ bookmarks: [...settings.bookmarks, b] });
              actions.notice("书签已添加。");
            }}
          >
            <BookmarkPlus size={15} />
            添加书签
          </Button>
          <Button
            variant="ghost"
            onClick={() => void actions.navigate("writer", chapter?.id)}
          >
            <Pencil size={14} />
            编辑本章
          </Button>
          <small>← → 翻页</small>
        </div>
      </div>
      {marks.ui}
      {imagePreview && (
        <Modal title="阅读插图" wide onClose={() => setImagePreview(null)}>
          <label className="image-preview-zoom">
            图片缩放
            <input
              aria-label="图片缩放"
              type="range"
              min="100"
              max="300"
              step="25"
              value={imageZoom}
              onChange={(e) => setImageZoom(+e.target.value)}
            />
            <span>{imageZoom}%</span>
          </label>
          <div className="reader-image-preview-scroll">
            <div style={{ width: `${imageZoom}%` }}>
              <MediaImage
                id={imagePreview}
                alt="放大阅读插图"
                className="reader-image-preview"
              />
            </div>
          </div>
        </Modal>
      )}
      {footnote && (
        <Modal title="脚注" onClose={() => setFootnote(null)}>
          <p className="footnote-content">{footnote}</p>
        </Modal>
      )}
      <div
        ref={probe}
        className="leaf-body page-probe"
        style={font}
        aria-hidden="true"
      />
    </section>
  );
}
