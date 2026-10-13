import type { RefObject } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { ReaderState } from "./domain";
export function ReaderPreferences({
  state,
  change,
  open,
  setOpen,
  panelRef,
  buttonRef,
  pdf = false,
}: {
  state: ReaderState;
  change: (s: Partial<ReaderState>) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  pdf?: boolean;
}) {
  const choices = [
    { id: "paper", name: "暖纸" },
    { id: "white", name: "白纸" },
    { id: "night", name: "夜读" },
  ];
  return (
    <div className="reader-preferences" ref={panelRef}>
      <button
        ref={buttonRef}
        className={`button ghost ${open ? "is-open" : ""}`}
        aria-label="阅读设置"
        aria-expanded={open}
        aria-controls="reader-settings"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={17} />
        <span>阅读设置</span>
      </button>
      {open && (
        <div
          className="reader-settings"
          id="reader-settings"
          role="dialog"
          aria-label="阅读设置"
        >
          <header>
            <div>
              <h3>阅读设置</h3>
              <p>找到适合你的阅读方式</p>
            </div>
            <button
              className="icon-button reader-settings-close"
              aria-label="关闭阅读设置"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          </header>
          {!pdf && (
            <>
              <label className="reader-setting-row">
                <span>正文字体</span>
                <select
                  aria-label="阅读字体"
                  value={state.fontFamily}
                  onChange={(e) => change({ fontFamily: e.target.value })}
                >
                  {[
                    { id: "NanoOldSong", name: "纳米老宋" },
                    { id: "SimSun", name: "宋体" },
                    { id: "Microsoft YaHei", name: "微软雅黑" },
                    { id: "Georgia", name: "Georgia" },
                  ].map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="reader-settings-grid">
                <label>
                  字号
                  <select
                    aria-label="阅读字号"
                    value={state.fontSize}
                    onChange={(e) => change({ fontSize: +e.target.value })}
                  >
                    {[16, 18, 20, 22, 24, 28, 32, 36].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  行距
                  <select
                    aria-label="阅读行距"
                    value={state.lineHeight}
                    onChange={(e) => change({ lineHeight: +e.target.value })}
                  >
                    {[1.4, 1.6, 1.8, 1.9, 2.1, 2.3].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="reader-settings-grid">
                <label>
                  段距
                  <select
                    aria-label="阅读段距"
                    value={state.paragraphSpacing}
                    onChange={(e) =>
                      change({ paragraphSpacing: +e.target.value })
                    }
                  >
                    {[0, 6, 12, 18, 24, 32].map((n) => (
                      <option key={n} value={n}>
                        {n} px
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  页边距
                  <select
                    aria-label="阅读页边距"
                    value={state.pageMargin}
                    onChange={(e) => change({ pageMargin: +e.target.value })}
                  >
                    {[24, 32, 44, 52, 64].map((n) => (
                      <option key={n} value={n}>
                        {n} px
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
          {pdf && (
            <p className="reader-settings-hint">
              PDF 保留原字体、图片与排版；可调整缩放、版式和阅读背景。
            </p>
          )}
          <label className="reader-setting-row">
            <span>页面缩放</span>
            <select
              aria-label="阅读缩放"
              value={state.zoom}
              onChange={(e) => change({ zoom: +e.target.value })}
            >
              {[
                50,
                65,
                80,
                90,
                100,
                120,
                140,
                160,
                ...(pdf ? [200, 250, 300, 400] : []),
              ].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
          <label className="reader-setting-row">
            <span>页面布局</span>
            <select
              aria-label="阅读版式"
              value={state.layout}
              onChange={(e) => change({ layout: e.target.value })}
            >
              <option value="double">双页 · 书本</option>
              <option value="single">单页 · 纸张</option>
            </select>
          </label>
          <label className="reader-setting-row">
            <span>阅读主题</span>
            <select
              aria-label="阅读主题"
              value={state.theme}
              onChange={(e) => change({ theme: e.target.value })}
            >
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="reader-theme-swatches"
            role="group"
            aria-label="快捷阅读主题"
          >
            {choices.map((t) => (
              <button
                key={t.id}
                aria-label={t.name}
                className={`theme-swatch swatch-${t.id} ${state.theme === t.id ? "selected" : ""}`}
                aria-pressed={state.theme === t.id}
                onClick={() => change({ theme: t.id })}
              >
                <i>Aa</i>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
          <p className="reader-settings-hint">
            自动适配窗口大小，阅读进度随时保存。
          </p>
        </div>
      )}
    </div>
  );
}
