// REQ-FE-308 / RF-REV-405：全局共享的自定义字体加载存储。
// - 每个字体 ID 一条记录，正文/标题/多本书共用，同一别名在 document.fonts 中最多保留一个 FontFace；
// - 状态可观察：idle / loading / ready / error，错误可见、可真正重读字节（force）；
// - 代际 gen：重试、强制重读、删除都会使旧请求作废，迟到结果不能覆盖新状态；
// - ready 但 Face 已不在 document.fonts（外部移除）时会重新加载，而不是误认为仍可用。
// 依赖通过 deps 注入，便于在 node 环境单测；默认实例见 useFontLoader.ts。
import { fontAlias } from "./font-family";

export type FontLoadStatus = "idle" | "loading" | "ready" | "error";

export interface FontLoadState {
  status: FontLoadStatus;
  /** 最近一次失败的作者可读信息；成功/加载中为空 */
  error: string;
  /** 已发起的字节读取次数（含重试），用于界面与测试观察 */
  attempts: number;
}

export interface FontFaceLike {
  family: string;
  status?: string;
  load(): Promise<unknown>;
}

export interface FontSetLike<F extends FontFaceLike = FontFaceLike> {
  add(face: F): unknown;
  delete(face: F): unknown;
  has(face: F): boolean;
  [Symbol.iterator](): Iterator<F>;
}

export interface FontStoreDeps<F extends FontFaceLike = FontFaceLike> {
  loadBytes: (fontId: string) => Promise<ArrayBuffer>;
  createFace: (alias: string, bytes: ArrayBuffer) => F;
  fonts: () => FontSetLike<F> | null;
  describeError: (e: unknown) => string;
}

interface Entry<F> {
  state: FontLoadState;
  face: F | null;
  gen: number;
  promise: Promise<void> | null;
}

export const IDLE_STATE: FontLoadState = Object.freeze({
  status: "idle",
  error: "",
  attempts: 0,
}) as FontLoadState;

export interface EnsureOptions {
  /** 忽略缓存与进行中的请求，重新读取字节并重建 FontFace */
  force?: boolean;
  /** 当前为 error 时自动再试一次（新会话打开阅读器时使用；设置面板打开时不自动重试） */
  retryError?: boolean;
}

export function createFontStore<F extends FontFaceLike>(deps: FontStoreDeps<F>) {
  const entries = new Map<string, Entry<F>>();
  const names = new Map<string, string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => {
    version++;
    for (const l of [...listeners]) l();
  };
  const entry = (id: string): Entry<F> => {
    let e = entries.get(id);
    if (!e) {
      e = { state: IDLE_STATE, face: null, gen: 0, promise: null };
      entries.set(id, e);
    }
    return e;
  };
  const setState = (e: Entry<F>, patch: Partial<FontLoadState>) => {
    e.state = { ...e.state, ...patch };
    notify();
  };
  /** 移除 document.fonts 中该别名的全部 Face（只可能是本存储加入的） */
  const removeAlias = (alias: string) => {
    const set = deps.fonts();
    if (!set) return;
    for (const f of [...set]) if (f.family.replace(/^["']|["']$/g, "") === alias) set.delete(f);
  };

  const ensure = (id: string, options: EnsureOptions = {}): Promise<void> => {
    if (!id) return Promise.resolve();
    const e = entry(id);
    if (!options.force) {
      if (e.state.status === "loading" && e.promise) return e.promise;
      if (e.state.status === "ready") {
        const set = deps.fonts();
        if (e.face && (!set || set.has(e.face))) return Promise.resolve();
      }
      if (e.state.status === "error" && !options.retryError) return Promise.resolve();
    }
    const gen = ++e.gen;
    const alias = fontAlias(id);
    setState(e, { status: "loading", error: "", attempts: e.state.attempts + 1 });
    const promise = (async () => {
      try {
        const bytes = await deps.loadBytes(id);
        if (e.gen !== gen || entries.get(id) !== e) return; // 迟到：已被重试/删除取代
        const face = deps.createFace(alias, bytes);
        await face.load();
        if (e.gen !== gen || entries.get(id) !== e) return;
        removeAlias(alias);
        deps.fonts()?.add(face);
        e.face = face;
        e.promise = null;
        setState(e, { status: "ready", error: "" });
      } catch (err) {
        if (e.gen !== gen || entries.get(id) !== e) return;
        e.promise = null;
        setState(e, { status: "error", error: deps.describeError(err) });
      }
    })();
    e.promise = promise;
    return promise;
  };

  return {
    get: (id: string): FontLoadState => entries.get(id)?.state || IDLE_STATE,
    ensure,
    /** 作者点击重试：真正重新读取字节 */
    retry: (id: string) => ensure(id, { force: true }),
    /** 重导成功（可能同 ID/hash 修复了字节）：已使用过的字体强制重读并重建 Face */
    refresh: (id: string) => (entries.has(id) ? ensure(id, { force: true }) : Promise.resolve()),
    /** 字体已从库中删除：作废进行中的请求并移除 Face */
    forget: (id: string) => {
      const e = entries.get(id);
      if (e) e.gen++;
      entries.delete(id);
      removeAlias(fontAlias(id));
      notify();
    },
    setNames: (list: { id: string; label: string }[]) => {
      let changed = false;
      for (const { id, label } of list)
        if (names.get(id) !== label) {
          names.set(id, label);
          changed = true;
        }
      if (changed) notify();
    },
    name: (id: string) => names.get(id) || "",
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => version,
  };
}

export type FontStore = ReturnType<typeof createFontStore>;
