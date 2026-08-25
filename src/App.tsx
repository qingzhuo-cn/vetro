import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import JSZip from 'jszip';
import { useStore, buildTree, docTreeContent, childrenOf } from './store';
import { renderMarkdown, highlightCode, previewElRef, htmlToMarkdown } from './markdown';
import { createEditor, editorViewRef, jumpToLine } from './editor';
import { PluginManager } from './plugins';
import type { Command, RenderHooks } from './plugins';
import { ACCENTS, ICONS, rgba, lighten, darken } from './presets';
import type { Doc, AppConfig, ViewMode } from './types';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { demoPlugin } from './demo-plugin';
import { isTauri, getVersion, secureGet, secureSet, secureDelete, saveFileDialog, writeTextFile, dbInit, dbLoadState, dbSaveState, dbSearch, readBinaryFile, listImagesDir, deleteFile, renameFile, STORAGE_KEY } from './backend';
import { getCurrentWindow } from '@tauri-apps/api/window';
import AiPanel from './AiPanel';
import SettingsPanel from './SettingsPanel';
import SearchPanel from './SearchPanel';
import { HELP_DOC } from './help';
import { checkForUpdates } from './updater';
import { saveImageToDisk, getImagesDir, loadExternalImages } from './image';

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
  const cfg = useStore((s) => s.cfg);
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const view = createEditor(ref.current, doc.content, (v) => updateDoc(doc.id, { content: v }), extra, cfg.typewriterMode);
    viewRef.current = view;
    editorViewRef.current = view;
    return () => { if (editorViewRef.current === view) editorViewRef.current = null; view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // 预览（所见即所得）改动 → 同步回编辑器内容（编辑器自身输入则跳过）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === doc.content) return;
    view.dispatch({ changes: { from: 0, to: cur.length, insert: doc.content } });
    // 打字机模式：内容变化后将光标所在行居中
    if (cfg.typewriterMode) {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.content]);

  return <div className="editor-host" ref={ref} />;
}

/* ===== 预览（所见即所得：可编辑文字、拖入图片、拖图移动、右键复制/移动/删除） ===== */
function PreviewPane({ doc, hooks }: { doc: Doc; hooks: RenderHooks[] }) {
  const updateDoc = useStore((s) => s.updateDoc);
  const updateDocWithUndo = useStore((s) => s.updateDocWithUndo);
  const ref = useRef<HTMLDivElement>(null);
  const skipRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const dragImgRef = useRef<HTMLImageElement | null>(null);
  const pendingMoveRef = useRef<HTMLImageElement | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; img: HTMLImageElement } | null>(null);
  const html = useMemo(() => renderMarkdown(doc.content, hooks), [doc.content, hooks]);

  // 渲染来源变化时刷新预览；但若刚才是预览自身编辑同步回来的，跳过本次重绘（避免光标跳动）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (skipRef.current) { skipRef.current = false; return; }
    // 外部改动（编辑器等）→ 取消预览待同步的防抖定时器，避免旧内容回写覆盖
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    el.innerHTML = html;
    highlightCode(el);
    // 加载外置图片：将相对路径的 img src 转为 data URL
    loadExternalImages(el);
    // wiki-link 点击跳转
    el.querySelectorAll('.wiki-link[data-wiki]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const name = (link as HTMLElement).dataset.wiki;
        if (!name) return;
        const target = useStore.getState().docs.find((d) => d.name.replace(/\.\w+$/i, '') === name);
        if (target) useStore.getState().setActive(target.id);
      });
    });
  }, [html]);

  // ref 绑定/解绑独立于内容渲染，避免每次 html 变化都清空 previewElRef
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    previewElRef.current = el;
    return () => { if (previewElRef.current === el) previewElRef.current = null; };
  }, []);

  // 点击其它位置关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  // 预览里的编辑 → 同步回 Markdown 源码
  const syncFromPreview = () => {
    const el = ref.current;
    if (!el) return;
    try {
      const md = htmlToMarkdown(el.innerHTML);
      // 转换失败/清空保护：原文非空而转换结果为空时拒绝覆盖，防止丢稿
      if (!md && doc.content) { console.warn('预览 → Markdown 转换结果为空，跳过同步'); return; }
      if (md !== doc.content) {
        skipRef.current = true;
        updateDocWithUndo(doc.id, { content: md });
      }
    } catch (e) { console.warn('预览同步失败:', e); }
  };

  // 粘贴富文本：净化后再插入（contentEditable 的 innerHTML 不经过 renderMarkdown 的 sanitize）
  const onPaste = (e: React.ClipboardEvent) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const htmlText = cd.getData('text/html');
    if (htmlText) {
      e.preventDefault();
      const clean = DOMPurify.sanitize(htmlText, { FORBID_TAGS: ['style', 'script'], ADD_ATTR: ['target'] });
      const tpl = document.createElement('template');
      tpl.innerHTML = clean;
      const frag = tpl.content;
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        range.insertNode(frag);
      } else {
        ref.current?.appendChild(frag);
      }
      syncFromPreview();
    }
    // 纯文本 / 图片走默认路径（图片由 onDrop 同款逻辑处理不了，交给默认粘贴行为）
  };

  const onInput = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(syncFromPreview, 400);
  };

  // 预览失焦（如切到编辑器）时立即同步，避免丢编辑
  const onBlur = () => {
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    syncFromPreview();
  };

  // 在坐标处插入节点（优先用 caretRangeFromPoint）
  const placeNodeAt = (x: number, y: number, node: Node): boolean => {
    try {
      const docEl = document as any;
      if (typeof docEl.caretRangeFromPoint === 'function') {
        const range = docEl.caretRangeFromPoint(x, y) as Range | null;
        if (range) {
          range.deleteContents();
          range.insertNode(node);
          range.setStartAfter(node);
          range.setEndAfter(node);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
          return true;
        }
      }
    } catch { /* ignore */ }
    ref.current?.appendChild(node);
    return true;
  };

  const insertFileImage = (e: React.DragEvent, file: File) => {
    saveImageToDisk(file, '').then(({ dataUrl }) => {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = file.name.replace(/\.[^.]+$/, '');
      placeNodeAt(e.clientX, e.clientY, img);
      syncFromPreview();
    }).catch(() => {});
  };

  // 图片拖拽：移动（剪切到目标位置，不复制）
  const onDragStart = (e: React.DragEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') {
      dragImgRef.current = t as HTMLImageElement;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/vetro-img', '1');
    } else {
      dragImgRef.current = null;
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (dragImgRef.current) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      e.preventDefault();
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) insertFileImage(e, file);
      }
      dragImgRef.current = null;
      return;
    }
    const src = dragImgRef.current;
    if (src) {
      e.preventDefault();
      const clone = src.cloneNode(true) as HTMLImageElement;
      src.remove();
      placeNodeAt(e.clientX, e.clientY, clone);
      dragImgRef.current = null;
      syncFromPreview();
    }
  };

  const onDragEnd = () => { dragImgRef.current = null; };

  const onContextMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, img: t as HTMLImageElement });
    } else {
      setCtxMenu(null);
    }
  };

  const onClickPlace = (e: React.MouseEvent) => {
    const pending = pendingMoveRef.current;
    if (!pending) return;
    pendingMoveRef.current = null;
    placeNodeAt(e.clientX, e.clientY, pending);
    syncFromPreview();
  };

  const dupImage = () => {
    if (!ctxMenu) return;
    const clone = ctxMenu.img.cloneNode(true) as HTMLImageElement;
    ctxMenu.img.after(clone);
    setCtxMenu(null);
    syncFromPreview();
  };

  const cutImage = () => {
    if (!ctxMenu) return;
    pendingMoveRef.current = ctxMenu.img.cloneNode(true) as HTMLImageElement;
    ctxMenu.img.remove();
    setCtxMenu(null);
    syncFromPreview();
    toast('已剪切图片，点击预览目标位置即可放置', 'ok');
  };

  const delImage = () => {
    if (!ctxMenu) return;
    ctxMenu.img.remove();
    setCtxMenu(null);
    syncFromPreview();
  };

  return (
    <>
      <div
        className="preview markdown-body"
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onBlur={onBlur}
        onPaste={onPaste}
        onClick={onClickPlace}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onContextMenu={onContextMenu}
      />
      {ctxMenu && createPortal(
        <div className="img-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={dupImage}>复制一份</button>
          <button onClick={cutImage}>移动</button>
          <button onClick={delImage}>删除</button>
        </div>,
        document.body
      )}
    </>
  );
}

/* ===== 标签面板 ===== */
function TagPanel() {
  const docs = useStore((s) => s.docs);
  const filterTag = useStore((s) => s.filterTag);
  const setFilterTag = useStore((s) => s.setFilterTag);
  const allTags = useMemo(() => {
    const tags = new Map<string, number>();
    for (const d of docs) for (const t of d.tags) tags.set(t, (tags.get(t) || 0) + 1);
    return Array.from(tags.entries()).sort((a, b) => b[1] - a[1]);
  }, [docs]);
  if (!allTags.length) {
    return <div className="doc-empty"><p>暂无标签</p><span>在文档列表中点击标签图标添加</span></div>;
  }
  return (
    <div className="tag-panel">
      <div className="tag-list">
        {allTags.map(([tag, count]) => (
          <button key={tag} className={'tag-chip' + (filterTag === tag ? ' active' : '')}
            onClick={() => setFilterTag(filterTag === tag ? null : tag)}>
            {tag}<span className="tag-count">{count}</span>
          </button>
        ))}
      </div>
      {filterTag && (
        <div style={{ marginTop: 8 }}>
          <button className="btn ghost sm" onClick={() => setFilterTag(null)}>清除筛选</button>
        </div>
      )}
    </div>
  );
}

/* ===== 附件面板 ===== */
function AttachmentsPanel() {
  const docs = useStore((s) => s.docs);
  const updateDoc = useStore((s) => s.updateDoc);
  const [images, setImages] = useState<{ name: string; size: number; dataUrl?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [imagesDir, setImagesDir] = useState('');

  const loadImages = async () => {
    setLoading(true);
    try {
      const dir = await getImagesDir();
      setImagesDir(dir);
      const list = await listImagesDir();
      const withThumbs = await Promise.all(
        list.map(async (img) => {
          try {
            const dataUrl = await readBinaryFile(dir + '/' + img.name);
            return { ...img, dataUrl };
          } catch {
            return { ...img, dataUrl: undefined };
          }
        })
      );
      setImages(withThumbs);
    } catch (e) {
      console.error('加载附件失败:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadImages(); }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleDelete = async (img: { name: string }) => {
    if (!confirm(`确认删除附件「${img.name}」？\n引用此图片的文档中将显示为 [deleted]`)) return;
    try {
      const filePath = imagesDir + '/' + img.name;
      await deleteFile(filePath);
      // 更新所有引用此图片的文档
      const allDocs = useStore.getState().docs;
      for (const d of allDocs) {
        if (!d.content) continue;
        // 匹配 ![...](imagesDir/name) 和 ![](imagesDir/name)
        const pattern = new RegExp(`!\\[[^\\]]*\\]\\([^)]*${img.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
        if (pattern.test(d.content)) {
          updateDoc(d.id, { content: d.content.replace(pattern, '![deleted]') });
        }
      }
      toast('已删除附件 ' + img.name, 'ok');
      loadImages();
    } catch (e) {
      toast('删除失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  };

  const handleRename = async (img: { name: string }) => {
    if (!renameVal.trim() || renameVal === img.name) { setRenamingId(null); return; }
    const newName = renameVal.trim();
    try {
      const oldPath = imagesDir + '/' + img.name;
      const newPath = imagesDir + '/' + newName;
      await renameFile(oldPath, newPath);
      // 更新所有引用此图片的文档
      const allDocs = useStore.getState().docs;
      for (const d of allDocs) {
        if (!d.content) continue;
        if (d.content.includes(img.name)) {
          updateDoc(d.id, { content: d.content.split(img.name).join(newName) });
        }
      }
      toast('已重命名 ' + img.name + ' → ' + newName, 'ok');
      setRenamingId(null);
      loadImages();
    } catch (e) {
      toast('重命名失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  };

  if (loading) {
    return <div className="doc-empty"><p>加载中…</p></div>;
  }

  if (!images.length) {
    return <div className="doc-empty"><p>暂无附件</p><span>在文档中拖入图片即可添加</span></div>;
  }

  return (
    <div className="attachments-panel">
      <div className="attachments-header">
        <span className="attachments-count">{images.length} 个文件</span>
        <button className="btn ghost sm" onClick={loadImages}>刷新</button>
      </div>
      <div className="attachments-grid">
        {images.map((img) => (
          <div key={img.name} className="attachment-item">
            <div className="attachment-thumb">
              {img.dataUrl ? (
                <img src={img.dataUrl} alt={img.name} loading="lazy" />
              ) : (
                <div className="attachment-thumb-placeholder">🖼</div>
              )}
            </div>
            <div className="attachment-info">
              {renamingId === img.name ? (
                <input
                  className="search-input"
                  value={renameVal}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(img);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => handleRename(img)}
                />
              ) : (
                <div className="attachment-name" title={img.name}>{img.name}</div>
              )}
              <div className="attachment-size">{formatSize(img.size)}</div>
            </div>
            <div className="attachment-actions">
              <button className="btn ghost sm" title="重命名" onClick={() => { setRenamingId(img.name); setRenameVal(img.name); }}>✎</button>
              <button className="btn ghost sm" title="删除" onClick={() => handleDelete(img)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
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
  const addDocTag = useStore((s) => s.addDocTag);
  const removeDocTag = useStore((s) => s.removeDocTag);
  const toggleDocFavorite = useStore((s) => s.toggleDocFavorite);
  const filterTag = useStore((s) => s.filterTag);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [tagInputId, setTagInputId] = useState<string | null>(null);
  const [tagInputVal, setTagInputVal] = useState('');

  const nodes = useMemo(() => buildTree(docs, collapsed, filterTag), [docs, collapsed, filterTag]);
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
              <div className="doc-name">
                {(doc as any).favorite && <span className="doc-fav active">★</span>}
                {doc.name}
              </div>
              <div className="doc-sub">{words} 字</div>
              {doc.tags.length > 0 && (
                <div className="doc-tags">
                  {doc.tags.map((tag) => (
                    <span key={tag} className="tag-pill">
                      {tag}
                      <button className="tag-pill-remove" onClick={(e) => { e.stopPropagation(); removeDocTag(doc.id, tag); }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {tagInputId === doc.id && (
                <input
                  className="search-input"
                  style={{ marginTop: 2, fontSize: 10, padding: '2px 6px' }}
                  value={tagInputVal}
                  placeholder="输入标签回车"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagInputVal.trim()) {
                      addDocTag(doc.id, tagInputVal.trim());
                      setTagInputVal('');
                      setTagInputId(null);
                    }
                    if (e.key === 'Escape') { setTagInputId(null); setTagInputVal(''); }
                  }}
                  onChange={(e) => setTagInputVal(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
            <button className={'doc-sync ' + (doc.sync !== false ? 'on' : 'off')} title={doc.sync !== false ? '已启用同步' : '已禁用同步'} onClick={(e) => { e.stopPropagation(); toggleDocSync(doc.id); }}>☁</button>
            <button className="doc-subnew" title="新建子文档" onClick={(e) => { e.stopPropagation(); createDoc(doc.name.replace(/\.\w+$/i, '') + ' · 子文档.md', '', doc.id); }}>＋</button>
            <button className="doc-subnew" title="添加标签" onClick={(e) => { e.stopPropagation(); setTagInputId(tagInputId === doc.id ? null : doc.id); setTagInputVal(''); }}>🏷</button>
            <button className={'doc-subnew' + ((doc as any).favorite ? ' doc-fav active' : '')} title={(doc as any).favorite ? '取消收藏' : '收藏'} onClick={(e) => { e.stopPropagation(); toggleDocFavorite(doc.id); }}>★</button>
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
function Topbar({ commands, onNew, onCycleView, onToggleSidebar, onOpenAi, onOpenSettings, onExport, onExportZip, onOpenSearch, onOpenHelp }: { commands: Command[]; onNew: () => void; onCycleView: () => void; onToggleSidebar: () => void; onOpenAi: () => void; onOpenSettings: () => void; onExport: () => void; onExportZip: () => void; onOpenSearch: () => void; onOpenHelp: () => void }) {
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
        <div className="export-dropdown">
          <button className="btn ghost" onClick={onExport}>⭳ 导出</button>
          <div className="export-menu">
            <button className="export-menu-item" onClick={onExport}>导出当前文档</button>
            <button className="export-menu-item" onClick={onExportZip}>全部导出 ZIP</button>
          </div>
        </div>
        <button className="btn ghost" onClick={onCycleView}>视图</button>
        <button className="btn ghost" onClick={onOpenSearch} title="搜索 (Ctrl+F)">🔍 搜索</button>
        <button className="btn ghost" onClick={() => useStore.getState().undo()} title="撤销 Ctrl+Z">↶</button>
        <button className="btn ghost" onClick={() => useStore.getState().redo()} title="重做 Ctrl+Shift+Z">↷</button>
        <button className="btn ghost" onClick={() => setCfg({ theme: cfg.theme === 'dark' ? 'light' : 'dark' })}>{resolveTheme(cfg) === 'dark' ? '☀' : '🌙'}</button>
        <button className="btn ghost" onClick={() => setCfg({ focusMode: !cfg.focusMode })} title={cfg.focusMode ? '退出专注模式' : '专注模式'}>{cfg.focusMode ? '✕ 专注' : '🖥 专注'}</button>
        <button className="btn ghost" onClick={() => setCfg({ typewriterMode: !cfg.typewriterMode })} title={cfg.typewriterMode ? '关闭打字机' : '打字机模式'}>{cfg.typewriterMode ? '⌨' : '📖'}</button>
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
  const saveStatus = useStore((s) => s.saveStatus);
  const d = docs.find((x) => x.id === activeId);
  const words = d ? (d.content || '').replace(/\s/g, '').length : 0;
  const [ver, setVer] = useState('');
  useEffect(() => { getVersion().then(setVer).catch(() => {}); }, []);
  const statusLabel = saveStatus === 'saving' ? '保存中…'
    : saveStatus === 'saved' ? '已保存 ✓'
    : saveStatus === 'error' ? '保存失败 ⚠'
    : '自动保存';
  return (
    <footer className="statusbar">
      <span className={'save-state ' + saveStatus}>{statusLabel}</span>
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
          const parsed = JSON.parse(raw);
          // 基础 schema 校验：必须是普通对象（数组也会通过 typeof 'object'，需排除）
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            load(parsed);
          } else {
            console.warn('存储数据格式错误，已忽略');
          }
        }
        // 首次启动或数据为空：内置「使用说明」文档
        if (useStore.getState().docs.length === 0) {
          useStore.getState().createDoc('使用说明.md', HELP_DOC);
        } else {
          // 有数据但缺少使用说明：补创建（覆盖安装后可能被清掉）
          const hasHelp = useStore.getState().docs.some((d) => d.name === '使用说明.md');
          if (!hasHelp) useStore.getState().createDoc('使用说明.md', HELP_DOC);
        }
      } catch (e) {
        console.error('初始化失败:', e);
      }
    })();
    applyTheme(useStore.getState().cfg);
    pm.activate(demoPlugin).then(() => {
      setCommands(pm.commands.all());
      setRenderHooks(pm.renderers.all());
      setEditorExts(pm.editors.all());
    });
    // 从系统密钥链加载 AI 密钥与 WebDAV 密码（不落存储）
    Promise.all([secureGet('ai-key'), secureGet('sync-password')])
      .then(([aiKey, syncPwd]) => {
        const s = useStore.getState();
        const patches: Partial<AppConfig> = {};
        if (aiKey && !s.cfg.ai.key) patches.ai = { ...s.cfg.ai, key: aiKey };
        if (syncPwd && !s.cfg.sync.password) patches.sync = { ...s.cfg.sync, password: syncPwd };
        if (Object.keys(patches).length) setCfg(patches);
      })
      .catch(() => {})
      .finally(() => { keyLoaded.current = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 密钥与 WebDAV 密码变化 → 写入系统密钥链
  useEffect(() => {
    if (!keyLoaded.current) return;
    const key = cfg.ai.key;
    if (key) secureSet('ai-key', key).catch(() => {});
    else secureDelete('ai-key').catch(() => {});
  }, [cfg.ai.key]);

  useEffect(() => {
    if (!keyLoaded.current) return;
    const pwd = cfg.sync.password;
    if (pwd) secureSet('sync-password', pwd).catch(() => {});
    else secureDelete('sync-password').catch(() => {});
  }, [cfg.sync.password]);

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

  // 持久化（防抖）：SQLite（Tauri）或 localStorage（浏览器）；密钥与密码只存系统钥匙串
  // 增量优化：记录文档内容 hash，仅变化时才发送 FTS 数据避免无谓重建
  const lastSavedHash = useRef('');
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useStore.getState();
      s.setSaveStatus('saving');
      const { key: _key, ...aiSafe } = s.cfg.ai;
      const { password: _pwd, ...syncSafe } = s.cfg.sync;
      const cfgSafe = { ...s.cfg, ai: aiSafe, sync: syncSafe };
      const stateJson = JSON.stringify({ docs: s.docs, trash: s.trash, activeId: s.activeId, cfg: cfgSafe });
      const contentHash = s.docs.map((d) => d.id + ':' + (d.content?.length || 0)).join(',');
      const needsFts = contentHash !== lastSavedHash.current;
      const docsJson = needsFts
        ? JSON.stringify(s.docs.map((d) => ({
            id: d.id,
            name: d.name,
            content: (d.content || '').replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '![](data:image-omitted)'),
          })))
        : '';
      if (needsFts) lastSavedHash.current = contentHash;
      dbSaveState(stateJson, docsJson)
        .then(() => {
          s.setSaveStatus('saved');
          setTimeout(() => {
            if (useStore.getState().saveStatus === 'saved') useStore.getState().setSaveStatus('idle');
          }, 1500);
        })
        .catch(() => { s.setSaveStatus('error'); });
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

  // 撤销/重做全局快捷键 + 专注模式 ESC 退出
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); useStore.getState().undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); useStore.getState().redo(); }
      if (e.key === 'Escape' && useStore.getState().cfg.focusMode) { useStore.getState().setCfg({ focusMode: false }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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

  const exportZip = async () => {
    try {
      const zip = new JSZip();
      for (const d of docs) {
        const name = d.name || '未命名.md';
        zip.file(name, d.content || '');
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vetro-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出全部文档为 ZIP', 'ok');
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
    <div className="app" data-focus={cfg.focusMode || undefined}>
      <div className="app-bg" aria-hidden>
        <div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" />
      </div>
      {!cfg.focusMode && <Topbar commands={commands} onNew={() => createDoc()} onCycleView={cycleView} onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} onOpenAi={() => setAiOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onExport={exportDoc} onExportZip={exportZip} onOpenSearch={() => setSearchOpen(true)} onOpenHelp={openHelp} />}
      {cfg.focusMode && (
        <div className="focus-float-bar">
          <button className="btn ghost sm" onClick={() => setCfg({ focusMode: false })}>✕ 退出专注</button>
          <WindowControls />
        </div>
      )}
      <div className="workbench">
        <aside className={'sidebar' + (sidebarCollapsed || cfg.focusMode ? ' collapsed' : '')}>
          <div className="sidebar-head">
            <div className="sidebar-tabs">
              {(['docs', 'outline', 'tags', 'trash', 'attachments'] as const).map((t) => (
                <button key={t} className={'sidebar-tab' + (sidebarTab === t ? ' active' : '')}
                  title={t === 'docs' ? '文档' : t === 'outline' ? '大纲' : t === 'tags' ? '标签' : t === 'trash' ? '回收站' : '附件'}
                  onClick={() => { setSidebarTab(t); if (sidebarCollapsed) setSidebarCollapsed(false); }}>
                  <span className="tab-ico">{t === 'docs' ? '📄' : t === 'outline' ? '☰' : t === 'tags' ? '🏷' : t === 'trash' ? '🗑' : '📎'}</span>
                  {!sidebarCollapsed && <span className="tab-label">{t === 'docs' ? '文档' : t === 'outline' ? '大纲' : t === 'tags' ? '标签' : t === 'trash' ? '回收站' : '附件'}</span>}
                </button>
              ))}
            </div>
          </div>
          {!sidebarCollapsed && (sidebarTab === 'docs' ? <DocTree /> : sidebarTab === 'outline' ? <OutlineList /> : sidebarTab === 'tags' ? <TagPanel /> : sidebarTab === 'attachments' ? <AttachmentsPanel /> : <TrashList />)}
        </aside>
        <div className="editor-shell">
          <div className="view-tabs">
            <button className={'tab' + (viewMode === 'edit' ? ' active' : '')} onClick={() => setCfg({ viewMode: 'edit' })}>编辑</button>
            <button className={'tab' + (viewMode === 'split' ? ' active' : '')} onClick={() => setCfg({ viewMode: 'split' })}>分栏</button>
            <button className={'tab' + (viewMode === 'preview' ? ' active' : '')} onClick={() => setCfg({ viewMode: 'preview' })}>预览</button>
          </div>
          <div className="editor-panes">
            {active && (
              <>
                <div className={'pane pane-edit' + (viewMode === 'preview' ? ' hidden' : '')}>
                  <EditorPane doc={active} extra={editorExts} />
                </div>
                <div className={'pane pane-preview' + (viewMode === 'edit' ? ' hidden' : '')}>
                  <PreviewPane doc={active} hooks={renderHooks} />
                </div>
              </>
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
