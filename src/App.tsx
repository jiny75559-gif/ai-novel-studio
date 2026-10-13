import {
  useCallback,
  useMemo,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Feather,
  GitBranch,
  Layers3,
  Palette,
  Settings2,
  Plus,
  ChevronRight,
  FolderOpen,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  NotebookPen,
  Sparkles,
  HardDrive,
  ShieldCheck,
  Search,
  X,
} from "lucide-react";
import { command, desktop, errorMessage } from "./bridge";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type AppError,
  type Mutation,
  type Preflight,
  type Project,
  type ProjectCard,
  type Provider,
  type Run,
  type View,
  type ReaderState,
  type ImageJob,
  hanCount,
  approved,
} from "./domain";
import { Badge, Button, Confirm, Empty, Field, Modal } from "./components";
import { Writer } from "./Writer";
import { Outline } from "./Outline";
import { Characters } from "./Characters";
import { Memory } from "./Memory";
import { StylePage } from "./StylePage";
import { SettingsPage } from "./SettingsPage";
import { Reader } from "./Reader";
import { MediaImage } from "./MediaImage";
const PdfReader = lazy(() =>
  import("./PdfReader").then((m) => ({ default: m.PdfReader })),
);
import { Illustrations } from "./Illustrations";
import { WorkspaceBoundary } from "./WorkspaceBoundary";
import { UpdatesPanel } from "./UpdatesPanel";

export interface Actions {
  mutate: (m: Mutation) => Promise<Project | undefined>;
  notice: (s: string) => void;
  run: (
    task: string,
    resumeId?: string,
    automatic?: boolean,
    cid?: string,
  ) => Promise<void>;
  perform: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  navigate: (view: View, cid?: string) => Promise<void>;
  refreshProviders: () => Promise<void>;
  refreshProject: () => Promise<void>;
  saveReader: (pid: string, state: ReaderState) => Promise<void>;
}
const nav = [
  { id: "writer", label: "写作台", icon: Feather },
  { id: "reader", label: "书本阅读", icon: BookOpen },
  { id: "illustrations", label: "插图与形象", icon: Palette },
  { id: "outline", label: "故事大纲", icon: NotebookPen },
  { id: "characters", label: "人物关系", icon: GitBranch },
  { id: "memory", label: "设定与记忆", icon: Layers3 },
  { id: "style", label: "文风", icon: Palette },
  { id: "settings", label: "模型与设置", icon: Settings2 },
] as const;

export function App() {
  const [view, setView] = useState<View>("home");
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const readerPending = useRef(new Map<string, ReaderState>());
  const [librarySort, setLibrarySort] = useState("reading");
  const [cards, setCards] = useState<ProjectCard[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [chapterId, setChapterId] = useState("");
  const chapterRef = useRef("");
  const [body, setBody] = useState("");
  const bodyRef = useRef("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const runsRef = useRef<Run[]>([]);
  const imageStatuses = useRef(new Map<string, string>());
  const [saved, setSaved] = useState("已保存");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<ReactNode>(null);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const [search, setSearch] = useState("");
  const [trash, setTrash] = useState(false);
  const [context, setContext] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(false);
  const notify = useCallback((s: string) => setMessage(s), []);
  const perform = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (e) {
        notify(errorMessage(e));
        return undefined;
      }
    },
    [notify],
  );
  const serialize = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.current.then(fn, fn);
    tail.current = next.catch(() => {});
    return next;
  }, []);
  const accept = useCallback((p: Project) => {
    const old = projectRef.current;
    const cid = chapterRef.current;
    const oldText = old?.chapters.find((c) => c.id === cid)?.working || "";
    if (!old || old.id !== p.id || bodyRef.current === oldText) {
      const newText = p.chapters.find((c) => c.id === cid)?.working || "";
      bodyRef.current = newText;
      setBody(newText);
    }
    projectRef.current = p;
    setProject(p);
  }, []);
  const refreshCards = useCallback(async () => {
    setCards(await command<ProjectCard[]>("list_projects", { trash }));
  }, [trash]);
  const refreshProviders = useCallback(async () => {
    setProviders(await command<Provider[]>("list_providers"));
  }, []);
  useEffect(() => {
    if (desktop) {
      void perform(async () => {
        await Promise.all([refreshCards(), refreshProviders()]);
      });
    }
  }, [perform, refreshCards, refreshProviders]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(timer);
  }, [message]);

  const commitReaderProgress = useCallback(async () => {
    for (const [pid, state] of readerPending.current) {
      const reader = await command<ReaderState>("save_reader", {
        projectId: pid,
        reader: state,
      });
      if (readerPending.current.get(pid) === state)
        readerPending.current.delete(pid);
      if (projectRef.current?.id === pid) {
        const p = { ...projectRef.current, reader };
        projectRef.current = p;
        setProject(p);
      }
    }
  }, []);
  const flush = useCallback(async (): Promise<boolean> => {
    try {
      await serialize(async () => {
        await commitReaderProgress();
        const p = projectRef.current;
        const cid = chapterRef.current;
        if (!p || !cid) return;
        const c = p.chapters.find((c) => c.id === cid);
        if (!c || c.working === bodyRef.current) return;
        setSaved("保存中…");
        const text = bodyRef.current;
        const result = await command<Project>("save_working", {
          projectId: p.id,
          chapterId: cid,
          expectedRevision: c.editRevision,
          content: text,
        });
        accept(result);
        setSaved(bodyRef.current === text ? "已保存" : "编辑中…");
      });
      return true;
    } catch (e) {
      setSaved("保存失败 · 输入仍保留");
      notify(errorMessage(e));
      return false;
    }
  }, [accept, notify, serialize, commitReaderProgress]);
  useEffect(() => {
    if (!projectRef.current || !chapterRef.current) return;
    const timer = setTimeout(() => void flush(), 1500);
    return () => clearTimeout(timer);
  }, [body, chapterId, flush]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const c = projectRef.current?.chapters.find(
        (c) => c.id === chapterRef.current,
      );
      if (c && bodyRef.current !== c.working) {
        e.preventDefault();
        e.returnValue = "正文尚未保存";
        void flush();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flush]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let closing = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          if (await flush()) await getCurrentWindow().destroy();
        } catch (e) {
          notify(errorMessage(e));
        } finally {
          closing = false;
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => notify(errorMessage(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flush, notify]);
  const editBody = (text: string) => {
    bodyRef.current = text;
    setBody(text);
    setSaved("编辑中…");
  };

  const open = async (pid: string, mode?: "writer" | "reader") => {
    if (!(await flush())) return;
    setLoading(true);
    await perform(async () => {
      const p = await command<Project>("load_project", { projectId: pid });
      projectRef.current = p;
      setProject(p);
      const cid =
        mode === "reader" || p.bookSource
          ? p.reader.chapterId || p.chapters[0]?.id || ""
          : p.chapters[0]?.id || "";
      chapterRef.current = cid;
      setChapterId(cid);
      bodyRef.current = p.chapters.find((c) => c.id === cid)?.working || "";
      setBody(bodyRef.current);
      setView(
        p.pdfBook ? "reader" : mode || (p.bookSource ? "reader" : "writer"),
      );
      setSaved("已保存");
      setRuns([]);
      runsRef.current = [];
      setContext(null);
    });
    setLoading(false);
  };
  const navigate = async (next: View, cid?: string) => {
    if (!(await flush())) return;
    if (cid && cid !== chapterRef.current) {
      chapterRef.current = cid;
      setChapterId(cid);
      const text =
        projectRef.current?.chapters.find((c) => c.id === cid)?.working || "";
      bodyRef.current = text;
      setBody(text);
      setSaved("已保存");
      setContext(null);
    }
    setView(next);
  };
  const mutate = async (m: Mutation): Promise<Project | undefined> => {
    if (!(await flush())) return;
    return perform(() =>
      serialize(async () => {
        const p = projectRef.current!;
        const result = await command<Project>("mutate_project", {
          projectId: p.id,
          expectedRevision: p.revision,
          mutation: m,
        });
        accept(result);
        return result;
      }),
    );
  };
  const saveVersion = async (restoreId = "") => {
    if (!(await flush())) return;
    return perform(() =>
      serialize(async () => {
        const p = projectRef.current!;
        const ch = p.chapters.find((c) => c.id === chapterRef.current)!;
        const result = await command<Project>("save_version", {
          projectId: p.id,
          chapterId: ch.id,
          expectedRevision: ch.editRevision,
          restoreId,
        });
        accept(result);
        notify(
          restoreId ? "已作为新版本恢复，可继续编辑。" : "正文版本已保存。",
        );
        return result;
      }),
    );
  };
  const approveChapter = async () => {
    const p = await saveVersion();
    if (!p) return;
    const ch = p.chapters.find((c) => c.id === chapterRef.current)!;
    const report = p.reports.find(
      (r) => !r.stale && r.chapterVersionId === ch.currentVersionId,
    );
    const blockers =
      report?.issues.filter((i) => i.severity === "blocker" && !i.decision)
        .length || 0;
    setModal(
      <Confirm
        title="确认这一章"
        description={
          blockers
            ? `审稿还有 ${blockers} 项阻断意见。你可以决定保留剧情并确认；这些意见不会替你决定作品内容。`
            : report
              ? "确认后，下一章会使用这一版正文。你随时可以重新修改。"
              : "本章尚未审稿。你可以直接确认，或者稍后使用副 AI 检查。"
        }
        label="确认正文"
        onClose={() => setModal(null)}
        onConfirm={async () => {
          const result = await command<Project>("approve_chapter", {
            projectId: p.id,
            chapterId: ch.id,
            versionId: ch.currentVersionId,
            riskReason:
              report && !blockers ? "" : "作者直接确认，保留自己的创作决定。",
          });
          accept(result);
          setModal(null);
          notify("本章已确认。可提取记忆，或进入下一章。");
        }}
      />,
    );
  };
  const start = async (
    task: string,
    cid: string,
    resumeId: string,
    overrideReason: string,
  ) => {
    const p = projectRef.current!;
    const result = await perform(() =>
      command<Run>("start_run", {
        projectId: p.id,
        chapterId: cid,
        task,
        runId: crypto.randomUUID(),
        resumeId,
        overrideReason,
      }),
    );
    if (result) {
      setRuns((old) => [result, ...old]);
      runsRef.current = [result, ...runsRef.current];
      setModal(null);
      notify(
        `${{ write: "开始写作", review: "开始审稿", remember: "开始提取摘要和记忆", revise: "开始定点修订" }[task]}，可随时取消。`,
      );
    }
  };
  const requestRun = async (
    task: string,
    resumeId = "",
    automatic = false,
    cid = chapterRef.current,
  ) => {
    if (!(await flush())) return;
    if (task === "review" || task === "revise") {
      if (cid === chapterRef.current && !(await saveVersion())) return;
    }
    const info = await perform(() =>
      command<Preflight>("preflight", {
        projectId: projectRef.current!.id,
        chapterId: cid,
        task,
      }),
    );
    if (!info) return;
    setContext(info);
    const needsDecision = info.warnings.some(
      (w) => w.includes("已有正文") || w.includes("前文或记忆"),
    );
    if (task !== "write" || (automatic && !needsDecision)) {
      await start(task, cid, resumeId, "");
      return;
    }
    setModal(
      <GenerationConfirm
        info={info}
        recovery={!!resumeId}
        onClose={() => setModal(null)}
        onStart={(override) => start(task, cid, resumeId, override)}
      />,
    );
  };
  const next = async () => {
    if (!(await flush())) return;
    const p = projectRef.current!;
    const ch = p.chapters.find((c) => c.id === chapterRef.current)!;
    if (!approved(ch)) {
      notify("先确认当前章，新版正文才会成为下一章的依据。");
      await approveChapter();
      return;
    }
    try {
      const cid = await command<string>("next_chapter", {
        projectId: p.id,
        chapterId: ch.id,
      });
      await navigate("writer", cid);
      const c = projectRef.current!.chapters.find((c) => c.id === cid)!;
      if (p.settings.autoNext && !c.working.trim())
        await requestRun("write", "", true, cid);
    } catch (e) {
      if ((e as AppError).code === "NEEDS_OUTLINE") {
        await navigate("outline");
        notify("请先新增或补充下一章大纲，保存后再开始写作。");
      } else {
        notify(errorMessage(e));
      }
    }
  };
  useEffect(() => {
    if (!project?.id) return;
    const pid = project.id;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        const [next, imageJobs] = await Promise.all([
          command<Run[]>("list_runs", { projectId: pid }),
          command<ImageJob[]>("list_image_jobs", { projectId: pid }),
        ]);
        if (stopped) return;
        const changedImages = imageJobs.some(
          (j) => imageStatuses.current.get(j.id) !== j.status,
        );
        imageStatuses.current = new Map(imageJobs.map((j) => [j.id, j.status]));
        const changed =
          changedImages ||
          next.some(
            (r) =>
              runsRef.current.find((old) => old.id === r.id)?.status !==
              r.status,
          );
        runsRef.current = next;
        setRuns(next);
        if (changed) {
          await serialize(async () => {
            const p = await command<Project>("load_project", {
              projectId: pid,
            });
            if (!stopped && projectRef.current?.id === pid) accept(p);
          });
        }
      } catch {
        /* A transient poll failure must not erase edits. */
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [project?.id, accept, serialize]);
  const exportProject = async (format: string) => {
    if (!(await flush())) return;
    const result = await perform(() =>
      command<string | null>("export_project", {
        projectId: projectRef.current!.id,
        format,
      }),
    );
    if (result) notify("作品已导出到所选位置。");
  };
  const importProject = async () => {
    const p = await perform(() => command<Project | null>("import_project"));
    if (p) {
      await refreshCards();
      await open(p.id);
      notify("项目已恢复。请重新配置主、副模型。");
    }
  };
  const create = () =>
    setModal(
      <NewProjectModal
        onClose={() => setModal(null)}
        onCreate={async (title, demo) => {
          const p = await perform(() =>
            command<Project>("create_project", { title, demo }),
          );
          if (p) {
            setModal(null);
            await refreshCards();
            await open(p.id);
          }
        }}
      />,
    );
  const actions: Actions = {
    mutate,
    notice: notify,
    run: requestRun,
    perform,
    navigate,
    refreshProviders,
    refreshProject: async () => {
      await serialize(async () => {
        const pid = projectRef.current?.id;
        if (pid)
          accept(await command<Project>("load_project", { projectId: pid }));
      });
    },
    saveReader: async (pid, state) => {
      readerPending.current.set(pid, state);
      await perform(() => serialize(commitReaderProgress));
    },
  };
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths.filter((path) =>
          /\.(txt|md|docx|epub|pdf)$/i.test(path),
        );
        if (paths.length)
          void perform(async () => {
            if (!(await flush())) return;
            let last: Project | undefined;
            for (const path of paths)
              last = await command<Project>("import_document_path", { path });
            await refreshCards();
            if (last) await open(last.id, "reader");
          });
      })
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch((e) => notify(errorMessage(e)));
    return () => {
      disposed = true;
      stop?.();
    };
  }, [flush, refreshCards, perform]);
  const chapter = project?.chapters.find((c) => c.id === chapterId);
  const pending =
    project?.proposals.filter((p) => p.status === "pending").length || 0;
  const active = runs.filter((r) => r.status === "running");
  const completed = useMemo(
    () => project?.chapters.filter(approved).length || 0,
    [project?.chapters],
  );
  const manuscriptChars = useMemo(
    () =>
      view === "reader" || view === "home"
        ? 0
        : project?.chapters.reduce((sum, c) => sum + hanCount(c.working), 0) ||
          0,
    [project?.chapters, view === "reader" || view === "home"],
  );
  return (
    <div className={`app-shell ${view === "reader" ? "reading-shell" : ""}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => void navigate("home")}>
          <span className="brand-mark">
            <Feather size={23} />
          </span>
          <span>
            <strong>叙事</strong>
            <small>NARRATIVE STUDIO</small>
          </span>
        </button>
        <div className="sidebar-section">
          <span>创作空间</span>
          <button
            className="icon-button"
            aria-label="新建作品"
            onClick={create}
          >
            <Plus size={17} />
          </button>
        </div>
        <button
          className={`project-switch ${view === "home" ? "selected" : ""}`}
          onClick={() => {
            void navigate("home");
            void perform(refreshCards);
          }}
        >
          <FolderOpen size={17} />
          <span>我的作品</span>
          <ChevronRight size={14} />
        </button>
        {project && (
          <>
            <div className="current-book">
              <div className="book-spine" />
              <div>
                <strong>{project.title}</strong>
                <span>
                  {project.pdfBook
                    ? "PDF · 原版式阅读"
                    : `${project.genre} · ${project.chapters.length} 章`}
                </span>
              </div>
            </div>
            <nav>
              {nav
                .filter(
                  (n) =>
                    !project.pdfBook || ["reader", "settings"].includes(n.id),
                )
                .map((n) => (
                  <button
                    key={n.id}
                    className={view === n.id ? "active" : ""}
                    onClick={() => void navigate(n.id)}
                  >
                    <n.icon size={18} />
                    {n.label}
                    {n.id === "memory" && pending > 0 && <em>{pending}</em>}
                  </button>
                ))}
            </nav>
          </>
        )}
        {!project && (
          <div className="sidebar-welcome">
            <BookOpen size={34} />
            <p>
              一个故事，一张空白的纸。
              <br />
              从你的大纲开始。
            </p>
          </div>
        )}
        <div className="sidebar-bottom">
          <span>
            <i className="status-dot" />
            本地工作空间
          </span>
          <small>你的故事，由你决定。</small>
          <span className="build-version">v0.3.1 · Windows</span>
          <button className="update-entry" onClick={() => setUpdatesOpen(true)}>软件更新</button>
        </div>
      </aside>
      {updatesOpen && <UpdatesPanel onClose={() => setUpdatesOpen(false)} beforeInstall={flush} />}
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{view === "home" ? "创作空间" : project?.title}</span>
            {view !== "home" && (
              <>
                <ChevronRight size={14} />
                <strong>{nav.find((n) => n.id === view)?.label}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <Badge tone="green">
              <HardDrive size={12} />
              本地保存
            </Badge>
            {project && view !== "home" && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => void exportProject("text")}
                >
                  <Download size={15} />
                  导出正文
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void exportProject("zip")}
                >
                  备份项目
                </Button>
              </>
            )}
          </div>
        </header>
        {!desktop && (
          <div className="banner">
            这是界面开发预览。请运行桌面程序使用 SQLite、API 和文件功能。
          </div>
        )}
        {view === "home" ? (
          <div className="home-page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR LIBRARY</span>
                <h1>我的书架</h1>
                <p>读一本喜欢的书，或写下属于你的故事。</p>
              </div>
              <Button variant="primary" onClick={create}>
                <Plus size={17} />
                新建作品
              </Button>
            </div>
            <div className="home-toolbar">
              <div className="search-box">
                <Search size={16} />
                <input
                  aria-label="搜索作品"
                  placeholder="搜索你的作品…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void perform(async () => {
                      if (!(await flush())) return;
                      const p = await command<Project | null>(
                        "import_document",
                      );
                      if (p) {
                        await refreshCards();
                        await open(p.id);
                        notify("书籍已导入，可以离线阅读或直接编辑。");
                      }
                    })
                  }
                >
                  <BookOpen size={15} />
                  导入书籍
                </Button>
                <Button variant="ghost" onClick={() => void importProject()}>
                  <Upload size={15} />
                  导入备份
                </Button>
                <Button variant="ghost" onClick={() => setTrash((v) => !v)}>
                  <Trash2 size={15} />
                  {trash ? "返回作品" : "回收站"}
                </Button>
              </div>
            </div>
            <label className="library-sort">
              排序
              <select
                aria-label="书架排序"
                value={librarySort}
                onChange={(e) => setLibrarySort(e.target.value)}
              >
                <option value="reading">最近阅读</option>
                <option value="edited">最近编辑</option>
                <option value="title">书名</option>
              </select>
            </label>
            <div className="project-grid">
              {cards
                .filter((c) => c.title.includes(search))
                .sort((a, b) =>
                  librarySort === "title"
                    ? a.title.localeCompare(b.title, "zh-CN")
                    : librarySort === "edited"
                      ? b.updatedAt - a.updatedAt
                      : b.lastReadAt - a.lastReadAt ||
                        b.updatedAt - a.updatedAt,
                )
                .map((c, index) => (
                  <article className="project-card" key={c.id}>
                    <div className={`cover cover-${index % 3}`}>
                      <span>{c.genre || "小说"}</span>
                      {c.coverImageId ? (
                        <MediaImage
                          id={c.coverImageId}
                          alt={`${c.title} 封面`}
                          className="library-cover-image"
                        />
                      ) : (
                        <BookOpen size={52} />
                      )}
                      <strong>{c.title}</strong>
                      <small>一章一章，写向远方</small>
                    </div>
                    <div className="project-card-info">
                      <h3>{c.title}</h3>
                      <p>
                        {c.bookSource === "pdf"
                          ? "PDF 文档"
                          : `${c.chapters} 个章节`}{" "}
                        · {new Date(c.updatedAt).toLocaleDateString("zh-CN")}
                      </p>
                      <div className="library-reading-progress">
                        <i
                          style={{
                            width: `${Math.round(c.readingProgress * 100)}%`,
                          }}
                        />
                        <span>已读 {Math.round(c.readingProgress * 100)}%</span>
                      </div>
                      <div>
                        <Button
                          variant="primary"
                          disabled={loading}
                          onClick={() =>
                            void open(
                              c.id,
                              c.bookSource === "pdf" ? "reader" : "writer",
                            )
                          }
                        >
                          {c.bookSource === "pdf" ? "打开阅读" : "编辑作品"}
                          <ChevronRight size={14} />
                        </Button>
                        {c.bookSource !== "pdf" && (
                          <Button
                            variant="ghost"
                            disabled={loading}
                            onClick={() => void open(c.id, "reader")}
                          >
                            <BookOpen size={14} />
                            电子书阅读
                          </Button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={trash ? "恢复作品" : "移入回收站"}
                          onClick={() =>
                            setModal(
                              <Confirm
                                title={trash ? "恢复这部作品" : "移入回收站"}
                                description={
                                  trash
                                    ? "作品将重新出现在项目列表。"
                                    : "章节、人物和版本会保留，你可以从回收站恢复。"
                                }
                                onClose={() => setModal(null)}
                                onConfirm={async () => {
                                  await command("trash_project", {
                                    projectId: c.id,
                                    deleted: !trash,
                                  });
                                  setModal(null);
                                  await refreshCards();
                                  if (project?.id === c.id && !trash) {
                                    projectRef.current = null;
                                    setProject(null);
                                  }
                                }}
                              />,
                            )
                          }
                        >
                          {trash ? <Upload size={16} /> : <Trash2 size={16} />}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              <button className="new-project-card" onClick={create}>
                <Plus size={30} />
                <strong>新的故事</strong>
                <span>从一个想法开始</span>
              </button>
            </div>
            <div className="home-notes">
              <div>
                <Feather size={22} />
                <h3>作者掌舵</h3>
                <p>正文随时修改，AI 以你的新版为依据。</p>
              </div>
              <div>
                <GitBranch size={22} />
                <h3>人物有记忆</h3>
                <p>关系、状态与秘密，随章节持续更新。</p>
              </div>
              <div>
                <ShieldCheck size={22} />
                <h3>审稿有证据</h3>
                <p>副 AI 提出疑点，最后的决定属于你。</p>
              </div>
            </div>
          </div>
        ) : project ? (
          <WorkspaceBoundary
            key={project.id}
            onReturn={() => void navigate("home")}
          >
            {view === "reader" && project.pdfBook && (
              <Suspense
                fallback={
                  <div className="pdf-document-state">正在打开阅读界面…</div>
                }
              >
                <PdfReader
                  key={project.id}
                  project={project}
                  actions={actions}
                />
              </Suspense>
            )}
            {view === "reader" && !project.pdfBook && (
              <Reader
                key={project.id}
                project={project}
                chapterId={chapterId}
                actions={actions}
              />
            )}
            {view === "illustrations" && (
              <Illustrations
                key={project.id}
                project={project}
                chapterId={chapterId}
                actions={actions}
              />
            )}
            {view === "writer" && (
              <Writer
                project={project}
                chapter={chapter}
                body={body}
                onBody={editBody}
                saveState={saved}
                onBlur={() => void flush()}
                providers={providers}
                runs={runs}
                context={context}
                actions={actions}
                onSave={() => void saveVersion()}
                onApprove={() => void approveChapter()}
                onNext={() => void next()}
                onRestore={(vid) =>
                  setModal(
                    <Confirm
                      title="采用这个正文版本"
                      description="会保存为新的当前草稿，原版本和编辑历史仍保留。确认正文后，修改会影响后续章节。"
                      label="采用并继续编辑"
                      onClose={() => setModal(null)}
                      onConfirm={async () => {
                        await saveVersion(vid);
                        setModal(null);
                      }}
                    />,
                  )
                }
                onCancel={(rid) =>
                  void perform(() => command("cancel_run", { runId: rid }))
                }
              />
            )}
            {view === "outline" && (
              <Outline key={project.id} project={project} actions={actions} />
            )}
            {view === "characters" && (
              <Characters
                key={project.id}
                project={project}
                actions={actions}
                chapterOrder={Math.max(
                  1,
                  project.chapters.findIndex((c) => c.id === chapterId) + 1,
                )}
              />
            )}
            {view === "memory" && (
              <Memory key={project.id} project={project} actions={actions} />
            )}
            {view === "style" && (
              <StylePage key={project.id} project={project} actions={actions} />
            )}
            {view === "settings" && (
              <SettingsPage
                key={project.id}
                project={project}
                providers={providers}
                actions={actions}
              />
            )}
          </WorkspaceBoundary>
        ) : (
          <Empty
            icon={<BookOpen />}
            title="打开一部作品"
            description="先创建或打开你的小说项目。"
          >
            <Button variant="primary" onClick={create}>
              新建作品
            </Button>
          </Empty>
        )}
        {project && view !== "home" && view !== "reader" && (
          <div className="workspace-footer">
            <span>
              {completed} / {project.chapters.length} 章已确认 ·{" "}
              {manuscriptChars.toLocaleString()} 汉字
            </span>
            <span>
              {active.length ? (
                <>
                  <i className="status-dot amber" />
                  {active.length} 个任务运行中
                </>
              ) : (
                <>
                  <CheckCircle2 size={12} />
                  创作资料已保存在本机
                </>
              )}
            </span>
          </div>
        )}
      </main>
      {message && (
        <div className="toast" role="status">
          {message}
          <button aria-label="关闭提示" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal}
    </div>
  );
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, demo: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="开始一个新故事"
      subtitle="先给它一个名字，其余设定随时补充。"
      onClose={onClose}
    >
      <Field label="作品名称">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：雾港灯塔"
          maxLength={120}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) void onCreate(title, false);
          }}
        />
      </Field>
      <div className="demo-note">
        <BookOpen size={20} />
        <div>
          <strong>想先熟悉工作台？</strong>
          <p>示例项目包含三章大纲、两个人物和连续性设定。</p>
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onCreate("雾港灯塔", true);
            setBusy(false);
          }}
        >
          创建示例
        </Button>
      </div>
      <footer>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={!title.trim()}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onCreate(title, false);
            setBusy(false);
          }}
        >
          <Plus size={16} />
          创建作品
        </Button>
      </footer>
    </Modal>
  );
}
function GenerationConfirm({
  info,
  recovery,
  onClose,
  onStart,
}: {
  info: Preflight;
  recovery: boolean;
  onClose: () => void;
  onStart: (reason: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={recovery ? "恢复未完成的章节" : "准备写这一章"}
      subtitle="一次操作完成一章，内部会分场景写作并保存进度。"
      onClose={onClose}
    >
      <div className="generation-metrics">
        <div>
          <strong>{info.targetChars.toLocaleString()}</strong>
          <span>目标汉字</span>
        </div>
        <div>
          <strong>{info.sceneCount}</strong>
          <span>顺序场景</span>
        </div>
        <div>
          <strong>≤ {info.maxCalls}</strong>
          <span>本轮调用上限</span>
        </div>
      </div>
      <p className="muted">
        上下文估算约 {info.context.estimatedTokens.toLocaleString()}{" "}
        tokens，未配置单价，不显示金额。
      </p>
      {info.writingPreview && (
        <p className="muted">
          写作预设：{info.writingPreview.presetName} · 实际请求约{" "}
          {info.writingPreview.estimatedTokens.toLocaleString()} tokens
        </p>
      )}
      {info.warnings.map((s, i) => (
        <p className="inline-note" key={i}>
          {s}
        </p>
      ))}
      <div className="context-preview">
        <strong>AI 本次将读取</strong>
        <div>
          {info.context.items.map((i) => (
            <Badge key={i.id}>{i.label}</Badge>
          ))}
        </div>
        {!!info.context.omitted.length && (
          <small>预算裁剪：{info.context.omitted.join("、")}</small>
        )}
      </div>
      <p className="destination">资料发送至：{info.destination}</p>
      <footer>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={info.writingPreview?.canGenerate === false}
          onClick={async () => {
            setBusy(true);
            await onStart(
              info.warnings.length
                ? "作者已查看变更提示，选择按当前资料继续。"
                : "",
            );
            setBusy(false);
          }}
        >
          <Sparkles size={16} />
          {recovery ? "恢复写作" : "开始生成"}
        </Button>
      </footer>
    </Modal>
  );
}
