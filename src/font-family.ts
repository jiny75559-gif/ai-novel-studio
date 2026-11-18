// REQ-FE-308：字体 token 与 CSS 族名的纯函数（无 DOM/IPC 依赖，可被测量 probe、标题工厂与测试共用）。
// 持久化值保持 `font:<id>`；渲染前统一解析为稳定别名，绝不把 token 原样写进 CSS。
import type { ReaderFontInfo } from "./domain";

export const CUSTOM_FONT_PREFIX = "font:";

/** 为自定义字体生成稳定的 CSS 别名 */
export function fontAlias(fontId: string): string {
  return `NovelStudioFont_${fontId.replace(/-/g, "")}`;
}

/** 解析 font:<id> 格式或返回内置字体名 */
export function parseFontFamily(fontFamily: string): {
  type: "builtin" | "custom";
  value: string;
} {
  if (fontFamily.startsWith(CUSTOM_FONT_PREFIX)) {
    return { type: "custom", value: fontFamily.slice(CUSTOM_FONT_PREFIX.length) };
  }
  return { type: "builtin", value: fontFamily };
}

/** token 对应的自定义字体 ID；内置/inherit/空返回 null */
export function customFontId(fontFamily: string | undefined | null): string | null {
  if (!fontFamily) return null;
  const parsed = parseFontFamily(fontFamily);
  return parsed.type === "custom" && parsed.value ? parsed.value : null;
}

/** 将 fontFamily token 转换为实际 CSS 族名（不含引号与回退） */
export function resolveFontFamily(fontFamily: string): string {
  const parsed = parseFontFamily(fontFamily);
  return parsed.type === "custom" ? fontAlias(parsed.value) : parsed.value;
}

/** 完整 CSS font-family 值：真实族名 + serif 回退（自定义字体失败/加载中时临时回退，不改写设置） */
export function fontStack(fontFamily: string): string {
  return `"${resolveFontFamily(fontFamily)}", serif`;
}

/**
 * 标题字体的实际 CSS 族名。inherit 跟随正文实际字体（解析后的正文别名），
 * 用于签名与测量；可见标题/probe 中 inherit 不写 font-family，直接继承 leaf-body。
 */
export function resolveTitleFamily(titleFamily: string, bodyFamily: string): string {
  return titleFamily === "inherit"
    ? resolveFontFamily(bodyFamily)
    : resolveFontFamily(titleFamily);
}

/** 短指纹：sha256 前 8 位；缺失时退回 ID 前 8 位 */
export function shortFingerprint(font: Pick<ReaderFontInfo, "id" | "sha256">): string {
  return (font.sha256 || font.id.replace(/-/g, "")).slice(0, 8).toLowerCase();
}

/**
 * RF-REV-403：为字体列表生成可区分的显示名。
 * - 家族名唯一：只显示家族名；
 * - 同家族不同样式：家族名 · 样式名；
 * - 同家族同样式不同文件：再追加稳定短指纹（sha256 前 8 位），保证每一项文字不同。
 */
export function fontLabels(fonts: ReaderFontInfo[]): Map<string, string> {
  const byFamily = new Map<string, number>();
  const byStyle = new Map<string, number>();
  const styleKey = (f: ReaderFontInfo) => `${f.familyName}\u0000${f.styleName}`;
  for (const f of fonts) {
    byFamily.set(f.familyName, (byFamily.get(f.familyName) || 0) + 1);
    byStyle.set(styleKey(f), (byStyle.get(styleKey(f)) || 0) + 1);
  }
  const out = new Map<string, string>();
  for (const f of fonts) {
    let label = f.familyName || "未命名字体";
    if ((byFamily.get(f.familyName) || 0) > 1) label += ` · ${f.styleName || "Regular"}`;
    if ((byStyle.get(styleKey(f)) || 0) > 1) label += ` #${shortFingerprint(f)}`;
    out.set(f.id, label);
  }
  return out;
}

/** 按 ID upsert：已存在则原位替换（不追加重复项），否则追加；返回新数组 */
export function upsertFont(fonts: ReaderFontInfo[], font: ReaderFontInfo): ReaderFontInfo[] {
  const i = fonts.findIndex((f) => f.id === font.id);
  if (i < 0) return [...fonts, font];
  const next = fonts.slice();
  next[i] = font;
  return next;
}

/** 列表按 ID 去重（保留首次出现的位置，后出现的元数据覆盖） */
export function dedupeFonts(fonts: ReaderFontInfo[]): ReaderFontInfo[] {
  return fonts.reduce<ReaderFontInfo[]>((acc, f) => upsertFont(acc, f), []);
}
