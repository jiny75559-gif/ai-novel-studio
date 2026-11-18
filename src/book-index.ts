// RF-FE-05 阶段 A：会话内全书分页索引（纯函数部分）。
// 页数来自真实 DOM 测量（paginateBook），这里只做轻量描述、前缀汇总与定位；
// 不按字数估算，不写入 ReaderState.totalPages（该字段为 PDF 原页数）。
import type { BookPage } from "./reader-pagination";

/** 测量引擎版本：分页算法或测量方式变化时递增，令旧索引失效 */
export const INDEX_ENGINE = "dom-paginate-v2";

/** 每页轻量描述：只保留原文锚点与图片页信息，不保存正文和 DOM */
export interface PageDesc {
  start: number;
  end: number;
  imageId?: string;
}
export interface ChapterEntry {
  key: string;
  pages: PageDesc[];
}
export interface ChapterSource {
  id: string;
  key: string;
}

export function describePages(pages: BookPage[]): PageDesc[] {
  // 保留 start=end 的图片页、同 offset 多张图片与空章的唯一空页
  return pages.map((p) =>
    p.imageId
      ? { start: p.start, end: p.end, imageId: p.imageId }
      : { start: p.start, end: p.end },
  );
}

/** FNV-1a 32 位散列 + 长度；用于识别等长改稿 */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

export function chapterKey(input: {
  id: string;
  editRevision: number;
  hash: string;
  images?: { offset: number; imageId: string; caption: string }[];
  artworkIds: string[];
  /** REQ-FE-307：启用独立标题时的章节标题文本（未启用为 undefined，key 与旧版一致） */
  heading?: string;
}): string {
  const images = (input.images || [])
    .map((i) => `${i.offset}:${i.imageId}:${i.caption}`)
    .join("|");
  return JSON.stringify([
    input.id,
    input.editRevision,
    input.hash,
    images,
    input.artworkIds.join("|"),
    ...(input.heading !== undefined ? [`h:${input.heading}`] : []),
  ]);
}

export interface BookSummary {
  /** 已按当前 key 测量完成的章节数 */
  measured: number;
  chapters: number;
  complete: boolean;
  /** 全书物理内容页数；仅在 complete 时给出 */
  totalPages?: number;
  /** 每章起始全书页序（0 基）；前缀未全部测量时为 undefined */
  prefix: (number | undefined)[];
}

export function valid(
  entries: Map<string, ChapterEntry>,
  c: ChapterSource,
): ChapterEntry | undefined {
  const e = entries.get(c.id);
  return e && e.key === c.key ? e : undefined;
}

export function summarize(
  order: ChapterSource[],
  entries: Map<string, ChapterEntry>,
): BookSummary {
  let measured = 0;
  let running: number | undefined = 0;
  const prefix: (number | undefined)[] = [];
  for (const c of order) {
    prefix.push(running);
    const e = valid(entries, c);
    if (e) {
      measured++;
      if (running !== undefined) running += e.pages.length;
    } else running = undefined;
  }
  const complete = order.length > 0 && measured === order.length;
  return {
    measured,
    chapters: order.length,
    complete,
    totalPages: complete ? running : undefined,
    prefix,
  };
}

/** 下一个待测章节：优先指定章节，其后按书序 */
export function nextToMeasure(
  order: ChapterSource[],
  entries: Map<string, ChapterEntry>,
  priority: string[] = [],
): number {
  for (const id of priority) {
    const i = order.findIndex((c) => c.id === id);
    if (i >= 0 && !valid(entries, order[i])) return i;
  }
  return order.findIndex((c) => !valid(entries, c));
}

/**
 * 当前可见内容页的全书页码（1 基）。双页时第二页只有在本章确实存在时才计入，
 * 不把下一章页码当作已显示。前缀未完成或本章页数与索引不一致时返回 undefined。
 */
export function visibleGlobalPages(
  summary: BookSummary,
  order: ChapterSource[],
  entries: Map<string, ChapterEntry>,
  chapterId: string,
  localIndex: number,
  localCount: number,
  double: boolean,
): { first: number; last: number } | undefined {
  if (!summary.complete) return undefined;
  const ci = order.findIndex((c) => c.id === chapterId);
  if (ci < 0) return undefined;
  const e = valid(entries, order[ci]);
  const base = summary.prefix[ci];
  if (!e || base === undefined || e.pages.length !== localCount) return undefined;
  if (localIndex < 0 || localIndex >= localCount) return undefined;
  const first = base + localIndex + 1;
  const last = double && localIndex + 1 < localCount ? first + 1 : first;
  return { first, last };
}

/** 全书第 n 页（1 基）定位到章节与本章页序；越界夹到首/末页 */
export function locateGlobal(
  summary: BookSummary,
  order: ChapterSource[],
  entries: Map<string, ChapterEntry>,
  pageNumber: number,
):
  | { chapterIndex: number; chapterId: string; localIndex: number; page: PageDesc }
  | undefined {
  if (!summary.complete || !summary.totalPages) return undefined;
  const target =
    Math.max(1, Math.min(summary.totalPages, Math.floor(pageNumber))) - 1;
  for (let ci = 0; ci < order.length; ci++) {
    const e = valid(entries, order[ci])!;
    const base = summary.prefix[ci]!;
    if (target < base + e.pages.length) {
      const localIndex = target - base;
      return {
        chapterIndex: ci,
        chapterId: order[ci].id,
        localIndex,
        page: e.pages[localIndex],
      };
    }
  }
  return undefined;
}
