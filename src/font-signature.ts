// 分页签名中的字体身份：仅 document.fonts.check() 的布尔值不足以发现
// “同名字体被替换”（替换前后 check 都为 true）。这里为每个 FontFace 对象分配
// 会话内稳定编号，签名包含与当前排版相关字体族的 FontFace 编号与状态，
// 字体替换/加载完成/加载失败都会改变签名，从而使可见页、预取与全书索引一起失效。

export interface FaceLike {
  family: string;
  weight: string;
  style: string;
  status: string;
}

const ids = new WeakMap<object, number>();
let seq = 0;

function faceId(face: object): number {
  let id = ids.get(face);
  if (id === undefined) {
    id = ++seq;
    ids.set(face, id);
  }
  return id;
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "").toLowerCase();

/** 解析 CSS font-family 列表（可多个计算值），返回小写去引号的族名集合 */
export function familyNames(...families: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of families)
    for (const part of f.split(",")) {
      const name = unquote(part);
      if (name) out.add(name);
    }
  return out;
}

/**
 * 相关字体族的 FontFace 身份签名。没有匹配的 FontFace（系统字体）时返回 "system"。
 * faces 通常为 document.fonts；测试可传数组。
 */
export function fontFacesSignature(
  faces: Iterable<FaceLike & object>,
  families: Set<string>,
): string {
  const parts: string[] = [];
  for (const f of faces) {
    if (!families.has(unquote(f.family))) continue;
    parts.push(`${unquote(f.family)}#${faceId(f)}:${f.weight}:${f.style}:${f.status}`);
  }
  return parts.length ? parts.sort().join(",") : "system";
}

export function documentFontsSignature(...families: string[]): string {
  try {
    return fontFacesSignature(
      document.fonts as unknown as Iterable<FaceLike & object>,
      familyNames(...families),
    );
  } catch {
    return "unknown";
  }
}
