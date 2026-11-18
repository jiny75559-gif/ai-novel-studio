import type { RefObject } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type {
  BandSlot,
  PageBand,
  ReaderState,
  TitleFont,
  TitleStyle,
} from "./domain";
import { FontLoadNotice, FontManager, useReaderFonts } from "./FontManager";
import { customFontId } from "./font-family";
import { useFontLoad } from "./useFontLoader";

const BODY_FONTS = [
  { id: "NanoOldSong", name: "纳米老宋" },
  { id: "SimSun", name: "宋体" },
  { id: "Microsoft YaHei", name: "微软雅黑" },
  { id: "Georgia", name: "Georgia" },
];

const TITLE_FONTS: { id: TitleFont; name: string }[] = [
  { id: "inherit", name: "跟随正文" },
  { id: "NanoOldSong", name: "纳米老宋" },
  { id: "SimSun", name: "宋体" },
  { id: "Microsoft YaHei", name: "微软雅黑" },
  { id: "Georgia", name: "Georgia" },
];

const SLOT_CHOICES: { id: BandSlot; name: string }[] = [
  { id: "none", name: "空" },
  { id: "book-title", name: "书名" },
  { id: "chapter-title", name: "章节标题" },
  { id: "chapter-page", name: "本章页码" },
  { id: "book-page", name: "全书页码" },
  { id: "progress", name: "全书进度" },
];

function withCurrent(presets: number[], current: number): number[] {
  return presets.includes(current)
    ? presets
    : [...presets, current].sort((a, b) => a - b);
}

function BandEditor({
  title,
  band,
  onChange,
}: {
  title: "页眉" | "页脚";
  band: PageBand;
  onChange: (next: PageBand) => void;
}) {
  const patch = (p: Partial<PageBand>) => onChange({ ...band, ...p });
  return (
    <div className="reader-settings-subblock">
      <div className="reader-check-header">
        <label className="reader-check-label">
          <input
            type="checkbox"
            aria-label={`显示${title}`}
            checked={band.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>显示{title}</span>
        </label>
        {band.enabled && (
          <select
            className="reader-band-size"
            aria-label={`${title}字号`}
            value={band.fontSize}
            onChange={(e) => patch({ fontSize: +e.target.value })}
          >
            {withCurrent([8, 9, 10, 11, 12, 13, 14, 16, 18], band.fontSize).map(
              (n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ),
            )}
          </select>
        )}
      </div>
      {band.enabled && (
        <div className="reader-band-slots">
          {(
            [
              ["left", `${title}左侧`, "左"],
              ["center", `${title}中间`, "中"],
              ["right", `${title}右侧`, "右"],
            ] as const
          ).map(([key, aria, short]) => (
            <label key={key}>
              <span>{short}</span>
              <select
                aria-label={aria}
                value={band[key]}
                onChange={(e) => patch({ [key]: e.target.value as BandSlot })}
              >
                {SLOT_CHOICES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const patchTitle = (p: Partial<TitleStyle>) =>
    change({ titleStyle: { ...state.titleStyle, ...p } });
  // 字体库：正文单选与标题下拉共用；面板打开时读取
  const fontLibrary = useReaderFonts(open && !pdf);
  const titleCustomId = customFontId(state.titleStyle.fontFamily);
  // 仅观察（不自动重试）；标题未启用时不加载
  const titleLoad = useFontLoad(
    !pdf && state.titleStyle.enabled ? state.titleStyle.fontFamily : "",
  );
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
              <div className="reader-settings-section">
                <h4>正文字体</h4>
                <label className="reader-setting-row">
                  <span>内置字体</span>
                  <select
                    aria-label="阅读字体"
                    value={state.fontFamily.startsWith("font:") ? "" : state.fontFamily}
                    onChange={(e) => change({ fontFamily: e.target.value })}
                  >
                    <option value="" disabled>
                      {state.fontFamily.startsWith("font:") ? "自定义字体" : "请选择"}
                    </option>
                    {BODY_FONTS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <FontManager
                  library={fontLibrary}
                  currentFont={state.fontFamily}
                  onSelect={(fontFamily) => change({ fontFamily })}
                />
              </div>
              <div className="reader-settings-grid">
                <label>
                  字号
                  <select
                    aria-label="阅读字号"
                    value={state.fontSize}
                    onChange={(e) => change({ fontSize: +e.target.value })}
                  >
                    {[12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48].map((n) => (
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
                    {[1.0, 1.2, 1.4, 1.6, 1.8, 1.9, 2.1, 2.3, 2.5, 2.8].map((n) => (
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
                    {[0, 6, 12, 18, 24, 32, 40, 48].map((n) => (
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
                    {[8, 16, 24, 32, 44, 52, 64, 80, 96].map((n) => (
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
              PDF 保留原字体、图片与排版；可调整缩放、版式、阅读方式和背景。
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
            <span>阅读方式</span>
            <select
              aria-label="阅读方式"
              value={state.readingMode}
              onChange={(e) =>
                change({
                  readingMode: e.target.value === "scroll" ? "scroll" : "paged",
                })
              }
            >
              <option value="paged">翻页</option>
              <option value="scroll">连续滚动</option>
            </select>
          </label>
          {!pdf && (
            <div className="reader-settings-section">
              <h4>章节标题与页眉页脚</h4>
              <div className="reader-settings-subblock">
                <div className="reader-check-header">
                  <label className="reader-check-label">
                    <input
                      type="checkbox"
                      aria-label="显示章节标题"
                      checked={state.titleStyle.enabled}
                      onChange={(e) => patchTitle({ enabled: e.target.checked })}
                    />
                    <span>显示独立章节标题</span>
                  </label>
                </div>
                {state.titleStyle.enabled && (
                  <>
                    <label className="reader-setting-row">
                      <span>标题字体</span>
                      <select
                        aria-label="标题字体"
                        value={state.titleStyle.fontFamily}
                        onChange={(e) =>
                          patchTitle({ fontFamily: e.target.value as TitleFont })
                        }
                      >
                        {TITLE_FONTS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                        {fontLibrary.fonts.length > 0 && (
                          <optgroup label="已导入字体">
                            {fontLibrary.fonts.map((f) => (
                              <option key={f.id} value={`font:${f.id}`}>
                                {fontLibrary.labels.get(f.id) || f.familyName}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {titleCustomId &&
                          !fontLibrary.fonts.some((f) => f.id === titleCustomId) && (
                            // 已保存的自定义标题字体尚未出现在列表中：如实显示，不误显示“跟随正文”
                            <option value={state.titleStyle.fontFamily}>
                              {fontLibrary.loaded
                                ? "自定义字体（字体库中未找到）"
                                : "自定义字体（正在读取字体库…）"}
                            </option>
                          )}
                      </select>
                    </label>
                    <FontLoadNotice view={titleLoad} role="标题" />
                    <div className="reader-settings-grid">
                      <label>
                        标题字号
                        <select
                          aria-label="标题字号"
                          value={state.titleStyle.fontSize}
                          onChange={(e) =>
                            patchTitle({ fontSize: +e.target.value })
                          }
                        >
                          {withCurrent(
                            [14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56],
                            state.titleStyle.fontSize,
                          ).map((n) => (
                            <option key={n} value={n}>
                              {n} px
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        标题字重
                        <select
                          aria-label="标题字重"
                          value={state.titleStyle.fontWeight}
                          onChange={(e) =>
                            patchTitle({
                              fontWeight: +e.target.value as 400 | 500 | 600 | 700,
                            })
                          }
                        >
                          {[
                            [400, "常规 (400)"],
                            [500, "适中 (500)"],
                            [600, "半粗 (600)"],
                            [700, "加粗 (700)"],
                          ].map(([w, label]) => (
                            <option key={w} value={w}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="reader-setting-row">
                      <span>标题对齐</span>
                      <select
                        aria-label="标题对齐"
                        value={state.titleStyle.align}
                        onChange={(e) =>
                          patchTitle({
                            align: e.target.value as "left" | "center" | "right",
                          })
                        }
                      >
                        <option value="left">左对齐</option>
                        <option value="center">居中</option>
                        <option value="right">右对齐</option>
                      </select>
                    </label>
                    <div className="reader-settings-grid">
                      <label>
                        段前间距
                        <select
                          aria-label="标题段前距"
                          value={state.titleStyle.spaceBefore}
                          onChange={(e) =>
                            patchTitle({ spaceBefore: +e.target.value })
                          }
                        >
                          {withCurrent(
                            [0, 4, 8, 12, 16, 20, 24, 32, 40, 56, 80],
                            state.titleStyle.spaceBefore,
                          ).map((n) => (
                            <option key={n} value={n}>
                              {n} px
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        段后间距
                        <select
                          aria-label="标题段后距"
                          value={state.titleStyle.spaceAfter}
                          onChange={(e) =>
                            patchTitle({ spaceAfter: +e.target.value })
                          }
                        >
                          {withCurrent(
                            [0, 4, 8, 12, 16, 20, 24, 32, 40, 56, 80],
                            state.titleStyle.spaceAfter,
                          ).map((n) => (
                            <option key={n} value={n}>
                              {n} px
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </>
                )}
              </div>
              <BandEditor
                title="页眉"
                band={state.header}
                onChange={(header) => change({ header })}
              />
              <BandEditor
                title="页脚"
                band={state.footer}
                onChange={(footer) => change({ footer })}
              />
            </div>
          )}
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
