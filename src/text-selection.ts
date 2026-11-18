// RF-REV-402：正文选区的统一采集（鼠标、键盘、程序选区共用）与连续滚动挂载行计算。
// 选区始终以“章节 working 的 UTF-16 区间”为准：DOM 中间页块可以被虚拟化卸载，
// 起止点各自通过所在段落的 data-offset 换算，quote 取 working.slice(start, end)，不依赖 Range.toString()。
import type { Chapter } from "./domain";

export interface TextSelectionRange {
  chapterId: string;
  start: number;
  end: number;
  quote: string;
}

/**
 * 连续滚动实际挂载的页块：可见区间 [first, last] ∪ 选区端点所在页块（最多 2 个额外页块）。
 * 不再用 min/max 连续区间，长拖到章尾也不会挂满整章。
 */
export function mountedRows(
  first: number,
  last: number,
  protectedRows: readonly number[],
  total: number,
): number[] {
  if (total <= 0) return [];
  const set = new Set<number>();
  for (let r = Math.max(0, first); r <= Math.min(total - 1, last); r++) set.add(r);
  for (const r of protectedRows) if (Number.isInteger(r) && r >= 0 && r < total) set.add(r);
  return [...set].sort((a, b) => a - b);
}

export function sameRows(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 节点所在连续滚动页块序号；不在页块内返回 null */
export function rowOf(node: Node | null | undefined): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const row = el?.closest<HTMLElement>(".book-scroll-row");
  if (!row) return null;
  const n = Number(row.dataset.row);
  return Number.isInteger(n) ? n : null;
}

/** 选区端点页块（anchor 与 focus），仅当两端都在 root 内 */
export function selectionRows(root: HTMLElement, sel: Selection | null): number[] {
  if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return [];
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return [];
  const rows = [rowOf(sel.anchorNode), rowOf(sel.focusNode)].filter(
    (r): r is number => r !== null,
  );
  return [...new Set(rows)].sort((a, b) => a - b);
}

/** 去掉段尾换行，使吸附到段落末尾的终点不把换行算进 quote */
function trimEnd(text: string, end: number, floor: number) {
  let e = end;
  while (e > floor && (text[e - 1] === "\n" || text[e - 1] === "\r")) e--;
  return e;
}

/**
 * 读取 root 内当前原生选区对应的原文区间。
 * - 端点在正文段落内：精确换算 UTF-16 offset；
 * - 端点落在页眉/页脚/标题等非正文处：吸附到选区内第一个/最后一个正文段落（不夹带页眉与标题文字）。
 * 选区折叠、跨出 root、或无正文内容时返回 null。
 */
export function readTextSelection(
  root: HTMLElement,
  chapters: Pick<Chapter, "id" | "working">[],
  sel: Selection | null = window.getSelection(),
): TextSelectionRange | null {
  if (!sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const cid = root.dataset.chapter || "";
  const chapter = chapters.find((c) => c.id === cid);
  if (!chapter) return null;
  const exact = (node: Node, offset: number) => {
    const el = node instanceof Element ? node : node.parentElement;
    const p = el?.closest<HTMLElement>("p[data-offset]");
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p, 0);
    r.setEnd(node, offset);
    return +(p.dataset.offset || 0) + r.toString().length;
  };
  let start = exact(range.startContainer, range.startOffset);
  let end = exact(range.endContainer, range.endOffset);
  if (start === null || end === null) {
    const inside = [...root.querySelectorAll<HTMLElement>("p[data-offset]")].filter((p) =>
      range.intersectsNode(p),
    );
    if (!inside.length) return null;
    if (start === null) start = +(inside[0].dataset.offset || 0);
    if (end === null) {
      const last = inside[inside.length - 1];
      const lastStart = +(last.dataset.offset || 0);
      end = trimEnd(chapter.working, +(last.dataset.end || lastStart), lastStart);
    }
  }
  if (end < start) [start, end] = [end, start];
  start = Math.max(0, Math.min(chapter.working.length, start));
  end = Math.max(0, Math.min(chapter.working.length, end));
  const quote = chapter.working.slice(start, end);
  if (end <= start || !quote.trim()) return null;
  return { chapterId: cid, start, end, quote };
}
