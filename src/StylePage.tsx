import { useState } from "react";
import {
  Palette,
  Check,
  Sparkles,
  Upload,
  FileText,
  ArrowRight,
} from "lucide-react";
import type { Actions } from "./App";
import { command } from "./bridge";
import { type Project, type Style } from "./domain";
import { Badge, Button, Field, Toggle } from "./components";
const presets = [
  {
    name: "克制叙事",
    icon: "01",
    note: "自然语言，行动推进",
    tone: "自然、克制，以人物行动和具体细节推进情节。少解释，多呈现。",
    rhythm: "长短句交替，关键转折处留白。",
    avoid: "避免重复感叹、设定复述和过度抒情。",
  },
  {
    name: "节奏明快",
    icon: "02",
    note: "冲突鲜明，读来顺畅",
    tone: "直接、清晰，冲突推进快，人物目标明确。",
    rhythm: "短段落，事件密度较高，章节末尾留一个自然的悬念。",
    avoid: "避免为了爽感破坏人物动机与因果。",
  },
  {
    name: "悬疑留白",
    icon: "03",
    note: "细节铺垫，逐步揭示",
    tone: "冷静、紧张，让线索自然藏在人物行动和环境细节中。",
    rhythm: "逐渐累积不安感，信息按人物知识范围释放。",
    avoid: "不提前解释真相，不用全知旁白泄露秘密。",
  },
  {
    name: "细腻情感",
    icon: "04",
    note: "人物内心，日常质感",
    tone: "细腻、平实，以动作、对话与日常细节表达情绪。",
    rhythm: "留足情绪变化的空间，避免突然转折。",
    avoid: "不堆砌华丽意象，不用大段抽象感想代替事件。",
  },
];
export function StylePage({
  project,
  actions,
}: {
  project: Project;
  actions: Actions;
}) {
  const [style, setStyle] = useState(project.style);
  const [sample, setSample] = useState("");
  const [reference, setReference] = useState("");
  const [encoding, setEncoding] = useState("utf8");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const change = (key: keyof Style, value: string) => {
    setStyle((s) => ({ ...s, [key]: value }));
    setDirty(true);
  };
  const importFile = async () => {
    const data = await actions.perform(() =>
      command<{ name: string; characters: number; sample: string } | null>(
        "import_reference",
        { encoding },
      ),
    );
    if (data) {
      setSample(data.sample);
      setReference(
        `${data.name} · ${data.characters.toLocaleString()} 字 · 已抽取前、中、后三段样本`,
      );
      setConsented(false);
    }
  };
  const analyze = async () => {
    setBusy(true);
    const result = await actions.perform(() =>
      command<Style>("analyze_style", {
        projectId: project.id,
        sample,
        consented,
      }),
    );
    setBusy(false);
    if (result) {
      setStyle(result);
      setDirty(true);
      actions.notice("抽象文风卡已提取。你可以编辑后保存。");
    }
  };
  return (
    <div className="content-page style-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">VOICE & RHYTHM</span>
          <h1>找到属于故事的声音。</h1>
          <p>使用默认文风，或从参考文本提取抽象技巧，再按自己的偏好调整。</p>
        </div>
        <Button
          variant="primary"
          onClick={async () => {
            const p = await actions.mutate({ type: "style", style });
            if (p) {
              setDirty(false);
              actions.notice("文风卡已保存，下一次生成会使用新的文风。");
            }
          }}
        >
          <Check size={15} />
          保存文风卡{dirty && <i className="unsaved-dot" />}
        </Button>
      </div>
      <div className="style-presets">
        {presets.map((p) => (
          <button
            key={p.name}
            className={style.preset === p.name ? "selected" : ""}
            onClick={() => {
              setStyle((s) => ({
                ...s,
                preset: p.name,
                tone: p.tone,
                rhythm: p.rhythm,
                avoid: p.avoid,
              }));
              setDirty(true);
            }}
          >
            <span>{p.icon}</span>
            <Palette size={20} />
            <h3>{p.name}</h3>
            <p>{p.note}</p>
            {style.preset === p.name && <Check size={17} />}
          </button>
        ))}
      </div>
      <div className="style-columns">
        <section className="panel style-card-editor">
          <div className="section-heading">
            <div>
              <Palette size={19} />
              <h2>可编辑文风卡</h2>
            </div>
            <Badge>v{project.style.revision || 1}</Badge>
          </div>
          <Field label="名称">
            <input
              value={style.preset}
              onChange={(e) => change("preset", e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label="叙事视角">
              <input
                value={style.perspective}
                onChange={(e) => change("perspective", e.target.value)}
                placeholder="例如：第三人称限知"
              />
            </Field>
            <Field label="句式与节奏">
              <input
                value={style.rhythm}
                onChange={(e) => change("rhythm", e.target.value)}
              />
            </Field>
          </div>
          <Field label="语气与词汇">
            <textarea
              rows={3}
              value={style.tone}
              onChange={(e) => change("tone", e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label="对话偏好">
              <textarea
                rows={3}
                value={style.dialogue}
                onChange={(e) => change("dialogue", e.target.value)}
                placeholder="对话承担哪些作用？"
              />
            </Field>
            <Field label="描写密度">
              <textarea
                rows={3}
                value={style.description}
                onChange={(e) => change("description", e.target.value)}
                placeholder="环境、动作、心理描写的偏好…"
              />
            </Field>
          </div>
          <Field label="希望避免的写法">
            <textarea
              rows={2}
              value={style.avoid}
              onChange={(e) => change("avoid", e.target.value)}
            />
          </Field>
          <p className="panel-footnote">
            文风是创作偏好，作者的大纲与设定优先。
          </p>
        </section>
        <section className="panel reference-panel">
          <div className="section-heading">
            <div>
              <FileText size={19} />
              <h2>参考小说</h2>
            </div>
            <Badge>TXT ≤ 20 MB</Badge>
          </div>
          <p className="muted">
            仅分析你看到的样本，作品写作时使用风格卡。参考原文不会进入后续每一章的提示词。
          </p>
          <div className="reference-import">
            <Upload size={27} />
            <h3>导入一本小说或粘贴片段</h3>
            <div className="button-group">
              <select
                aria-label="参考小说编码"
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
              >
                <option value="utf8">UTF-8</option>
                <option value="gb18030">GB18030</option>
              </select>
              <Button onClick={() => void importFile()}>选择 TXT</Button>
            </div>
            {reference && <small>{reference}</small>}
          </div>
          <Field
            label="将发送的样本"
            hint={`${[...sample].length.toLocaleString()} / 最多 6000 字；可以直接编辑样本。`}
          >
            <textarea
              rows={10}
              value={sample}
              onChange={(e) => {
                setSample(e.target.value);
                setConsented(false);
              }}
              placeholder="粘贴你想分析的文本，或导入 TXT 自动抽样…"
            />
          </Field>
          <Toggle
            checked={consented}
            onChange={setConsented}
            label="将此样本发送给主 AI 分析"
            description="请确认你有权使用并向所选服务商发送此文本。"
          />
          <Button
            variant="primary"
            className="full-width"
            busy={busy}
            disabled={!consented || !sample.trim() || [...sample].length > 6000}
            onClick={() => void analyze()}
          >
            <Sparkles size={15} />
            提取文风特征
            <ArrowRight size={14} />
          </Button>
        </section>
      </div>
    </div>
  );
}
