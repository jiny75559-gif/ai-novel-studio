import { useState } from "react";
import type { Project, VisualExtraction } from "./domain";
import { Badge, Button, Modal } from "./components";
export function VisualExtractionReview({
  project,
  result,
  onClose,
  onApply,
}: {
  project: Project;
  result: VisualExtraction;
  onClose(): void;
  onApply(result: VisualExtraction): Promise<void>;
}) {
  const fixed = (cid: string) =>
    !!project.visualProfiles.find((p) => p.characterId === cid)
      ?.referenceImageId;
  const [profiles, setProfiles] = useState(result.profiles);
  const [selected, setSelected] = useState(
    result.profiles.map((p) => !fixed(p.characterId)),
  );
  const [changes, setChanges] = useState(result.changes.map(() => true));
  const [busy, setBusy] = useState(false);
  const count =
    selected.filter(Boolean).length + changes.filter(Boolean).length;
  const title = (cid: string) =>
    project.chapters.find((c) => c.id === cid)?.title || "原文";
  return (
    <Modal
      title="从正文读取的形象"
      subtitle={`已读取 ${result.chaptersScanned} 章${result.partial ? "的部分文字；超出模型窗口的正文未参与本次提取" : "正文"}。可以直接修改描述，再选择采用。`}
      onClose={onClose}
      wide
    >
      <div className="visual-extraction-list">
        {!profiles.length && !result.changes.length && (
          <p className="muted">
            本次正文没有找到明确的外貌描述。可以换一个章节读取，或直接编辑形象卡补充你的设定。
          </p>
        )}
        {profiles.map((p, i) => (
          <article
            className="visual-extraction-card"
            key={p.characterId || p.name}
          >
            <header>
              <label>
                <input
                  type="checkbox"
                  checked={selected[i]}
                  disabled={fixed(p.characterId)}
                  onChange={(e) =>
                    setSelected((v) =>
                      v.map((s, j) => (j === i ? e.target.checked : s)),
                    )
                  }
                />
                <strong>{p.name}</strong>
              </label>
              <Badge>
                {fixed(p.characterId)
                  ? "已固定 · 保留现有形象"
                  : p.characterId
                    ? "形象草稿"
                    : "新人物"}
              </Badge>
            </header>
            <textarea
              aria-label={`${p.name} 提取外貌`}
              rows={3}
              value={p.appearance}
              disabled={fixed(p.characterId)}
              onChange={(e) =>
                setProfiles((v) =>
                  v.map((s, j) =>
                    j === i ? { ...s, appearance: e.target.value } : s,
                  ),
                )
              }
            />
            {p.evidence.map((e, j) => (
              <blockquote key={j}>
                <small>{title(e.chapterId)}</small>
                <p>{e.excerpt}</p>
              </blockquote>
            ))}
          </article>
        ))}
        {result.changes.map((c, i) => (
          <article
            className="visual-extraction-card"
            key={`${c.characterId}-${i}`}
          >
            <header>
              <label>
                <input
                  type="checkbox"
                  checked={changes[i]}
                  onChange={(e) =>
                    setChanges((v) =>
                      v.map((s, j) => (j === i ? e.target.checked : s)),
                    )
                  }
                />
                <strong>
                  {project.characters.find((p) => p.id === c.characterId)?.name}{" "}
                  · 形象变化
                </strong>
              </label>
              <Badge>从原文章节起生效</Badge>
            </header>
            <p>{c.description}</p>
            <blockquote>
              <small>{title(c.evidence.chapterId)}</small>
              <p>{c.evidence.excerpt}</p>
            </blockquote>
          </article>
        ))}
      </div>
      <footer>
        <Button onClick={onClose}>稍后再用</Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={
            !count ||
            profiles.some((p, i) => selected[i] && !p.appearance.trim())
          }
          onClick={async () => {
            setBusy(true);
            try {
              await onApply({
                ...result,
                profiles: profiles.filter((_, i) => selected[i]),
                changes: result.changes.filter((_, i) => changes[i]),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          采用所选形象与变化
        </Button>
      </footer>
    </Modal>
  );
}
