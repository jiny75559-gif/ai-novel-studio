import { paginate, type BookPage } from "./reader-pagination";
import type { HeadingSpec } from "./chapter-heading";
import type { BookContent } from "./domain";
export async function paginateBook(
  text: string,
  measure: HTMLElement,
  content: BookContent | undefined,
  imageIds: string[],
  abort: () => boolean,
  /** REQ-FE-307 独立章节标题：放在本章首个文本页，参与实际 DOM 测量 */
  heading?: HeadingSpec,
): Promise<BookPage[]> {
  const pages: BookPage[] = [];
  let offset = 0;
  let headingLeft = heading;
  const append = async (end: number) => {
    if (end > offset) {
      const part = await paginate(text.slice(offset, end), measure, abort, headingLeft);
      headingLeft = undefined;
      for (const p of part)
        pages.push({
          ...p,
          start: p.start + offset,
          end: p.end + offset,
          blocks: p.blocks.map((b) => ({
            ...b,
            start: b.start + offset,
            end: b.end + offset,
          })),
        });
    }
    offset = end;
  };
  for (const image of content?.images || []) {
    await append(Math.min(text.length, image.offset));
    if (abort()) return [];
    pages.push({
      blocks: [],
      start: offset,
      end: offset,
      imageId: image.imageId,
      caption: image.caption,
    });
  }
  await append(text.length);
  for (const imageId of imageIds)
    pages.push({ blocks: [], start: text.length, end: text.length, imageId });
  if (!pages.length) {
    // 空文本章节：仍通过 paginate 测量独立标题（超长标题也可续排），无标题则返回单张空页
    if (headingLeft) return paginate("", measure, abort, headingLeft);
    return [{ blocks: [], start: 0, end: 0 }];
  }
  return pages;
}
