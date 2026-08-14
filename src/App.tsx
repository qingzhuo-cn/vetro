import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, buildTree, docTreeContent, childrenOf } from './store';
import { renderMarkdown, highlightCode } from './markdown';
import { createEditor } from './editor';
import { PluginManager } from './plugins';
import type { Command, RenderHooks } from './plugins';
import { ACCENTS, ICONS, rgba, lighten, darken } from './presets';
import { defaultConfig } from './types';
import type { Doc, AppConfig, ViewMode } from './types';
import type { Extension } from '@codemirror/state';
import { demoPlugin } from './demo-plugin';

const STORAGE_KEY = 'vetro::v2';

/* ===== 全局 toast ===== */
type ToastItem = { id: number; msg: string; kind: string };
let pushToast: ((msg: string, kind?: string) => void) | null = null;
function toast(msg: string, kind = '') { pushToast?.(msg, kind); }

const pm = new PluginManager({ toast }, (m) => console.log(m));

/* ===== 主题 ===== */
function resolveTheme(cfg: AppConfig): 'dark' | 'light' {
  return cfg.theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : cfg.theme;
}
function applyTheme(cfg: AppConfig) {
  const resolved = resolveTheme(cfg);
  document.body.dataset.theme = resolved;
  const accent = ACCENTS.find((a) => a.id === cfg.accent) || ACCENTS[0];
  const root = document.documentElement.style;
  root.setProperty('--accent', accent.accent);
  root.setProperty('--accent-2', accent.accent2);
  root.setProperty('--accent-strong', resolved === 'light' ? darken(accent.accent, 0.15) : lighten(accent.accent, 0.12));
  root.setProperty('--accent-soft', rgba(accent.accent, 0.18));
  root.setProperty('--accent-border', rgba(accent.accent, 0.35));
  root.setProperty('--accent-glow', rgba(accent.accent, 0.38));
  root.setProperty('--editor-fs', cfg.fontSize + 'px');
  if (accent.vars) for (const [k, v] of Object.entries(accent.vars)) root.setProperty(k, v);
}

/* ===== 图标 ===== */
function BrandLogo({ iconId }: { iconId: string }) {
  const icon = ICONS.find((i) => i.id === iconId) || ICONS[0];
  return (
    <svg className="brand-logo" viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="32" height="32" rx="10" fill="url(#logoGrad)" />
      <rect x="2.6" y="2.6" width="30.8" height="30.8" rx="9.4" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1" />
      <g dangerouslySetInnerHTML={{ __html: icon.glyph }} />
    </svg>
  );
}

/* ===== 编辑器 ===== */
function EditorPane({ doc, extra }: { doc: Doc; extra: Extension[] }) {
  const updateDoc = useStore((s) => s.updateDoc);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const view = createEditor(ref.current, doc.content, (v) => updateDoc(doc.id, { content: v }), extra);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);
  return <div className="editor-host" ref={ref} />;
}

/* ===== 预览 ===== */
function PreviewPane({ doc, hooks }: { doc: Doc; hooks: RenderHooks[] }) {
  const html = useMemo(() => renderMarkdown(doc.content, hooks), [doc.content, hooks]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) highlightCode(ref.current); }, [html]);
  return <div className="preview markdown-body" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ===== 文档树 ===== */
function DocTree() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const createDoc = useStore((s) => s.createDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const setDocParent = useStore((s) => s.setDocParent);
  const toggleDocSync = useStore((s) => s.toggleDocSync);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const nodes = useMemo(() => buildTree(docs, collapsed), [docs, collapsed]);
  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!nodes.length) {
    return <div className="doc-empty"><p>暂无文档</p><span>点击顶部「新建」开始</span></div>;
  }
  return (
    <div className="doc-list">
      {nodes.map(({ doc, depth }) => {
        const hasKids = childrenOf(docs, doc.id).length > 0;
        const words = (doc.content || '').replace(/\s/g, '').length;
        const initial = (doc.name || 'md').replace(/\.(md|markdown|txt)$/i, '').trim().slice(0, 2).toUpperCase() || 'MD';
        return (
          <div
            key={doc.id}
            className={'doc-item' + (doc.id === activeId ? ' active' : '')}
            style={{ paddingLeft: 10 + depth * 16, '--i': 0 } as React.CSSProperties}
            onClick={() => setActive(doc.id)}
          >
            {hasKids
              ? <button className="doc-caret" onClick={(e) => { e.stopPropagation(); toggle(doc.id); }}>{collapsed.has(doc.id) ? '▶' : '▼'}</button>
              : <span className="doc-caret ph" />}
            <div className="doc-ico">{initial}</div>
            <div className="doc-meta">
              <div className="doc-name">{doc.name}</div>
              <div className="doc-sub">{words} 字</div>
            </div>
            <button className="doc-sync on" title="同步" onClick={(e) => { e.stopPropagation(); toggleDocSync(doc.id); }}>☁</button>
            <button className="doc-subnew" title="新建子文档" onClick={(e) => { e.stopPropagation(); createDoc(doc.name.replace(/\.\w+$/i, '') + ' · 子文档.md', '', doc.id); }}>＋</button>
            <button className="doc-move" title="提升为主文档" onClick={(e) => { e.stopPropagation(); setDocParent(doc.id, null); }}>↳</button>
            <button className="doc-del" title="删除" onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id); }}>🗑</button>
          </div>
        );
      })}
    </div>
  );
}

/* ===== 回收站 ===== */
function TrashList() {
  const trash = useStore((s) => s.trash);
  const restore = useStore((s) => s.restoreTrash);
  const purge = useStore((s) => s.purgeTrash);
  if (!trash.length) return <div className="doc-empty"><p>回收站为空</p></div>;
  return (
    <div className="doc-list">
      {trash.map((t) => (
        <div key={t.id} className="doc-item trash-item">
          <div className="doc-ico">🗑</div>
          <div className="doc-meta"><div className="doc-name">{t.name}</div></div>
          <button className="btn ghost sm" onClick={() => restore(t.id)}>恢复</button>
          <button className="btn ghost sm doc-purge" onClick={() => purge(t.id)}>彻底删除</button>
        </div>
      ))}
    </div>
  );
}

/* ===== 顶栏 ===== */
function Topbar({ commands, onNew, onCycleView, onToggleSidebar }: { commands: Command[]; onNew: () => void; onCycleView: () => void; onToggleSidebar: () => void }) {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);
  const [openCmd, setOpenCmd] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">
        <BrandLogo iconId={cfg.icon} />
        <div className="brand-text"><span className="brand-name">Vetro</span></div>
      </div>
      <div className="topbar-actions">
        <button className="btn ghost" onClick={onNew}>＋ 新建</button>
        <button className="btn ghost" onClick={onCycleView}>视图</button>
        <button className="btn ghost" onClick={() => setCfg({ theme: cfg.theme === 'dark' ? 'light' : 'dark' })}>{resolveTheme(cfg) === 'dark' ? '☀' : '🌙'}</button>
        <button className="btn ghost" onClick={() => setOpenCmd(!openCmd)}>⌘</button>
        <button className="btn primary">AI 助手</button>
      </div>
      {openCmd && (
        <div className="cmd-menu">
          {commands.map((c) => (
            <button key={c.id} className="cmd-item" onClick={() => { c.run(); setOpenCmd(false); }}>{c.title}</button>
          ))}
          {!commands.length && <div className="cmd-empty">无插件命令</div>}
        </div>
      )}
      <div className="win-controls">
        <button className="winbtn" title="收起侧栏" onClick={onToggleSidebar}>≡</button>
      </div>
    </header>
  );
}

/* ===== 状态栏 ===== */
function StatusBar() {
  const cfg = useStore((s) => s.cfg);
  const activeId = useStore((s) => s.activeId);
  const docs = useStore((s) => s.docs);
  const d = docs.find((x) => x.id === activeId);
  const words = d ? (d.content || '').replace(/\s/g, '').length : 0;
  return (
    <footer className="statusbar">
      <span className="save-state">自动保存</span>
      <span className="status-sep" />
      <span>{words} 字</span>
      <span className="spacer" />
      <span className="accent-label">{ACCENTS.find((a) => a.id === cfg.accent)?.name ?? ''}</span>
    </footer>
  );
}

/* ===== Toasts ===== */
function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-wrap">
      {items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
    </div>
  );
}

/* ===== 根组件 ===== */
export default function App() {
  const cfg = useStore((s) => s.cfg);
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const setCfg = useStore((s) => s.setCfg);
  const createDoc = useStore((s) => s.createDoc);
  const load = useStore((s) => s.load);

  const [commands, setCommands] = useState<Command[]>([]);
  const [renderHooks, setRenderHooks] = useState<RenderHooks[]>([]);
  const [editorExts, setEditorExts] = useState<Extension[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 初始化：加载持久化 + 插件 + 主题
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) load(JSON.parse(raw));
    } catch (e) { /* ignore */ }
    applyTheme(useStore.getState().cfg);
    pm.activate(demoPlugin).then(() => {
      setCommands(pm.commands.all());
      setRenderHooks(pm.renderers.all());
      setEditorExts(pm.editors.all());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // toast 注入
  useEffect(() => {
    pushToast = (msg, kind) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, msg, kind: kind || '' }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
    };
    return () => { pushToast = null; };
  }, []);

  // 主题变化
  useEffect(() => { applyTheme(cfg); }, [cfg]);

  // 持久化（防抖）
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useStore.getState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs: s.docs, trash: s.trash, activeId: s.activeId, cfg: s.cfg }));
    }, 500);
    return () => clearTimeout(t);
  }, [docs, activeId, cfg]);

  const active = docs.find((d) => d.id === activeId) ?? null;
  const viewMode = cfg.viewMode;

  const cycleView = () => {
    const order: ViewMode[] = ['split', 'preview', 'edit'];
    const i = order.indexOf(viewMode);
    setCfg({ viewMode: order[(i + 1) % order.length] });
  };

  return (
    <div className="app">
      <div className="app-bg" aria-hidden>
        <div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" />
      </div>
      <Topbar commands={commands} onNew={() => createDoc()} onCycleView={cycleView} onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="workbench">
        <aside className={'sidebar' + (sidebarCollapsed ? ' collapsed' : '')}>
          <div className="sidebar-head">
            <div className="sidebar-tabs">
              {(['docs', 'trash'] as const).map((t) => (
                <button key={t} className={'sidebar-tab' + (sidebarTab === t ? ' active' : '')} onClick={() => setSidebarTab(t)}>
                  {t === 'docs' ? '文档' : '回收站'}
                </button>
              ))}
            </div>
          </div>
          {sidebarTab === 'docs' ? <DocTree /> : <TrashList />}
        </aside>
        <div className="editor-shell">
          <div className="view-tabs">
            <button className={'tab' + (viewMode === 'edit' ? ' active' : '')} onClick={() => setCfg({ viewMode: 'edit' })}>编辑</button>
            <button className={'tab' + (viewMode === 'split' ? ' active' : '')} onClick={() => setCfg({ viewMode: 'split' })}>分栏</button>
            <button className={'tab' + (viewMode === 'preview' ? ' active' : '')} onClick={() => setCfg({ viewMode: 'preview' })}>预览</button>
          </div>
          <div className="editor-panes">
            {(viewMode === 'edit' || viewMode === 'split') && active && (
              <div className="pane pane-edit"><EditorPane doc={active} extra={editorExts} /></div>
            )}
            {(viewMode === 'preview' || viewMode === 'split') && active && (
              <div className="pane pane-preview"><PreviewPane doc={active} hooks={renderHooks} /></div>
            )}
            {!active && <div className="pane pane-empty">新建或选择一篇文档</div>}
          </div>
        </div>
      </div>
      <StatusBar />
      <Toasts items={toasts} />
    </div>
  );
}
