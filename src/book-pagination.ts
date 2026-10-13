import { paginate, type BookPage } from "./reader-pagination";
import type { BookContent } from "./domain";
export async function paginateBook(
  text: string,
  measure: HTMLElement,
  content: BookContent | undefined,
  imageIds: string[],
  abort: () => boolean,
): Promise<BookPage[]> {
  const pages: BookPage[] = [];
  let offset = 0;
  const append = async (end: number) => {
    if (end > offset) {
      const part = await paginate(text.slice(offset, end), measure, abort);
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
  return pages.length ? pages : [{ blocks: [], start: 0, end: 0 }];
}
