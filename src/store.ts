import { create } from 'zustand';
import type { Doc, TrashItem, AppConfig } from './types';
import { defaultConfig, uid } from './types';

export type SidebarTab = 'docs' | 'outline' | 'trash';

export interface PersistedState {
  docs?: Doc[];
  trash?: TrashItem[];
  activeId?: string | null;
  cfg?: Partial<AppConfig>;
}

interface VetroState {
  docs: Doc[];
  trash: TrashItem[];
  activeId: string | null;
  cfg: AppConfig;
  sidebarTab: SidebarTab;

  load(data: PersistedState): void;
  setActive(id: string | null): void;
  setSidebarTab(tab: SidebarTab): void;
  setCfg(patch: Partial<AppConfig>): void;
  createDoc(name?: string, content?: string, parentId?: string | null): Doc;
  updateDoc(id: string, patch: Partial<Doc>): void;
  deleteDoc(id: string): void;
  restoreTrash(id: string): void;
  purgeTrash(id: string): void;
  setDocParent(id: string, parentId: string | null): void;
  toggleDocSync(id: string): void;
}

export const useStore = create<VetroState>((set) => ({
  docs: [],
  trash: [],
  activeId: null,
  cfg: defaultConfig(),
  sidebarTab: 'docs',

  load(data) {
    set({
      docs: data.docs || [],
      trash: data.trash || [],
      activeId: data.activeId ?? null,
      cfg: { ...defaultConfig(), ...(data.cfg || {}) }
    });
  },
  setActive(id) { set({ activeId: id }); },
  setSidebarTab(tab) { set({ sidebarTab: tab }); },
  setCfg(patch) { set((s) => ({ cfg: { ...s.cfg, ...patch } })); },

  createDoc(name, content, parentId) {
    const d: Doc = {
      id: uid(), name: name || '未命名.md', content: content || '',
      parentId: parentId ?? null, filePath: null, sync: true,
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
  deleteDoc(id) {
    set((s) => {
      const doc = s.docs.find((d) => d.id === id);
      if (!doc) return s;
      const docs = s.docs
        .filter((d) => d.id !== id)
        .map((d) => (d.parentId === id ? { ...d, parentId: doc.parentId } : d));
      return {
        docs,
        trash: [{ ...doc, deletedAt: Date.now() }, ...s.trash],
        activeId: s.activeId === id ? (docs[0]?.id ?? null) : s.activeId
      };
    });
  },
  restoreTrash(id) {
    set((s) => {
      const t = s.trash.find((x) => x.id === id);
      if (!t) return s;
      const { deletedAt: _del, ...doc } = t;
      return { trash: s.trash.filter((x) => x.id !== id), docs: [doc, ...s.docs], activeId: id };
    });
  },
  purgeTrash(id) { set((s) => ({ trash: s.trash.filter((x) => x.id !== id) })); },
  setDocParent(id, parentId) {
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, parentId } : d)) }));
  },
  toggleDocSync(id) {
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, sync: d.sync !== false } : d)) }));
  }
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

export function buildTree(docs: Doc[], collapsed: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const d of childrenOf(docs, parentId)) {
      out.push({ doc: d, depth });
      if (!collapsed.has(d.id)) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function docTreeContent(docs: Doc[], doc: Doc, depth = 0): string {
  const kids = childrenOf(docs, doc.id);
  if (!kids.length) return doc.content || '';
  let out = doc.content || '';
  for (const child of kids) {
    const level = Math.min(depth + 2, 6);
    const title = (child.name || '未命名').replace(/\.(md|markdown|txt)$/i, '');
    out = (out ? out + '\n\n' : '') + '#'.repeat(level) + ' ' + title + '\n\n' + docTreeContent(docs, child, depth + 1);
  }
  return out;
}
