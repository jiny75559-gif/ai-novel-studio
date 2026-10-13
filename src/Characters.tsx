import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  GitBranch,
  Network,
  Search,
  UserRound,
  Trash2,
  Check,
  ArrowRight,
  Link2,
} from "lucide-react";
import type { Actions } from "./App";
import {
  type Project,
  type Character,
  type Relation,
  blankCharacter,
  blankRelation,
  visibilityLabels,
} from "./domain";
import { Button, Confirm, Empty, Field, Modal } from "./components";
export function Characters({
  project,
  actions,
  chapterOrder,
}: {
  project: Project;
  actions: Actions;
  chapterOrder: number;
}) {
  const [mode, setMode] = useState<"graph" | "tree">("graph");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState(chapterOrder);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Character | null>(null);
  const [relation, setRelation] = useState<Relation | null>(null);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const visible = useMemo(
    () =>
      project.characters.filter(
        (c) => !c.deleted && (c.name.includes(query) || c.role.includes(query)),
      ),
    [project.characters, query],
  );
  const activeRelations = useMemo(
    () =>
      project.relations.filter(
        (r) =>
          r.startOrder <= order &&
          (!r.endOrder || r.endOrder >= order) &&
          (filter === "all" || r.kind === filter) &&
          visible.some((c) => c.id === r.fromId) &&
          visible.some((c) => c.id === r.toId),
      ),
    [project.relations, order, filter, visible],
  );
  const buildNodes = useCallback(
    () =>
      visible.map((c): Node => ({
        id: c.id,
        position: { x: c.x, y: c.y },
        data: {
          label: (
            <div className="character-node">
              <div className="avatar">{c.name.slice(0, 1)}</div>
              <div>
                <strong>{c.name}</strong>
                <small>{c.role || "人物"}</small>
              </div>
            </div>
          ),
        },
        style: {
          padding: 0,
          border: "none",
          borderRadius: 12,
          width: 190,
          background: "transparent",
        },
        sourcePosition: "right" as Node["sourcePosition"],
        targetPosition: "left" as Node["targetPosition"],
      })),
    [visible],
  );
  const [nodes, setNodes] = useState<Node[]>(buildNodes);
  useEffect(() => setNodes(buildNodes()), [buildNodes]);
  const edges: Edge[] = activeRelations.map((r, index) => ({
    id: r.id,
    source: r.fromId,
    target: r.toId,
    label: r.kind,
    type: "smoothstep",
    animated: false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: r.visibility === "author_only" ? "#bc9260" : "#7b9390",
    },
    markerStart:
      r.direction === "both"
        ? { type: MarkerType.ArrowClosed, color: "#7b9390" }
        : undefined,
    labelStyle: { fontSize: 12, fill: "#59615c" },
    labelBgStyle: { fill: "#faf8f3" },
    style: {
      stroke: r.visibility === "author_only" ? "#bc9260" : "#8a9d99",
      strokeWidth: 1.5,
      strokeDasharray: r.visibility === "author_only" ? "5 4" : undefined,
    },
    pathOptions: { offset: 20 + index * 12 },
  }));
  const onConnect = (c: Connection) =>
    setRelation({
      ...blankRelation(),
      fromId: c.source || "",
      toId: c.target || "",
      startOrder: order,
    });
  const name = (id: string) =>
    project.characters.find((c) => c.id === id)?.name || "未知人物";
  return (
    <div className="content-page characters-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CHARACTER CONSTELLATION</span>
          <h1>让每个人物，都有来处。</h1>
          <p>关系是网络，树是视角。人物状态和知识会进入 AI 的写作资料。</p>
        </div>
        <div className="button-group">
          <Button onClick={() => setRelation(blankRelation())}>
            <Link2 size={15} />
            添加关系
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              setEditing({
                ...blankCharacter(),
                x: 120 + (visible.length % 3) * 240,
                y: 100 + Math.floor(visible.length / 3) * 150,
              })
            }
          >
            <Plus size={16} />
            新增人物
          </Button>
        </div>
      </div>
      <div className="graph-layout">
        <section className="panel graph-panel">
          <div className="graph-toolbar">
            <div className="segmented">
              <button
                className={mode === "graph" ? "active" : ""}
                onClick={() => setMode("graph")}
              >
                <Network size={14} />
                关系网络
              </button>
              <button
                className={mode === "tree" ? "active" : ""}
                onClick={() => setMode("tree")}
              >
                <GitBranch size={14} />
                树形视图
              </button>
            </div>
            <div className="graph-filter">
              <label>
                第
                <input
                  aria-label="关系生效章节"
                  type="number"
                  min={1}
                  value={order}
                  onChange={(e) =>
                    setOrder(Math.max(1, Number(e.target.value)))
                  }
                />
                章
              </label>
              <select
                aria-label="关系类型筛选"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">全部关系</option>
                {[...new Set(project.relations.map((r) => r.kind))].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="graph-canvas">
            {mode === "graph" ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={(changes: NodeChange[]) =>
                  setNodes((old) => applyNodeChanges(changes, old))
                }
                onNodeDragStop={(_e, node) => {
                  const c = project.characters.find((c) => c.id === node.id);
                  if (c)
                    void actions.mutate({
                      type: "character",
                      character: {
                        ...c,
                        x: node.position.x,
                        y: node.position.y,
                      },
                    });
                }}
                onNodeDoubleClick={(_e, node) =>
                  setEditing(project.characters.find((c) => c.id === node.id)!)
                }
                onEdgeClick={(_e, edge) =>
                  setRelation(project.relations.find((r) => r.id === edge.id)!)
                }
                onConnect={onConnect}
                fitView
                fitViewOptions={{ padding: 0.35 }}
                minZoom={0.25}
                maxZoom={1.8}
              >
                <Background color="#d3d7cc" gap={22} size={1} />
                <Controls showInteractive={false} />
                <MiniMap nodeColor="#9ab0a8" maskColor="#f4f3edd9" />
              </ReactFlow>
            ) : (
              <RelationshipTree
                characters={visible}
                relations={activeRelations}
                onEdit={setEditing}
              />
            )}
            {!visible.length && (
              <div className="graph-empty">
                <Empty
                  icon={<UserRound size={32} />}
                  title="从第一个人物开始"
                  description="录入人物背景、状态和已知秘密，让 AI 理解他们。"
                >
                  <Button onClick={() => setEditing(blankCharacter())}>
                    <Plus size={14} />
                    新增人物
                  </Button>
                </Empty>
              </div>
            )}
          </div>
          <div className="graph-caption">
            <span>
              <i />
              公开关系
            </span>
            <span>
              <i className="secret" />
              秘密关系
            </span>
            <small>拖动保存位置 · 从节点连线建立关系 · 双击编辑人物</small>
          </div>
        </section>
        <aside className="character-directory">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="搜索人物、身份…"
              aria-label="搜索人物"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <h3>
            人物卡 <span>{visible.length}</span>
          </h3>
          {visible.map((c) => (
            <button
              className="character-card"
              key={c.id}
              onClick={() => setEditing(c)}
            >
              <header>
                <div className="avatar">{c.name.slice(0, 1)}</div>
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.role || "尚未填写身份"}</small>
                </div>
                <ArrowRight size={15} />
              </header>
              <p>{c.profile || "填写背景与性格…"}</p>
              {c.state && (
                <div>
                  <span>状态</span>
                  {c.state}
                </div>
              )}
              {c.knowledge && (
                <div>
                  <span>知识</span>
                  {c.knowledge}
                </div>
              )}
            </button>
          ))}
          <h3 className="relations-label">
            当前关系 <span>{activeRelations.length}</span>
          </h3>
          {activeRelations.map((r) => (
            <button
              className="relation-list-item"
              key={r.id}
              onClick={() => setRelation(r)}
            >
              <div>
                {name(r.fromId)} {r.direction === "both" ? "↔" : "→"}{" "}
                {name(r.toId)}
              </div>
              <span>{r.kind}</span>
              <small>{visibilityLabels[r.visibility]}</small>
            </button>
          ))}
        </aside>
      </div>
      {editing && (
        <CharacterModal
          character={editing}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setDeleting(editing);
            setEditing(null);
          }}
          onSave={async (c) => {
            const p = await actions.mutate({ type: "character", character: c });
            if (p) {
              setEditing(null);
              actions.notice("人物卡已保存，新的写作会读取更新后的资料。");
            }
          }}
        />
      )}
      {relation && (
        <RelationModal
          relation={relation}
          characters={project.characters.filter((c) => !c.deleted)}
          onClose={() => setRelation(null)}
          onDelete={async () => {
            const p = await actions.mutate({
              type: "deleteRelation",
              relation_id: relation.id,
            });
            if (p) setRelation(null);
          }}
          onSave={async (r) => {
            const p = await actions.mutate({ type: "relation", relation: r });
            if (p) setRelation(null);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`隐藏人物 ${deleting.name}`}
          description={`有 ${project.relations.filter((r) => r.fromId === deleting.id || r.toId === deleting.id).length} 条关系涉及此人物。隐藏后从当前视图和新生成资料中移除，历史快照仍保留。`}
          label="隐藏人物"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await actions.mutate({
              type: "character",
              character: { ...deleting, deleted: true },
            });
            setDeleting(null);
          }}
        />
      )}
      {project.characters.some((c) => c.deleted) && (
        <details className="archived-characters">
          <summary>已隐藏人物</summary>
          {project.characters
            .filter((c) => c.deleted)
            .map((c) => (
              <Button
                key={c.id}
                onClick={() =>
                  void actions.mutate({
                    type: "character",
                    character: { ...c, deleted: false },
                  })
                }
              >
                恢复 {c.name}
              </Button>
            ))}
        </details>
      )}
    </div>
  );
}
function CharacterModal({
  character,
  onClose,
  onSave,
  onDelete,
}: {
  character: Character;
  onClose: () => void;
  onSave: (c: Character) => Promise<void>;
  onDelete: () => void;
}) {
  const [c, setC] = useState(character);
  const [busy, setBusy] = useState(false);
  const change = (key: keyof Character, value: string) =>
    setC((c) => ({ ...c, [key]: value }));
  return (
    <Modal
      title={character.id ? "编辑人物卡" : "新的人物"}
      subtitle="把人物不知道的事也写清楚，避免 AI 泄露秘密。"
      onClose={onClose}
      wide
    >
      <div className="form-grid">
        <Field label="姓名">
          <input
            value={c.name}
            onChange={(e) => change("name", e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="身份 / 阵营">
          <input
            value={c.role}
            onChange={(e) => change("role", e.target.value)}
            placeholder="主角、信使、反派…"
          />
        </Field>
      </div>
      <Field label="别名 / 重名区分">
        <input
          value={c.aliases}
          onChange={(e) => change("aliases", e.target.value)}
        />
      </Field>
      <Field label="背景、性格与动机">
        <textarea
          rows={4}
          value={c.profile}
          onChange={(e) => change("profile", e.target.value)}
        />
      </Field>
      <div className="form-grid">
        <Field
          label="作者确认的状态"
          hint="伤势、地点、物品。需要时在记忆中设置分章有效期。"
        >
          <textarea
            rows={4}
            value={c.state}
            onChange={(e) => change("state", e.target.value)}
            placeholder="例如：左臂受伤；持有铜钥匙…"
          />
        </Field>
        <Field
          label="知识与秘密边界"
          hint="清楚写出知道什么、不知道什么，以及何时得知。"
        >
          <textarea
            rows={4}
            value={c.knowledge}
            onChange={(e) => change("knowledge", e.target.value)}
            placeholder="例如：知道钥匙藏处，但不知道蓝光来源…"
          />
        </Field>
      </div>
      <footer>
        {character.id && (
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={14} />
            隐藏人物
          </Button>
        )}
        <span className="spacer" />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={!c.name.trim()}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(c);
            setBusy(false);
          }}
        >
          <Check size={14} />
          保存人物
        </Button>
      </footer>
    </Modal>
  );
}
function RelationModal({
  relation,
  characters,
  onSave,
  onClose,
  onDelete,
}: {
  relation: Relation;
  characters: Character[];
  onSave: (r: Relation) => Promise<void>;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [r, setR] = useState(relation);
  const [busy, setBusy] = useState(false);
  const change = (key: keyof Relation, value: string | number | null) =>
    setR((r) => ({ ...r, [key]: value }));
  const selectCharacter = (key: "fromId" | "toId") => (
    <select value={r[key]} onChange={(e) => change(key, e.target.value)}>
      <option value="">选择人物</option>
      {characters.map((c) => (
        <option value={c.id} key={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
  return (
    <Modal
      title={relation.id ? "编辑人物关系" : "建立人物关系"}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="关系发起者">{selectCharacter("fromId")}</Field>
        <Field label="关系对象">{selectCharacter("toId")}</Field>
      </div>
      <div className="form-grid">
        <Field label="关系类型">
          <input
            value={r.kind}
            onChange={(e) => change("kind", e.target.value)}
            placeholder="师徒、兄妹、暗恋、同盟…"
          />
        </Field>
        <Field label="方向">
          <select
            value={r.direction}
            onChange={(e) => change("direction", e.target.value)}
          >
            <option value="one">单向 →</option>
            <option value="both">双向 ↔</option>
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field label="起始章节">
          <input
            type="number"
            min={1}
            value={r.startOrder}
            onChange={(e) => change("startOrder", Number(e.target.value))}
          />
        </Field>
        <Field label="结束章节（可空）">
          <input
            type="number"
            min={r.startOrder}
            value={r.endOrder || ""}
            onChange={(e) =>
              change("endOrder", e.target.value ? Number(e.target.value) : null)
            }
          />
        </Field>
      </div>
      <Field label="谁知道这段关系">
        <select
          value={r.visibility}
          onChange={(e) => change("visibility", e.target.value)}
        >
          {Object.entries(visibilityLabels).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="依据 / 获知者">
        <textarea
          rows={2}
          value={r.source}
          onChange={(e) => change("source", e.target.value)}
          placeholder="作者设定，或第几章的具体事件；秘密由谁知晓…"
        />
      </Field>
      <footer>
        {relation.id && (
          <Button variant="danger" onClick={() => void onDelete()}>
            <Trash2 size={14} />
            删除关系
          </Button>
        )}
        <span className="spacer" />
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={!r.fromId || !r.toId || !r.kind.trim()}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(r);
            setBusy(false);
          }}
        >
          保存关系
        </Button>
      </footer>
    </Modal>
  );
}
function RelationshipTree({
  characters,
  relations,
  onEdit,
}: {
  characters: Character[];
  relations: Relation[];
  onEdit: (c: Character) => void;
}) {
  const roots = characters.filter(
    (c) => !relations.some((r) => r.toId === c.id),
  );
  const seen = new Set<string>();
  function branch(
    c: Character,
    path: Set<string>,
    label = "",
  ): React.ReactNode {
    if (path.has(c.id))
      return (
        <div className="tree-cycle" key={c.id}>
          ↩ {c.name}（交叉关系）
        </div>
      );
    seen.add(c.id);
    const next = new Set([...path, c.id]);
    return (
      <div className="tree-branch" key={`${c.id}-${label}`}>
        <button className="tree-node" onClick={() => onEdit(c)}>
          <UserRound size={15} />
          <strong>{c.name}</strong>
          <small>{label || c.role}</small>
        </button>
        <div className="tree-children">
          {relations
            .filter((r) => r.fromId === c.id)
            .map((r) => {
              const child = characters.find((c) => c.id === r.toId);
              return child ? branch(child, next, r.kind) : null;
            })}
        </div>
      </div>
    );
  }
  return (
    <div className="relationship-tree">
      {roots.map((c) => branch(c, new Set()))}
      {characters
        .filter((c) => !seen.has(c.id))
        .map((c) => branch(c, new Set()))}
      <p className="muted">
        树形视图沿关系方向展开；多重关系与环仍保存在网络里。
      </p>
    </div>
  );
}
