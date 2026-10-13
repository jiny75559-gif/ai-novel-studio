import { it, expect } from "vitest";
import { paragraphs, pageAt, typographyBoundary } from "./reader-pagination";
it("book paragraphs preserve all offsets, whitespace and supplementary characters", () => {
  const text = "  第一段🐈\r\n\n第二段\t与空格。\n结尾𠮷";
  const blocks = paragraphs(text);
  expect(blocks.map((b) => b.text).join("")).toBe(text);
  for (const b of blocks) expect(text.slice(b.start, b.end)).toBe(b.text);
});
it("page boundaries keep Chinese closing punctuation with its preceding character", () => {
  const text = "返回城里，风停了。";
  const segments = Array.from(
    new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text),
  );
  const n = typographyBoundary(text, segments, 4);
  expect(text.slice(segments[n].index)).toBe("里，风停了。");
});
it("opening quotes stay with the following text at a page boundary", () => {
  const text = "他说：“明天出发。”";
  const segments = Array.from(
    new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text),
  );
  const n = typographyBoundary(text, segments, 4);
  expect(text.slice(segments[n].index)).toBe("“明天出发。”");
});
it("reading anchors locate the same passage after page boundaries change", () => {
  const blocks = paragraphs("abcdef");
  expect(
    pageAt(
      [
        { blocks, start: 0, end: 2 },
        { blocks, start: 2, end: 6 },
      ],
      3,
    ),
  ).toBe(1);
  expect(
    pageAt(
      [
        { blocks, start: 0, end: 4 },
        { blocks, start: 4, end: 6 },
      ],
      3,
    ),
  ).toBe(0);
});
