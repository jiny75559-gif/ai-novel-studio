import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Trash2, AlertCircle, RotateCcw, Loader2 } from "lucide-react";
import { command, errorMessage } from "./bridge";
import type { ReaderFontInfo } from "./domain";
import { Button } from "./components";
import { dedupeFonts, fontLabels, shortFingerprint, upsertFont } from "./font-family";
import { fontStore, useFontLoad, type FontLoadView } from "./useFontLoader";

/**
 * 字体库列表：ReaderPreferences 持有，正文单选与标题下拉共用同一份数据。
 * 所有更新均为函数式 + 按 ID upsert/去重，重复导入同一文件不会产生重复项（RF-REV-403）。
 */
export function useReaderFonts(active: boolean) {
  const [fonts, setFonts] = useState<ReaderFontInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const list = await command<ReaderFontInfo[]>("list_reader_fonts");
      if (mine !== seq.current) return; // 迟到的旧列表不覆盖
      setFonts(dedupeFonts(list));
      setLoaded(true);
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);
  const labels = useMemo(() => fontLabels(fonts), [fonts]);
  useEffect(() => {
    fontStore.setNames(fonts.map((f) => ({ id: f.id, label: labels.get(f.id) || f.familyName })));
  }, [fonts, labels]);
  const upsert = useCallback((font: ReaderFontInfo) => {
    // 导入结果后到：作废进行中的旧列表请求，避免旧列表覆盖新增项
    seq.current++;
    setLoading(false);
    setFonts((prev) => upsertFont(prev, font));
  }, []);
  const remove = useCallback((id: string) => {
    seq.current++;
    setLoading(false);
    setFonts((prev) => prev.filter((f) => f.id !== id));
  }, []);
  return { fonts, labels, loaded, loading, error, reload, upsert, remove };
}

export type ReaderFontLibrary = ReturnType<typeof useReaderFonts>;

/** 字体字节加载状态提示：加载中 / 失败可重试（阅读设置与阅读区共用样式） */
export function FontLoadNotice({
  view,
  role,
}: {
  view: FontLoadView;
  /** 用途：正文 / 标题 */
  role: string;
}) {
  if (!view.fontId) return null;
  const name = view.name || "自定义字体";
  if (view.status === "loading")
    return (
      <p className="font-load-note" aria-live="polite">
        <Loader2 size={13} className="spin" />
        正在加载{role}字体“{name}”…
      </p>
    );
  if (view.status !== "error") return null;
  return (
    <div className="inline-note error font-load-error" role="alert">
      <AlertCircle size={14} />
      <span>
        {role}字体“{name}”加载失败：{view.error} 暂以系统字体显示，已保存的选择未改变。
      </span>
      <button type="button" className="retry-link" onClick={view.retry}>
        重试加载字体
      </button>
    </div>
  );
}

export function FontManager({
  library,
  currentFont,
  onSelect,
}: {
  library: ReaderFontLibrary;
  currentFont: string;
  onSelect: (fontId: string) => void;
}) {
  const { fonts, labels, loaded, loading, error: listError, reload, upsert, remove } = library;
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const bodyLoad = useFontLoad(currentFont);

  const handleImport = async () => {
    setImporting(true);
    setError("");
    setInfo("");
    try {
      const result = await command<ReaderFontInfo | null>("import_reader_font");
      if (result) {
        const existed = fonts.some((f) => f.id === result.id);
        upsert(result);
        // 同字节重导返回既有 ID：可能修复了库存字节，已使用过的字体强制重读并重建 FontFace
        void fontStore.refresh(result.id);
        setInfo(
          existed
            ? `“${result.familyName}”已在字体库中（同一文件），未新增条目，已重新载入。`
            : `已导入“${result.familyName} · ${result.styleName}”，选择后才会应用到本书。`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (fontId: string) => {
    if (!confirm("确定要删除此字体吗？正在使用的作品将无法删除。")) return;
    setDeleting(fontId);
    setError("");
    setInfo("");
    try {
      await command("delete_reader_font", { fontId });
      remove(fontId);
      fontStore.forget(fontId);
      if (currentFont === `font:${fontId}`) {
        onSelect("NanoOldSong");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  if (loading && !loaded) {
    return <p className="reader-settings-hint">正在加载字体列表…</p>;
  }

  return (
    <div className="font-manager">
      {listError && (
        <div className="inline-note error" role="alert">
          <AlertCircle size={14} />
          <span>字体列表读取失败：{listError}</span>
          <button type="button" className="retry-link" onClick={() => void reload()}>
            <RotateCcw size={12} /> 重试读取字体列表
          </button>
        </div>
      )}
      {error && (
        <div className="inline-note error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      <FontLoadNotice view={bodyLoad} role="正文" />
      {info && (
        <p className="font-load-note" aria-live="polite">
          {info}
        </p>
      )}
      {fonts.length > 0 && (
        <div className="font-list" role="radiogroup" aria-label="已导入字体">
          {fonts.map((font) => {
            const label = labels.get(font.id) || font.familyName;
            return (
              <div key={font.id} className="font-item" data-font-id={font.id}>
                <label
                  title={`${font.familyName} · ${font.styleName}\n指纹 ${shortFingerprint(font)}\n导入于 ${new Date(font.createdAt).toLocaleString()}`}
                >
                  <input
                    type="radio"
                    name="reader-body-font"
                    checked={currentFont === `font:${font.id}`}
                    onChange={() => onSelect(`font:${font.id}`)}
                  />
                  <span className="font-name">{label}</span>
                  <span className="font-meta">
                    {font.format.toUpperCase()} · {Math.max(1, Math.round(font.byteLength / 1024))} KB
                  </span>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="删除字体"
                  title={`删除字体 ${label}`}
                  disabled={deleting === font.id}
                  onClick={() => void handleDelete(font.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <Button onClick={handleImport} busy={importing} disabled={importing}>
        <Upload size={15} />
        导入字体文件
      </Button>
    </div>
  );
}
