import type { HeadingSlice, HeadingSpec } from "./chapter-heading";

export interface PageBlock {
  text: string;
  start: number;
  end: number;
  continued: boolean;
}
export interface BookPage {
  caption?: string;
  blocks: PageBlock[];
  start: number;
  end: number;
  imageId?: string;
  /** REQ-FE-307：本页顶部显示的独立章节标题片段（已计入真实 DOM 测量） */
  heading?: HeadingSlice;
}
export function typographyBoundary(
  text: string,
  segments: { index: number }[],
  count: number,
): number {
  let n = count;
  const closers = new Set(Array.from("，。！？；：、）》】」』”’…,.!?;:)]}"));
  const openers = new Set(Array.from("（《【「『“‘([{"));
  while (n > 0) {
    const offset = n === segments.length ? text.length : segments[n].index;
    if (!closers.has(text[offset]) && !openers.has(text[offset - 1])) break;
    n--;
  }
  return n;
}
export function paragraphs(text: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  for (const m of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!m[0]) continue;
    blocks.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      continued: false,
    });
  }
  return blocks;
}
function element(b: PageBlock) {
  const p = document.createElement("p");
  p.className = `${b.continued ? "continued" : ""} ${!b.text.trim() ? "blank" : ""}`;
  p.textContent = b.text.replace(/\r?\n$/, "") || "\u200b";
  return p;
}
export async function paginate(
  text: string,
  probe: HTMLElement,
  aborted: () => boolean,
  /** 独立章节标题：放在首个文本页顶部参与测量；超长标题超出单页版心时自动续排，不截字 */
  heading?: HeadingSpec,
): Promise<BookPage[]> {
  await document.fonts.load(
    `${getComputedStyle(probe).fontSize} ${getComputedStyle(probe).fontFamily}`,
    "风雨归来",
  );
  if (aborted()) return [];
  probe.replaceChildren();
  const pages: BookPage[] = [];
  let blocks: PageBlock[] = [];
  let activeHeading: HeadingSlice | undefined;
  let lastYield = performance.now();
  const yieldIfBusy = async () => {
    if (performance.now() - lastYield < 12) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = performance.now();
  };
  if (heading) {
    let rem = heading.title || "\u200b";
    let isFirst = true;
    const sample = heading.create({ text: rem, first: true, last: true });
    probe.append(sample);
    const hs = getComputedStyle(sample);
    await document.fonts.load(
      `${hs.fontWeight} ${hs.fontSize} ${hs.fontFamily}`,
      sample.textContent || "风雨归来",
    );
    probe.replaceChildren();
    if (aborted()) return [];
    while (rem.length > 0) {
      if (aborted()) return [];
      await yieldIfBusy();
      if (aborted()) return [];
      const full: HeadingSlice = { text: rem, first: isFirst, last: true };
      const h = heading.create(full);
      probe.replaceChildren(h);
      if (probe.scrollHeight <= probe.clientHeight + 1) {
        activeHeading = full;
        break;
      }
      const segments = Array.from(
        new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(rem),
      );
      if (segments.length <= 1) {
        pages.push({ blocks: [], start: 0, end: 0, heading: full });
        probe.replaceChildren();
        rem = "";
        break;
      }
      let low = 0,
        high = segments.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const end = segments[mid].index;
        probe.replaceChildren(
          heading.create({ text: rem.slice(0, end), first: isFirst, last: false }),
        );
        if (probe.scrollHeight <= probe.clientHeight + 1) low = mid;
        else high = mid - 1;
      }
      const adjusted = typographyBoundary(rem, segments, low);
      low = Math.max(1, adjusted > 0 ? adjusted : low);
      const count = segments[low].index;
      pages.push({
        blocks: [],
        start: 0,
        end: 0,
        heading: { text: rem.slice(0, count), first: isFirst, last: false },
      });
      probe.replaceChildren();
      rem = rem.slice(count);
      isFirst = false;
    }
  }
  /** at：仅有标题、尚无正文块时该页的原文锚点 */
  const finish = (at = 0) => {
    if (blocks.length || activeHeading) {
      pages.push({
        blocks,
        start: blocks.length ? blocks[0].start : at,
        end: blocks.length ? blocks[blocks.length - 1].end : at,
        ...(activeHeading ? { heading: activeHeading } : {}),
      });
      blocks = [];
    }
    activeHeading = undefined;
    probe.replaceChildren();
  };
  let steps = 0;
  for (const original of paragraphs(text)) {
    let b = original;
    while (b.text.length) {
      if (aborted()) return [];
      await yieldIfBusy();
      if (aborted()) return [];
      const p = element(b);
      probe.append(p);
      if (probe.scrollHeight <= probe.clientHeight + 1) {
        blocks.push(b);
        break;
      }
      p.remove();
      // Find the longest grapheme-safe fragment that fits the remaining space.
      const segments = Array.from(
        new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(b.text),
      );
      let low = 0,
        high = segments.length;
      probe.append(p);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const end =
          mid === segments.length ? b.text.length : segments[mid].index;
        p.textContent = b.text.slice(0, end).replace(/\r?\n$/, "") || "\u200b";
        if (probe.scrollHeight <= probe.clientHeight + 1) low = mid;
        else high = mid - 1;
      }
      p.remove();
      const adjusted = typographyBoundary(b.text, segments, low);
      if (adjusted > 0 || blocks.length > 0) low = adjusted;
      if (low === 0) {
        // 已有正文块，或本页顶部有标题占高：先结束本页，正文从下一页开始（不截字、不无限分页）
        if (blocks.length || activeHeading) {
          finish(b.start);
          continue;
        }
        throw new Error("页幅太小，请减小字号。");
      }
      const count =
        low === segments.length ? b.text.length : segments[low].index;
      const part = { ...b, text: b.text.slice(0, count), end: b.start + count };
      blocks.push(part);
      finish();
      b = {
        text: b.text.slice(count),
        start: b.start + count,
        end: b.end,
        continued: true,
      };
      if (++steps % 12 === 0)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
    }
  }
  finish();
  return pages.length ? pages : [{ blocks: [], start: 0, end: 0 }];
}
export const pageAt = (pages: BookPage[], offset: number) => {
  const i = pages.findIndex(
    (p) => !p.imageId && (p.end > offset || p.start === offset),
  );
  return i < 0 ? Math.max(0, pages.length - 1) : i;
};
