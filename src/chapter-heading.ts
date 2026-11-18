// REQ-FE-307 独立章节标题：可见页与测量 probe 共用同一套样式，保证标题占高计入真实分页。
import type { TitleStyle } from "./domain";
import { fontStack } from "./font-family";

export interface HeadingSlice {
  text: string;
  first: boolean;
  last: boolean;
}

export interface HeadingSpec {
  title: string;
  create: (slice: HeadingSlice) => HTMLElement;
}

/** 返回可同时用于 React style 与 element.style 的样式（camelCase 键，字符串值） */
export function headingStyle(
  ts: TitleStyle,
  slice: Pick<HeadingSlice, "first" | "last"> = { first: true, last: true },
): Record<string, string> {
  const style: Record<string, string> = {
    fontSize: `${ts.fontSize}px`,
    fontWeight: String(ts.fontWeight),
    textAlign: ts.align,
    paddingTop: `${slice.first ? ts.spaceBefore : 0}px`,
    paddingBottom: `${slice.last ? ts.spaceAfter : 0}px`,
  };
  // inherit：跟随正文（leaf-body 的 font-family，已是解析后的真实别名）
  // RF-REV-404：font:<id> 必须解析为 NovelStudioFont_ 别名，不能把持久化 token 当 CSS 族名
  if (ts.fontFamily !== "inherit") style.fontFamily = fontStack(ts.fontFamily);
  return style;
}

/** 参与排版签名的标题样式 key；未启用时为 off，不影响旧默认分页 */
export function headingKey(ts: TitleStyle): string {
  return ts.enabled
    ? [ts.fontFamily, ts.fontSize, ts.fontWeight, ts.align, ts.spaceBefore, ts.spaceAfter].join("/")
    : "off";
}

export function headingFactory(
  title: string,
  ts: TitleStyle,
): HeadingSpec | undefined {
  if (!ts.enabled) return undefined;
  return {
    title,
    create: (slice) => {
      const el = document.createElement("div");
      el.className = "chapter-heading";
      el.setAttribute("aria-hidden", "true");
      el.textContent = slice.text || "\u200b";
      Object.assign(el.style, headingStyle(ts, slice));
      return el;
    },
  };
}
