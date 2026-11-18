import { describe, expect, it } from "vitest";
import {
  chapterKey,
  describePages,
  locateGlobal,
  nextToMeasure,
  summarize,
  textHash,
  visibleGlobalPages,
  type ChapterEntry,
  type PageDesc,
} from "./book-index";

const p = (start: number, end: number, imageId?: string): PageDesc =>
  imageId ? { start, end, imageId } : { start, end };
const book = (counts: Record<string, PageDesc[]>) => {
  const order = Object.keys(counts).map((id) => ({ id, key: `k-${id}` }));
  const entries = new Map<string, ChapterEntry>(
    order.map((c) => [c.id, { key: c.key, pages: counts[c.id] }]),
  );
  return { order, entries };
};

describe("全书分页索引", () => {
  it("前缀未完成时不给总页数与全书页码，完成后按物理页累加", () => {
    const { order, entries } = book({
      a: [p(0, 10), p(10, 20)],
      b: [p(0, 0)], // 空章保留一个空页
      c: [p(0, 5), p(5, 9), p(9, 12)],
    });
    entries.delete("b");
    const partial = summarize(order, entries);
    expect(partial.complete).toBe(false);
    expect(partial.totalPages).toBeUndefined();
    expect(partial.measured).toBe(2);
    expect(partial.prefix).toEqual([0, 2, undefined]);
    expect(visibleGlobalPages(partial, order, entries, "a", 0, 2, false)).toBeUndefined();
    entries.set("b", { key: "k-b", pages: [p(0, 0)] });
    const full = summarize(order, entries);
    expect(full.totalPages).toBe(6);
    expect(full.prefix).toEqual([0, 2, 3]);
    expect(visibleGlobalPages(full, order, entries, "c", 2, 3, false)).toEqual({ first: 6, last: 6 });
  });

  it("跳页边界：第 1 页、章首、末页及越界夹取", () => {
    const { order, entries } = book({ a: [p(0, 4), p(4, 8)], b: [p(0, 3)] });
    const s = summarize(order, entries);
    expect(locateGlobal(s, order, entries, 1)).toMatchObject({ chapterId: "a", localIndex: 0 });
    expect(locateGlobal(s, order, entries, 3)).toMatchObject({ chapterId: "b", localIndex: 0 });
    expect(locateGlobal(s, order, entries, 99)).toMatchObject({ chapterId: "b", localIndex: 0 });
    expect(locateGlobal(s, order, entries, 0)).toMatchObject({ chapterId: "a", localIndex: 0 });
    entries.delete("b");
    expect(locateGlobal(summarize(order, entries), order, entries, 1)).toBeUndefined();
  });

  it("相同 offset 的多张图片页按会话页序区分", () => {
    const pages = describePages([
      { blocks: [], start: 0, end: 5 },
      { blocks: [], start: 5, end: 5, imageId: "img-1", caption: "甲" },
      { blocks: [], start: 5, end: 5, imageId: "img-2", caption: "乙" },
      { blocks: [], start: 5, end: 9 },
    ]);
    expect(pages).toEqual([p(0, 5), p(5, 5, "img-1"), p(5, 5, "img-2"), p(5, 9)]);
    const { order, entries } = book({ a: pages });
    const s = summarize(order, entries);
    expect(locateGlobal(s, order, entries, 3)).toMatchObject({ localIndex: 2, page: { imageId: "img-2" } });
  });

  it("双页奇数章尾不把下一章页码当作已显示", () => {
    const { order, entries } = book({ a: [p(0, 1), p(1, 2), p(2, 3)], b: [p(0, 1), p(1, 2)] });
    const s = summarize(order, entries);
    expect(visibleGlobalPages(s, order, entries, "a", 0, 3, true)).toEqual({ first: 1, last: 2 });
    expect(visibleGlobalPages(s, order, entries, "a", 2, 3, true)).toEqual({ first: 3, last: 3 });
    expect(visibleGlobalPages(s, order, entries, "b", 0, 2, true)).toEqual({ first: 4, last: 5 });
    // 本章实际页数与索引不一致时不显示
    expect(visibleGlobalPages(s, order, entries, "a", 0, 4, true)).toBeUndefined();
  });

  it("失效：等长改稿、图片位置/说明变化与插图变化都改变 key", () => {
    const base = { id: "c1", editRevision: 3, artworkIds: [] as string[] };
    const k0 = chapterKey({ ...base, hash: textHash("春风十里") });
    expect(chapterKey({ ...base, hash: textHash("秋风十里") })).not.toBe(k0);
    expect(textHash("春风十里")).not.toBe(textHash("秋风十里"));
    const img = [{ offset: 2, imageId: "i", caption: "x" }];
    const k1 = chapterKey({ ...base, hash: "h", images: img });
    expect(chapterKey({ ...base, hash: "h", images: [{ ...img[0], offset: 3 }] })).not.toBe(k1);
    expect(chapterKey({ ...base, hash: "h", images: [{ ...img[0], caption: "y" }] })).not.toBe(k1);
    expect(chapterKey({ ...base, hash: "h", images: img, artworkIds: ["a"] })).not.toBe(k1);
    // 启用独立章节标题时章节标题进入 key，标题变化使该章索引失效；未启用时保持旧 key
    const kTitleA = chapterKey({ ...base, hash: "h", heading: "第一章 风起" });
    const kTitleB = chapterKey({ ...base, hash: "h", heading: "第一章 雨落" });
    expect(kTitleA).not.toBe(k0);
    expect(kTitleA).not.toBe(kTitleB);
    // 过期条目不计入已测量，且会被重新排入测量
    const order = [{ id: "c1", key: "new" }];
    const entries = new Map([["c1", { key: "old", pages: [p(0, 1)] }]]);
    expect(summarize(order, entries).measured).toBe(0);
    expect(nextToMeasure(order, entries)).toBe(0);
  });

  it("测量顺序：当前章优先，其余按书序；全部完成返回 -1", () => {
    const order = ["a", "b", "c", "d"].map((id) => ({ id, key: id }));
    const entries = new Map<string, ChapterEntry>();
    expect(nextToMeasure(order, entries, ["c"])).toBe(2);
    entries.set("c", { key: "c", pages: [p(0, 1)] });
    expect(nextToMeasure(order, entries, ["c"])).toBe(0);
    for (const id of ["a", "b", "d"]) entries.set(id, { key: id, pages: [p(0, 1)] });
    expect(nextToMeasure(order, entries, ["c"])).toBe(-1);
  });
});
