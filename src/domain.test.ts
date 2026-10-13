import { describe, it, expect } from "vitest";
import { hanCount, approved, blankChapter, status } from "./domain";
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
});
