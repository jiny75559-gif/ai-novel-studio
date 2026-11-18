import {
  useEffect,
  useLayoutEffect,
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
} from "lucide-react";
import type { Actions } from "./App";
import type { BandSlot, PageBand, Project, ReaderFontInfo, ReaderState } from "./domain";
import { withReaderDefaults } from "./domain";
import { Button } from "./components";
import { BookPage, pageAt } from "./reader-pagination";
import { paginateBook } from "./book-pagination";
import { INDEX_ENGINE, locateGlobal, visibleGlobalPages } from "./book-index";
import { useBookIndex } from "./useBookIndex";
import { documentFontsSignature } from "./font-signature";
import { headingFactory, headingKey, headingStyle } from "./chapter-heading";
import { MediaImage, preloadMedia } from "./MediaImage";
import { ReaderPreferences } from "./ReaderPreferences";
import { useFontLoad, useFontStoreVersion, fontStore } from "./useFontLoader";
import { fontLabels, fontStack, resolveTitleFamily } from "./font-family";
import { FontLoadNotice } from "./FontManager";
import { mountedRows } from "./text-selection";
import {
  ReadingLibrary,
  useReadingMarks,
  markedText,
  markCurrent,
} from "./ReadingTools";
import { BookContents } from "./BookContents";
import { Modal } from "./components";
import { errorMessage, command } from "./bridge";

export function Reader({
  project,
  chapterId,
  actions,
  readerNavCollapsed,
  preferencesLoaded = true,
  preferencesFailed = false,
  onReaderNavCollapse,
}: {
  project: Project;
  chapterId: string;
  actions: Actions;
  readerNavCollapsed?: boolean;
  /** 偏好加载完成前禁用导航切换，避免产生无法持久化的操作 */
  preferencesLoaded?: boolean;
  /** 偏好读取失败：保持禁用，提示使用重试入口而不是显示“正在加载” */
  preferencesFailed?: boolean;
  onReaderNavCollapse?: (collapsed: boolean) => void;
}) {
  const chapter =
    project.chapters.find((c) => c.id === chapterId) || project.chapters[0];
  const stage = useRef<HTMLDivElement>(null);
  // RF-REV-402：以正文根节点启用统一选区生命周期（键盘扩选、正文外松开、端点保护、原生复制）
  const marks = useReadingMarks(project, actions, stage);
  const [footnote, setFootnote] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(100);
  const [settings, setSettings] = useState<ReaderState>(() => ({
    ...withReaderDefaults(project.reader),
    chapterId: chapter?.id || "",
    offset:
      project.reader.chapterId === chapter?.id ? project.reader.offset : 0,
  }));
  const [pages, setPages] = useState<BookPage[]>([]);
  /** pages 所属章节：切章后、新章排版完成前 pages 仍是旧章，不能拿来算全书页码或翻页 */
  const [pagesChapter, setPagesChapter] = useState("");
  const pagesChapterRef = useRef(pagesChapter);
  pagesChapterRef.current = pagesChapter;
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toc, setToc] = useState(readerNavCollapsed !== true);
  const [focus, setFocus] = useState(false);
  const [preferences, setPreferences] = useState(false);

  // 同步迟到的偏好，但不覆盖用户已操作的状态
  const userToggled = useRef(false);
  useEffect(() => {
    if (readerNavCollapsed !== undefined && !userToggled.current) {
      setToc(!readerNavCollapsed);
    }
  }, [readerNavCollapsed]);
  const pageCache = useRef(new Map<string, BookPage[]>());
  const [fit, setFit] = useState(1);
  const preferencesRef = useRef<HTMLDivElement>(null);
  const preferencesButton = useRef<HTMLButtonElement>(null);
  const preferencesOpen = useRef(preferences);
  preferencesOpen.current = preferences;
  /** 连续滚动容器（仅 readingMode=scroll 时挂载） */
  const scroller = useRef<HTMLDivElement>(null);
  const scrollModeRef = useRef(false);
  const probe = useRef<HTMLDivElement>(null);
  const indexHost = useRef<HTMLDivElement>(null);
  /** 全书跳页：目标章排版完成后按会话内页序定位（处理同 imageId/同 offset 歧义） */
  const pendingLocal = useRef<{ chapterId: string; localIndex: number; count: number } | null>(null);
  const saved = useRef(settings);
  const saveFn = useRef(actions.saveReader);
  saveFn.current = actions.saveReader;
  const anchor = useRef(settings.offset);
  const pendingChapter = useRef("");
  const touch = useRef(0);
  const double = settings.layout === "double";
  const step = double ? 2 : 1;
  /** REQ-FE-306：连续滚动（文本）。位置仍是 chapterId + UTF-16 offset/imageId，不保存 scrollTop */
  const scroll = settings.readingMode === "scroll";
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () =>
      setFit(
        scroll
          ? // 滚动模式纵向可滚，只按宽度适配
            Math.min(
              1,
              Math.max(0.3, (element.clientWidth - 72) / (double ? 860 : 430)),
            )
          : Math.min(
              1,
              Math.max(0.3, (element.clientWidth - 104) / (double ? 860 : 430)),
              Math.max(0.3, (element.clientHeight - 64) / 640),
            ),
      );
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [double, scroll]);
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
  const titleKey = headingKey(settings.titleStyle);
  // 实际测量签名：取自 probe 的计算样式与版心尺寸，并包含字体就绪状态；
  // 字体加载完成会改变签名，使旧分页（含会话内全书索引）失效。缩放不改变版心，不参与。
  const [layoutSig, setLayoutSig] = useState("");
  const [fontEpoch, setFontEpoch] = useState(0);
  // RF-REV-405：自定义字体加载/失败/重建不一定产生 document.fonts 的 loadingdone 事件，
  // 以全局字体存储版本显式驱动签名重算（签名含实际别名的 FontFace 身份与状态）。
  const fontStoreVersion = useFontStoreVersion();
  const bodyLoad = useFontLoad(settings.fontFamily, true);
  const titleToken =
    settings.titleStyle.enabled && settings.titleStyle.fontFamily !== "inherit"
      ? settings.titleStyle.fontFamily
      : "";
  const titleLoad = useFontLoad(titleToken, true);
  useEffect(() => {
    const fonts = document.fonts;
    const bump = () => setFontEpoch((e) => e + 1);
    fonts.addEventListener("loadingdone", bump);
    fonts.addEventListener("loadingerror", bump);
    return () => {
      fonts.removeEventListener("loadingdone", bump);
      fonts.removeEventListener("loadingerror", bump);
    };
  }, []);
  useLayoutEffect(() => {
    const p = probe.current;
    if (!p) return;
    const cs = getComputedStyle(p);
    const spec = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let ready = true;
    try {
      ready = document.fonts.check(spec, "风雨归来");
    } catch {
      ready = true;
    }
    setLayoutSig(
      [
        INDEX_ENGINE,
        spec,
        cs.lineHeight,
        cs.letterSpacing,
        cs.wordSpacing,
        cs.getPropertyValue("--paragraph-spacing").trim(),
        p.clientWidth,
        p.clientHeight,
        ready ? "font-ready" : "font-pending",
        // 独立章节标题样式（未启用为 off，保持旧签名语义）
        headingKey(settings.titleStyle),
        // 字体身份：同名字体替换前后 check 均为 true 时也能使签名变化（含标题字体）。
        // RF-REV-404：标题参数使用解析后的真实 CSS 别名（inherit 即正文实际字体），不能用 font:<id> token
        documentFontsSignature(
          cs.fontFamily,
          settings.titleStyle.enabled
            ? resolveTitleFamily(settings.titleStyle.fontFamily, settings.fontFamily)
            : "",
        ),
      ].join("|"),
    );
  }, [layoutKey, fontEpoch, fontStoreVersion, settings.theme, titleKey]);
  const layoutSigRef = useRef(layoutSig);
  layoutSigRef.current = layoutSig;
  const bookIndex = useBookIndex({
    project,
    layoutSig,
    templateRef: probe,
    hostRef: indexHost,
    priorityId: chapter?.id || "",
    titleStyle: settings.titleStyle,
  });
  // 可见页、预取与全书索引共用同一章节内容 key（正文散列/修订/图片 offset·caption/获批插图）+ 排版签名
  const cacheKey = (c: typeof chapter) =>
    c ? `${c.id}\u0000${bookIndex.keyOf(c.id)}\u0000${layoutSig}` : "";
  const contentKey = chapter ? bookIndex.keyOf(chapter.id) : "";
  useEffect(() => {
    if (pendingChapter.current && chapter?.id !== pendingChapter.current)
      return;
    if (pendingChapter.current === chapter?.id) pendingChapter.current = "";
    if (!chapter || settings.chapterId === chapter.id) return;
    anchor.current = 0;
    setSettings((s) => ({ ...s, chapterId: chapter.id, offset: 0 }));
  }, [chapter?.id, settings.chapterId]);
  useEffect(() => {
    if (!chapter || !probe.current || !layoutSig) return;
    let aborted = false;
    const measure = probe.current;
    const sig = layoutSig;
    const measuredKey = contentKey;
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
            headingFactory(chapter.title, settings.titleStyle),
          )
    )
      .then((result) => {
        if (aborted) return;
        const next = result;
        pageCache.current.set(key, next);
        if (pageCache.current.size > 6)
          pageCache.current.delete(pageCache.current.keys().next().value!);
        setPages(next);
        setPagesChapter(chapter.id);
        bookIndex.seed(sig, chapter.id, measuredKey, next);
        const image = settings.imageId
          ? next.findIndex((p) => p.imageId === settings.imageId)
          : -1;
        let page = image >= 0 ? image : pageAt(next, anchor.current);
        const target = pendingLocal.current;
        if (target && target.chapterId === chapter.id) {
          pendingLocal.current = null;
          if (target.count === next.length && target.localIndex < next.length)
            page = target.localIndex;
        }
        setIndex(Math.floor(page / step) * step);
        setBusy(false);
      })
      .catch((e) => {
        if (!aborted) {
          actions.notice(errorMessage(e));
          // 新章排版失败：不再显示旧章内容冒充本章，允许翻到相邻章节
          if (pagesChapterRef.current !== chapter.id) {
            setPages([]);
            setPagesChapter(chapter.id);
          }
          setBusy(false);
        }
      });
    return () => {
      aborted = true;
    };
  }, [
    chapter?.id,
    // 统一内容 key：正文/修订/图片 offset·caption/获批插图任一变化都重新测量可见页
    contentKey,
    layoutSig,
    step,
  ]);
  // RF-REV-402：重排（字体加载、排版变化）或切章后页块 DOM 已重建，旧选区端点/保护行不再对应当前版面
  const shownPages = useRef(pages);
  useEffect(() => {
    if (shownPages.current === pages) return;
    shownPages.current = pages;
    marks.clear();
  }, [pages]);
  useEffect(() => {
    if (!chapter || busy || index < pages.length - 4 || !probe.current || !layoutSig) return;
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
    // 与可见 probe 保持同一阅读视图 CSS 上下文
    (indexHost.current || document.body).append(clone);
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
        headingFactory(next.title, settings.titleStyle),
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
  }, [chapter?.id, index, pages.length, busy, layoutKey, layoutSig]);
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
    if (busy || !chapter || pagesChapter !== chapter.id) return;
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
    await actions.navigate("reader", target.id, () => {
      pendingChapter.current = target.id;
      anchor.current = offset;
      setSettings((s) => ({ ...s, chapterId: target.id, offset, imageId: "" }));
    });
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
      // RF-REV-402：Shift+方向键/Home/End 是原生扩选，不能被翻页或滚动快捷键截走
      if (
        e.shiftKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
      )
        return;
      if (
        scrollModeRef.current &&
        ["ArrowDown", "ArrowUp"].includes(e.key) &&
        scroller.current &&
        !scroller.current.contains(e.target as Node)
      ) {
        // 焦点不在滚动区时，上下方向键也滚动正文
        e.preventDefault();
        scroller.current.scrollBy({ top: e.key === "ArrowDown" ? 60 : -60 });
        return;
      }
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
    await actions.navigate("reader", cid, () => {
      if (cid !== chapter?.id) pendingChapter.current = cid;
      anchor.current = offset;
      setSettings((s) => ({ ...s, chapterId: cid, offset, imageId: "" }));
      if (cid === chapter?.id) {
        const i = pageAt(pages, offset);
        setIndex(Math.floor(i / step) * step);
      }
    });
  };
  const change = (patch: Partial<ReaderState>) =>
    setSettings((s) => ({ ...s, ...patch }));
  // 全书页码：仅在会话内索引完整后显示/可跳转；计算中不显示估算总页数
  const bookSummary = bookIndex.summary;
  const globalVisible = busy || !chapter || pagesChapter !== chapter.id
    ? undefined
    : visibleGlobalPages(
        bookSummary,
        bookIndex.order,
        bookIndex.entries,
        chapter?.id || "",
        index,
        pages.length,
        double,
      );
  const globalText = bookIndex.error
    ? "全书页码计算失败"
    : !bookSummary.complete
      ? `全书页码计算中 ${bookSummary.measured}/${bookSummary.chapters} 章`
      : globalVisible
        ? `全书第 ${globalVisible.first}${globalVisible.last !== globalVisible.first ? `–${globalVisible.last}` : ""} / ${bookSummary.totalPages} 页`
        : "全书页码同步中";
  const jumpGlobal = async (n: number) => {
    if (busy || !Number.isFinite(n) || pagesChapter !== chapter?.id) return;
    const target = locateGlobal(bookSummary, bookIndex.order, bookIndex.entries, n);
    if (!target) return;
    if (target.chapterId === chapter?.id && target.localIndex < pages.length) {
      marks.clear();
      anchor.current = target.page.start;
      setIndex(Math.floor(target.localIndex / step) * step);
      change({ offset: target.page.start, imageId: target.page.imageId || "" });
      return;
    }
    await actions.navigate("reader", target.chapterId, () => {
      marks.clear();
      anchor.current = target.page.start;
      const count = bookIndex.entries.get(target.chapterId)?.pages.length || 0;
      pendingLocal.current = {
        chapterId: target.chapterId,
        localIndex: target.localIndex,
        count,
      };
      pendingChapter.current = target.chapterId;
      setSettings((s) => ({
        ...s,
        chapterId: target.chapterId,
        offset: target.page.start,
        imageId: target.page.imageId || "",
      }));
    });
  };
  // REQ-FE-308: 自定义字体由全局 fontStore 加载（见 bodyLoad/titleLoad）；失败时界面可见并可重试。
  // 字体名称（列表未在本会话读取过时）用于失败提示
  const fontError = bodyLoad.status === "error" || titleLoad.status === "error";
  const missingName =
    (bodyLoad.status === "error" && !bodyLoad.name) ||
    (titleLoad.status === "error" && !titleLoad.name);
  useEffect(() => {
    if (!missingName) return;
    let cancelled = false;
    void command<ReaderFontInfo[]>("list_reader_fonts")
      .then((list) => {
        if (cancelled) return;
        const labels = fontLabels(list);
        fontStore.setNames(list.map((f) => ({ id: f.id, label: labels.get(f.id) || f.familyName })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missingName]);

  const font: CSSProperties = {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    fontFamily: fontStack(settings.fontFamily),
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
  // ---- REQ-FE-306 连续滚动：按“页块行”虚拟化，每行为 step 个真实分页（与翻页模式同一测量结果） ----
  scrollModeRef.current = scroll;
  const ROW_GAP = 24;
  const SCROLL_HEAD = 56;
  const SCROLL_FOOT = 88;
  const rowH = (640 + ROW_GAP) * zoom;
  const rows = pages.length ? Math.ceil(pages.length / step) : 0;
  const [view, setView] = useState({ top: 0, height: 0 });
  /** 由滚动产生的定位，用于避免“滚动→设 index→再程序滚动”回环 */
  const scrollOrigin = useRef<{ index: number; pages: BookPage[]; zoom: number; step: number } | null>(null);
  const edgeWheel = useRef(0);
  const readingRowAt = (top: number, height: number) =>
    Math.max(
      0,
      Math.min(
        rows - 1,
        Math.floor((top + Math.min(height * 0.3, rowH * 0.5) - SCROLL_HEAD) / rowH),
      ),
    );
  // 页块（或排版/缩放）变化而非用户滚动时：把包含原文锚点的页块滚到视口顶部
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!scroll || !el || !chapter || pagesChapter !== chapter.id || !rows) return;
    const o = scrollOrigin.current;
    if (o && o.index === index && o.pages === pages && o.zoom === zoom && o.step === step) return;
    const row = Math.floor(index / step);
    el.scrollTop = SCROLL_HEAD + row * rowH;
    scrollOrigin.current = { index, pages, zoom, step };
    setView({ top: el.scrollTop, height: el.clientHeight });
  }, [scroll, index, pages, pagesChapter, chapter?.id, zoom, step, rows, rowH]);
  useEffect(() => {
    const el = scroller.current;
    if (!scroll || !el) return;
    const observer = new ResizeObserver(() =>
      setView({ top: el.scrollTop, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scroll]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop,
      height = el.clientHeight;
    setView({ top, height });
    if (busy || !chapter || pagesChapter !== chapter.id || !rows) return;
    const next = readingRowAt(top, height) * step;
    if (next === index || !pages[next]) return;
    // 仅在没有活动选择时清除；跨页拖选期间不打断
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      marks.clear();
    }
    scrollOrigin.current = { index: next, pages, zoom, step };
    setIndex(next);
    anchor.current = pages[next].start;
    setSettings((s) => ({
      ...s,
      offset: anchor.current,
      imageId: pages[next].imageId || "",
    }));
  };
  const onWheel = (e: { deltaY: number; currentTarget: HTMLDivElement }) => {
    // 章节边界：在底部继续向下（或顶部继续向上）滚动一定距离后进入相邻章节
    const el = e.currentTarget;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const atStart = el.scrollTop <= 1;
    if ((e.deltaY > 0 && atEnd) || (e.deltaY < 0 && atStart)) {
      edgeWheel.current += e.deltaY;
      if (Math.abs(edgeWheel.current) > 240) {
        const dir = edgeWheel.current > 0 ? 1 : -1;
        edgeWheel.current = 0;
        void crossChapter(dir);
      }
    } else edgeWheel.current = 0;
  };
  const chapterPos = project.chapters.findIndex((c) => c.id === chapter?.id);
  const prevChapter = chapterPos > 0 ? project.chapters[chapterPos - 1] : undefined;
  const nextChapter =
    chapterPos >= 0 ? project.chapters[chapterPos + 1] : undefined;
  const crossChapter = async (direction: number) => {
    if (busy || !chapter || pagesChapter !== chapter.id) return;
    const target = direction > 0 ? nextChapter : prevChapter;
    if (!target) return;
    marks.clear();
    const offset = direction < 0 ? target.working.length : 0;
    await actions.navigate("reader", target.id, () => {
      pendingChapter.current = target.id;
      anchor.current = offset;
      setSettings((s) => ({ ...s, chapterId: target.id, offset, imageId: "" }));
    });
  };
  const firstRow = Math.max(0, Math.floor((view.top - SCROLL_HEAD) / rowH) - 1);
  const lastRow = Math.min(
    rows - 1,
    Math.ceil((view.top + view.height - SCROLL_HEAD) / rowH) + 1,
  );
  // RF-REV-402：只额外保护选区端点（anchor/focus）所在页块，不再挂载两端之间的连续区间；
  // 中间文字由 UTF-16 逻辑选区（working.slice）保证完整，原生复制也改写为原文。
  const renderRows = mountedRows(firstRow, lastRow, marks.protectedRows, rows);
  // 末尾留白保证最后一行也能滚到视口顶部，否则 scrollTop 被夹住会把定位回退到前一行
  const scrollFoot = Math.max(SCROLL_FOOT, view.height - 640 * zoom);
  // ---- REQ-FE-307 页眉/页脚槽位：固定单行区域，不占用 510px 版心、不改变分页 ----
  const chapterRow = lengths.rows.find((c) => c.id === chapter?.id);
  const slotText = (slot: BandSlot, page: BookPage | undefined, n: number) => {
    switch (slot) {
      case "book-title":
        return project.title;
      case "chapter-title":
        return chapter?.title || "";
      case "chapter-page":
        // 实际物理本章页码（1 基）
        return page ? String(n + 1) : "";
      case "book-page": {
        if (!page || !chapter || pagesChapter !== chapter.id) return "";
        const g = visibleGlobalPages(
          bookSummary,
          bookIndex.order,
          bookIndex.entries,
          chapter.id,
          n,
          pages.length,
          false,
        );
        // 未完成不显示估算值；计算失败显示空
        return g ? String(g.first) : bookIndex.error ? "" : "计算中";
      }
      case "progress": {
        if (!page || !lengths.total || !chapterRow) return "";
        const pos =
          chapterRow.start + (project.bookSource === "cbz" ? 1 : page.start);
        return `${Math.min(100, Math.round((pos / lengths.total) * 100))}%`;
      }
      default:
        return "";
    }
  };
  const renderBand = (
    band: PageBand,
    Tag: "header" | "footer",
    page: BookPage | undefined,
    n: number,
  ) => {
    if (!band.enabled) return null;
    const hasLeft = band.left !== "none";
    const hasCenter = band.center !== "none";
    const hasRight = band.right !== "none";
    // 单槽位独占整行宽度避免无意义截断；左右并存时等宽保证中间槽位严格居中
    const centerOnly = hasCenter && !hasLeft && !hasRight;
    const leftOnly = hasLeft && !hasCenter && !hasRight;
    const rightOnly = hasRight && !hasCenter && !hasLeft;
    const columns =
      centerOnly || leftOnly || rightOnly
        ? "minmax(0, 1fr)"
        : !hasCenter
          ? "minmax(0, 1fr) minmax(0, 1fr)"
          : "minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr)";
    return (
      <Tag
        className="leaf-band"
        style={{
          fontSize: band.fontSize,
          left: settings.pageMargin,
          right: settings.pageMargin,
          gridTemplateColumns: columns,
        }}
      >
        {centerOnly ? (
          <span className="band-center">{slotText(band.center, page, n)}</span>
        ) : leftOnly ? (
          <span className="band-left">{slotText(band.left, page, n)}</span>
        ) : rightOnly ? (
          <span className="band-right">{slotText(band.right, page, n)}</span>
        ) : (
          <>
            <span className="band-left">{slotText(band.left, page, n)}</span>
            {hasCenter && (
              <span className="band-center">{slotText(band.center, page, n)}</span>
            )}
            <span className="band-right">{slotText(band.right, page, n)}</span>
          </>
        )}
      </Tag>
    );
  };
  const renderPage = (page: BookPage | undefined, n: number) => (
    <article
      className={`book-leaf ${n % 2 === 0 ? "left-leaf" : "right-leaf"}`}
      key={n}
    >
      {renderBand(settings.header, "header", page, n)}
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
          <>
            {page?.heading && settings.titleStyle.enabled && (
              // 与测量 probe 同样式；不带 data-offset，不进入选区锚点/批注 quote
              <div
                className="chapter-heading"
                role="heading"
                aria-level={2}
                style={headingStyle(settings.titleStyle, page.heading) as CSSProperties}
              >
                {page.heading.text || "\u200b"}
              </div>
            )}
            {page?.blocks.map((b) => (
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
            ))}
          </>
        )}
      </div>
      {renderBand(settings.footer, "footer", page, n)}
    </article>
  );
  return (
    <section className={`reader-view reader-${settings.theme}`}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-start">
          <Button
            variant="ghost"
            aria-label="阅读导航"
            aria-expanded={toc}
            disabled={!preferencesLoaded}
            aria-busy={!preferencesLoaded && !preferencesFailed}
            title={
              preferencesLoaded
                ? undefined
                : preferencesFailed
                  ? "阅读偏好读取失败，请使用页面上方的“重试读取偏好”"
                  : "正在加载阅读偏好…"
            }
            onClick={() => {
              if (!preferencesLoaded) return;
              userToggled.current = true;
              const next = !toc;
              setToc(next);
              onReaderNavCollapse?.(!next);
            }}
          >
            <List size={17} />
            阅读导航
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
            bookmarks={settings.bookmarks}
            onBookmarkDelete={(id) =>
              change({
                bookmarks: settings.bookmarks.filter((x) => x.id !== id),
              })
            }
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
          </ReadingLibrary>
        )}
        <div
          ref={stage}
          className="book-stage"
          data-chapter={chapter?.id}
          onMouseUp={(e) => marks.collect(e.currentTarget)}
          onCopy={marks.copy}
          onTouchStart={(e) => {
            touch.current = e.changedTouches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const delta = e.changedTouches[0].clientX - touch.current;
            if (
              !scroll &&
              Math.abs(delta) > 70 &&
              window.getSelection()?.isCollapsed !== false
            )
              void turn(delta < 0 ? 1 : -1);
          }}
        >
          {scroll ? (
            <div
              ref={scroller}
              className={`book-scroll ${busy ? "paginating" : ""}`}
              role="region"
              aria-label="连续滚动阅读区"
              tabIndex={0}
              onScroll={onScroll}
              onWheel={onWheel}
              data-rows={rows}
              data-rendered={renderRows.length}
            >
              <div
                className="book-scroll-track"
                style={{
                  height: SCROLL_HEAD + rows * rowH + scrollFoot,
                  width: width * zoom,
                }}
              >
                <div className="book-scroll-edge" style={{ top: 0, height: SCROLL_HEAD }}>
                  {prevChapter ? (
                    <button type="button" onClick={() => void crossChapter(-1)}>
                      <ChevronLeft size={14} /> 上一章：{prevChapter.title}
                    </button>
                  ) : (
                    <span>已是第一章</span>
                  )}
                </div>
                {renderRows.map((r) => {
                    const n = r * step;
                    return (
                      <div
                        key={`${pagesChapter}-${r}`}
                        className="book-scroll-row"
                        data-row={r}
                        data-row-index={r}
                        style={{
                          top: SCROLL_HEAD + r * rowH,
                          width: width * zoom,
                          height: 640 * zoom,
                        }}
                      >
                        <div
                          className={`book-spread ${double ? "double" : "single"}`}
                          style={{ width, transform: `scale(${zoom})` }}
                        >
                          {renderPage(pages[n], n)}
                          {double && renderPage(pages[n + 1], n + 1)}
                        </div>
                      </div>
                    );
                  })}
                <div
                  className="book-scroll-edge"
                  style={{ top: SCROLL_HEAD + rows * rowH, height: SCROLL_FOOT }}
                >
                  {nextChapter ? (
                    <button type="button" onClick={() => void crossChapter(1)}>
                      下一章：{nextChapter.title} <ChevronRight size={14} />
                    </button>
                  ) : (
                    <span>全书完</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
          {busy && <div className="reader-loading">正在排版…</div>}
          {(fontError || bodyLoad.status === "loading" || titleLoad.status === "loading") && (
            // RF-REV-405：阅读区内的字体状态（专注阅读、设置面板关闭时也可见）
            <div className="reader-font-status">
              <FontLoadNotice view={bodyLoad} role="正文" />
              <FontLoadNotice view={titleLoad} role="标题" />
            </div>
          )}
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
          <span className="reader-chapter-percent">
            本章{" "}
            {pages.length
              ? Math.min(100, Math.round(((index + step) / pages.length) * 100))
              : 0}
            %
          </span>
          <label>
            本章页码
            <input
              aria-label="跳转到本章第几页"
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
          <label title={bookSummary.complete ? undefined : "全书页码计算完成后可跳转"}>
            全书页码
            <input
              aria-label="跳转到全书第几页"
              type="number"
              min="1"
              max={bookSummary.totalPages}
              disabled={!bookSummary.complete || busy}
              key={`g-${chapter?.id}-${index}-${bookSummary.totalPages ?? "x"}`}
              defaultValue={globalVisible?.first ?? ""}
              placeholder={bookSummary.complete ? undefined : "计算中"}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void jumpGlobal(+e.currentTarget.value);
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
        <span
          className="reader-page-summary"
          title={`${chapter?.title || ""} · ${globalText}`}
          data-book-measured={bookSummary.measured}
          data-book-chapters={bookSummary.chapters}
          data-book-total={bookSummary.totalPages ?? ""}
          data-book-first={globalVisible?.first ?? ""}
          data-book-last={globalVisible?.last ?? ""}
        >
          <span className="reader-summary-meta">
            全书进度（按原文）{Math.round(fullProgress * 100)}% ·{" "}
            {chapter?.title || "暂无章节"} ·&nbsp;
          </span>
          {/* 关键页码：不收缩、不截断；窄栏时先隐藏上面的 meta */}
          <span className="reader-summary-pages">
            {pages.length
              ? `本章 ${index + 1}${double && index + 1 < pages.length ? `–${index + 2}` : ""} / ${pages.length} 页`
              : ""}
            {" · "}
            <span className="reader-book-pages" aria-live="polite">
              {globalText}
            </span>
          </span>
        </span>
        {bookIndex.error && (
          <button
            type="button"
            className="reader-index-retry"
            title={bookIndex.error}
            onClick={bookIndex.retry}
          >
            重试计算全书页码
          </button>
        )}
        <div>
          <Button
            variant="ghost"
            aria-label="添加书签"
            title="添加书签"
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
            <span className="reader-status-label">添加书签</span>
          </Button>
          <Button
            variant="ghost"
            aria-label="编辑本章"
            title="编辑本章"
            onClick={() => void actions.navigate("writer", chapter?.id)}
          >
            <Pencil size={14} />
            <span className="reader-status-label">编辑本章</span>
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
      {/* 全书索引/预取用的离屏 probe 挂载点（React 不渲染子节点） */}
      <div ref={indexHost} className="page-probe-host" aria-hidden="true" />
    </section>
  );
}
