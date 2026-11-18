// RF-FE-05 阶段 A：会话内全书分页索引（DOM 调度部分）。
// 仅保存在当前阅读会话内存：不写 SQLite、不写 localStorage、不进备份。
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Project, TitleStyle } from "./domain";
import { headingFactory } from "./chapter-heading";
import type { BookPage } from "./reader-pagination";
import { paginateBook } from "./book-pagination";
import {
  chapterKey,
  describePages,
  nextToMeasure,
  summarize,
  textHash,
  type ChapterEntry,
  type ChapterSource,
} from "./book-index";
import { errorMessage } from "./bridge";

interface Source extends ChapterSource {
  text: string;
  title: string;
  content: Project["bookContent"][number] | undefined;
  artworkIds: string[];
}

const idle = () =>
  new Promise<void>((resolve) => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 120 });
    else setTimeout(resolve, 0);
  });

export function useBookIndex({
  project,
  layoutSig,
  templateRef,
  hostRef,
  priorityId,
  titleStyle,
}: {
  project: Project;
  /** 实际版心/字体/样式/字体就绪状态签名；变化即整体失效 */
  layoutSig: string;
  /** 可见页使用的同款 probe，克隆其 class 与内联样式 */
  templateRef: RefObject<HTMLElement | null>;
  /** 克隆 probe 的挂载点，位于阅读视图内，保持相同 CSS 上下文 */
  hostRef: RefObject<HTMLElement | null>;
  priorityId: string;
  /** REQ-FE-307：启用独立标题时，章节标题文本进入章 key，标题参与测量 */
  titleStyle: TitleStyle;
}) {
  const hashes = useRef(new Map<string, { text: string; hash: string }>());
  const order = useMemo<Source[]>(() => {
    const contents = new Map(project.bookContent.map((b) => [b.chapterId, b]));
    const art = new Map<string, string[]>();
    for (const a of project.artwork)
      if (a.approved && a.kind === "chapter")
        art.set(a.chapterId, [...(art.get(a.chapterId) || []), a.imageId]);
    return project.chapters.map((c) => {
      let h = hashes.current.get(c.id);
      if (!h || h.text !== c.working) {
        h = { text: c.working, hash: textHash(c.working) };
        hashes.current.set(c.id, h);
      }
      const content = contents.get(c.id);
      const artworkIds = art.get(c.id) || [];
      return {
        id: c.id,
        text: c.working,
        title: c.title,
        content,
        artworkIds,
        key: chapterKey({
          id: c.id,
          editRevision: c.editRevision,
          hash: h.hash,
          images: content?.images,
          artworkIds,
          heading: titleStyle.enabled ? c.title : undefined,
        }),
      };
    });
  }, [project.chapters, project.bookContent, project.artwork, titleStyle.enabled]);
  const titleRef = useRef(titleStyle);
  titleRef.current = titleStyle;
  const orderRef = useRef(order);
  orderRef.current = order;
  const orderKey = useMemo(() => order.map((c) => c.key).join("\n"), [order]);

  // 代际：项目或排版签名变化即丢弃全部条目
  const generation = `${project.id}\u0000${layoutSig}`;
  const entries = useRef(new Map<string, ChapterEntry>());
  const genRef = useRef(generation);
  if (genRef.current !== generation) {
    genRef.current = generation;
    entries.current = new Map();
  }
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const priorityRef = useRef(priorityId);
  priorityRef.current = priorityId;

  useEffect(() => {
    const host = hostRef.current;
    const template = templateRef.current;
    if (!layoutSig || !host || !template) return;
    const map = entries.current;
    const gen = generation;
    let cancelled = false;
    const probe = template.cloneNode(false) as HTMLElement;
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.bookIndexProbe = "1";
    host.append(probe);
    setError("");
    void (async () => {
      // 稍候启动：当前章通常由可见阅读区测量后 seed，避免重复测量并让首屏优先
      await new Promise((resolve) => setTimeout(resolve, 400));
      let lastTick = performance.now();
      while (!cancelled) {
        const list = orderRef.current;
        const i = nextToMeasure(list, map, [priorityRef.current]);
        if (i < 0) break;
        const c = list[i];
        let pages: BookPage[];
        try {
          pages = await paginateBook(
            c.text,
            probe,
            c.content,
            c.artworkIds,
            () => cancelled,
            headingFactory(c.title, titleRef.current),
          );
        } catch (e) {
          if (!cancelled) setError(errorMessage(e));
          return;
        }
        if (cancelled || genRef.current !== gen) return;
        // 期间章节内容变化：丢弃该结果，下轮按新 key 重测
        const latest = orderRef.current.find((x) => x.id === c.id);
        if (latest && latest.key === c.key)
          map.set(c.id, { key: c.key, pages: describePages(pages) });
        if (performance.now() - lastTick > 150) {
          lastTick = performance.now();
          setTick((t) => t + 1);
        }
        await idle();
      }
      if (!cancelled) setTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
      probe.remove();
    };
    // priorityId 变化时重启以便目标章优先；orderKey 变化时补测失效章节
  }, [generation, orderKey, priorityId, retry, layoutSig, hostRef, templateRef]);

  /**
   * 当前阅读区用同一签名测得的本章结果直接入索引，保证本章页数一致。
   * key 为测量开始时的章节内容 key；测量期间内容已变化（key 不同）则丢弃，避免旧结果冒充新内容。
   */
  const seed = useCallback(
    (sig: string, chapterId: string, key: string, pages: BookPage[]) => {
      if (`${project.id}\u0000${sig}` !== genRef.current) return;
      const c = orderRef.current.find((x) => x.id === chapterId);
      if (!c || c.key !== key) return;
      entries.current.set(chapterId, { key: c.key, pages: describePages(pages) });
      setTick((t) => t + 1);
    },
    [project.id],
  );
  /** 章节统一内容 key（正文散列/修订/图片 offset·caption/获批插图），供可见页、预取与索引共用 */
  const keyOf = useCallback(
    (chapterId: string) => order.find((x) => x.id === chapterId)?.key || "",
    [order],
  );

  // tick/generation 用于在 ref 中的条目更新后重新汇总
  const summary = useMemo(
    () => summarize(order, entries.current),
    [order, tick, generation],
  );
  return {
    order,
    entries: entries.current,
    summary,
    error,
    retry: () => setRetry((r) => r + 1),
    seed,
    keyOf,
  };
}
