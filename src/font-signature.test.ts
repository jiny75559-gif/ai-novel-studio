import { describe, expect, it } from "vitest";
import { familyNames, fontFacesSignature } from "./font-signature";

const face = (family: string, status = "loaded") => ({
  family,
  weight: "400",
  style: "normal",
  status,
});

describe("fontFacesSignature", () => {
  const families = familyNames('"NanoOldSong", serif');

  it("系统字体（无匹配 FontFace）为 system", () => {
    expect(fontFacesSignature([face("Other")], familyNames("SimSun, serif"))).toBe(
      "system",
    );
  });

  it("同名字体被替换为新 FontFace 时签名变化（check 均为 true 的情况）", () => {
    const a = face('"NanoOldSong"');
    const b = face("NanoOldSong");
    const before = fontFacesSignature([a], families);
    const after = fontFacesSignature([b], families);
    expect(before).not.toBe(after);
    // 同一对象重复计算签名稳定
    expect(fontFacesSignature([a], families)).toBe(before);
  });

  it("加载状态变化（loading→loaded / error）改变签名", () => {
    const f = face("NanoOldSong", "loading");
    const loading = fontFacesSignature([f], families);
    f.status = "loaded";
    const loaded = fontFacesSignature([f], families);
    f.status = "error";
    expect(loading).not.toBe(loaded);
    expect(fontFacesSignature([f], families)).not.toBe(loaded);
  });

  it("无关字体加载不影响签名", () => {
    const f = face("NanoOldSong");
    const base = fontFacesSignature([f], families);
    expect(fontFacesSignature([f, face("Inter")], families)).toBe(base);
  });
});
