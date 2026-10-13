import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize2,
  Minimize2,
  ScanLine,
  Trash2,
  Download,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { Actions } from "./App";
import type { BookOutline, PdfRect, Project, ReaderState } from "./domain";
import { command, errorMessage } from "./bridge";
import { Button, Modal } from "./components";
import { ReaderPreferences } from "./ReaderPreferences";
import {
  ReadingLibrary,
  useReadingMarks,
  type ReadingSearchResult,
} from "./ReadingTools";
import { BookContents } from "./BookContents";
GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({
  doc,
  pageNumber,
  density,
  project,
  edit,
  region,
  onRegion,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  density: number;
  project: Project;
  edit: ReturnType<typeof useReadingMarks>["edit"];
  region: boolean;
  onRegion: (r: PdfRect) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    start = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 430, height: 640, scale: 1 }),
    [ready, setReady] = useState(false),
    [failure, setFailure] = useState("");
  useEffect(() => {
    let live = true,
      render: RenderTask | undefined,
      layer: TextLayer | undefined;
    setReady(false);
    setFailure("");
    void doc
      .getPage(pageNumber)
      .then(async (page) => {
        if (!live || !canvas.current || !text.current) return;
        const raw = page.getViewport({ scale: 1 }),
          scale = Math.min(430 / raw.width, 640 / raw.height),
          viewport = page.getViewport({ scale });
        const c = canvas.current,
          container = text.current;
        c.width = Math.ceil(viewport.width * density);
        c.height = Math.ceil(viewport.height * density);
        container.replaceChildren();
        container.style.setProperty("--total-scale-factor", String(scale));
        setSize({ width: viewport.width, height: viewport.height, scale });
        render = page.render({
          canvas: c,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
        });
        layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        });
        await Promise.all([render.promise, layer.render()]);
        if (live) setReady(true);
      })
      .catch((e) => {
        if (live && e?.name !== "RenderingCancelledException")
          setFailure("这一页暂时无法显示，请重新打开文件。 " + errorMessage(e));
      });
    return () => {
      live = false;
      render?.cancel();
      layer?.cancel();
    };
  }, [doc, pageNumber, density]);
  return (
    <article
      className="book-leaf pdf-leaf"
      aria-label={`PDF 第 ${pageNumber} 页`}
    >
      <div
        className={`pdf-page ${region ? "region-mode" : ""}`}
        data-page={pageNumber}
        data-ready={ready}
        style={
          {
            width: size.width,
            height: size.height,
            "--total-scale-factor": size.scale,
          } as CSSProperties
        }
        onPointerDown={(e) => {
          if (!region) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const box = e.currentTarget.getBoundingClientRect();
          start.current = {
            x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
            y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
          };
        }}
        onPointerUp={(e) => {
          if (!region || !start.current) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect(),
            end = {
              x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
              y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
            },
            first = start.current;
          start.current = null;
          const r = {
            page: pageNumber,
            x: Math.min(first.x, end.x),
            y: Math.min(first.y, end.y),
            width: Math.abs(end.x - first.x),
            height: Math.abs(end.y - first.y),
          };
          if (r.width > 0.005 && r.height > 0.005) onRegion(r);
        }}
      >
        <canvas
          ref={canvas}
          style={{ width: size.width, height: size.height }}
          aria-label={`PDF 第 ${pageNumber} 页原版面`}
        />
        <div ref={text} className="textLayer" />
        {project.readingMarks.flatMap((m) =>
          m.pdfRects
            .filter((r) => r.page === pageNumber)
            .map((r, i) => (
              <button
                key={`${m.id}-${i}`}
                className={`pdf-highlight mark-${m.color}`}
                aria-label={m.note ? `批注：${m.note}` : "编辑高亮批注"}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
                }}
                onClick={() => edit(m)}
                title={m.note || m.quote}
              />
            )),
        )}
        {!ready && !failure && (
          <span className="pdf-page-loading">读取第 {pageNumber} 页…</span>
        )}
        {failure && <p className="pdf-page-error">{failure}</p>}
      </div>
    </article>
  );
}
export function PdfReader({
  project,
  actions,
}: {
  project: Project;
  actions: Actions;
}) {
  const [settings, setSettings] = useState<ReaderState>(project.reader),
    [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [failure, setFailure] = useState(""),
    [index, setIndex] = useState(project.reader.offset),
    [toc, setToc] = useState(false),
    [preferences, setPreferences] = useState(false),
    [focus, setFocus] = useState(false),
    [region, setRegion] = useState(false),
    [fit, setFit] = useState(1),
    [outline, setOutline] = useState<BookOutline[]>([]),
    [password, setPassword] = useState<string | null>(null),
    [passwordValue, setPasswordValue] = useState("");
  const stage = useRef<HTMLDivElement>(null),
    panelRef = useRef<HTMLDivElement>(null),
    buttonRef = useRef<HTMLButtonElement>(null),
    saveFn = useRef(actions.saveReader),
    saved = useRef(settings),
    options = useRef({ preferences, focus, region }),
    passwordFn = useRef<((p: string) => void) | null>(null),
    turnRef = useRef<(n: number) => void>(() => {});
  saveFn.current = actions.saveReader;
  options.current = { preferences, focus, region };
  saved.current = settings;
  const marks = useReadingMarks(project, actions),
    double = settings.layout === "double",
    step = double ? 2 : 1;
  const change = (s: Partial<ReaderState>) =>
    setSettings((old) => ({ ...old, ...s }));
  const goto = (_cid: string, offset: number) => {
    if (!doc) return;
    const n =
      Math.floor(Math.max(0, Math.min(doc.numPages - 1, offset)) / step) * step;
    marks.clear();
    setIndex(n);
    change({ offset: n });
  };
  turnRef.current = (n) => goto("", index + n * step);
  useEffect(() => {
    let live = true,
      task: ReturnType<typeof getDocument> | undefined;
    void command<ArrayBuffer>("pdf_data", { projectId: project.id })
      .then(async (data) => {
        if (!live) return;
        const asset = (name: string) =>
          new URL(`/pdfjs/${name}/`, location.href).href;
        task = getDocument({
          data: new Uint8Array(data),
          cMapUrl: asset("cmaps"),
          cMapPacked: true,
          standardFontDataUrl: asset("standard_fonts"),
          wasmUrl: asset("wasm"),
          iccUrl: asset("iccs"),
          enableXfa: false,
          maxImageSize: 80_000_000,
        });
        task.onPassword = (fn: (p: string) => void, reason: number) => {
          if (live) {
            passwordFn.current = fn;
            setPassword(
              reason === 2
                ? "密码不正确，请重新输入。"
                : "这个 PDF 需要阅读密码。",
            );
          }
        };
        const pdf = await task.promise;
        if (!live) return;
        setPassword(null);
        const n =
          Math.floor(Math.min(project.reader.offset, pdf.numPages - 1) / step) *
          step;
        setIndex(n);
        setSettings((s) => ({ ...s, offset: n, totalPages: pdf.numPages }));
        const items = await pdf.getOutline();
        type Item = NonNullable<typeof items>[number];
        const parse = async (
          list: Item[],
          depth = 0,
        ): Promise<BookOutline[]> => {
          if (depth > 32) return [];
          const result: BookOutline[] = [];
          for (const item of list) {
            let dest = item.dest;
            if (typeof dest === "string") dest = await pdf.getDestination(dest);
            const children = await parse(item.items, depth + 1);
            let page = children[0]?.offset ?? 0;
            if (Array.isArray(dest) && dest[0] !== undefined) {
              try {
                page =
                  typeof dest[0] === "number"
                    ? dest[0]
                    : await pdf.getPageIndex(dest[0]);
              } catch {
                /* retain navigable child */
              }
            }
            result.push({
              title: item.title,
              chapterId: `pdf-${page}`,
              offset: page,
              children,
            });
          }
          return result;
        };
        const parsed = items ? await parse(items) : [];
        if (live)
          setOutline(
            parsed.length
              ? parsed
              : Array.from({ length: pdf.numPages }, (_, i) => ({
                  title: `第 ${i + 1} 页`,
                  chapterId: `pdf-${i}`,
                  offset: i,
                  children: [],
                })),
          );
        try {
          if (!project.coverImageId) {
            const page = await pdf.getPage(1),
              raw = page.getViewport({ scale: 1 }),
              viewport = page.getViewport({
                scale: Math.min(180 / raw.width, 240 / raw.height),
              }),
              canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvas, viewport }).promise;
            const blob = await new Promise<Blob | null>((r) =>
              canvas.toBlob(r, "image/png"),
            );
            if (live && blob) {
              await command("save_pdf_cover", {
                projectId: project.id,
                bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
              });
              await actions.refreshProject();
            }
          }
        } catch {
          /* A thumbnail failure must not block reading the PDF itself. */
        }
        if (live) setDoc(pdf);
      })
      .catch((e) => {
        if (live)
          setFailure(
            e?.name === "InvalidPDFException"
              ? "PDF 文件已损坏或格式无效。请确认文件能够正常打开后重新导入。"
              : errorMessage(e),
          );
      });
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [project.id]);
  useEffect(() => {
    void saveFn.current(project.id, settings);
  }, [settings, project.id]);
  useEffect(
    () => () => {
      void saveFn.current(project.id, saved.current);
    },
    [project.id],
  );
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const resize = () =>
      setFit(
        Math.min(
          1,
          Math.max(0.3, (el.clientWidth - 104) / (double ? 860 : 430)),
          Math.max(0.3, (el.clientHeight - 64) / 640),
        ),
      );
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, [double]);
  useEffect(() => {
    if (!doc) return;
    const n = Math.floor(index / step) * step;
    if (n !== index) {
      setIndex(n);
      change({ offset: n });
    }
  }, [step]);
  useEffect(() => {
    document
      .querySelector(".app-shell")
      ?.classList.toggle("reader-focus", focus);
    return () =>
      document.querySelector(".app-shell")?.classList.remove("reader-focus");
  }, [focus]);
  useEffect(() => {
    if (!preferences) return;
    panelRef.current
      ?.querySelector<HTMLButtonElement>(".reader-settings-close")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !panelRef.current?.contains(e.target))
        setPreferences(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPreferences(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [preferences]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        options.current.preferences ||
        document.querySelector('.modal[role="dialog"]') ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey
      )
        return;
      if (e.key === " " && (e.target as HTMLElement)?.closest("button")) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        turnRef.current(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        turnRef.current(-1);
      } else if (e.key === "Escape") {
        setFocus(false);
        setRegion(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!doc) return;
    let live = true;
    for (const n of [index + step + 1, index + step + 2])
      if (n <= doc.numPages)
        void doc
          .getPage(n)
          .then((p) => (live ? p.getOperatorList() : undefined))
          .catch(() => {});
    if (index > 4)
      void doc
        .getPage(index - 3)
        .then((p) => p.cleanup())
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [doc, index, step]);
  const searchPdf = async (
    q: string,
    signal: AbortSignal,
  ): Promise<ReadingSearchResult[]> => {
    if (!doc) return [];
    const found: ReadingSearchResult[] = [];
    for (
      let i = 1;
      i <= doc.numPages && !signal.aborted && found.length < 200;
      i++
    ) {
      const p = await doc.getPage(i),
        content = await p.getTextContent(),
        text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
        offset = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
      if (offset >= 0)
        found.push({
          chapterId: "",
          offset: i - 1,
          label: `第 ${i} 页`,
          snippet: text.slice(Math.max(0, offset - 24), offset + q.length + 60),
        });
    }
    return found;
  };
  const zoom = (settings.zoom / 100) * fit,
    width = double ? 860 : 430,
    progress = doc
      ? Math.min(100, Math.round(((index + step) / doc.numPages) * 100))
      : 0;
  return (
    <section className={`reader-view pdf-reader reader-${settings.theme}`}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-start">
          <Button
            variant="ghost"
            aria-label="目录与书签"
            aria-expanded={toc}
            onClick={() => setToc(!toc)}
          >
            <List size={17} />
            目录
          </Button>
        </div>
        <div className="reader-heading">
          <strong>{project.title}</strong>
          <span>PDF · 原版式阅读</span>
        </div>
        <div className="reader-toolbar-end">
          <ReaderPreferences
            state={settings}
            change={change}
            open={preferences}
            setOpen={setPreferences}
            panelRef={panelRef}
            buttonRef={buttonRef}
            pdf
          />
          <Button
            variant="ghost"
            aria-label="专注阅读"
            aria-pressed={focus}
            onClick={() => setFocus(!focus)}
          >
            {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </Button>
        </div>
      </div>
      <div className="reading-area">
        {toc && (
          <ReadingLibrary
            project={project}
            actions={actions}
            goto={goto}
            edit={marks.edit}
            pdfSearch={searchPdf}
          >
            <h3>{project.title}</h3>
            <BookContents
              project={{ ...project, bookOutline: outline }}
              chapterId={`pdf-${index}`}
              goto={goto}
            />
            <h3>书签</h3>
            {settings.bookmarks.map((b) => (
              <div className="reader-bookmark" key={b.id}>
                <button onClick={() => goto("", b.offset)}>{b.label}</button>
                <button
                  aria-label="删除书签"
                  onClick={() =>
                    change({
                      bookmarks: settings.bookmarks.filter(
                        (m) => m.id !== b.id,
                      ),
                    })
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              onClick={() =>
                void actions.perform(async () => {
                  await command("export_project", {
                    projectId: project.id,
                    format: "zip",
                  });
                })
              }
            >
              <Download size={14} />
              备份书籍
            </Button>
          </ReadingLibrary>
        )}
        <div
          ref={stage}
          className="book-stage"
          onMouseUp={(e) => {
            if (!region) marks.collect(e.currentTarget);
          }}
        >
          <button
            className="page-turn turn-left"
            aria-label="上一页"
            disabled={!doc || index === 0}
            onClick={() => turnRef.current(-1)}
          >
            <ChevronLeft size={28} />
          </button>
          {doc && (
            <div
              className="book-zoom-frame"
              style={{ width: width * zoom, height: 640 * zoom }}
            >
              <div
                className={`book-spread ${double ? "double" : "single"}`}
                style={{ width, transform: `scale(${zoom})` }}
              >
                {[index + 1, ...(double ? [index + 2] : [])].map((n) =>
                  n <= doc.numPages ? (
                    <PdfPage
                      key={n}
                      doc={doc}
                      pageNumber={n}
                      density={Math.min(
                        3,
                        Math.max(1, devicePixelRatio * zoom),
                      )}
                      project={project}
                      edit={marks.edit}
                      region={region}
                      onRegion={(r) => {
                        marks.select({
                          chapterId: "",
                          start: 0,
                          end: 0,
                          quote: `第 ${r.page} 页 · 区域批注`,
                          pdfRects: [r],
                        });
                        setRegion(false);
                      }}
                    />
                  ) : (
                    <article key="blank" className="book-leaf pdf-leaf" />
                  ),
                )}
              </div>
            </div>
          )}
          <button
            className="page-turn turn-right"
            aria-label="下一页"
            disabled={!doc || index + step >= doc.numPages}
            onClick={() => turnRef.current(1)}
          >
            <ChevronRight size={28} />
          </button>
          {!doc && (
            <div className="pdf-document-state">
              {failure ? (
                <>
                  <h3>暂时无法打开这本 PDF</h3>
                  <p>{failure}</p>
                  <Button onClick={() => void actions.navigate("home")}>
                    返回书架
                  </Button>
                </>
              ) : (
                <p>正在打开 PDF…</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="reader-status">
        <div className="reader-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="reader-position">
          <input
            aria-label="阅读进度"
            type="range"
            min="0"
            max={Math.max(0, (doc?.numPages || 1) - 1)}
            value={index}
            onChange={(e) => goto("", +e.target.value)}
          />
          <span>{progress}%</span>
          <label>
            页
            <input
              aria-label="跳转页码"
              type="number"
              min="1"
              max={doc?.numPages || 1}
              defaultValue={index + 1}
              key={index}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  goto("", +e.currentTarget.value - 1);
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
        <span>
          {doc
            ? `${index + 1}${double && index + 1 < doc.numPages ? `–${index + 2}` : ""} / ${doc.numPages} 页`
            : ""}
        </span>
        <div>
          <Button
            variant="ghost"
            disabled={!doc}
            onClick={() => {
              change({
                bookmarks: [
                  ...settings.bookmarks,
                  {
                    id: crypto.randomUUID(),
                    chapterId: "",
                    offset: index,
                    label: `第 ${index + 1} 页`,
                  },
                ],
              });
              actions.notice("书签已添加。");
            }}
          >
            <BookmarkPlus size={15} />
            添加书签
          </Button>
          <Button
            variant="ghost"
            aria-pressed={region}
            disabled={!doc}
            onClick={() => {
              marks.clear();
              setRegion(!region);
            }}
          >
            <ScanLine size={15} />
            {region ? "拖动框选 · Esc 取消" : "区域批注"}
          </Button>
        </div>
      </div>
      {marks.ui}
      {password && (
        <Modal
          title="PDF 阅读密码"
          onClose={() => {
            setPassword(null);
            setFailure("阅读密码未提供。重新打开时可以再次输入。");
            void actions.navigate("home");
          }}
        >
          <p>{password}</p>
          <input
            type="password"
            autoFocus
            aria-label="PDF 密码"
            value={passwordValue}
            onChange={(e) => setPasswordValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                passwordFn.current?.(passwordValue);
                setPasswordValue("");
                setPassword(null);
              }
            }}
          />
          <footer>
            <Button
              variant="primary"
              onClick={() => {
                passwordFn.current?.(passwordValue);
                setPasswordValue("");
                setPassword(null);
              }}
            >
              打开阅读
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
