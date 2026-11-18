import { describe, expect, it } from "vitest";
import type { ReaderFontInfo } from "./domain";
import {
  customFontId,
  dedupeFonts,
  fontAlias,
  fontLabels,
  fontStack,
  resolveFontFamily,
  resolveTitleFamily,
  upsertFont,
} from "./font-family";
import { headingKey, headingStyle } from "./chapter-heading";
import { DEFAULT_TITLE_STYLE } from "./domain";
import { createFontStore, type FontFaceLike } from "./font-store";
import { mountedRows } from "./text-selection";

const ID_A = "11111111-2222-3333-4444-555555555555";
const ID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const info = (id: string, patch: Partial<ReaderFontInfo> = {}): ReaderFontInfo => ({
  id,
  familyName: "Studio Fixture",
  styleName: "Regular",
  format: "ttf",
  sha256: id.replace(/-/g, "").padEnd(64, "0"),
  byteLength: 2048,
  createdAt: 1,
  ...patch,
});

describe("font-family 解析（RF-REV-404）", () => {
  it("font:<id> 解析为稳定别名，内置字体原样", () => {
    expect(resolveFontFamily(`font:${ID_A}`)).toBe(fontAlias(ID_A));
    expect(fontAlias(ID_A)).toBe("NovelStudioFont_11111111222233334444555555555555");
    expect(resolveFontFamily("SimSun")).toBe("SimSun");
    expect(fontStack(`font:${ID_A}`)).toBe(`"${fontAlias(ID_A)}", serif`);
    expect(customFontId("inherit")).toBeNull();
    expect(customFontId(`font:${ID_B}`)).toBe(ID_B);
  });
  it("标题 inherit 跟随正文实际别名；自定义标题解析为自身别名", () => {
    expect(resolveTitleFamily("inherit", `font:${ID_A}`)).toBe(fontAlias(ID_A));
    expect(resolveTitleFamily(`font:${ID_B}`, "SimSun")).toBe(fontAlias(ID_B));
  });
  it("headingStyle 不把 token 原样写进 CSS；inherit 不写 font-family", () => {
    const custom = { ...DEFAULT_TITLE_STYLE, enabled: true, fontFamily: `font:${ID_B}` as const };
    const style = headingStyle(custom);
    expect(style.fontFamily).toBe(`"${fontAlias(ID_B)}", serif`);
    expect(style.fontFamily).not.toContain("font:");
    expect(headingStyle({ ...custom, fontFamily: "inherit" }).fontFamily).toBeUndefined();
    // 持久化/签名仍以 token 区分不同字体
    expect(headingKey(custom)).toContain(`font:${ID_B}`);
  });
});

describe("字体列表去重与显示名（RF-REV-403）", () => {
  it("重复导入同一 ID 不新增条目", () => {
    let list: ReaderFontInfo[] = [];
    list = upsertFont(list, info(ID_A));
    list = upsertFont(list, info(ID_B));
    list = upsertFont(list, info(ID_A, { createdAt: 9 }));
    expect(list.map((f) => f.id)).toEqual([ID_A, ID_B]);
    expect(list[0].createdAt).toBe(9);
    expect(dedupeFonts([info(ID_A), info(ID_A), info(ID_B)]).length).toBe(2);
  });
  it("同家族同样式不同文件用短指纹区分，且文字各不相同", () => {
    const labels = fontLabels([info(ID_A), info(ID_B)]);
    const a = labels.get(ID_A)!,
      b = labels.get(ID_B)!;
    expect(a).not.toBe(b);
    expect(a).toBe("Studio Fixture · Regular #11111111");
    expect(b).toBe("Studio Fixture · Regular #aaaaaaaa");
  });
  it("家族唯一时只显示家族名；同家族不同样式显示样式名", () => {
    expect(fontLabels([info(ID_A)]).get(ID_A)).toBe("Studio Fixture");
    const labels = fontLabels([info(ID_A), info(ID_B, { styleName: "Bold" })]);
    expect(labels.get(ID_A)).toBe("Studio Fixture · Regular");
    expect(labels.get(ID_B)).toBe("Studio Fixture · Bold");
  });
});

class FakeFace implements FontFaceLike {
  status = "unloaded";
  constructor(
    public family: string,
    public bytes: ArrayBuffer,
    private fail = false,
  ) {}
  async load() {
    if (this.fail) {
      this.status = "error";
      throw new Error("bad");
    }
    this.status = "loaded";
    return this;
  }
}

function setup() {
  const set = new Set<FakeFace>();
  const pending: { id: string; resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }[] = [];
  const store = createFontStore<FakeFace>({
    loadBytes: (id) =>
      new Promise((resolve, reject) => pending.push({ id, resolve, reject })),
    createFace: (alias, bytes) => new FakeFace(alias, bytes, bytes.byteLength === 0),
    fonts: () => set,
    describeError: (e) =>
      typeof e === "object" && e && "userMessage" in e
        ? String((e as { userMessage: string }).userMessage)
        : "损坏",
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { set, pending, store, flush };
}

describe("全局字体存储（RF-REV-405）", () => {
  it("失败可见，重试真正重读字节并成功，同别名只保留一个 Face", async () => {
    const { set, pending, store, flush } = setup();
    void store.ensure(ID_A);
    expect(store.get(ID_A).status).toBe("loading");
    pending.shift()!.reject({ code: "INVALID_FONT", userMessage: "读取失败" });
    await flush();
    expect(store.get(ID_A)).toMatchObject({ status: "error", error: "读取失败", attempts: 1 });
    // 非强制 ensure（如设置面板打开）不自动重试
    void store.ensure(ID_A);
    expect(pending.length).toBe(0);
    void store.retry(ID_A);
    expect(pending.length).toBe(1);
    pending.shift()!.resolve(new ArrayBuffer(4));
    await flush();
    expect(store.get(ID_A)).toMatchObject({ status: "ready", attempts: 2 });
    expect(set.size).toBe(1);
    // 同 ID 重导：强制重建 Face，旧 Face 被替换而不是累积
    void store.refresh(ID_A);
    pending.shift()!.resolve(new ArrayBuffer(8));
    await flush();
    expect(set.size).toBe(1);
    expect([...set][0].bytes.byteLength).toBe(8);
  });
  it("正文/标题同 ID 共享一次加载；迟到的旧请求不覆盖新结果", async () => {
    const { set, pending, store, flush } = setup();
    void store.ensure(ID_A);
    void store.ensure(ID_A);
    expect(pending.length).toBe(1);
    const old = pending.shift()!;
    void store.retry(ID_A); // 新一代请求
    const fresh = pending.shift()!;
    fresh.resolve(new ArrayBuffer(16));
    await flush();
    old.reject({ userMessage: "迟到失败" });
    await flush();
    expect(store.get(ID_A).status).toBe("ready");
    expect(set.size).toBe(1);
  });
  it("Face 被外部移除后重新加载；删除字体作废进行中请求", async () => {
    const { set, pending, store, flush } = setup();
    void store.ensure(ID_A);
    pending.shift()!.resolve(new ArrayBuffer(4));
    await flush();
    set.clear();
    void store.ensure(ID_A);
    expect(pending.length).toBe(1);
    store.forget(ID_A);
    pending.shift()!.resolve(new ArrayBuffer(4));
    await flush();
    expect(store.get(ID_A).status).toBe("idle");
    expect(set.size).toBe(0);
  });
  it("损坏字节（FontFace.load 失败）进入 error", async () => {
    const { pending, store, flush } = setup();
    void store.ensure(ID_B);
    pending.shift()!.resolve(new ArrayBuffer(0));
    await flush();
    expect(store.get(ID_B)).toMatchObject({ status: "error", error: "损坏" });
  });
});

describe("连续滚动挂载行（RF-REV-402）", () => {
  it("只挂可见区间与端点，不挂中间连续区间", () => {
    expect(mountedRows(58, 61, [0, 60], 100)).toEqual([0, 58, 59, 60, 61]);
    expect(mountedRows(88, 93, [0], 94)).toEqual([0, 88, 89, 90, 91, 92, 93]);
    expect(mountedRows(0, 3, [], 100)).toEqual([0, 1, 2, 3]);
    expect(mountedRows(0, 3, [120, -1], 100)).toEqual([0, 1, 2, 3]);
    expect(mountedRows(0, 3, [], 0)).toEqual([]);
  });
});
