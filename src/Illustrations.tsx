import { useEffect, useRef, useState } from "react";
import {
  Check,
  ImagePlus,
  Plus,
  Settings2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import type { Actions } from "./App";
import { command } from "./bridge";
import {
  blankImageConfig,
  ImageConfig,
  ImageJob,
  Project,
  runLabels,
  VisualChange,
  VisualProfile,
  VisualExtraction,
} from "./domain";
import { Badge, Button, Field, Modal } from "./components";
import { MediaImage } from "./MediaImage";
import { VisualExtractionReview } from "./VisualExtractionReview";

export function Illustrations({
  project,
  chapterId,
  actions,
}: {
  project: Project;
  chapterId: string;
  actions: Actions;
}) {
  const [configs, setConfigs] = useState<ImageConfig[]>([]);
  const [editing, setEditing] = useState<ImageConfig | null>(null);
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [settings, setSettings] = useState(project.visualSettings);
  const [selected, setSelected] = useState<string[]>([]);
  const [scene, setScene] = useState("");
  const [planning, setPlanning] = useState(false);
  const [readingProfiles, setReadingProfiles] = useState(false);
  const [extraction, setExtraction] = useState<VisualExtraction | null>(null);
  const [sourceHash, setSourceHash] = useState("");
  const [profile, setProfile] = useState<VisualProfile | null>(null);
  const [change, setChange] = useState<VisualChange | null>(null);
  const chapter =
    project.chapters.find((c) => c.id === chapterId) || project.chapters[0];
  const active = jobs.some((j) => j.status === "running");
  const refresh = async () =>
    setConfigs(await command<ImageConfig[]>("list_image_configs"));
  useEffect(() => {
    void actions.perform(refresh);
  }, []);
  useEffect(() => {
    setScene(chapter?.working || "");
    let live = true;
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(chapter?.working || ""))
      .then((buf) => {
        if (live)
          setSourceHash(
            Array.from(new Uint8Array(buf), (n) =>
              n.toString(16).padStart(2, "0"),
            ).join(""),
          );
      });
    return () => {
      live = false;
    };
  }, [chapter?.id, chapter?.working]);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const statuses = useRef(new Map<string, string>());
  useEffect(() => {
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        const next = await command<ImageJob[]>("list_image_jobs", {
          projectId: project.id,
        });
        if (stopped) return;
        const changed = next.some(
          (j) => statuses.current.get(j.id) !== j.status,
        );
        statuses.current = new Map(next.map((j) => [j.id, j.status]));
        setJobs(next);
        if (changed) await actionsRef.current.refreshProject();
      } catch {
        /* Preserve visible results on transient polling failure. */
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1100);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [project.id]);
  const saveSettings = async () =>
    !!(await actions.mutate({ type: "visualSettings", settings }));
  const start = async (kind: string, cids: string[]) => {
    if (!settings.providerId) {
      actions.notice("先选择一个生图服务，再生成定妆或插图。");
      return;
    }
    if (kind === "portrait" && !profileFor(cids[0]).appearance.trim()) {
      if (!chapter) return;
      setReadingProfiles(true);
      const prepared = await actions.perform(async () => {
        const read = await command<VisualExtraction>(
          "extract_visual_characters",
          {
            projectId: project.id,
            chapterId: chapter.id,
            characterId: cids[0],
          },
        );
        const candidate = read.profiles.find((p) => p.characterId === cids[0]);
        if (!candidate) {
          actions.notice(
            "文章里没有找到这个人物的明确外貌；可以换章读取或补充形象设定。",
          );
          return false;
        }
        const saved = await actions.mutate({
          type: "visualExtraction",
          profiles: [candidate],
          changes: read.changes,
          overwrite_existing: false,
        });
        if (!saved) return false;
        actions.notice(
          `已从正文读取 ${candidate.name} 的外貌${read.partial ? "（本次只读取了上下文窗口内的部分正文）" : ""}。原文依据：${candidate.evidence[0].excerpt}`,
        );
        return true;
      });
      setReadingProfiles(false);
      if (!prepared) return;
    }
    if (!chapter || !(await saveSettings())) return;
    const result = await actions.perform(() =>
      command<ImageJob>("start_image_job", {
        projectId: project.id,
        request: {
          id: crypto.randomUUID(),
          chapterId: chapter.id,
          characterIds: cids,
          kind,
          scene:
            kind === "portrait"
              ? "人物定妆肖像，清楚展示面部、发型与体态，简洁背景。"
              : scene,
        },
      }),
    );
    if (result) {
      setJobs((old) => [result, ...old]);
      actions.notice("生图已开始，结果会保存在本机。");
    }
  };
  const profileFor = (cid: string): VisualProfile =>
    project.visualProfiles.find((p) => p.characterId === cid) || {
      characterId: cid,
      appearance: "",
      referenceImageId: "",
      revision: 0,
    };
  const currentArts = project.artwork.filter(
    (a) => a.kind === "chapter" && a.chapterId === chapter?.id,
  );
  return (
    <div className="content-page illustrations-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A FACE TO REMEMBER</span>
          <h1>让故事有自己的画面。</h1>
          <p>先确认人物形象，再让每一章沿用他们的脸与细节。</p>
        </div>
        <Button onClick={() => setEditing(blankImageConfig())}>
          <Plus size={16} />
          添加生图服务
        </Button>
      </div>
      <section className="panel visual-service">
        <div className="section-heading">
          <h2>生图服务</h2>
          <Badge>云端 · ComfyUI · WebUI / Forge</Badge>
        </div>
        <div className="visual-service-row">
          <select
            aria-label="生图服务"
            value={settings.providerId}
            onChange={(e) =>
              setSettings((s) => ({ ...s, providerId: e.target.value }))
            }
          >
            <option value="">选择一个已保存的配置</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.mode}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              const c = configs.find((c) => c.id === settings.providerId);
              if (c) setEditing(c);
            }}
          >
            配置服务
          </Button>
          <Button
            onClick={() =>
              void actions.perform(async () => {
                const c = configs.find((c) => c.id === settings.providerId);
                if (c)
                  actions.notice(
                    await command<string>("test_image_config", { config: c }),
                  );
              })
            }
          >
            测试连接
          </Button>
          <Button variant="primary" onClick={() => void saveSettings()}>
            <Check size={14} />
            保存
          </Button>
        </div>
        <div className="visual-two-fields">
          <Field label="整部作品的画风">
            <textarea
              rows={2}
              value={settings.style}
              onChange={(e) =>
                setSettings((s) => ({ ...s, style: e.target.value }))
              }
              placeholder="例如：水彩插画，温暖纸张质感，柔和光线。也可以写角色 LoRA 触发词。"
            />
          </Field>
          <Field label="负面提示词（ComfyUI / WebUI）">
            <textarea
              rows={2}
              value={settings.negativePrompt}
              onChange={(e) =>
                setSettings((s) => ({ ...s, negativePrompt: e.target.value }))
              }
              placeholder="自由填写需要避免的画面特征"
            />
          </Field>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <ImagePlus size={18} />
            <h2>人物形象卡</h2>
          </div>
          <Button
            busy={readingProfiles}
            disabled={
              !project.settings.writerId || !chapter?.working.trim() || active
            }
            title={
              !project.settings.writerId
                ? "选择主 AI 后可自动读取正文"
                : "识别人物外貌与本章的明确形象变化"
            }
            onClick={async () => {
              if (!chapter) return;
              setReadingProfiles(true);
              await actions.perform(async () => {
                const result = await command<VisualExtraction>(
                  "extract_visual_characters",
                  {
                    projectId: project.id,
                    chapterId: chapter.id,
                    characterId: null,
                  },
                );
                setExtraction(result);
              });
              setReadingProfiles(false);
            }}
          >
            <WandSparkles size={15} />
            从正文读取形象
          </Button>
          <Button
            variant="ghost"
            onClick={() => void actions.navigate("characters")}
          >
            管理人物
          </Button>
        </div>
        {!project.characters.some((c) => !c.deleted) && (
          <p className="muted">
            可以直接从正文识别人物与外貌，也可以在人物关系中添加人物。无人场景可以直接生图。
          </p>
        )}
        <div className="visual-profiles">
          {project.characters
            .filter((c) => !c.deleted)
            .map((c) => {
              const p = profileFor(c.id);
              return (
                <article className="visual-profile-card" key={c.id}>
                  <div className="portrait-frame">
                    {p.referenceImageId ? (
                      <MediaImage
                        id={p.referenceImageId}
                        alt={`${c.name} 固定形象`}
                      />
                    ) : (
                      <div>
                        <ImagePlus size={26} />
                        <span>等待定妆</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <h3>
                      {c.name}{" "}
                      {p.referenceImageId && <Badge tone="green">已固定</Badge>}
                    </h3>
                    <p>
                      {p.appearance ||
                        "首次生成定妆时自动读取正文中的外貌，也可以自行编辑。"}
                    </p>
                    <div className="visual-card-actions">
                      <Button onClick={() => setProfile({ ...p })}>
                        编辑形象
                      </Button>
                      <Button
                        disabled={
                          active ||
                          readingProfiles ||
                          !settings.providerId ||
                          (!p.appearance.trim() &&
                            (!project.settings.writerId ||
                              !chapter?.working.trim()))
                        }
                        onClick={() => void start("portrait", [c.id])}
                      >
                        生成定妆
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setChange({
                            id: "",
                            characterId: c.id,
                            sourceChapterId: chapter?.id || "",
                            excerpt: "",
                            description: "",
                            startOrder: Math.max(
                              1,
                              project.chapters.findIndex(
                                (x) => x.id === chapter?.id,
                              ) + 1,
                            ),
                            endOrder: null,
                          })
                        }
                      >
                        记录变化
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
        </div>
        <p className="muted visual-explanation">
          自动读取使用本作品的主
          AI，未配置时也可以直接编辑外貌。首次定妆后，在下方结果中点击“设为固定形象”。后续生图会传入确认过的参考图；ComfyUI
          工作流可继续使用角色 LoRA、IP-Adapter
          或其他角色一致性节点。固定种子不能代替人物参考图。
        </p>
        {project.visualChanges.map((v) => (
          <div className="visual-change" key={v.id}>
            <strong>
              {project.characters.find((c) => c.id === v.characterId)?.name}
            </strong>
            <span>
              {v.description} · 第 {v.startOrder}–{v.endOrder || "后续"} 章
            </span>
            <small>“{v.excerpt}”</small>
            {!project.chapters
              .find((c) => c.id === v.sourceChapterId)
              ?.working.includes(v.excerpt) && (
              <Badge>原文已修改，暂不应用</Badge>
            )}
            <Button
              variant="ghost"
              aria-label="删除形象变化"
              onClick={() =>
                void actions.mutate({
                  type: "deleteVisualChange",
                  change_id: v.id,
                })
              }
            >
              <X size={14} />
            </Button>
          </div>
        ))}
      </section>
      <section className="panel visual-scene">
        <div className="section-heading">
          <h2>本章插图</h2>
          <Button
            busy={planning}
            disabled={!project.settings.writerId || !chapter?.working.trim()}
            onClick={async () => {
              if (!chapter) return;
              setPlanning(true);
              await actions.perform(async () => {
                if (!(await saveSettings())) return;
                const plan = await command<{
                  scene: string;
                  excerpt: string;
                  characterIds: string[];
                }>("plan_illustration", {
                  projectId: project.id,
                  chapterId: chapter.id,
                });
                setScene(plan.scene);
                setSelected(plan.characterIds);
                actions.notice(
                  `已提炼场景，原文依据：${plan.excerpt}。可继续修改提示词。`,
                );
              });
              setPlanning(false);
            }}
          >
            AI 提炼场景
          </Button>
          <Button
            variant="primary"
            disabled={active || !scene.trim() || !settings.providerId}
            onClick={() => void start("chapter", selected)}
          >
            <WandSparkles size={16} />
            生成本章插图
          </Button>
        </div>
        <Field label="章节">
          <select
            aria-label="插图章节"
            value={chapter?.id || ""}
            onChange={(e) =>
              void actions.navigate("illustrations", e.target.value)
            }
          >
            {project.chapters.map((c, i) => (
              <option key={c.id} value={c.id}>
                第{i + 1}章 · {c.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="scene-characters">
          <span>画面中的人物</span>
          {project.characters
            .filter((c) => !c.deleted)
            .map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked
                        ? [...s, c.id]
                        : s.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
        </div>
        <Field
          label="本章场景 / 生图提示词"
          hint="默认读取当前正文；可以精简为想描绘的场景。生成前请核对出场人物。"
        >
          <textarea
            aria-label="插图场景"
            rows={6}
            value={scene}
            onChange={(e) => setScene(e.target.value)}
          />
        </Field>
        {!!selected.length && (
          <div className="reference-strip">
            {selected.map((cid) => {
              const p = profileFor(cid);
              return (
                <div key={cid}>
                  {p.referenceImageId ? (
                    <MediaImage id={p.referenceImageId} alt="本次人物参考图" />
                  ) : (
                    <span>未确认参考图</span>
                  )}
                  <small>
                    {project.characters.find((c) => c.id === cid)?.name}
                  </small>
                </div>
              );
            })}
          </div>
        )}
        <p className="muted">
          WebUI 基础图生图适合一位人物；多人同框建议使用支持多参考图的云端接口或
          ComfyUI 工作流。是否相似仍需你查看结果，确认后再放进章节。
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>生图任务与定妆候选</h2>
        </div>
        {jobs.length === 0 && <p className="muted">还没有生图任务。</p>}
        {jobs.slice(0, 20).map((j) => {
          const art = project.artwork.find((a) => a.id === j.resultArtworkId);
          return (
            <div className="image-job" key={j.id}>
              <div>
                <Badge tone={j.status === "succeeded" ? "green" : "neutral"}>
                  {runLabels[j.status] || j.status}
                </Badge>
                <strong>
                  {j.kind === "portrait" ? "人物定妆" : "章节插图"}
                </strong>
                <span>
                  {project.chapters.find((c) => c.id === j.chapterId)?.title} ·{" "}
                  {j.config.name}
                </span>
                {j.error && (
                  <p className="inline-note">{j.error.userMessage}</p>
                )}
                <details>
                  <summary>查看发送的提示词与参考图</summary>
                  <pre>{j.prompt}</pre>
                  <small>
                    {j.referenceIds.length} 张参考图 ·{" "}
                    {j.remotePromptId ? `ComfyUI 任务 ${j.remotePromptId}` : ""}
                  </small>
                </details>
              </div>
              <div>
                {j.status === "running" && (
                  <Button
                    onClick={() =>
                      void actions.perform(() =>
                        command("cancel_image_job", { jobId: j.id }),
                      )
                    }
                  >
                    停止等待
                  </Button>
                )}
                {j.status !== "running" &&
                  j.status !== "succeeded" &&
                  j.config.mode === "comfyui" &&
                  j.remotePromptId && (
                    <Button
                      onClick={() =>
                        void actions.perform(() =>
                          command("resume_image_job", { jobId: j.id }),
                        )
                      }
                    >
                      取回原任务
                    </Button>
                  )}
                {art && j.kind === "portrait" && (
                  <div className="portrait-candidate">
                    <MediaImage id={art.imageId} alt="定妆候选" />
                    <Button
                      variant="primary"
                      onClick={() =>
                        void actions.mutate({
                          type: "visualProfile",
                          profile: {
                            ...profileFor(j.characterIds[0]),
                            referenceImageId: art.imageId,
                          },
                        })
                      }
                    >
                      设为固定形象
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <div className="artwork-gallery">
        {currentArts.map((a) => (
          <article className="panel" key={a.id}>
            <MediaImage id={a.imageId} alt={`${chapter?.title} 插图`} />
            <div>
              <Badge tone={a.approved ? "green" : "neutral"}>
                {a.approved ? "已放入章节" : "待选插图"}
              </Badge>
              <Button
                variant="ghost"
                onClick={() =>
                  void actions.perform(async () => {
                    const path = await command<string | null>("export_image", {
                      imageId: a.imageId,
                    });
                    if (path) actions.notice("图片已保存。");
                  })
                }
              >
                保存图片
              </Button>
              <Button
                onClick={() =>
                  void actions.mutate({
                    type: "artwork",
                    artwork_id: a.id,
                    approved: !a.approved,
                  })
                }
              >
                {a.approved ? "从阅读页移除" : "放入本章"}
              </Button>
            </div>
            <p className="muted">
              {sourceHash && sourceHash !== a.sourceHash && (
                <Badge>正文已变更</Badge>
              )}
              {Object.entries(a.profileRevisions).some(
                ([cid, revision]) =>
                  project.visualProfiles.find((v) => v.characterId === cid)
                    ?.revision !== revision,
              ) && <Badge>人物形象已变更</Badge>}
              {new Date(a.createdAt).toLocaleString("zh-CN")} ·
              正文更新后，可重新生成匹配新场景的插图。
            </p>
          </article>
        ))}
      </div>
      {extraction && (
        <VisualExtractionReview
          project={project}
          result={extraction}
          onClose={() => setExtraction(null)}
          onApply={async (result) => {
            const saved = await actions.mutate({
              type: "visualExtraction",
              profiles: result.profiles,
              changes: result.changes,
              overwrite_existing: true,
            });
            if (saved) {
              setExtraction(null);
              actions.notice(
                `已采用 ${result.profiles.length} 个人物形象与 ${result.changes.length} 项变化，可继续编辑。`,
              );
            }
          }}
        />
      )}
      {editing && (
        <ImageConfigEditor
          config={editing}
          actions={actions}
          onClose={() => setEditing(null)}
          onSaved={async (c) => {
            await refresh();
            setSettings((s) => ({ ...s, providerId: c.id }));
            setEditing(null);
          }}
        />
      )}
      {profile && (
        <Modal
          title={`${project.characters.find((c) => c.id === profile.characterId)?.name} · 固定形象`}
          onClose={() => setProfile(null)}
        >
          <Field label="固定外貌与辨识细节">
            <textarea
              autoFocus
              rows={5}
              value={profile.appearance}
              onChange={(e) =>
                setProfile((p) =>
                  p ? { ...p, appearance: e.target.value } : p,
                )
              }
              placeholder="年龄感、脸型、五官、发色、发型、体态、标志性细节。"
            />
          </Field>
          {profile.referenceImageId && (
            <MediaImage
              id={profile.referenceImageId}
              alt="人物参考图"
              className="profile-editor-image"
            />
          )}
          <Button
            onClick={() =>
              void actions.perform(async () => {
                const imageId = await command<string | null>("import_portrait");
                if (imageId)
                  setProfile((p) =>
                    p ? { ...p, referenceImageId: imageId } : p,
                  );
              })
            }
          >
            <Upload size={15} />
            导入自己的参考图
          </Button>
          <footer>
            <Button onClick={() => setProfile(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (await actions.mutate({ type: "visualProfile", profile }))
                  setProfile(null);
              }}
            >
              确认并保存
            </Button>
          </footer>
        </Modal>
      )}
      {change && (
        <Modal title="记录文中明确的形象变化" onClose={() => setChange(null)}>
          <Field label="来源章节">
            <select
              value={change.sourceChapterId}
              onChange={(e) =>
                setChange((v) =>
                  v ? { ...v, sourceChapterId: e.target.value } : v,
                )
              }
            >
              {project.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="原文依据（粘贴存在于本章的句子）">
            <textarea
              rows={2}
              value={change.excerpt}
              onChange={(e) =>
                setChange((v) => (v ? { ...v, excerpt: e.target.value } : v))
              }
            />
          </Field>
          <Field label="外貌如何变化">
            <textarea
              rows={2}
              value={change.description}
              onChange={(e) =>
                setChange((v) =>
                  v ? { ...v, description: e.target.value } : v,
                )
              }
            />
          </Field>
          <div className="visual-two-fields">
            <Field label="从第几章生效">
              <input
                type="number"
                min={1}
                value={change.startOrder}
                onChange={(e) =>
                  setChange((v) =>
                    v ? { ...v, startOrder: +e.target.value } : v,
                  )
                }
              />
            </Field>
            <Field label="结束章（空为持续）">
              <input
                type="number"
                min={change.startOrder}
                value={change.endOrder || ""}
                onChange={(e) =>
                  setChange((v) =>
                    v
                      ? {
                          ...v,
                          endOrder: e.target.value ? +e.target.value : null,
                        }
                      : v,
                  )
                }
              />
            </Field>
          </div>
          <footer>
            <Button onClick={() => setChange(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (await actions.mutate({ type: "visualChange", change }))
                  setChange(null);
              }}
            >
              保存变化
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function ImageConfigEditor({
  config,
  actions,
  onClose,
  onSaved,
}: {
  config: ImageConfig;
  actions: Actions;
  onClose: () => void;
  onSaved: (c: ImageConfig) => Promise<void>;
}) {
  const [c, setC] = useState(config);
  const [key, setKey] = useState("");
  const [workflow, setWorkflow] = useState(JSON.stringify(c.workflow, null, 2));
  const [references, setReferences] = useState(c.referenceNodes.join(", "));
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof ImageConfig>(k: K, v: ImageConfig[K]) =>
    setC((c) => ({ ...c, [k]: v }));
  const save = async () => {
    setBusy(true);
    await actions.perform(async () => {
      const parsed = c.mode === "comfyui" ? JSON.parse(workflow) : c.workflow;
      const saved = await command<ImageConfig>("save_image_config", {
        config: {
          ...c,
          workflow: parsed,
          referenceNodes: references
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
        key,
      });
      await onSaved(saved);
      actions.notice(
        saved.keyStorage === "session"
          ? "配置已保存；此密钥仅保留在当前会话。"
          : "生图配置已保存。",
      );
    });
    setBusy(false);
  };
  return (
    <Modal
      title="生图服务配置"
      subtitle="可接入本地服务或兼容的云端图像接口。"
      wide
      onClose={onClose}
    >
      <div className="visual-two-fields">
        <Field label="配置名称">
          <input
            value={c.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </Field>
        <Field label="服务类型">
          <select
            aria-label="生图服务类型"
            value={c.mode}
            onChange={(e) => {
              const mode = e.target.value;
              setC((c) => ({
                ...c,
                mode,
                baseUrl:
                  mode === "comfyui"
                    ? "http://127.0.0.1:8188"
                    : mode === "webui"
                      ? "http://127.0.0.1:7860"
                      : "https://api.openai.com/v1",
                name:
                  mode === "comfyui"
                    ? "本地 ComfyUI"
                    : mode === "webui"
                      ? "本地 WebUI / Forge"
                      : "云端生图",
                allowLocalHttp: mode !== "cloud",
              }));
            }}
          >
            <option value="comfyui">ComfyUI · 自定义工作流</option>
            <option value="webui">Stable Diffusion WebUI / Forge</option>
            <option value="cloud">云端 · Images 兼容接口</option>
          </select>
        </Field>
      </div>
      <Field label="服务地址">
        <input
          value={c.baseUrl}
          onChange={(e) => update("baseUrl", e.target.value)}
        />
      </Field>
      <label className="visual-checkbox">
        <input
          type="checkbox"
          checked={c.allowLocalHttp}
          onChange={(e) => update("allowLocalHttp", e.target.checked)}
        />
        允许本机 HTTP（127.0.0.1 / localhost）
      </label>
      <Field
        label="API Key / Bearer Token（本地服务通常留空）"
        hint={
          c.hasKey
            ? "已保存密钥；留空继续沿用。"
            : "密钥存入 Windows 凭据管理器，不进入作品备份。"
        }
      >
        <input
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      {c.mode === "comfyui" ? (
        <>
          <div className="section-heading">
            <h3>API 工作流</h3>
            <Button
              onClick={() =>
                void actions.perform(async () => {
                  const w = await command<Record<string, unknown> | null>(
                    "import_image_workflow",
                  );
                  if (w) setWorkflow(JSON.stringify(w, null, 2));
                })
              }
            >
              <Upload size={14} />
              导入 JSON
            </Button>
          </div>
          <Field
            label="工作流 JSON"
            hint="在 ComfyUI 中导出 API 格式；保留你的模型、LoRA、IP-Adapter 和自定义节点。"
          >
            <textarea
              aria-label="ComfyUI 工作流"
              rows={8}
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value)}
              className="workflow-json"
            />
          </Field>
          <div className="visual-node-grid">
            {(
              [
                ["positiveNode", "正面提示词节点"],
                ["negativeNode", "负面节点（可空）"],
                ["outputNode", "SaveImage 输出节点"],
                ["seedNode", "种子节点（可空）"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <input
                  value={c[k]}
                  onChange={(e) => update(k, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <Field
            label="人物参考图 LoadImage 节点 ID（用逗号隔开）"
            hint="按画面人物的选择顺序依次上传，节点必须连接到输出。一位人物一个节点。"
          >
            <input
              value={references}
              onChange={(e) => setReferences(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label={
              c.mode === "cloud"
                ? "图像模型 ID"
                : "Checkpoint 名称（留空使用当前模型）"
            }
          >
            <input
              value={c.modelId}
              onChange={(e) => update("modelId", e.target.value)}
            />
          </Field>
          {c.mode === "cloud" ? (
            <div className="visual-two-fields">
              <Field label="尺寸（由接口决定，例如 1024x1024 / auto）">
                <input
                  value={c.size}
                  onChange={(e) => update("size", e.target.value)}
                />
              </Field>
              <Field label="参考图字段">
                <select
                  value={c.imageField}
                  onChange={(e) => update("imageField", e.target.value)}
                >
                  <option value="image[]">image[] · 多参考图</option>
                  <option value="image">image · 单图接口</option>
                </select>
              </Field>
              <label className="visual-checkbox">
                <input
                  type="checkbox"
                  checked={c.supportsEdits}
                  onChange={(e) => update("supportsEdits", e.target.checked)}
                />
                接口支持 /images/edits 参考图编辑
              </label>
            </div>
          ) : (
            <>
              <p className="inline-note">
                WebUI 请开启 --api。参考图使用基础
                img2img，人物一致性取决于模型与重绘强度；进阶角色控制可选
                ComfyUI 工作流。
              </p>
              <div className="visual-node-grid">
                {(
                  [
                    ["width", "宽度"],
                    ["height", "高度"],
                    ["steps", "步数"],
                    ["cfg", "CFG"],
                    ["denoising", "参考图重绘强度"],
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input
                      type="number"
                      step={k === "denoising" ? 0.05 : 1}
                      value={c[k]}
                      onChange={(e) => update(k, +e.target.value)}
                    />
                  </Field>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <div className="visual-two-fields">
        {c.mode !== "cloud" && (
          <Field label="种子（-1 随机；固定值方便复现）">
            <input
              type="number"
              value={c.seed}
              onChange={(e) => update("seed", +e.target.value)}
            />
          </Field>
        )}
        <Field label="任务超时（秒，30–1800）">
          <input
            type="number"
            min={30}
            max={1800}
            value={c.timeoutSeconds}
            onChange={(e) => update("timeoutSeconds", +e.target.value)}
          />
        </Field>
      </div>
      <footer>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          <Settings2 size={15} />
          保存生图配置
        </Button>
      </footer>
    </Modal>
  );
}
