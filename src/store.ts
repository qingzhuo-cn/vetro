import { create } from 'zustand';
import type { Doc, TrashItem, AppConfig, ViewMode } from './types';
import { defaultConfig, FONT_FAMILIES, uid, VISUAL_THEMES } from './types';

export type SidebarTab = 'docs' | 'outline' | 'trash' | 'tags' | 'attachments';

export interface PersistedState {
  docs?: Doc[];
  trash?: TrashItem[];
  activeId?: string | null;
  cfg?: Partial<AppConfig>;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface VetroState {
  docs: Doc[];
  trash: TrashItem[];
  activeId: string | null;
  cfg: AppConfig;
  sidebarTab: SidebarTab;
  /** 标签筛选：null = 不筛选，string = 只显示含该标签的文档 */
  filterTag: string | null;
  /** 保存状态指示 */
  saveStatus: SaveStatus;
  /** undo/redo 栈（基于 snapshots） */
  undoStack: PersistedState[];
  redoStack: PersistedState[];

  load(data: PersistedState): void;
  setActive(id: string | null): void;
  setSidebarTab(tab: SidebarTab): void;
  setCfg(patch: Partial<AppConfig>): void;
  setFilterTag(tag: string | null): void;
  setSaveStatus(status: SaveStatus): void;
  replaceDocuments(docs: Doc[], trash: TrashItem[], activeId?: string | null): void;
  createDoc(name?: string, content?: string, parentId?: string | null): Doc;
  updateDoc(id: string, patch: Partial<Doc>): void;
  /** updateDoc 的快照感知版本，记录到 undo 栈 */
  updateDocWithUndo(id: string, patch: Partial<Doc>): void;
  deleteDoc(id: string): void;
  restoreTrash(id: string): void;
  purgeTrash(id: string): void;
  setDocParent(id: string, parentId: string | null): void;
  moveDoc(id: string, parentId: string | null): void;
  toggleDocSync(id: string): void;
  addDocTag(id: string, tag: string): void;
  removeDocTag(id: string, tag: string): void;
  toggleDocFavorite(id: string): void;
  undo(): void;
  redo(): void;
  /** 收集所有文档中使用的标签 */
  allTags(): string[];
}

function validOneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

const VIEW_MODES = ['edit', 'split', 'preview'] as const;
function validViewOrNull(value: unknown): ViewMode | null {
  return typeof value === 'string' && VIEW_MODES.includes(value as ViewMode) ? value as ViewMode : null;
}
function sanitizeDoc(value: unknown): Doc | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Doc>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.content !== 'string') return null;
  return {
    id: raw.id,
    name: raw.name || '未命名.md',
    content: raw.content,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    filePath: typeof raw.filePath === 'string' ? raw.filePath : null,
    sync: raw.sync !== false,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 100) : [],
    favorite: raw.favorite === true,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

function sanitizeTrash(value: unknown): TrashItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TrashItem>;
  const doc = sanitizeDoc(raw);
  if (!doc || typeof raw.deletedAt !== 'number' || !Number.isFinite(raw.deletedAt)) return null;
  return { ...doc, deletedAt: raw.deletedAt };
}

function sanitizeConfig(input: Partial<AppConfig> | undefined): AppConfig {
  const defaults = defaultConfig();
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const aiRaw = raw.ai && typeof raw.ai === 'object' ? raw.ai as Record<string, unknown> : {};
  const syncRaw = raw.sync && typeof raw.sync === 'object' ? raw.sync as Record<string, unknown> : {};
  const theme = validOneOf(raw.theme, ['auto', 'dark', 'light'] as const, defaults.theme);
  const viewMode = validOneOf(raw.viewMode, ['edit', 'split', 'preview'] as const, defaults.viewMode);
  const visualTheme = validOneOf(raw.visualTheme, VISUAL_THEMES, defaults.visualTheme);
  const fontFamily = validOneOf(raw.fontFamily, FONT_FAMILIES, defaults.fontFamily);
  const fontSize = typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize) ? Math.max(12, Math.min(24, raw.fontSize)) : defaults.fontSize;
  const dividerRatio = typeof raw.dividerRatio === 'number' && Number.isFinite(raw.dividerRatio) ? Math.max(0.25, Math.min(0.75, raw.dividerRatio)) : defaults.dividerRatio;
  return {
    ...defaults,
    theme,
    visualTheme,
    viewMode,
    fontSize,
    fontFamily,
    dividerRatio,
    immersionPreviousView: validViewOrNull(raw.immersionPreviousView),
    wrap: raw.wrap !== false,
    accent: typeof raw.accent === 'string' ? raw.accent : defaults.accent,
    icon: typeof raw.icon === 'string' ? raw.icon : defaults.icon,
    customThemes: Array.isArray(raw.customThemes) ? raw.customThemes.filter((theme): theme is AppConfig['customThemes'][number] => !!theme && typeof theme === 'object' && typeof (theme as { id?: unknown }).id === 'string') : [],
    ai: {
      endpoint: typeof aiRaw.endpoint === 'string' ? aiRaw.endpoint : defaults.ai.endpoint,
      key: '',
      model: typeof aiRaw.model === 'string' && aiRaw.model ? aiRaw.model : defaults.ai.model,
      ok: aiRaw.ok === true,
    },
    sync: {
      enabled: syncRaw.enabled === true,
      url: typeof syncRaw.url === 'string' ? syncRaw.url : defaults.sync.url,
      username: typeof syncRaw.username === 'string' ? syncRaw.username : defaults.sync.username,
      password: '',
      autosync: syncRaw.autosync === true,
      lastSync: typeof syncRaw.lastSync === 'number' && Number.isFinite(syncRaw.lastSync) ? syncRaw.lastSync : 0,
    },
    focusMode: raw.focusMode === true,
    typewriterMode: raw.typewriterMode === true,
  };
}

/** 创建用于 undo 的快照（只保留需要恢复的字段） */
function snapshot(s: VetroState): PersistedState {
  return {
    docs: s.docs.map((d) => ({ ...d })),
    trash: s.trash.map((t) => ({ ...t })),
    activeId: s.activeId,
  };
}

export const useStore = create<VetroState>((set, get) => ({
  docs: [],
  trash: [],
  activeId: null,
  cfg: defaultConfig(),
  sidebarTab: 'docs',
  filterTag: null,
  saveStatus: 'idle',
  undoStack: [],
  redoStack: [],

  load(data) {
    const docs = Array.isArray(data?.docs) ? data.docs.map(sanitizeDoc).filter((d): d is Doc => !!d) : [];
    const trash = Array.isArray(data?.trash) ? data.trash.map(sanitizeTrash).filter((d): d is TrashItem => !!d) : [];
    const activeId = typeof data?.activeId === 'string' && docs.some((d) => d.id === data.activeId) ? data.activeId : (docs[0]?.id ?? null);
    set({ docs, trash, activeId, cfg: sanitizeConfig(data?.cfg) });
  },
  setActive(id) { set({ activeId: id }); },
  setSidebarTab(tab) { set({ sidebarTab: tab }); },
  setCfg(patch) { set((s) => ({ cfg: { ...s.cfg, ...patch } })); },
  setFilterTag(tag) { set({ filterTag: tag }); },
  setSaveStatus(status) { set({ saveStatus: status }); },
  replaceDocuments(docs, trash, activeId) {
    const safeDocs = docs.map(sanitizeDoc).filter((d): d is Doc => !!d);
    const safeTrash = trash.map(sanitizeTrash).filter((d): d is TrashItem => !!d);
    set({ docs: safeDocs, trash: safeTrash, activeId: activeId && safeDocs.some((d) => d.id === activeId) ? activeId : (safeDocs[0]?.id ?? null) });
  },

  createDoc(name?: string, content?: string, parentId?: string | null) {
    const d: Doc = {
      id: uid(), name: name || '未命名.md', content: content || '',
      parentId: parentId ?? null, filePath: null, sync: true,
      tags: [], favorite: false,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    set((s) => ({ docs: [d, ...s.docs], activeId: d.id }));
    return d;
  },
  updateDoc(id, patch) {
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d))
    }));
  },
  updateDocWithUndo(id, patch) {
    const s = get();
    const before = s.docs.find((d) => d.id === id);
    if (!before || before.content === patch.content) return; // 内容没变就不入栈
    const snap = snapshot(s);
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
      undoStack: [...state.undoStack.slice(-199), snap],
      redoStack: [],
    }));
  },
  deleteDoc(id) {
    set((s) => {
      const doc = s.docs.find((d) => d.id === id);
      if (!doc) return s;
      const snap = snapshot(s);
      const docs = s.docs
        .filter((d) => d.id !== id)
        .map((d) => (d.parentId === id ? { ...d, parentId: doc.parentId } : d));
      return {
        docs,
        trash: [{ ...doc, deletedAt: Date.now() }, ...s.trash],
        activeId: s.activeId === id ? (docs[0]?.id ?? null) : s.activeId,
        undoStack: [...s.undoStack.slice(-199), snap],
        redoStack: [],
      };
    });
  },
  restoreTrash(id) {
    set((s) => {
      const t = s.trash.find((x) => x.id === id);
      if (!t) return s;
      const { deletedAt: _del, ...doc } = t;
      const validParent = doc.parentId ? s.docs.some((d) => d.id === doc.parentId) : true;
      const restoredDoc = validParent ? doc : { ...doc, parentId: null };
      return { trash: s.trash.filter((x) => x.id !== id), docs: [restoredDoc, ...s.docs], activeId: id };
    });
  },
  purgeTrash(id) { set((s) => ({ trash: s.trash.filter((x) => x.id !== id) })); },
  setDocParent(id, parentId) {
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, parentId } : d)) }));
  },
  moveDoc(id, parentId) {
    set((s) => {
      const doc = s.docs.find((d) => d.id === id);
      if (!doc) return s;
      if (parentId) {
        let cur = s.docs.find((d) => d.id === parentId);
        while (cur) {
          if (cur.id === id) return s;
          const nextId = cur.parentId;
          cur = nextId ? s.docs.find((d) => d.id === nextId) : undefined;
        }
      }
      return { docs: s.docs.map((d) => (d.id === id ? { ...d, parentId } : d)), activeId: id };
    });
  },
  toggleDocSync(id) {
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, sync: d.sync === false } : d)) }));
  },
  addDocTag(id, tag) {
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id && !d.tags.includes(tag) ? { ...d, tags: [...d.tags, tag] } : d))
    }));
  },
  removeDocTag(id, tag) {
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, tags: d.tags.filter((t) => t !== tag) } : d))
    }));
  },
  toggleDocFavorite(id) {
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, favorite: !d.favorite } : d))
    }));
  },
  undo() {
    const s = get();
    if (!s.undoStack.length) return;
    const prev = s.undoStack[s.undoStack.length - 1];
    const current = snapshot(s);
    set({
      docs: prev.docs ?? [],
      trash: prev.trash ?? [],
      activeId: prev.activeId ?? null,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, current],
    });
  },
  redo() {
    const s = get();
    if (!s.redoStack.length) return;
    const next = s.redoStack[s.redoStack.length - 1];
    const current = snapshot(s);
    set({
      docs: next.docs ?? [],
      trash: next.trash ?? [],
      activeId: next.activeId ?? null,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, current],
    });
  },
  allTags() {
    const s = get();
    const tags = new Set<string>();
    for (const d of s.docs) for (const t of d.tags) tags.add(t);
    return Array.from(tags).sort();
  },
}));

// —— 派生工具 ——

export function activeDoc(): Doc | null {
  const s = useStore.getState();
  return s.docs.find((d) => d.id === s.activeId) ?? null;
}

export function childrenOf(docs: Doc[], parentId: string | null): Doc[] {
  return docs.filter((d) => (d.parentId ?? null) === parentId);
}

export interface TreeNode { doc: Doc; depth: number; }

export function buildTree(docs: Doc[], collapsed: Set<string>, filterTag?: string | null): TreeNode[] {
  const out: TreeNode[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const d of childrenOf(docs, parentId)) {
      if (visited.has(d.id)) continue;
      visited.add(d.id);
      // 标签筛选：只显示含目标标签的文档（子文档不受限）
      if (filterTag && !d.tags.includes(filterTag) && !d.favorite) {
        // 如果是收藏的文档，始终显示
        // 否则跳过（但仍然递归子节点，以查找后代中可能命中的）
      } else {
        out.push({ doc: d, depth });
      }
      if (!collapsed.has(d.id)) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function docTreeContent(docs: Doc[], doc: Doc, depth = 0): string {
  const visited = new Set<string>();
  const walk = (d: Doc, dDepth: number): string => {
    if (visited.has(d.id)) return '';
    visited.add(d.id);
    const kids = childrenOf(docs, d.id);
    if (!kids.length) return d.content || '';
    let out = d.content || '';
    for (const child of kids) {
      if (visited.has(child.id)) continue;
      const level = Math.min(dDepth + 2, 6);
      const title = (child.name || '未命名').replace(/\.(md|markdown|txt)$/i, '');
      out = (out ? out + '\n\n' : '') + '#'.repeat(level) + ' ' + title + '\n\n' + walk(child, dDepth + 1);
    }
    return out;
  };
  return walk(doc, depth);
}
