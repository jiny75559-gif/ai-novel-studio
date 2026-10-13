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
): Promise<BookPage[]> {
  await document.fonts.load(
    `${getComputedStyle(probe).fontSize} ${getComputedStyle(probe).fontFamily}`,
    "风雨归来",
  );
  if (aborted()) return [];
  probe.replaceChildren();
  const pages: BookPage[] = [];
  let blocks: PageBlock[] = [];
  const finish = () => {
    if (blocks.length) {
      pages.push({
        blocks,
        start: blocks[0].start,
        end: blocks[blocks.length - 1].end,
      });
      blocks = [];
    }
    probe.replaceChildren();
  };
  let steps = 0;
  for (const original of paragraphs(text)) {
    let b = original;
    while (b.text.length) {
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
        if (blocks.length) {
          finish();
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
