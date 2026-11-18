import { useState, useRef, useEffect, useCallback, type CSSProperties } from "react";
import { Trash2, X, GripVertical } from "lucide-react";
import type { Project, ReadingMark } from "./domain";
import type { Actions } from "./App";
import { Button, Modal } from "./components";
import { errorMessage } from "./bridge";
import { markCurrent } from "./ReadingTools";

export function ReadingAnnotationEditor({
  editing,
  project,
  onClose,
  saving,
  onSave,
  onDelete,
  actions,
}: {
  editing: ReadingMark;
  project: Project;
  actions: Actions;
  onClose: () => void;
  saving: boolean;
  onSave: (mark: ReadingMark) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [mark, setMark] = useState(editing);
  const [baseline, setBaseline] = useState(editing);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [working, setWorking] = useState(false);
  const pending = useRef<((allow: boolean) => void) | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const latest = useRef({ mark, baseline, onSave, saving });
  latest.current = { mark, baseline, onSave, saving };
  const dirty = useCallback(() => {
    const { mark: draft, baseline: saved } = latest.current;
    return draft.color !== saved.color || draft.note !== saved.note;
  }, []);
  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const draft = latest.current.mark;
    setWorking(true);
    setSaveError("");
    const task = (async () => {
      try {
        if (!(await latest.current.onSave(draft))) {
          setSaveError("批注保存失败，输入仍保留。请重试或继续编辑。");
          return false;
        }
        latest.current.baseline = draft;
        setBaseline(draft);
        return true;
      } catch (e) {
        setSaveError(errorMessage(e));
        return false;
      } finally {
        inFlight.current = null;
        setWorking(false);
      }
    })();
    inFlight.current = task;
    return task;
  }, []);
  const flushMark = useCallback(async (): Promise<boolean> => {
    if (pending.current) return false;
    if (inFlight.current) return inFlight.current;
    if (latest.current.saving) return false;
    if (!dirty()) return true;
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setConfirmLeave(true);
    });
  }, [dirty]);
  const settle = useCallback((allow: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setConfirmLeave(false);
    resolve?.(allow);
  }, []);
  useEffect(() => actions.registerReadingGuard({ flush: flushMark, dirty }), [actions.registerReadingGuard, flushMark, dirty]);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  const handleClose = useCallback(async () => {
    if (await flushMark()) onClose();
  }, [flushMark, onClose]);
  useEffect(() => {
    if (editing.id === latest.current.baseline.id) return;
    void flushMark().then((allow) => {
      if (allow) {
        latest.current.mark = editing;
        latest.current.baseline = editing;
        setMark(editing);
        setBaseline(editing);
        setSaveError("");
      }
    });
  }, [editing, flushMark]);

  useEffect(() => {
    const clampPosition = (x: number, y: number, w: number, h: number) => {
      const minVisible = 40;
      return {
        x: Math.max(0, Math.min(x, window.innerWidth - Math.max(minVisible, w))),
        y: Math.max(0, Math.min(y, window.innerHeight - Math.max(minVisible, h))),
      };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = clampPosition(
          e.clientX - dragStart.x,
          e.clientY - dragStart.y,
          size.width,
          size.height
        );
        setPosition(newPos);
      } else if (isResizing) {
        const maxWidth = Math.max(1, window.innerWidth - position.x - 10);
        const maxHeight = Math.max(1, window.innerHeight - position.y - 10);
        const newWidth = Math.min(maxWidth, Math.max(300, e.clientX - position.x + 10));
        const newHeight = Math.min(maxHeight, Math.max(200, e.clientY - position.y + 10));
        setSize({ width: newWidth, height: newHeight });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    const handleResize = () => {
      const maxW = Math.min(size.width, window.innerWidth - 10);
      const maxH = Math.min(size.height, window.innerHeight - 10);
      setSize({ width: Math.max(1, maxW), height: Math.max(1, maxH) });
      setPosition((prev) => clampPosition(prev.x, prev.y, maxW, maxH));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (pending.current) { if (!inFlight.current) settle(false); }
        else void handleClose();
      }
    };

    if (isDragging || isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDragging, isResizing, dragStart, position, size, handleClose, settle]);

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.annotation-editor-close')) {
      return;
    }
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
  };

  const style: CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
    zIndex: 40,
  };

  return (
    <>
      <div
        ref={panelRef}
        className="reading-annotation-editor"
        style={style}
        role="dialog"
        aria-label="编辑阅读批注"
        onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
      >
        <div
          className="annotation-editor-header"
          onMouseDown={handleDragStart}
        >
          <GripVertical size={16} className="annotation-editor-grip" />
          <span>阅读批注</span>
          <button
            className="annotation-editor-close"
            aria-label="关闭"
            disabled={working || saving}
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </div>
      <div className="annotation-editor-body">
        <blockquote className="annotation-quote">{mark.quote}</blockquote>
        {!markCurrent(project, mark) && !mark.pdfRects.length && (
          <p className="inline-note">
            原文已修改，请重新核对位置。你的批注会保留。
          </p>
        )}
        <div className="mark-colors" role="group" aria-label="高亮颜色">
          {[
            { id: "yellow", label: "黄色" },
            { id: "green", label: "绿色" },
            { id: "blue", label: "蓝色" },
            { id: "pink", label: "粉色" },
          ].map((c) => (
            <button
              key={c.id}
              className={`mark-${c.id}`}
              aria-label={c.label}
              aria-pressed={mark.color === c.id}
              disabled={working || saving || confirmLeave}
              onClick={() => setMark({ ...mark, color: c.id })}
            />
          ))}
        </div>
        <label className="annotation-note">
          写下你的想法
          <textarea
            aria-label="批注内容"
            rows={5}
            disabled={working || saving || confirmLeave}
            value={mark.note}
            onChange={(e) => setMark({ ...mark, note: e.target.value })}
            placeholder="可以只保留高亮，也可以写下批注…"
          />
        </label>
      </div>
        {saveError && <p role="alert" className="inline-note">{saveError}</p>}
        <footer className="annotation-editor-footer">
          {project.readingMarks.some((m) => m.id === mark.id) && (
            <Button
              variant="ghost"
              disabled={saving || working || confirmLeave}
              onClick={() => onDelete(mark.id)}
            >
              <Trash2 size={15} />
              删除
            </Button>
          )}
          <span className="spacer" />
          <Button disabled={saving || working} onClick={handleClose}>
            取消
          </Button>
          <Button
            variant="primary"
            busy={saving || working}
            onClick={async () => {
              if (await save()) onClose();
            }}
          >
            保存批注
          </Button>
        </footer>
        <div
          className="annotation-editor-resize-handle"
          onMouseDown={handleResizeStart}
        />
      </div>
      {confirmLeave && (
        <Modal title="批注尚未保存" onClose={() => { if (!working) settle(false); }}>
          <p>保存修改后继续，或明确放弃本次修改。</p>
          {saveError && <p role="alert" className="inline-note">{saveError}</p>}
          <footer>
            <Button disabled={working} onClick={() => settle(false)}>继续编辑</Button>
            <Button disabled={working} onClick={() => {
              latest.current.mark = latest.current.baseline;
              setMark(latest.current.baseline);
              settle(true);
            }}>放弃修改</Button>
            <Button busy={working} variant="primary" onClick={async () => {
              if (await save()) settle(true);
            }}>保存后继续</Button>
          </footer>
        </Modal>
      )}
    </>
  );
}
