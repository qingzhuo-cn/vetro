import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, buildTree, docTreeContent, childrenOf } from './store';
import { renderMarkdown, highlightCode, previewElRef, htmlToMarkdown } from './markdown';
import { createEditor, editorViewRef, jumpToLine } from './editor';
import { PluginManager } from './plugins';
import type { Command, RenderHooks } from './plugins';
import { ACCENTS, ICONS, rgba, lighten, darken } from './presets';
import { defaultConfig } from './types';
import type { Doc, AppConfig, ViewMode } from './types';
import type { Extension } from '@codemirror/state';
import { demoPlugin } from './demo-plugin';
import { isTauri, getVersion, secureGet, secureSet, secureDelete, saveFileDialog, writeTextFile, dbInit, dbLoadState, dbSaveState, dbSearch } from './backend';
import { getCurrentWindow } from '@tauri-apps/api/window';
import AiPanel from './AiPanel';
import SettingsPanel from './SettingsPanel';
import SearchPanel from './SearchPanel';
import { HELP_DOC } from './help';
import { checkForUpdates } from './updater';

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
    editorViewRef.current = view;
    return () => { if (editorViewRef.current === view) editorViewRef.current = null; view.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);
  return <div className="editor-host" ref={ref} />;
}

/* ===== 预览（所见即所得：可直接编辑文字、拖入图片、拖动图片调整位置） ===== */
function PreviewPane({ doc, hooks }: { doc: Doc; hooks: RenderHooks[] }) {
  const updateDoc = useStore((s) => s.updateDoc);
  const ref = useRef<HTMLDivElement>(null);
  const skipRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const html = useMemo(() => renderMarkdown(doc.content, hooks), [doc.content, hooks]);

  // 渲染来源变化时刷新预览；但若刚才是预览自身编辑同步回来的，跳过本次重绘（避免光标跳动）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    previewElRef.current = el;
    if (skipRef.current) { skipRef.current = false; return; }
    el.innerHTML = html;
    highlightCode(el);
    return () => { if (previewElRef.current === el) previewElRef.current = null; };
  }, [html]);

  // 预览里的编辑 → 同步回 Markdown 源码
  const syncFromPreview = () => {
    const el = ref.current;
    if (!el) return;
    try {
      const md = htmlToMarkdown(el.innerHTML);
      if (md !== doc.content) {
        skipRef.current = true;
        updateDoc(doc.id, { content: md });
      }
    } catch (e) { /* ignore */ }
  };

  const onInput = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(syncFromPreview, 400);
  };

  const insertImageAtCaret = (dataUrl: string, name: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const safe = name.replace(/"/g, '');
    document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${safe}">`);
    syncFromPreview();
  };

  const onDrop = (e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return; // 内部元素拖动（如图片换位）交给浏览器默认行为
    e.preventDefault();
    // 把光标定位到释放位置
    try {
      const docEl = document as any;
      if (typeof docEl.caretRangeFromPoint === 'function') {
        const range = docEl.caretRangeFromPoint(e.clientX, e.clientY) as Range | null;
        if (range) { const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(range); } }
      }
    } catch { /* ignore */ }
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          if (dataUrl) insertImageAtCaret(dataUrl, file.name);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div
      className="preview markdown-body"
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={onInput}
      onDrop={onDrop}
      onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); }}
    />
  );
}

/* ===== 文档树 ===== */
function DocTree() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const createDoc = useStore((s) => s.createDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const setDocParent = useStore((s) => s.setDocParent);
  const moveDoc = useStore((s) => s.moveDoc);
  const toggleDocSync = useStore((s) => s.toggleDocSync);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const nodes = useMemo(() => buildTree(docs, collapsed), [docs, collapsed]);
  const toggle = (id: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleDrop = (e: React.DragEvent, parentId: string | null) => {
    e.preventDefault();
    let src = '';
    try { src = e.dataTransfer.getData('text/vetro-doc') || ''; } catch { /* ignore */ }
    setDragOverId(null);
    if (src) moveDoc(src, parentId);
  };

  return (
    <div
      className="doc-list"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => handleDrop(e, null)}
    >
      {nodes.length === 0 && (
        <div className="doc-empty"><p>暂无文档</p><span>点击顶部「新建」开始</span></div>
      )}
      {nodes.map(({ doc, depth }) => {
        const hasKids = childrenOf(docs, doc.id).length > 0;
        const words = (doc.content || '').replace(/\s/g, '').length;
        const initial = (doc.name || 'md').replace(/\.(md|markdown|txt)$/i, '').trim().slice(0, 2).toUpperCase() || 'MD';
        return (
          <div
            key={doc.id}
            draggable
            className={'doc-item' + (doc.id === activeId ? ' active' : '') + (dragOverId === doc.id ? ' drag-over' : '')}
            style={{ paddingLeft: 10 + depth * 16, '--i': 0 } as React.CSSProperties}
            onClick={() => setActive(doc.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/vetro-doc', doc.id);
              e.dataTransfer.setData('text/plain', doc.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverId !== doc.id) setDragOverId(doc.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null);
            }}
            onDrop={(e) => { e.stopPropagation(); handleDrop(e, doc.id); }}
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

/* ===== 大纲 ===== */
function extractHeadings(content: string): { level: number; text: string; line: number }[] {
  const out: { level: number; text: string; line: number }[] = [];
  const lines = content.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (m) {
      const text = m[2].replace(/[*_`~]/g, '').trim();
      if (text) out.push({ level: m[1].length, text, line: i + 1 });
    }
  }
  return out;
}

function OutlineList() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const d = docs.find((x) => x.id === activeId);
  const headings = useMemo(() => extractHeadings(d?.content || ''), [d?.content]);
  if (!headings.length) {
    return <div className="doc-empty"><p>暂无标题</p><span>用 # 标题来组织文档结构</span></div>;
  }
  const jump = (line: number, index: number) => {
    jumpToLine(line);
    const el = previewElRef.current;
    if (el) {
      const hs = el.querySelectorAll('h1,h2,h3,h4,h5,h6');
      hs[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  return (
    <div className="outline-list">
      {headings.map((h, i) => (
        <button key={i} className="outline-item" style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
          onClick={() => jump(h.line, i)}>
          <span className="outline-level">H{h.level}</span>
          <span className="outline-text">{h.text}</span>
        </button>
      ))}
    </div>
  );
}

/* ===== 窗口控制（无边框标题栏） ===== */
function WindowControls() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | null = null;
    w.isMaximized().then((m) => { if (!disposed) setMax(m); });
    w.onResized(async () => setMax(await w.isMaximized())).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const w = () => (isTauri ? getCurrentWindow() : null);
  return (
    <>
      <button className="winbtn" title="最小化" onClick={() => w()?.minimize()}>─</button>
      <button className="winbtn" title={max ? '还原' : '最大化'} onClick={() => w()?.toggleMaximize()}>{max ? '❐' : '□'}</button>
      <button className="winbtn winbtn-close" title="关闭" onClick={() => w()?.close()}>✕</button>
    </>
  );
}

/* ===== 顶栏 ===== */
function Topbar({ commands, onNew, onCycleView, onToggleSidebar, onOpenAi, onOpenSettings, onExport, onOpenSearch, onOpenHelp }: { commands: Command[]; onNew: () => void; onCycleView: () => void; onToggleSidebar: () => void; onOpenAi: () => void; onOpenSettings: () => void; onExport: () => void; onOpenSearch: () => void; onOpenHelp: () => void }) {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);
  const [openCmd, setOpenCmd] = useState(false);
  const onDragMouseDown = (e: React.MouseEvent) => {
    if (!isTauri || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, select, a, .cmd-menu')) return;
    getCurrentWindow().startDragging();
  };
  return (
    <header className="topbar" onMouseDown={onDragMouseDown}>
      <div className="brand">
        <BrandLogo iconId={cfg.icon} />
        <div className="brand-text"><span className="brand-name">Vetro</span></div>
      </div>
      <div className="topbar-actions">
        <button className="btn ghost" onClick={onNew}>＋ 新建</button>
        <button className="btn ghost" onClick={onExport}>⭳ 导出</button>
        <button className="btn ghost" onClick={onCycleView}>视图</button>
        <button className="btn ghost" onClick={onOpenSearch} title="搜索">🔍</button>
        <button className="btn ghost" onClick={() => setCfg({ theme: cfg.theme === 'dark' ? 'light' : 'dark' })}>{resolveTheme(cfg) === 'dark' ? '☀' : '🌙'}</button>
        <button className="btn ghost" onClick={onOpenSettings}>⚙ 设置</button>
        <button className="btn ghost" onClick={onOpenHelp} title="使用说明">❓</button>
        <button className="btn ghost" onClick={() => setOpenCmd(!openCmd)}>⌘</button>
        <button className="btn primary" onClick={onOpenAi}>AI 助手</button>
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
        <WindowControls />
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
  const [ver, setVer] = useState('');
  useEffect(() => { getVersion().then(setVer).catch(() => {}); }, []);
  return (
    <footer className="statusbar">
      <span className="save-state">自动保存</span>
      <span className="status-sep" />
      <span>{words} 字</span>
      <span className="spacer" />
      <span className="accent-label">{ACCENTS.find((a) => a.id === cfg.accent)?.name ?? ''}</span>
      {ver && <span className="version-label">v{ver}</span>}
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
  const setActive = useStore((s) => s.setActive);
  const createDoc = useStore((s) => s.createDoc);
  const load = useStore((s) => s.load);

  const [commands, setCommands] = useState<Command[]>([]);
  const [renderHooks, setRenderHooks] = useState<RenderHooks[]>([]);
  const [editorExts, setEditorExts] = useState<Extension[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const keyLoaded = useRef(false);

  // 初始化：加载持久化（SQLite 优先，回退 localStorage 迁移旧数据）+ 插件 + 主题
  useEffect(() => {
    (async () => {
      try {
        await dbInit();
        let raw = await dbLoadState();
        if (!raw) raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          load(JSON.parse(raw));
        } else {
          // 首次启动：内置「使用说明」文档
          useStore.getState().createDoc('使用说明.md', HELP_DOC);
        }
        if (useStore.getState().docs.length === 0) {
          useStore.getState().createDoc('使用说明.md', HELP_DOC);
        }
      } catch (e) { /* ignore */ }
    })();
    applyTheme(useStore.getState().cfg);
    pm.activate(demoPlugin).then(() => {
      setCommands(pm.commands.all());
      setRenderHooks(pm.renderers.all());
      setEditorExts(pm.editors.all());
    });
    // 从系统密钥链加载 AI 密钥（不落存储）
    secureGet('ai-key')
      .then((k) => {
        const cur = useStore.getState().cfg.ai.key;
        if (k && !cur) setCfg({ ai: { ...useStore.getState().cfg.ai, key: k } });
      })
      .catch(() => {})
      .finally(() => { keyLoaded.current = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 密钥变化 → 写入系统密钥链
  useEffect(() => {
    if (!keyLoaded.current) return;
    const key = cfg.ai.key;
    if (key) secureSet('ai-key', key).catch(() => {});
    else secureDelete('ai-key').catch(() => {});
  }, [cfg.ai.key]);

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

  // 持久化（防抖）：SQLite（Tauri）或 localStorage（浏览器）；密钥只存系统钥匙串
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useStore.getState();
      const { key: _key, ...aiSafe } = s.cfg.ai;
      const cfgSafe = { ...s.cfg, ai: aiSafe };
      const stateJson = JSON.stringify({ docs: s.docs, trash: s.trash, activeId: s.activeId, cfg: cfgSafe });
      const docsJson = JSON.stringify(s.docs.map((d) => ({ id: d.id, name: d.name, content: d.content })));
      dbSaveState(stateJson, docsJson).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [docs, activeId, cfg]);

  // 自动检查更新（延迟几秒，静默；发现新版本才提示）
  useEffect(() => {
    const t = setTimeout(() => {
      checkForUpdates().then((info) => {
        if (info) toast(`发现新版本 ${info.latest}，可在「⚙ 设置 → 检查更新」查看下载地址`, 'ok');
      });
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  const active = docs.find((d) => d.id === activeId) ?? null;
  const viewMode = cfg.viewMode;

  const cycleView = () => {
    const order: ViewMode[] = ['split', 'preview', 'edit'];
    const i = order.indexOf(viewMode);
    setCfg({ viewMode: order[(i + 1) % order.length] });
  };

  const exportDoc = async () => {
    const d = docs.find((x) => x.id === activeId);
    if (!d) { toast('没有可导出的文档', 'err'); return; }
    const merged = docTreeContent(docs, d);
    const path = await saveFileDialog(d.name.replace(/\.(md|markdown|txt)$/i, '') + ' (导出).md');
    if (!path) return;
    try {
      await writeTextFile(path, merged);
      toast('已导出到 ' + path, 'ok');
    } catch (e) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  };

  const openHelp = () => {
    const s = useStore.getState();
    const existing = s.docs.find((d) => d.name === '使用说明.md');
    if (existing) setActive(existing.id);
    else createDoc('使用说明.md', HELP_DOC);
  };

  return (
    <div className="app">
      <div className="app-bg" aria-hidden>
        <div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" />
      </div>
      <Topbar commands={commands} onNew={() => createDoc()} onCycleView={cycleView} onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} onOpenAi={() => setAiOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onExport={exportDoc} onOpenSearch={() => setSearchOpen(true)} onOpenHelp={openHelp} />
      <div className="workbench">
        <aside className={'sidebar' + (sidebarCollapsed ? ' collapsed' : '')}>
          <div className="sidebar-head">
            <div className="sidebar-tabs">
              {(['docs', 'outline', 'trash'] as const).map((t) => (
                <button key={t} className={'sidebar-tab' + (sidebarTab === t ? ' active' : '')}
                  title={t === 'docs' ? '文档' : t === 'outline' ? '大纲' : '回收站'}
                  onClick={() => { setSidebarTab(t); if (sidebarCollapsed) setSidebarCollapsed(false); }}>
                  <span className="tab-ico">{t === 'docs' ? '📄' : t === 'outline' ? '☰' : '🗑'}</span>
                  {!sidebarCollapsed && <span className="tab-label">{t === 'docs' ? '文档' : t === 'outline' ? '大纲' : '回收站'}</span>}
                </button>
              ))}
            </div>
          </div>
          {!sidebarCollapsed && (sidebarTab === 'docs' ? <DocTree /> : sidebarTab === 'outline' ? <OutlineList /> : <TrashList />)}
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
      {aiOpen && <AiPanel onClose={() => setAiOpen(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
