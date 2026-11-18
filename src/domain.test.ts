import { describe, it, expect } from "vitest";
import {
  hanCount,
  approved,
  blankChapter,
  status,
  withReaderDefaults,
  DEFAULT_TITLE_STYLE,
  DEFAULT_HEADER,
  DEFAULT_FOOTER,
  type ReaderState,
} from "./domain";
import { headingKey, headingStyle } from "./chapter-heading";
describe("writer UI status", () => {
  it("requires the exact approved immutable version and current working text", () => {
    const c = blankChapter();
    c.id = "c1";
    c.working = "正文";
    c.currentVersionId = "v1";
    c.approvedVersionId = "v1";
    c.versions = [
      {
        id: "v1",
        chapterId: "c1",
        number: 1,
        content: "正文",
        author: "manual",
        baseVersionId: "",
        createdAt: 1,
        branch: false,
      },
    ];
    expect(approved(c)).toBe(true);
    c.working = "作者修改";
    expect(approved(c)).toBe(false);
    expect(status(c)).toBe("草稿");
  });
  it("counts Han characters without treating punctuation as words", () => {
    expect(hanCount("你好，世界！123abc")).toBe(4);
  });
  it("fills missing REQ-FE-306/307 reader fields while preserving saved values", () => {
    const legacy = {
      fontFamily: "NanoOldSong",
      paragraphSpacing: 12,
      pageMargin: 44,
      imageId: "",
      totalPages: 0,
      lastReadAt: 0,
      chapterId: "c1",
      offset: 18,
      fontSize: 18,
      lineHeight: 1.8,
      zoom: 100,
      theme: "paper",
      layout: "double",
      bookmarks: [],
    } as unknown as ReaderState;
    const filled = withReaderDefaults(legacy);
    expect(filled.readingMode).toBe("paged");
    expect(filled.titleStyle).toEqual(DEFAULT_TITLE_STYLE);
    expect(filled.header).toEqual(DEFAULT_HEADER);
    expect(filled.footer).toEqual(DEFAULT_FOOTER);

    const custom = withReaderDefaults({
      ...filled,
      readingMode: "scroll",
      titleStyle: { ...DEFAULT_TITLE_STYLE, enabled: true, fontSize: 36, spaceBefore: 16 },
      header: { enabled: false, left: "none", center: "book-page", right: "progress", fontSize: 14 },
    });
    expect(custom.readingMode).toBe("scroll");
    expect(custom.titleStyle.enabled).toBe(true);
    expect(custom.titleStyle.fontSize).toBe(36);
    expect(custom.header.center).toBe("book-page");
    expect(headingKey(DEFAULT_TITLE_STYLE)).toBe("off");
    expect(headingKey(custom.titleStyle)).not.toBe("off");
    expect(headingStyle(custom.titleStyle, { first: true, last: false })).toMatchObject({
      paddingTop: "16px",
      paddingBottom: "0px",
    });
    expect(headingStyle(custom.titleStyle, { first: false, last: true })).toMatchObject({
      paddingTop: "0px",
      paddingBottom: "20px",
    });
  });
});
