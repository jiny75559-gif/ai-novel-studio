import { useEffect, useSyncExternalStore } from "react";
import { command, errorMessage } from "./bridge";
import { customFontId } from "./font-family";
import { createFontStore, IDLE_STATE, type FontLoadState } from "./font-store";

// 兼容既有导入：纯函数统一放在 font-family.ts（标题工厂/probe 也使用，避免依赖 IPC）
export { fontAlias, parseFontFamily, resolveFontFamily } from "./font-family";

/** 全局唯一字体存储：正文/标题/设置面板/多次切书共享同一份 FontFace 与状态 */
export const fontStore = createFontStore<FontFace>({
  loadBytes: (fontId) => command<ArrayBuffer>("reader_font_data", { fontId }),
  createFace: (alias, bytes) => new FontFace(alias, bytes),
  fonts: () => (typeof document !== "undefined" ? document.fonts : null),
  describeError: (e) => {
    if (typeof e === "object" && e && "userMessage" in e) return errorMessage(e);
    // FontFace.load() 的 DOMException（损坏/无法解析）
    return "字体文件无法解析或已损坏，请重新导入该字体后重试。";
  },
});

/** 订阅字体存储版本：任意字体状态变化都会触发重渲染（用于驱动分页签名重测） */
export function useFontStoreVersion(): number {
  return useSyncExternalStore(fontStore.subscribe, fontStore.version, fontStore.version);
}

export interface FontLoadView extends FontLoadState {
  /** 自定义字体 ID；内置字体/inherit 为 null */
  fontId: string | null;
  /** 人类可读名称（字体列表加载过才有） */
  name: string;
  retry: () => void;
}

const BUILTIN_VIEW: FontLoadState = { ...IDLE_STATE, status: "ready" };

/**
 * REQ-FE-308 / RF-REV-405：加载 token 对应的自定义字体并返回可观察状态。
 * retryOnMount=true（阅读器）：此前失败的字体在重新进入时再试一次；设置面板传 false，只观察不自动重试。
 */
export function useFontLoad(token: string, retryOnMount = false): FontLoadView {
  useFontStoreVersion();
  const fontId = customFontId(token);
  useEffect(() => {
    if (fontId) void fontStore.ensure(fontId, { retryError: retryOnMount });
  }, [fontId, retryOnMount]);
  const state = fontId ? fontStore.get(fontId) : BUILTIN_VIEW;
  return {
    ...state,
    fontId,
    name: fontId ? fontStore.name(fontId) : "",
    retry: () => {
      if (fontId) void fontStore.retry(fontId);
    },
  };
}

/** 旧接口：仅触发加载（新代码请使用 useFontLoad 获取状态与重试） */
export function useFontLoader(fontFamily: string) {
  useFontLoad(fontFamily, true);
}
