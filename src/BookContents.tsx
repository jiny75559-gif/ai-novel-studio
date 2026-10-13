import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BookOutline, Project } from "./domain";
export function BookContents({
  project,
  chapterId,
  goto,
}: {
  project: Project;
  chapterId: string;
  goto: (cid: string, offset: number) => void;
}) {
  const outline = useMemo(() => {
    if (project.bookOutline.length) return project.bookOutline;
    const groups = new Map<string, BookOutline>();
    for (const c of project.chapters) {
      const key = c.volume || "正文";
      let g = groups.get(key);
      if (!g) {
        g = { title: key, chapterId: c.id, offset: 0, children: [] };
        groups.set(key, g);
      }
      g.children.push({
        title: c.title,
        chapterId: c.id,
        offset: 0,
        children: [],
      });
    }
    return groups.size > 1
      ? [...groups.values()]
      : [...groups.values()].flatMap((g) => g.children);
  }, [project.bookOutline, project.chapters]);
  const [filter, setFilter] = useState(""),
    [top, setTop] = useState(0),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const result: { item: BookOutline; depth: number; key: string }[] = [];
    const walk = (nodes: BookOutline[], depth: number, path: string) =>
      nodes.forEach((item, i) => {
        const key = `${path}/${i}`;
        if (
          !filter ||
          item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
        )
          result.push({ item, depth, key });
        if (filter || !collapsed.has(key)) walk(item.children, depth + 1, key);
      });
    walk(outline, 1, "");
    return result;
  }, [outline, filter, collapsed]);
  const start = Math.max(0, Math.floor(top / 38) - 5),
    end = Math.min(rows.length, start + 45);
  useEffect(() => {
    if (filter) return;
    const i = rows.findIndex((r) => r.item.chapterId === chapterId);
    if (i >= 0 && container.current) {
      const y = Math.max(0, i * 38 - 76);
      container.current.scrollTop = y;
      setTop(y);
    }
  }, [chapterId, rows, filter]);
  return (
    <>
      <input
        className="toc-filter"
        aria-label="筛选目录"
        placeholder="查找章节…"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setTop(0);
          if (container.current) container.current.scrollTop = 0;
        }}
      />
      <div
        className="toc-tree-list"
        role="tree"
        aria-label="章节目录"
        ref={container}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * 38, position: "relative" }}>
          {rows.slice(start, end).map(({ item, depth, key }, i) => (
            <div
              key={key}
              className={`toc-tree-row ${item.chapterId === chapterId ? "selected" : ""}`}
              role="treeitem"
              aria-level={depth}
              aria-selected={item.chapterId === chapterId}
              style={{
                top: (start + i) * 38,
                paddingLeft: 8 + (depth - 1) * 14,
              }}
            >
              {item.children.length > 0 ? (
                <button
                  aria-label={
                    collapsed.has(key)
                      ? `展开 ${item.title}`
                      : `折叠 ${item.title}`
                  }
                  onClick={() =>
                    setCollapsed((s) => {
                      const next = new Set(s);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  {collapsed.has(key) ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
              ) : (
                <span className="toc-spacer" />
              )}
              <button
                title={item.title}
                onClick={() => goto(item.chapterId, item.offset)}
              >
                {item.title}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
