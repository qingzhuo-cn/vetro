/* Vetro · 玻璃态 Markdown 编辑器 主体逻辑（打磨版 v2）
   特性：IndexedDB 存储 · 文档大纲 · 查找替换 · 图片粘贴 · AI 流式输出 · 批量导入/合并/撤销
   ---------------------------------------------------------------------- */
'use strict';

/* ===== 工具 ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ===== Toast ===== */
function toast(msg, kind = '', action = null) {
  const wrap = $('#toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label || '撤销';
    btn.addEventListener('click', () => { action.fn && action.fn(); el.remove(); });
    el.appendChild(btn);
  }
  wrap.appendChild(el);
  const kill = () => {
    if (el.classList.contains('out')) return;
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };
  setTimeout(kill, action ? 6000 : 2600);
}

/* ===== 弹层动画辅助 ===== */
function openModal(el) { el.hidden = false; void el.offsetWidth; el.classList.add('show'); }
function closeModal(el) {
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 380);
}
function dismissModal(el) { closeModal(el); setTimeout(() => el.remove(), 480); }

/* ===== 通用确认 / 输入对话框 ===== */
function askDialog(opts) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-dialog" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
        <div class="modal-head"><h3>${esc(opts.title)}</h3></div>
        <div class="modal-body">
          ${opts.message ? `<p class="dialog-msg">${esc(opts.message)}</p>` : ''}
          ${opts.input ? `<input class="cfg-input dialog-input" value="${esc(opts.value || '')}" spellcheck="false">` : ''}
        </div>
        <div class="modal-foot">
          <button class="btn ghost" data-act="cancel">${esc(opts.cancelLabel || '取消')}</button>
          <button class="btn ${opts.danger ? 'danger' : 'primary'}" data-act="ok">${esc(opts.confirmLabel || '确定')}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector('.dialog-input');
    const okBtn = backdrop.querySelector('[data-act="ok"]');
    const finish = (result) => { dismissModal(backdrop); resolve(result); };

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(opts.input ? null : false); });
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(opts.input ? null : false));
    okBtn.addEventListener('click', () => finish(opts.input ? (input ? input.value : null) : true));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish(opts.input ? null : false);
      else if (e.key === 'Enter' && !opts.input) finish(true);
    });
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(input.value);
        else if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      });
    }
    openModal(backdrop);
    setTimeout(() => { (input || okBtn).focus(); if (input) input.select && input.select(); }, 60);
  });
}
const confirmDialog = (opts) => askDialog(opts);
const promptDialog = (opts) => askDialog(Object.assign({ input: true }, opts));

/* ===== IndexedDB 存储 ===== */
const DB_NAME = 'vetro';
const DB_STORE = 'kv';
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB 不可用')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, val) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGetFrom(dbName, key) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const r = tx.objectStore(DB_STORE).get(key);
        r.onsuccess = () => { const v = r.result; db.close(); resolve(v); };
        r.onerror = () => { db.close(); reject(r.error); };
      } catch (e) { db.close(); reject(e); }
    };
    req.onerror = () => reject(req.error);
  });
}

/* ===== 状态 ===== */
const STORE_KEY = 'vetro::v1';
function defaultCfg() {
  return {
    theme: 'auto',
    viewMode: 'split',
    fontSize: 15,
    wrap: true,
    accent: 'teal',
    icon: 'markdown',
    customThemes: [],
    sync: { enabled: false, url: '', username: '', password: '', passwordEnc: '' },
    ai: { endpoint: '', key: '', keyEnc: '', model: 'deepseek-chat', ok: false }
  };
}
const state = { docs: [], trash: [], activeId: null, cfg: defaultCfg(), syncMeta: {} };

/* 文档级撤销栈 + 多选 + 侧栏页签（运行时态，不持久化） */
const undoStack = [];
let sidebarTab = 'docs';
let multiSelect = false;
const selected = new Set();
const collapsedDocs = new Set();
let stopController = null;
let editorSelection = { text: '', start: 0, end: 0 };

function applyState(data) {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data.docs)) state.docs = data.docs;
  state.docs.forEach((d) => { if (d.parentId == null) d.parentId = null; });
  if (Array.isArray(data.trash)) state.trash = data.trash;
  if (data.activeId != null) state.activeId = data.activeId;
  if (data.syncMeta && typeof data.syncMeta === 'object') state.syncMeta = data.syncMeta;
  const base = defaultCfg();
  state.cfg = Object.assign(base, data.cfg || {});
  state.cfg.ai = Object.assign(base.ai, (data.cfg && data.cfg.ai) || {});
  state.cfg.sync = Object.assign(base.sync, (data.cfg && data.cfg.sync) || {});
}

async function load() {
  try {
    const raw = await idbGet(STORE_KEY);
    if (raw != null) { applyState(typeof raw === 'string' ? JSON.parse(raw) : raw); return; }

    // 迁移旧标识（glassmark）→ vetro
    const legacy = localStorage.getItem('glassmark::v1');
    if (legacy) {
      applyState(JSON.parse(legacy));
      localStorage.removeItem('glassmark::v1');
      await save();
      return;
    }
    const old = await idbGetFrom('glassmark', 'glassmark::v1').catch(() => null);
    if (old != null) {
      applyState(typeof old === 'string' ? JSON.parse(old) : old);
      await save();
      return;
    }
  } catch (e) { console.warn('load failed', e); }
}

let saveFlashTimer = null;
function markSaved() {
  clearTimeout(saveFlashTimer);
  saveFlashTimer = setTimeout(() => {
    const el = $('#saveState');
    if (!el) return;
    el.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }, 600);
}
async function save() {
  try {
    // 明文 API Key 永不落盘（仅持久化加密后的 keyEnc）
    const json = JSON.stringify(state, (k, v) => (k === 'key' || k === 'password' ? undefined : v));
    await idbSet(STORE_KEY, json);
    markSaved();
  }
  catch (e) { console.warn('save failed', e); toast('本地存储失败：' + e.message, 'err'); }
}

/* ===== API Key 安全存储 =====
   桌面版：Electron safeStorage（系统级加密）加密后落盘；
   浏览器版：降级为 base64 混淆。明文 key 仅存于内存，绝不写入存储。 */
async function persistKey() {
  const k = state.cfg.ai.key;
  if (!k) { state.cfg.ai.keyEnc = ''; return; }
  if (window.desktop && window.desktop.secure) {
    try {
      const r = await window.desktop.secure.encrypt(k);
      if (r && r.ok) { state.cfg.ai.keyEnc = r.data; return; }
    } catch (e) {}
  }
  try { state.cfg.ai.keyEnc = 'b64:' + btoa(unescape(encodeURIComponent(k))); }
  catch (e) { state.cfg.ai.keyEnc = ''; }
}
async function restoreKey() {
  const enc = state.cfg.ai.keyEnc;
  if (!enc) return; // 无加密存储：key 或为空，或为旧版明文（由 boot 迁移）
  if (enc.indexOf('b64:') === 0) {
    try { state.cfg.ai.key = decodeURIComponent(escape(atob(enc.slice(4)))); }
    catch (e) { state.cfg.ai.key = ''; }
    return;
  }
  if (window.desktop && window.desktop.secure) {
    try {
      const r = await window.desktop.secure.decrypt(enc);
      if (r && r.ok) { state.cfg.ai.key = r.data; return; }
    } catch (e) {}
  }
  state.cfg.ai.key = '';
}

/* ===== Markdown 渲染 ===== */
function initMarked() {
  if (typeof marked !== 'undefined') marked.setOptions({ breaks: true, gfm: true });
}
function render(md) {
  if (typeof marked === 'undefined') return '<pre>' + esc(md || '') + '</pre>';
  try {
    const html = marked.parse(md || '');
    // 净化预览 HTML：防止 Markdown 原始 HTML 造成 XSS
    if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(html);
    return html;
  }
  catch (e) { return '<pre>渲染失败：' + esc(e.message) + '</pre>'; }
}
function highlightBlocks(root) {
  if (typeof hljs === 'undefined' || !root) return;
  root.querySelectorAll('pre code').forEach((el) => { try { hljs.highlightElement(el); } catch (e) {} });
}

/* ===== 文档级撤销 ===== */
function snapshot() { return JSON.stringify({ docs: state.docs, trash: state.trash, activeId: state.activeId, cfg: state.cfg }); }
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 30) undoStack.shift();
  updateUndoBtn();
}
function undo() {
  if (!undoStack.length) { toast('没有可撤销的操作', 'err'); return; }
  const s = JSON.parse(undoStack.pop());
  state.docs = s.docs; state.activeId = s.activeId;
  if (s.trash) state.trash = s.trash;
  if (s.cfg) state.cfg = s.cfg;
  exitMultiSelect();
  save(); renderDocList(); renderEditor(); applyView();
  applyTheme(); applyFontSize(); applyWrap(); applyIcon();
  applyAiStatus(); updateSyncUI();
  updateUndoBtn();
  toast('已撤销');
}
function updateUndoBtn() {
  const b = $('#btnUndo');
  if (b) b.disabled = undoStack.length === 0;
}

/* ===== 文档操作 ===== */
function getActive() { return state.docs.find((d) => d.id === state.activeId) || null; }
function countWords(c) { return (c || '').replace(/\s/g, '').length; }
function fmtTime(t) {
  const diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  const d = new Date(t);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function createDoc(name = '未命名文档.md', content = '', filePath = null, parentId = null) {
  const d = { id: uid(), name, content, filePath: filePath || null, parentId: parentId || null, createdAt: Date.now(), updatedAt: Date.now() };
  state.docs.unshift(d);
  state.activeId = d.id;
  save();
  renderDocList();
  renderEditor();
  return d;
}

async function deleteDoc(id) {
  const d = state.docs.find((x) => x.id === id);
  if (!d) return;
  const ok = await confirmDialog({ title: '删除文档', message: '将「' + d.name + '」移入回收站？（可在回收站恢复或彻底删除）', confirmLabel: '移入回收站', danger: true });
  if (!ok) return;
  pushUndo();
  const idx = state.docs.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [removed] = state.docs.splice(idx, 1);
  reparentChildren(removed.id, removed.parentId);
  state.trash.unshift(Object.assign({}, removed, { deletedAt: Date.now() }));
  if (state.activeId === id) state.activeId = state.docs.length ? state.docs[0].id : null;
  save();
  renderDocList();
  renderEditor();
  toast('已移入回收站');
}

async function renameDoc(id) {
  const d = state.docs.find((x) => x.id === id);
  if (!d) return;
  const name = await promptDialog({ title: '重命名文档', message: '输入新的文档名称：', value: d.name, confirmLabel: '保存' });
  if (name == null) return;
  const clean = (name || '').trim();
  if (!clean) { toast('名称不能为空', 'err'); return; }
  d.name = clean; d.updatedAt = Date.now();
  save(); renderDocList(); renderEditor();
  toast('已重命名');
}

function switchDoc(id) {
  if (id === state.activeId) return;
  flushEditor();
  state.activeId = id;
  save();
  renderDocList();
  renderEditor();
}

function flushEditor() {
  const d = getActive();
  if (!d) return;
  const ed = $('#editor');
  if (ed && ed.value !== d.content) {
    d.content = ed.value;
    d.updatedAt = Date.now();
    save();
  }
}

/* ===== 多选 + 合并 ===== */
function enterMultiSelect() {
  multiSelect = true;
  selected.clear();
  $('#btnMultiSelect').classList.add('on');
  $('#multiBar').hidden = false;
  $('#dropHint').hidden = true;
  renderDocList(true);
}
function exitMultiSelect() {
  multiSelect = false;
  selected.clear();
  const b = $('#btnMultiSelect');
  if (b) b.classList.remove('on');
  $('#multiBar').hidden = true;
  $('#dropHint').hidden = false;
  renderDocList(true);
}
function toggleMultiSelect() { if (multiSelect) exitMultiSelect(); else enterMultiSelect(); }
function toggleSelected(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  renderDocList();
}
function updateMultiBar() { $('#multiCount').textContent = '已选 ' + selected.size + ' 项'; }

async function mergeSelected() {
  const ids = Array.from(selected);
  if (ids.length < 2) { toast('请至少勾选两个文档进行合并', 'err'); return; }
  const docs = ids.map((id) => state.docs.find((d) => d.id === id)).filter(Boolean);
  const name = await promptDialog({ title: '合并文档', message: '合并后的文档名称：', value: (docs[0].name || '合并').replace(/\.\w+$/i, '') + '-合并.md', confirmLabel: '合并' });
  if (name == null) return;
  const clean = (name || '').trim() || '合并文档.md';
  pushUndo();
  const content = docs.map((d) => d.content || '').join('\n\n---\n\n');
  state.docs = state.docs.filter((d) => !ids.includes(d.id));
  ids.forEach((id) => reparentChildren(id, null));
  state.docs.unshift({ id: uid(), name: clean, content, filePath: null, parentId: null, createdAt: Date.now(), updatedAt: Date.now() });
  state.activeId = state.docs[0].id;
  exitMultiSelect();
  save(); renderDocList(); renderEditor();
  toast('已合并 ' + docs.length + ' 个文档为「' + clean + '」', 'ok');
}

async function deleteSelected() {
  const ids = Array.from(selected);
  if (!ids.length) { toast('请先勾选要删除的文档', 'err'); return; }
  const ok = await confirmDialog({ title: '批量删除', message: '确定删除选中的 ' + ids.length + ' 个文档吗？（可点「撤销」恢复）', confirmLabel: '删除', danger: true });
  if (!ok) return;
  pushUndo();
  ids.forEach((id) => reparentChildren(id, (state.docs.find((d) => d.id === id) || {}).parentId || null));
  state.docs.filter((d) => ids.includes(d.id)).forEach((d) => state.trash.unshift(Object.assign({}, d, { deletedAt: Date.now() })));
  state.docs = state.docs.filter((d) => !ids.includes(d.id));
  if (ids.includes(state.activeId)) state.activeId = state.docs.length ? state.docs[0].id : null;
  exitMultiSelect();
  save(); renderDocList(); renderEditor();
  toast('已将 ' + ids.length + ' 个文档移入回收站', 'ok');
}

/* ===== 渲染 ===== */
/* ===== 文档树（主文档 / 分文档） ===== */
function childrenOf(parentId) {
  return state.docs.filter((d) => (d.parentId || null) === parentId);
}
function isDescendantOf(descendantId, ancestorId) {
  let cur = state.docs.find((d) => d.id === descendantId);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = state.docs.find((d) => d.id === cur.parentId);
  }
  return false;
}
function buildTree() {
  const out = [];
  const walk = (parentId, depth) => {
    childrenOf(parentId).forEach((d) => {
      out.push({ doc: d, depth });
      if (!collapsedDocs.has(d.id)) walk(d.id, depth + 1);
    });
  };
  walk(null, 0);
  return out;
}
function reparentChildren(parentId, newParentId) {
  state.docs.forEach((x) => { if ((x.parentId || null) === parentId) x.parentId = newParentId || null; });
}
function toggleCollapse(id) {
  if (collapsedDocs.has(id)) collapsedDocs.delete(id); else collapsedDocs.add(id);
  renderDocList(true);
}
function createSubDoc(parentId) {
  const parent = state.docs.find((d) => d.id === parentId);
  const name = (parent ? parent.name.replace(/\.\w+$/i, '') : '文档') + ' · 子文档.md';
  pushUndo();
  const d = { id: uid(), name, content: '', filePath: null, parentId: parentId || null, createdAt: Date.now(), updatedAt: Date.now() };
  state.docs.unshift(d);
  state.activeId = d.id;
  collapsedDocs.delete(parentId);
  save(); renderDocList(); renderEditor();
  toast('已新建子文档');
}
function setDocParent(id, newParentId) {
  pushUndo();
  const d = state.docs.find((x) => x.id === id);
  if (d) d.parentId = newParentId || null;
  save(); renderDocList();
  toast(newParentId ? '已设为子文档' : '已提升为主文档');
}
function pickParentDialog(id) {
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return;
  const candidates = state.docs.filter((d) => d.id !== id && !isDescendantOf(d.id, id));
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  let html = '<div class="modal modal-dialog" role="dialog"><div class="modal-head"><h3>移动「' + esc(doc.name) + '」</h3></div><div class="modal-body"><div class="parent-list">';
  html += '<button class="parent-item" data-parent="">⟷ 作为主文档（无父级）</button>';
  candidates.forEach((c) => {
    html += '<button class="parent-item" data-parent="' + esc(c.id) + '">' + esc(c.name) + '</button>';
  });
  html += '</div></div></div>';
  backdrop.innerHTML = html;
  document.body.appendChild(backdrop);
  const finish = () => dismissModal(backdrop);
  backdrop.querySelectorAll('.parent-item').forEach((b) => {
    b.addEventListener('click', () => { setDocParent(id, b.dataset.parent || null); finish(); });
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(); });
  openModal(backdrop);
}

/* ===== 渲染 ===== */
function renderDocList(force) {
  const list = $('#docList');
  if (!list) return;
  const currentIds = $$('.doc-item', list).map((el) => el.dataset.id).join(',');
  const nextIds = buildTree().map((x) => x.doc.id).join(',');

  if (state.docs.length === 0) {
    list.innerHTML = `
      <div class="doc-empty">
        <svg viewBox="0 0 24 24"><path d="M4 4h7l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
        <p>暂无文档</p>
        <span>拖入多个 .md 文件批量导入<br>或点击 + 新建</span>
      </div>`;
    updateMultiBar();
    return;
  }

  if (!force && currentIds === nextIds) {
    const active = getActive();
    $$('.doc-item', list).forEach((el) => {
      const id = el.dataset.id;
      el.classList.toggle('active', id === state.activeId);
      el.classList.toggle('selected', multiSelect && selected.has(id));
      const cb = el.querySelector('.doc-check');
      if (cb) cb.checked = selected.has(id);
      if (id === state.activeId && active) {
        const n = el.querySelector('.doc-name');
        const s = el.querySelector('.doc-sub');
        if (n) n.textContent = active.name || '未命名';
        if (s) s.textContent = countWords(active.content) + ' 字 · ' + fmtTime(active.updatedAt);
      }
    });
    updateMultiBar();
    return;
  }

  list.innerHTML = '';
  buildTree().forEach(({ doc: d, depth }, i) => {
    const item = document.createElement('div');
    item.className = 'doc-item'
      + (d.id === state.activeId ? ' active' : '')
      + (multiSelect ? ' selectable' : '')
      + (multiSelect && selected.has(d.id) ? ' selected' : '');
    item.dataset.id = d.id;
    item.style.setProperty('--i', i);
    item.style.setProperty('--depth', depth);
    const words = countWords(d.content);
    const initial = (d.name || 'md').replace(/\.(md|markdown|txt|mdown)$/i, '').trim().slice(0, 2).toUpperCase() || 'MD';
    const hasChildren = childrenOf(d.id).length > 0;
    item.innerHTML = `
      ${multiSelect ? `<input type="checkbox" class="doc-check" ${selected.has(d.id) ? 'checked' : ''}>` : ''}
      ${hasChildren
        ? `<button class="doc-caret" title="展开/收起">${collapsedDocs.has(d.id) ? '▶' : '▼'}</button>`
        : '<span class="doc-caret ph"></span>'}
      <div class="doc-ico">${esc(initial)}</div>
      <div class="doc-meta">
        <div class="doc-name">${esc(d.name || '未命名')}</div>
        <div class="doc-sub">${words} 字 · ${fmtTime(d.updatedAt)}</div>
      </div>
      ${syncEnabled() ? `<button class="doc-sync ${d.sync !== false ? 'on' : ''}" title="${d.sync !== false ? '已参与同步（点击关闭）' : '未参与同步（点击开启）'}"><svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 1 1 .5-8.97A6 6 0 0 1 19 10.5a3.5 3.5 0 0 1-.5 6.97"/></svg></button>` : ''}
      <button class="doc-subnew" title="新建子文档">＋</button>
      <button class="doc-move" title="移动 / 设为主文档">↳</button>
      <button class="doc-del" title="删除" aria-label="删除文档">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
      </button>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.doc-del, .doc-check, .doc-caret, .doc-sync, .doc-subnew, .doc-move')) return;
      if (multiSelect) toggleSelected(d.id);
      else switchDoc(d.id);
    });
    const cb = item.querySelector('.doc-check');
    if (cb) cb.addEventListener('click', (e) => { e.stopPropagation(); toggleSelected(d.id); });
    const caret = item.querySelector('.doc-caret');
    if (caret && hasChildren) caret.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(d.id); });
    item.addEventListener('dblclick', () => { if (!multiSelect) renameDoc(d.id); });
    item.querySelector('.doc-del').addEventListener('click', (e) => { e.stopPropagation(); deleteDoc(d.id); });
    item.querySelector('.doc-subnew').addEventListener('click', (e) => { e.stopPropagation(); createSubDoc(d.id); });
    item.querySelector('.doc-move').addEventListener('click', (e) => { e.stopPropagation(); pickParentDialog(d.id); });
    const syncBtn = item.querySelector('.doc-sync');
    if (syncBtn) syncBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDocSync(d.id); });
    list.appendChild(item);
  });
  updateMultiBar();
}

function emptyEditorHtml() {
  return `<div class="doc-empty big">
    <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
    <p>从左侧选择文档开始</p>
    <span>或点击「添加文档」/ 拖入 .md 文件 / 粘贴图片</span>
  </div>`;
}

function renderEditor() {
  const d = getActive();
  const ed = $('#editor');
  const pv = $('#preview');
  const nameEl = $('#docName');
  if (!d) {
    ed.value = '';
    pv.innerHTML = emptyEditorHtml();
    nameEl.textContent = '未命名文档.md';
    updateStats('');
    if (sidebarTab === 'outline') renderOutline();
    return;
  }
  ed.value = d.content || '';
  nameEl.textContent = d.name || '未命名.md';
  renderPreview(d.content);
  updateStats(d.content);
  applyView();
}

function renderPreview(md) {
  const pv = $('#preview');
  const scroller = pv.closest('.pane-preview');
  const prevScroll = scroller ? scroller.scrollTop : 0;
  pv.innerHTML = render(md);
  highlightBlocks(pv);
  if (scroller) scroller.scrollTop = prevScroll;
  if (sidebarTab === 'outline') renderOutline();
}

function updateStats(content) {
  $('#statWords').textContent = countWords(content);
  $('#statLines').textContent = (content || '').split(/\n/).length;
}

/* ===== 大纲 ===== */
function renderOutline() {
  const outline = $('#outline');
  const pv = $('#preview');
  if (!outline) return;
  const headings = pv.querySelectorAll('h1, h2, h3, h4, h5, h6');
  outline.innerHTML = '';
  if (!headings.length) {
    outline.innerHTML = '<div class="outline-empty">暂无标题</div>';
    return;
  }
  headings.forEach((h) => {
    const lvl = parseInt(h.tagName.charAt(1), 10);
    const a = document.createElement('a');
    a.className = 'outline-item lvl-' + lvl;
    a.textContent = h.textContent.trim() || '(无标题)';
    a.title = a.textContent;
    a.href = '#';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
    });
    outline.appendChild(a);
  });
}
function switchSidebarTab(tab) {
  sidebarTab = tab;
  $$('.sidebar-tab').forEach((b) => b.classList.toggle('active', b.dataset.sidebarTab === tab));
  $('#docList').hidden = tab !== 'docs';
  $('#outline').hidden = tab !== 'outline';
  $('#trashList').hidden = tab !== 'trash';
  if (tab === 'outline') renderOutline();
  else if (tab === 'trash') renderTrash();
  else renderDocList();
}

/* ===== 查找替换 ===== */
function openFind(withReplace) {
  const bar = $('#findBar');
  bar.hidden = false;
  void bar.offsetWidth;
  bar.classList.add('show');
  if (withReplace) showReplaceControls(true);
  const inp = $('#findInput');
  inp.focus(); inp.select();
  updateFindCount();
}
function closeFind() {
  const bar = $('#findBar');
  bar.classList.remove('show');
  setTimeout(() => { if (!bar.classList.contains('show')) bar.hidden = true; }, 220);
}
function showReplaceControls(on) {
  $('#replaceInput').hidden = !on;
  $('#btnReplaceOne').hidden = !on;
  $('#btnReplaceAll').hidden = !on;
  $('#btnToggleReplace').classList.toggle('on', on);
  if (on) $('#replaceInput').focus();
}
function findMatches() {
  const q = $('#findInput').value;
  const text = $('#editor').value;
  if (!q) return [];
  const res = [];
  let i = text.indexOf(q);
  while (i !== -1) { res.push(i); i = text.indexOf(q, i + q.length); }
  return res;
}
function updateFindCount() {
  const el = $('#findCount');
  const q = $('#findInput').value;
  if (!q) { el.textContent = ''; return; }
  const matches = findMatches();
  const pos = $('#editor').selectionStart;
  let cur = 0;
  matches.forEach((m, i) => { if (m <= pos) cur = i + 1; });
  el.textContent = matches.length ? (cur + '/' + matches.length) : '0/0';
}
function findStep(dir) {
  const ed = $('#editor');
  const q = $('#findInput').value;
  if (!q) return;
  const matches = findMatches();
  if (!matches.length) { updateFindCount(); return; }
  const pos = ed.selectionStart;
  let idx;
  if (dir === 1) {
    idx = matches.findIndex((m) => m > pos);
    if (idx === -1) idx = 0;
  } else {
    idx = matches.findIndex((m) => m >= pos);
    if (idx === -1) idx = matches.length - 1;
    else idx = idx - 1;
    if (idx < 0) idx = matches.length - 1;
  }
  const target = matches[idx];
  ed.focus();
  ed.setSelectionRange(target, target + q.length);
  $('#findInput').focus();
  updateFindCount();
}
function doReplaceOne() {
  const ed = $('#editor');
  const q = $('#findInput').value;
  const rep = $('#replaceInput').value;
  if (!q) return;
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (sel === q) {
    const s = ed.selectionStart;
    ed.value = ed.value.slice(0, s) + rep + ed.value.slice(ed.selectionEnd);
    ed.setSelectionRange(s, s + rep.length);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }
  findStep(1);
}
function doReplaceAll() {
  const ed = $('#editor');
  const q = $('#findInput').value;
  const rep = $('#replaceInput').value;
  if (!q) return;
  const count = ed.value.split(q).length - 1;
  if (!count) { toast('没有匹配项', 'err'); return; }
  ed.value = ed.value.split(q).join(rep);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  updateFindCount();
  toast('已替换 ' + count + ' 处', 'ok');
}
function bindFind() {
  $('#findInput').addEventListener('input', updateFindCount);
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') closeFind();
  });
  $('#replaceInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doReplaceOne(); }
    else if (e.key === 'Escape') closeFind();
  });
  $('#btnFindNext').addEventListener('click', () => findStep(1));
  $('#btnFindPrev').addEventListener('click', () => findStep(-1));
  $('#btnToggleReplace').addEventListener('click', () => showReplaceControls($('#replaceInput').hidden));
  $('#btnReplaceOne').addEventListener('click', doReplaceOne);
  $('#btnReplaceAll').addEventListener('click', doReplaceAll);
  $('#btnCloseFind').addEventListener('click', closeFind);
}

/* ===== 图片粘贴 / 插入 ===== */
function insertImageMarkdown(dataUrl, name) {
  const ed = $('#editor');
  const alt = (name || '图片').replace(/\.(png|jpe?g|gif|webp|bmp|svg)$/i, '');
  const md = '![' + alt + '](' + dataUrl + ')';
  const s = ed.selectionStart, en = ed.selectionEnd;
  ed.value = ed.value.slice(0, s) + md + ed.value.slice(en);
  const pos = s + md.length;
  ed.setSelectionRange(pos, pos);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}
function insertImages(files) {
  const arr = Array.from(files || []).filter((f) => f.type && f.type.startsWith('image/'));
  if (!arr.length) return;
  if (!getActive()) createDoc('未命名文档.md', '');
  let done = 0;
  arr.forEach((f) => {
    const reader = new FileReader();
    reader.onload = () => {
      insertImageMarkdown(reader.result, f.name);
      if (++done === arr.length) { save(); toast('已插入 ' + arr.length + ' 张图片', 'ok'); }
    };
    reader.onerror = () => { if (++done === arr.length) save(); };
    reader.readAsDataURL(f);
  });
}
function bindPaste() {
  const ed = $('#editor');
  ed.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imgs = Array.from(items).filter((it) => it.kind === 'file' && it.type && it.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    let done = 0;
    imgs.forEach((it) => {
      const f = it.getAsFile();
      if (!f) { if (++done === imgs.length) save(); return; }
      const reader = new FileReader();
      reader.onload = () => { insertImageMarkdown(reader.result, f.name); if (++done === imgs.length) save(); };
      reader.onerror = () => { if (++done === imgs.length) save(); };
      reader.readAsDataURL(f);
    });
    toast('已插入图片', 'ok');
  });
}

function bindPreview() {
  // 预览区链接：外部链接用系统浏览器/新标签打开，避免应用被导航走
  $('#preview').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return; // 内部锚点允许滚动
    e.preventDefault();
    if (/^(https?:|mailto:|ftp:)/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
}

/* ===== 视图 / 主题 / 字号 ===== */
function applyView() {
  const shell = $('#editorShell');
  const panes = $('#editorPanes');
  const mode = state.cfg.viewMode || 'split';
  const editPane = $('.pane-edit', panes);
  const previewPane = $('.pane-preview', panes);
  shell.classList.toggle('split', mode === 'split');
  editPane.classList.toggle('active', mode === 'edit' || mode === 'split');
  previewPane.classList.toggle('active', mode === 'preview' || mode === 'split');
  $$('.tab[data-view]', $('#viewTabs')).forEach((t) => t.classList.toggle('active', t.dataset.view === mode));
}

function applyTheme() {
  const theme = state.cfg.theme;
  const resolved = theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  if (!REDUCED_MOTION) {
    document.documentElement.classList.add('theme-switching');
    clearTimeout(applyTheme._t);
    applyTheme._t = setTimeout(() => document.documentElement.classList.remove('theme-switching'), 400);
  }
  document.body.dataset.theme = resolved;
  applyAccent();
  $$('#themeSeg .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
}

function applyFontSize() {
  document.documentElement.style.setProperty('--editor-fs', state.cfg.fontSize + 'px');
  const r = $('#cfgFontSize'); const v = $('#cfgFontSizeVal');
  if (r) r.value = state.cfg.fontSize;
  if (v) v.textContent = state.cfg.fontSize + 'px';
}

function applyWrap() {
  $('#editor').classList.toggle('no-wrap', !state.cfg.wrap);
  const btn = $('#btnWordWrap');
  btn.classList.toggle('on', !!state.cfg.wrap);
  btn.title = state.cfg.wrap ? '关闭自动换行' : '开启自动换行';
}

/* ===== 强调色 / 图标样式 / 主题导入 ===== */
const ACCENTS = [
  { id: 'teal', name: '青绿', accent: '#4ecdc4', accent2: '#7c9eff' },
  { id: 'indigo', name: '靛蓝', accent: '#818cf8', accent2: '#a78bfa' },
  { id: 'violet', name: '紫罗兰', accent: '#a78bfa', accent2: '#f472b6' },
  { id: 'rose', name: '玫瑰', accent: '#fb7185', accent2: '#f472b6' },
  { id: 'amber', name: '琥珀', accent: '#fbbf24', accent2: '#fb923c' },
  { id: 'emerald', name: '翡翠', accent: '#34d399', accent2: '#2dd4bf' },
  { id: 'sky', name: '天蓝', accent: '#38bdf8', accent2: '#818cf8' },
  { id: 'crimson', name: '绯红', accent: '#e11d48', accent2: '#fb7185' }
];

const ICON_STYLES = [
  { id: 'markdown', name: 'Markdown', glyph: '<path d="M11 22 V13 L16.5 16.8 L22 13 V22" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 23.5 V26.6 M14.6 26.6 L16.5 28.6 L18.4 26.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'prism', name: '棱镜', glyph: '<path d="M18 9 L28 18 L18 27 L8 18 Z" fill="none" stroke="#fff" stroke-width="2.3" stroke-linejoin="round"/><path d="M18 9 V27 M8 18 H28" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" opacity="0.7"/>' },
  { id: 'v', name: 'V 字', glyph: '<path d="M12.5 13 L18 24 L23.5 13" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'spark', name: '星芒', glyph: '<path d="M18 8 L19.7 14.3 L26 16 L19.7 17.7 L18 24 L16.3 17.7 L10 16 L16.3 14.3 Z" fill="#fff" stroke="none"/>' }
];

let appliedCustomVars = [];

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6 || isNaN(parseInt(full, 16))) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  if (!c) return 'rgba(78,205,196,' + a + ')';
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}
function lighten(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const mix = (v) => Math.round(v + (255 - v) * amt);
  return '#' + [mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function darken(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const mix = (v) => Math.round(v * (1 - amt));
  return '#' + [mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function allAccents() { return ACCENTS.concat((state.cfg.customThemes || []).map((t) => Object.assign({}, t, { custom: true }))); }

function applyAccent() {
  const preset = allAccents().find((a) => a.id === state.cfg.accent) || ACCENTS[0];
  const root = document.documentElement.style;
  appliedCustomVars.forEach((k) => root.removeProperty(k));
  appliedCustomVars = [];
  root.setProperty('--accent', preset.accent);
  root.setProperty('--accent-2', preset.accent2);
  const isLight = document.body.dataset.theme === 'light';
  root.setProperty('--accent-strong', isLight ? darken(preset.accent, 0.15) : lighten(preset.accent, 0.12));
  root.setProperty('--accent-soft', rgba(preset.accent, 0.18));
  root.setProperty('--accent-border', rgba(preset.accent, 0.35));
  root.setProperty('--accent-glow', rgba(preset.accent, 0.38));
  if (preset.vars) {
    Object.entries(preset.vars).forEach(([k, v]) => { root.setProperty(k, v); appliedCustomVars.push(k); });
  }
  $$('.accent-grid .accent-swatch').forEach((el) => el.classList.toggle('active', el.dataset.accent === state.cfg.accent));
}

function applyIcon() {
  const preset = ICON_STYLES.find((s) => s.id === state.cfg.icon) || ICON_STYLES[0];
  const g = $('#logoGlyph');
  if (g) g.innerHTML = preset.glyph;
  $$('.icon-grid .icon-preview').forEach((el) => el.classList.toggle('active', el.dataset.icon === state.cfg.icon));
}

function renderAccentGrid() {
  const grid = $('#accentGrid');
  if (!grid) return;
  grid.innerHTML = '';
  allAccents().forEach((a) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'accent-swatch' + (a.id === state.cfg.accent ? ' active' : '');
    sw.dataset.accent = a.id;
    sw.title = a.name + (a.custom ? '（导入）' : '');
    sw.style.background = 'linear-gradient(135deg, ' + a.accent + ', ' + a.accent2 + ')';
    sw.addEventListener('click', () => { state.cfg.accent = a.id; save(); applyAccent(); });
    grid.appendChild(sw);
  });
}

function renderIconGrid() {
  const grid = $('#iconGrid');
  if (!grid) return;
  grid.innerHTML = '';
  ICON_STYLES.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-preview' + (s.id === state.cfg.icon ? ' active' : '');
    b.dataset.icon = s.id;
    b.title = s.name;
    b.innerHTML = '<svg viewBox="0 0 36 36"><rect x="2" y="2" width="32" height="32" rx="10" fill="url(#logoGrad)"/><rect x="2.6" y="2.6" width="30.8" height="30.8" rx="9.4" fill="none" stroke="rgba(255,255,255,0.38)" stroke-width="1"/>' + s.glyph + '</svg>';
    b.addEventListener('click', () => { state.cfg.icon = s.id; save(); applyIcon(); });
    grid.appendChild(b);
  });
}

function importThemeFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ''));
      const name = (data.name || '导入主题').toString().trim();
      const accent = data.accent || (data.colors && data.colors.accent) || '#4ecdc4';
      const accent2 = data.accent2 || (data.colors && data.colors.accent2) || '#7c9eff';
      const vars = (data.vars && typeof data.vars === 'object') ? data.vars : null;
      const id = 'custom-' + uid();
      state.cfg.customThemes = state.cfg.customThemes || [];
      state.cfg.customThemes.push({ id, name, accent, accent2, vars });
      state.cfg.accent = id;
      save();
      applyAccent();
      renderAccentGrid();
      toast('已导入主题：' + name, 'ok');
    } catch (e) { toast('主题文件解析失败：' + e.message, 'err'); }
  };
  reader.onerror = () => toast('读取主题文件失败', 'err');
  reader.readAsText(file);
}

function exportTheme() {
  const preset = allAccents().find((a) => a.id === state.cfg.accent) || ACCENTS[0];
  const data = { name: preset.name || 'Vetro 主题', accent: preset.accent, accent2: preset.accent2 };
  if (preset.vars) data.vars = preset.vars;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (preset.name || 'vetro-theme') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已导出当前配色', 'ok');
}

/* ===== 编辑器输入 ===== */
let renderTimer = null;
let persistTimer = null;
function scheduleSave() { clearTimeout(persistTimer); persistTimer = setTimeout(() => save(), 500); }

function bindEditor() {
  const ed = $('#editor');
  ed.addEventListener('input', () => {
    const d = getActive();
    if (d) { d.content = ed.value; d.updatedAt = Date.now(); }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderPreview(ed.value);
      updateStats(ed.value);
      const sub = $('.doc-item.active .doc-sub');
      if (sub) sub.textContent = countWords(ed.value) + ' 字 · 刚刚';
    }, 200);
    scheduleSave();
  });

  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ed.selectionStart, en = ed.selectionEnd;
      ed.value = ed.value.slice(0, s) + '  ' + ed.value.slice(en);
      ed.selectionStart = ed.selectionEnd = s + 2;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushEditor();
      saveToDisk();
    }
  });

  // 实时捕获选中文本（改写/润色/翻译依赖）
  ed.addEventListener('mouseup', captureEditorSelection);
  ed.addEventListener('keyup', captureEditorSelection);
  ed.addEventListener('blur', captureEditorSelection);

  $$('.tab[data-view]', $('#viewTabs')).forEach((t) => {
    t.addEventListener('click', () => {
      state.cfg.viewMode = t.dataset.view;
      save(); applyView();
    });
  });

  $('#btnWordWrap').addEventListener('click', () => {
    state.cfg.wrap = !state.cfg.wrap;
    save(); applyWrap();
  });
}

/* ===== 文件导入导出 ===== */
function importFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => /\.(md|markdown|txt|mdown)$/i.test(f.name) || (f.type && f.type.startsWith('text')));
  if (files.length === 0) { toast('仅支持 .md / .txt / .markdown 文件', 'err'); return; }
  pushUndo();
  let done = 0;
  files.forEach((f) => {
    const reader = new FileReader();
    reader.onload = () => {
      createDoc(f.name, String(reader.result || ''));
      if (++done === files.length) toast('已导入 ' + files.length + ' 个文档（可点「撤销」撤回）', 'ok');
    };
    reader.onerror = () => { toast('读取失败：' + f.name, 'err'); if (++done === files.length) {} };
    reader.readAsText(f);
  });
}

function handleDroppedFiles(files) {
  const arr = Array.from(files || []);
  const images = arr.filter((f) => f.type && f.type.startsWith('image/'));
  const docs = arr.filter((f) => !images.includes(f));
  if (docs.length) importFiles(docs);
  if (images.length) insertImages(images);
}

async function saveToDisk() {
  const d = getActive();
  if (!d) { toast('没有可保存的文档', 'err'); return; }
  flushEditor();
  if (window.desktop && window.desktop.saveFile) {
    try {
      const res = await window.desktop.saveFile({ content: d.content, filePath: d.filePath, name: d.name });
      if (!res || res.canceled) return;
      if (res.error) { toast('保存失败：' + res.error, 'err'); return; }
      d.filePath = res.filePath;
      d.name = res.name;
      d.updatedAt = Date.now();
      save(); renderDocList(); renderEditor();
      toast('已保存：' + res.name, 'ok');
      return;
    } catch (e) { toast('保存失败：' + e.message, 'err'); return; }
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: d.name || '未命名.md',
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }]
      });
      const w = await handle.createWritable();
      await w.write(d.content);
      await w.close();
      toast('已保存：' + handle.name, 'ok');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const blob = new Blob([d.content], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = d.name || '未命名.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已下载：' + (d.name || '未命名.md'), 'ok');
}

async function saveFileAs() {
  const d = getActive();
  if (!d) { toast('没有可保存的文档', 'err'); return; }
  flushEditor();
  if (window.desktop && window.desktop.saveFileAs) {
    try {
      const res = await window.desktop.saveFileAs({ content: d.content, name: d.name });
      if (!res || res.canceled) return;
      if (res.error) { toast('另存为失败：' + res.error, 'err'); return; }
      d.filePath = res.filePath;
      d.name = res.name;
      d.updatedAt = Date.now();
      save(); renderDocList(); renderEditor();
      toast('已另存为：' + res.name, 'ok');
      return;
    } catch (e) { toast('另存为失败：' + e.message, 'err'); return; }
  }
  saveToDisk();
}

async function openFromDisk() {
  if (window.desktop && window.desktop.openFile) {
    try {
      const res = await window.desktop.openFile();
      if (!res || res.canceled) return;
      pushUndo();
      for (const f of res.files) createDoc(f.name, f.content, f.path);
      toast('已打开 ' + res.files.length + ' 个文档', 'ok');
      return;
    } catch (e) { toast('打开失败：' + e.message, 'err'); return; }
  }
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt', '.mdown'] } }]
      });
      pushUndo();
      for (const h of handles) {
        const f = await h.getFile();
        const text = await new Promise((res) => {
          const reader = new FileReader();
          reader.onload = () => res(String(reader.result || ''));
          reader.readAsText(f);
        });
        createDoc(f.name, text);
      }
      toast('已打开文档', 'ok');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  $('#fileInput').click();
}

/* ===== 拖拽(全局) ===== */
function bindDragDrop() {
  const overlay = $('#dragOverlay');
  let counter = 0;
  const show = () => { overlay.hidden = false; void overlay.offsetWidth; overlay.classList.add('show'); };
  const hide = () => {
    overlay.classList.remove('show');
    setTimeout(() => { if (!overlay.classList.contains('show')) overlay.hidden = true; }, 300);
  };
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    counter++;
    show();
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    counter--;
    if (counter <= 0) { counter = 0; hide(); }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    counter = 0;
    hide();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleDroppedFiles(e.dataTransfer.files);
    }
  });
  const dh = $('#dropHint');
  dh.addEventListener('dragover', (e) => { e.preventDefault(); dh.classList.add('dragover'); });
  dh.addEventListener('dragleave', () => dh.classList.remove('dragover'));
  dh.addEventListener('drop', (e) => { e.preventDefault(); dh.classList.remove('dragover'); if (e.dataTransfer.files.length) handleDroppedFiles(e.dataTransfer.files); });
}

/* ===== 设置 ===== */
function openSettings() {
  openModal($('#settingsModal'));
  applyTheme(); applyFontSize(); applyAccent(); applyIcon();
  renderAccentGrid(); renderIconGrid();
  $$('#viewSeg .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.viewMode === state.cfg.viewMode));
  // 同步设置回填
  const s = state.cfg.sync || {};
  const sec = $('#syncSection');
  if (sec) sec.hidden = !window.desktop;
  $('#syncEnabled').checked = !!s.enabled;
  $('#syncUrl').value = s.url || '';
  $('#syncUser').value = s.username || '';
  $('#syncPass').value = s.password || '';
}
function closeSettings() { closeModal($('#settingsModal')); }

function bindSettings() {
  $('#btnSettings').addEventListener('click', openSettings);
  $$('[data-close-settings]').forEach((b) => b.addEventListener('click', closeSettings));
  $('#settingsModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSettings(); });

  $$('#themeSeg .seg-item').forEach((b) => b.addEventListener('click', () => {
    state.cfg.theme = b.dataset.theme; save(); applyTheme();
  }));
  $$('#viewSeg .seg-item').forEach((b) => b.addEventListener('click', () => {
    state.cfg.viewMode = b.dataset.viewMode; save(); applyView();
    $$('#viewSeg .seg-item').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('#cfgFontSize').addEventListener('input', (e) => {
    state.cfg.fontSize = parseInt(e.target.value, 10) || 15; applyFontSize(); save();
  });
  $('#btnClearAll').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清空全部数据', message: '确定清空所有文档和设置吗？清空后仍可点击「撤销」恢复。', confirmLabel: '清空', danger: true });
    if (!ok) return;
    pushUndo();
    state.docs = []; state.activeId = null; state.cfg = defaultCfg();
    save(); renderDocList(); renderEditor(); applyTheme(); applyFontSize(); applyWrap(); applyAccent(); applyIcon(); closeSettings();
    toast('已清空所有数据', 'ok', { label: '撤销', fn: undo });
  });

  $('#btnImportTheme').addEventListener('click', () => $('#themeInput').click());
  $('#themeInput').addEventListener('change', (e) => {
    if (e.target.files.length) importThemeFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnExportTheme').addEventListener('click', exportTheme);

  // WebDAV 同步
  $('#syncEnabled').addEventListener('change', (e) => { state.cfg.sync.enabled = e.target.checked; save(); updateSyncUI(); renderDocList(true); });
  $('#btnSaveSync').addEventListener('click', saveSyncConfig);
  $('#btnTestSync').addEventListener('click', testSyncConnection);
  $('#btnSyncNow').addEventListener('click', syncNow);
}

/* ===== AI 助手 ===== */
function applyAiStatus() {
  const ok = state.cfg.ai.ok;
  const el = $('#aiStatus');
  const card = $('#aiStatusCardLine');
  const cardLine = $('#aiStatusCard .ai-status-line');
  if (!state.cfg.ai.endpoint || !state.cfg.ai.key) {
    el.className = 'ai-dot off'; el.innerHTML = '<span class="dot"></span>AI 未连接';
    if (card) { card.textContent = '未配置 API —— 请填写 API 地址和 Key'; cardLine && cardLine.classList.remove('ok', 'err', 'busy'); }
  } else {
    el.className = 'ai-dot ' + (ok ? 'on' : 'err');
    el.innerHTML = '<span class="dot"></span>AI ' + (ok ? '已连接 · ' + state.cfg.ai.model : '未验证');
    if (card) {
      card.textContent = ok ? '已连接到 ' + state.cfg.ai.model + '（' + state.cfg.ai.endpoint + '）' : 'API 已填写，点击「保存并测试连接」验证';
      cardLine && (cardLine.classList.toggle('ok', ok), cardLine.classList.remove('err', 'busy'));
    }
  }
}

function openAi() {
  const view = (state.cfg.ai.endpoint && state.cfg.ai.key) ? 'chat' : 'config';
  switchAiView(view);
  $('#cfgEndpoint').value = state.cfg.ai.endpoint || '';
  $('#cfgKey').value = state.cfg.ai.key || '';
  setModelValue(state.cfg.ai.model || 'deepseek-chat');
  applyAiStatus();
  captureEditorSelection();
  const box = $('#aiSelText');
  if (box) box.value = editorSelection.text;
  autoGrowSel();
  updateAiSelHint();
  updateRunBtnLabel();
  $('#aiBackdrop').classList.add('show');
  $('#aiDrawer').classList.add('open');
  $('#aiDrawer').setAttribute('aria-hidden', 'false');
}
function closeAi() {
  $('#aiDrawer').classList.remove('open');
  $('#aiBackdrop').classList.remove('show');
  $('#aiDrawer').setAttribute('aria-hidden', 'true');
}
function switchAiView(v) {
  $('#aiConfigView').hidden = v !== 'config';
  $('#aiChatView').hidden = v !== 'chat';
}

function bindAi() {
  $('#btnAi').addEventListener('click', openAi);
  $('#btnCloseAi').addEventListener('click', closeAi);
  $('#aiBackdrop').addEventListener('click', closeAi);

  $('#btnToggleKey').addEventListener('click', () => {
    const k = $('#cfgKey'); k.type = k.type === 'password' ? 'text' : 'password';
  });

  $('#btnSaveAi').addEventListener('click', testAiConnect);
  $('#btnRunAi').addEventListener('click', runAi);
  $('#btnStopAi').addEventListener('click', stopAi);
  $('#btnInsertResult').addEventListener('click', insertResult);
  $('#btnCopyResult').addEventListener('click', copyResult);
  $('#btnUseAsDoc').addEventListener('click', useResultAsDoc);
  $('#btnAiConfig').addEventListener('click', () => switchAiView('config'));
  $('#aiAction').addEventListener('change', updateRunBtnLabel);
  $('#btnFetchModels').addEventListener('click', fetchModels);
  $('#aiSelText').addEventListener('input', () => {
    autoGrowSel();
    updateAiSelHint(); updateRunBtnLabel();
  });
}

function updateRunBtnLabel() {
  const a = $('#aiAction').value;
  const hasSel = !!($('#aiSelText') && $('#aiSelText').value.trim());
  const map = {
    '改写': hasSel ? '改写选中文本' : '改写整篇文档',
    '润色': hasSel ? '润色选中文本' : '润色整篇文档',
    '续写': '续写光标之后',
    '翻译': hasSel ? '翻译选中文本' : '翻译整篇文档',
    '总结': '总结当前文档',
    '自由': '发送给 AI'
  };
  $('#btnRunAiLabel').textContent = map[a] || '执行 AI 操作';
}

function autoGrowSel() {
  const ta = $('#aiSelText');
  if (!ta) return;
  const drawer = $('#aiDrawer');
  const cap = drawer ? Math.round(drawer.clientHeight * 2 / 3) : 360;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
}

function captureEditorSelection() {
  const ed = $('#editor');
  if (!ed) return;
  const text = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  editorSelection = { text, start: ed.selectionStart, end: ed.selectionEnd };
  if (text) {
    const box = $('#aiSelText');
    if (box) box.value = text;
    autoGrowSel();
  }
  updateAiSelHint();
  updateRunBtnLabel();
}

function updateAiSelHint() {
  const el = $('#aiSelHint');
  if (!el) return;
  const t = $('#aiSelText') ? $('#aiSelText').value.trim() : '';
  if (t) {
    const preview = t.length > 24 ? t.slice(0, 24) + '…' : t;
    el.innerHTML = '已选 <b>' + countWords(t) + '</b> 字（可编辑）：「' + esc(preview) + '」 <button class="ai-sel-clear" title="清除选中，改为处理整篇文档">清除</button>';
    const clearBtn = el.querySelector('.ai-sel-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      const box = $('#aiSelText');
      if (box) { box.value = ''; box.style.height = 'auto'; }
      updateAiSelHint(); updateRunBtnLabel();
    });
  } else {
    el.textContent = '未选中 —— 将处理整篇文档';
  }
}

function setAiResult(text) {
  const el = $('#aiResult');
  el.textContent = text;
  el.classList.remove('anim'); void el.offsetWidth; el.classList.add('anim');
}

function setModelValue(model) {
  const sel = $('#cfgModel');
  if (!sel) return;
  if (model && !Array.from(sel.options).some((o) => o.value === model)) {
    const o = document.createElement('option');
    o.value = model; o.textContent = model;
    sel.insertBefore(o, sel.firstChild);
  }
  sel.value = model || 'deepseek-chat';
}

async function fetchModels() {
  const endpoint = ($('#cfgEndpoint').value || '').trim().replace(/\/+$/, '');
  const key = $('#cfgKey').value.trim();
  if (!endpoint || !key) { toast('请先填写 API 地址和 Key', 'err'); return; }
  const btn = $('#btnFetchModels');
  btn.disabled = true;
  btn.textContent = '获取中…';
  try {
    let res;
    if (window.desktop && window.desktop.aiModels) {
      res = await window.desktop.aiModels({ endpoint, key });
    } else {
      const r = await fetch(endpoint + '/models', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) {}
        res = { ok: false, error: msg };
      } else {
        const d = await r.json();
        res = { ok: true, models: (d && Array.isArray(d.data) ? d.data : []).map((m) => m && m.id).filter(Boolean).sort() };
      }
    }
    if (!res || !res.ok) { toast('获取模型失败：' + ((res && res.error) || '未知错误'), 'err'); return; }
    const models = res.models || [];
    if (models.length) {
      const sel = $('#cfgModel');
      const current = state.cfg.ai.model || sel.value;
      sel.innerHTML = '';
      models.forEach((m) => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        sel.appendChild(o);
      });
      if (current && models.indexOf(current) === -1) {
        const o = document.createElement('option');
        o.value = current; o.textContent = current + '（当前）';
        sel.insertBefore(o, sel.firstChild);
      }
      sel.value = (current && models.indexOf(current) !== -1) ? current : models[0];
      toast('已获取 ' + models.length + ' 个模型，请在「模型」下拉框选择', 'ok');
    } else {
      toast('未获取到模型', 'err');
    }
  } catch (e) {
    toast('获取模型失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '获取模型';
  }
}

async function testAiConnect() {
  state.cfg.ai.endpoint = ($('#cfgEndpoint').value || '').trim().replace(/\/+$/, '');
  state.cfg.ai.key = $('#cfgKey').value.trim();
  state.cfg.ai.model = ($('#cfgModel').value || '').trim() || 'deepseek-chat';
  await persistKey();
  save();
  applyAiStatus();
  if (!state.cfg.ai.endpoint || !state.cfg.ai.key) { toast('请填写 API 地址和 Key', 'err'); return; }
  $('#aiStatusCard .ai-status-line').classList.add('busy');
  $('#aiStatusCardLine').textContent = '正在测试连接……';
  try {
    const r = await callChat([{ role: 'user', content: '回复“OK”' }], 20);
    state.cfg.ai.ok = true; save();
    applyAiStatus();
    toast('AI 连接成功！', 'ok');
    switchAiView('chat');
    updateRunBtnLabel();
  } catch (e) {
    state.cfg.ai.ok = false; save();
    applyAiStatus();
    $('#aiStatusCard .ai-status-line').classList.remove('busy');
    $('#aiStatusCard .ai-status-line').classList.add('err');
    $('#aiStatusCardLine').textContent = '连接失败：' + e.message;
    toast('AI 连接失败：' + e.message, 'err');
  }
}

async function callChat(messages, maxTokens) {
  const { endpoint, key, model } = state.cfg.ai;
  const url = endpoint.replace(/\/+$/, '') + '/chat/completions';
  const body = { model, messages, temperature: 0.7, max_tokens: maxTokens || 2048, stream: false };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('返回为空');
  return content;
}

async function callChatStream(messages, onDelta, signal) {
  const { endpoint, key, model } = state.cfg.ai;
  const url = endpoint.replace(/\/+$/, '') + '/chat/completions';
  const body = { model, messages, temperature: 0.7, stream: true };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('text/event-stream') !== -1 || ct.indexOf('application/x-ndjson') !== -1) {
    if (!res.body) throw new Error('当前环境不支持流式读取');
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (t.indexOf('data:') !== 0) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data);
          const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (delta) onDelta(delta);
        } catch (e) {}
      }
    }
  } else {
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (content) onDelta(content);
  }
}

async function runAi() {
  if (!state.cfg.ai.ok) { toast('请先配置并测试 AI 连接', 'err'); switchAiView('config'); return; }
  flushEditor();
  const d = getActive();
  const action = $('#aiAction').value;
  const extra = ($('#aiCustomPrompt').value || '').trim();
  const selText = $('#aiSelText') ? $('#aiSelText').value.trim() : '';
  const isSel = !!selText;

  let sys = '', user = '';
  const ctxDoc = d ? d.content : '';

  switch (action) {
    case '改写': {
      const target = selText || ctxDoc;
      if (!target) { toast('文档为空', 'err'); return; }
      sys = '你是中文写作助手，按用户要求改写文本。只输出改写后的文本，不要加解释或代码块。';
      user = `改写以下${isSel ? '选中文本' : '文档'}${extra ? '，要求：' + extra : ''}：\n\n${target}`;
      break;
    }
    case '润色': {
      const target = selText || ctxDoc;
      if (!target) { toast('文档为空', 'err'); return; }
      sys = '你是资深编辑，对文本进行润色：修正语病、提升表达、保持原意不动。只输出润色后的 Markdown 文本。';
      user = `润色以下${isSel ? '选中内容' : '文档'}${extra ? '，额外要求：' + extra : ''}：\n\n${target}`;
      break;
    }
    case '续写':
      sys = '你是 Markdown 写作助手，根据上下文续写文档。只输出续写的新增部分，不要重复原文。';
      user = `这是当前文档：\n\n${ctxDoc}\n\n请在文档末尾续写${extra ? '，要求：' + extra : ''}。只输出新增内容。`;
      break;
    case '翻译': {
      const target = selText || ctxDoc;
      if (!target) { toast('文档为空', 'err'); return; }
      sys = '你是专业翻译，将内容翻译为流畅的简体中文（若已是中文则译为英文）。保持 Markdown 格式。只输出译文。';
      user = `翻译以下${isSel ? '选中文本' : '文档'}${extra ? '，额外要求：' + extra : ''}：\n\n${target}`;
      break;
    }
    case '总结':
      if (!ctxDoc) { toast('文档为空', 'err'); return; }
      sys = '你用 Markdown 写一份结构化总结：要点、关键信息、可执行项（如有）。只输出总结。';
      user = `总结以下文档${extra ? '，要求：' + extra : ''}：\n\n${ctxDoc}`;
      break;
    case '自由':
      sys = '你是用户的写作助手，回答问题或帮助处理 Markdown 文本。';
      user = selText ? `选中文本：\n\n${selText}\n\n请求：${extra || '请给出你的建议或改写'}` : (extra || '请帮我处理当前文档。当前文档：\n\n' + ctxDoc);
      break;
  }

  $('#btnRunAi').disabled = true;
  $('#btnStopAi').hidden = false;
  $('#btnRunAiLabel').textContent = '生成中…';
  $('#aiStatus').className = 'ai-dot busy';
  $('#aiStatus').innerHTML = '<span class="dot"></span>AI 处理中';
  setAiResult('');
  $('#aiResultLabel').hidden = false;
  $('#aiResultActions').hidden = true;

  let acc = '';
  stopController = new AbortController();
  const resultEl = $('#aiResult');
  try {
    await callChatStream([{ role: 'system', content: sys }, { role: 'user', content: user }], (delta) => {
      acc += delta;
      resultEl.textContent = acc;
      resultEl.scrollTop = resultEl.scrollHeight;
    }, stopController.signal);
    setAiResult(acc);
    $('#aiResultActions').hidden = false;
    $('#aiStatus').className = 'ai-dot on';
    $('#aiStatus').innerHTML = '<span class="dot"></span>AI 已连接 · ' + state.cfg.ai.model;
    toast('AI 处理完成', 'ok');
  } catch (e) {
    if (e.name === 'AbortError') {
      if (acc) setAiResult(acc);
      toast('已停止生成');
    } else {
      setAiResult((acc ? acc + '\n\n' : '') + '❌ 失败：' + e.message);
      toast('AI 调用失败：' + e.message, 'err');
    }
    $('#aiStatus').className = 'ai-dot err';
    $('#aiStatus').innerHTML = '<span class="dot"></span>AI 报错';
  } finally {
    $('#btnRunAi').disabled = false;
    $('#btnStopAi').hidden = true;
    stopController = null;
    updateRunBtnLabel();
  }
}
function stopAi() { if (stopController) stopController.abort(); }

function insertResult() {
  const text = $('#aiResult').textContent;
  if (!text) return;
  flushEditor();
  const ed = $('#editor');
  const s = ed.selectionStart, en = ed.selectionEnd;
  ed.value = ed.value.slice(0, s) + text + ed.value.slice(en);
  ed.selectionStart = s; ed.selectionEnd = s + text.length;
  ed.focus();
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  save();
  toast('已插入到文档', 'ok');
}
function copyResult() {
  const text = $('#aiResult').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast('已复制', 'ok')).catch(() => toast('复制失败', 'err'));
}
async function useResultAsDoc() {
  const text = $('#aiResult').textContent;
  if (!text) return;
  const ok = await confirmDialog({ title: '替换文档', message: '用 AI 结果替换当前文档全部内容？', confirmLabel: '替换', danger: true });
  if (!ok) return;
  pushUndo();
  const d = getActive();
  if (!d) { createDoc('AI 生成.md', text); return; }
  d.content = text; d.updatedAt = Date.now();
  save(); renderEditor(); renderDocList();
  toast('已替换文档内容', 'ok');
}

/* ===== PWA 安装 ===== */
let deferredPrompt = null;
function bindPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btnInstall').hidden = false;
  });
  $('#btnInstall').addEventListener('click', async () => {
    if (!deferredPrompt) { toast('当前浏览器不支持安装，或已安装', 'err'); return; }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('已安装到桌面', 'ok');
    deferredPrompt = null;
    $('#btnInstall').hidden = true;
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.log('sw reg skipped:', e.message));
    });
  }
}

/* ===== 顶部按钮绑定 ===== */
function cycleView() {
  const order = ['split', 'preview', 'edit'];
  const i = order.indexOf(state.cfg.viewMode);
  state.cfg.viewMode = order[(i + 1) % order.length];
  save(); applyView();
  $$('#viewSeg .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.viewMode === state.cfg.viewMode));
}

function bindTopbar() {
  $('#btnFiles').addEventListener('click', openFromDisk);
  $('#btnSave').addEventListener('click', saveToDisk);
  $('#btnSaveAs').addEventListener('click', saveFileAs);
  $('#btnToggleSplit').addEventListener('click', cycleView);
  $('#btnNewDoc').addEventListener('click', async () => {
    const name = await promptDialog({
      title: '新建文档',
      message: '输入文档名称：',
      value: '未命名-' + new Date().toLocaleDateString('zh-CN').replace(/\//g, '-') + '.md',
      confirmLabel: '新建'
    });
    if (name == null) return;
    const clean = (name || '').trim() || '未命名.md';
    pushUndo();
    createDoc(clean, '# ' + clean.replace(/\.\w+$/i, '') + '\n\n');
    toast('已新建：' + clean, 'ok');
  });
  $('#btnCollapseSidebar').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
  });
  $('#fileInput').addEventListener('change', (e) => {
    if (e.target.files.length) importFiles(e.target.files);
    e.target.value = '';
  });

  // 侧栏：页签 / 多选 / 撤销 / 合并
  $$('.sidebar-tab').forEach((b) => b.addEventListener('click', () => switchSidebarTab(b.dataset.sidebarTab)));
  $('#btnMultiSelect').addEventListener('click', toggleMultiSelect);
  $('#btnUndo').addEventListener('click', undo);
  $('#btnMergeSelected').addEventListener('click', mergeSelected);
  $('#btnDeleteSelected').addEventListener('click', deleteSelected);
  $('#btnCancelMulti').addEventListener('click', exitMultiSelect);

  window.addEventListener('blur', () => { flushEditor(); save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flushEditor(); save(); } });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('beforeunload', () => { flushEditor(); save(); });

  // 全局快捷键
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); openFromDisk(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'f') { e.preventDefault(); openFind(false); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'h') { e.preventDefault(); openFind(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 's') { e.preventDefault(); saveFileAs(); return; }
    if ((e.ctrlKey || e.metaKey) && k === '\\') { e.preventDefault(); cycleView(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape') {
      if (!$('#findBar').hidden) { closeFind(); return; }
      if ($('#aiDrawer').classList.contains('open')) closeAi();
      else if (!$('#settingsModal').hidden) closeSettings();
    }
  });

  // 桌面版：显示「另存为」并调整按钮语义
  if (window.desktop) {
    $('#btnSaveAs').hidden = false;
    const saveLabel = $('#btnSave span');
    if (saveLabel) saveLabel.textContent = '保存';
  }
}

/* ===== WebDAV 同步 ===== */
const SYNC_TRASH = '.trash';

function syncEnabled() {
  return !!(window.desktop && window.desktop.webdav && state.cfg.sync && state.cfg.sync.enabled && state.cfg.sync.url);
}
function syncCfg() {
  return { url: state.cfg.sync.url, username: state.cfg.sync.username, password: state.cfg.sync.password || '' };
}
function sanitizeFilename(name) {
  let s = String(name || '未命名.md').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  if (!s) s = '未命名.md';
  if (!/\.(md|markdown|txt)$/i.test(s)) s += '.md';
  s = s.replace(/^\.+/, '');
  return s;
}
function wrapSyncContent(doc) {
  return '---\nvetro-id: ' + doc.id + '\nvetro-updated: ' + doc.updatedAt + '\n---\n' + (doc.content || '');
}
function unwrapSyncContent(text) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text || '');
  if (!m) return { id: null, updated: 0, content: text || '' };
  const idM = /vetro-id:\s*(\S+)/.exec(m[1]);
  const upM = /vetro-updated:\s*(\d+)/.exec(m[1]);
  return { id: idM ? idM[1] : null, updated: upM ? parseInt(upM[1], 10) : 0, content: (text || '').slice(m[0].length) };
}
function getSyncDocs() { return state.docs.filter((d) => d.sync !== false); }

async function encryptSecret(text) {
  if (!text) return '';
  if (window.desktop && window.desktop.secure) {
    try { const r = await window.desktop.secure.encrypt(text); if (r && r.ok) return r.data; } catch (e) {}
  }
  try { return 'b64:' + btoa(unescape(encodeURIComponent(text))); } catch (e) { return ''; }
}
async function decryptSecret(b64) {
  if (!b64) return '';
  if (b64.indexOf('b64:') === 0) {
    try { return decodeURIComponent(escape(atob(b64.slice(4)))); } catch (e) { return ''; }
  }
  if (window.desktop && window.desktop.secure) {
    try { const r = await window.desktop.secure.decrypt(b64); if (r && r.ok) return r.data; } catch (e) {}
  }
  return '';
}
async function restoreSyncPassword() {
  state.cfg.sync.password = await decryptSecret(state.cfg.sync.passwordEnc || '');
}
async function saveSyncConfig() {
  state.cfg.sync.url = ($('#syncUrl').value || '').trim();
  state.cfg.sync.username = ($('#syncUser').value || '').trim();
  state.cfg.sync.password = $('#syncPass').value;
  state.cfg.sync.passwordEnc = await encryptSecret(state.cfg.sync.password);
  save();
  updateSyncUI();
  renderDocList(true);
  toast('同步设置已保存', 'ok');
}

function setSyncStatus(st) {
  const el = $('#syncState');
  if (!el) return;
  const map = { ok: '已同步', syncing: '同步中…', err: '同步失败', off: '未开启同步' };
  el.textContent = map[st] || '';
  el.className = 'sync-state ' + (st || '');
}
function updateSyncUI() {
  setSyncStatus(syncEnabled() ? 'ok' : 'off');
}

async function testSyncConnection() {
  if (!syncEnabled()) { toast('请先填写并保存 WebDAV 配置', 'err'); return; }
  setSyncStatus('syncing');
  const r = await window.desktop.webdav.test(syncCfg());
  if (r && r.ok) { setSyncStatus('ok'); toast('WebDAV 连接成功', 'ok'); }
  else { setSyncStatus('err'); toast('WebDAV 连接失败：' + ((r && (r.error || ('HTTP ' + r.status))) || '未知错误'), 'err'); }
}

async function ensureSyncDir() {
  const r = await window.desktop.webdav.mkcol(syncCfg());
  return r && r.ok;
}

async function syncNow() {
  if (!syncEnabled()) { toast('请先启用并配置 WebDAV 同步', 'err'); return; }
  setSyncStatus('syncing');
  try {
    await ensureSyncDir();
    const lr = await window.desktop.webdav.list(syncCfg());
    if (!lr || !lr.ok) throw new Error(lr && lr.error ? lr.error : '读取远端目录失败');
    const remote = lr.files || [];
    const remoteByName = new Map(remote.map((f) => [f.name, f]));
    const syncDocs = getSyncDocs();
    const localByName = new Map(syncDocs.map((d) => [sanitizeFilename(d.name), d]));

    // 1) 推送本地新增 / 更新
    for (const d of syncDocs) {
      const fname = sanitizeFilename(d.name);
      const meta = state.syncMeta[fname];
      if (!remoteByName.has(fname) || !meta || d.updatedAt > (meta.updatedAt || 0)) {
        await window.desktop.webdav.put(syncCfg(), fname, wrapSyncContent(d));
        state.syncMeta[fname] = { id: d.id, updatedAt: d.updatedAt, remoteMtime: remoteByName.has(fname) ? remoteByName.get(fname).mtime : Date.now() };
      }
    }

    // 2) 拉取远端新增 / 更新（mtime 变化才 GET，比较 frontmatter 毫秒时间戳）
    for (const f of remote) {
      const meta = state.syncMeta[f.name];
      const d = localByName.get(f.name);
      const changed = !d || !meta || f.mtime !== meta.remoteMtime;
      if (!changed) continue;
      const g = await window.desktop.webdav.get(syncCfg(), f.name);
      if (!g || !g.ok) continue;
      const rdoc = unwrapSyncContent(g.content);
      if (!d) {
        const nd = { id: rdoc.id || uid(), name: f.name, content: rdoc.content, filePath: null, createdAt: Date.now(), updatedAt: rdoc.updated || Date.now(), sync: true };
        state.docs.unshift(nd);
        state.syncMeta[f.name] = { id: nd.id, updatedAt: nd.updatedAt, remoteMtime: f.mtime };
      } else if (rdoc.updated > d.updatedAt) {
        d.content = rdoc.content; d.updatedAt = rdoc.updated; d.sync = true;
        state.syncMeta[f.name] = { id: d.id, updatedAt: rdoc.updated, remoteMtime: f.mtime };
      } else {
        state.syncMeta[f.name] = { id: d.id, updatedAt: d.updatedAt, remoteMtime: f.mtime };
      }
    }

    // 3) 软删除：本地已删但远端还在 → 移入远端 .trash/
    const syncNames = new Set(syncDocs.map((d) => sanitizeFilename(d.name)));
    for (const fname of Object.keys(state.syncMeta)) {
      if (!syncNames.has(fname) && remoteByName.has(fname)) {
        await window.desktop.webdav.move(syncCfg(), fname, SYNC_TRASH + '/' + fname);
        delete state.syncMeta[fname];
      }
    }

    // 4) 远端被删但本地还在 → 重新推送
    for (const fname of Object.keys(state.syncMeta)) {
      if (!remoteByName.has(fname)) {
        const d = localByName.get(fname);
        if (d) {
          await window.desktop.webdav.put(syncCfg(), fname, wrapSyncContent(d));
          state.syncMeta[fname] = { id: d.id, updatedAt: d.updatedAt, remoteMtime: Date.now() };
        }
      }
    }

    await save();
    setSyncStatus('ok');
    toast('同步完成', 'ok');
  } catch (e) {
    setSyncStatus('err');
    toast('同步失败：' + e.message, 'err');
  }
}

function toggleDocSync(id) {
  const d = state.docs.find((x) => x.id === id);
  if (!d) return;
  d.sync = d.sync === false ? true : false;
  save();
  renderDocList();
}

/* ===== 回收站 ===== */
function restoreTrashDoc(id) {
  const idx = state.trash.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const doc = state.trash.splice(idx, 1)[0];
  delete doc.deletedAt;
  state.docs.unshift(doc);
  state.activeId = doc.id;
  save(); renderDocList(); renderEditor(); renderTrash();
  toast('已恢复「' + doc.name + '」');
}
async function purgeTrashDoc(id) {
  const idx = state.trash.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const ok = await confirmDialog({ title: '彻底删除', message: '彻底删除「' + state.trash[idx].name + '」？此操作不可恢复。', confirmLabel: '删除', danger: true });
  if (!ok) return;
  state.trash.splice(state.trash.findIndex((t) => t.id === id), 1);
  save(); renderTrash();
  toast('已彻底删除');
}
function renderTrash() {
  const list = $('#trashList');
  if (!list) return;
  if (!state.trash.length) {
    list.innerHTML = '<div class="doc-empty"><p>回收站为空</p><span>删除的文档会出现在这里，可恢复或彻底删除</span></div>';
    return;
  }
  list.innerHTML = '';
  state.trash.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'doc-item trash-item';
    item.innerHTML = `
      <div class="doc-ico">🗑</div>
      <div class="doc-meta">
        <div class="doc-name">${esc(d.name || '未命名')}</div>
        <div class="doc-sub">删除于 ${fmtTime(d.deletedAt)}</div>
      </div>
      <button class="btn ghost sm doc-restore">恢复</button>
      <button class="btn ghost sm doc-purge">彻底删除</button>`;
    item.querySelector('.doc-restore').addEventListener('click', () => restoreTrashDoc(d.id));
    item.querySelector('.doc-purge').addEventListener('click', () => purgeTrashDoc(d.id));
    list.appendChild(item);
  });
}

/* ===== 窗口控制 / 项目链接 / 更新检测 ===== */
function bindWindowControls() {
  if (!window.desktop || !window.desktop.win) return;
  $('#btnWinMin').addEventListener('click', () => window.desktop.win.minimize());
  $('#btnWinMax').addEventListener('click', () => window.desktop.win.maximize());
  $('#btnWinClose').addEventListener('click', () => window.desktop.win.close());
  if (window.desktop.win.onState) {
    window.desktop.win.onState((s) => {
      const btn = $('#btnWinMax');
      if (btn) btn.textContent = s && s.maximized ? '❐' : '□';
    });
  }
}
function bindProjectLink() {
  const a = $('#projectLink');
  if (a) a.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener,noreferrer');
  });
  const u = $('#updateHint');
  if (u) u.addEventListener('click', (e) => {
    e.preventDefault();
    if (u.dataset.url) window.open(u.dataset.url, '_blank', 'noopener,noreferrer');
  });
}
async function checkForUpdate() {
  if (!window.desktop || !window.desktop.checkUpdate) return;
  try {
    const r = await window.desktop.checkUpdate();
    if (r && r.ok && r.hasUpdate) {
      const u = $('#updateHint');
      if (u) {
        u.hidden = false;
        u.textContent = '有更新 ' + r.latest;
        u.dataset.url = r.url || 'https://github.com/qingzhuo-cn/vetro/releases';
      }
      toast('发现新版本 ' + r.latest + '，可前往 Releases 下载（不强制更新）', 'ok');
    }
  } catch (e) {}
}

/* ===== 启动 ===== */
async function boot() {
  await load();
  await restoreKey();
  await restoreSyncPassword();
  // 迁移旧版明文 API Key → 加密存储
  if (state.cfg.ai.key && !state.cfg.ai.keyEnc) {
    await persistKey();
    await save();
  }
  initMarked();
  applyTheme();
  applyFontSize();
  applyWrap();
  applyIcon();

  if (state.docs.length === 0) {
    const welcome = `# 欢迎使用 Vetro ✨

一款**玻璃态 Markdown 编辑器**，拖拽导入即可开始。

## 核心能力

- 📥 **批量导入** —— 拖入多个 .md / .txt 文件，自动拆分为独立文档，可随时合并 / 撤销
- ✏️ **实时预览** —— 左侧编辑、右侧所见即所得，代码高亮
- 🗂️ **文档大纲** —— 侧边栏「大纲」页签，点击标题快速跳转
- 🔍 **查找替换** —— Ctrl+F 查找、Ctrl+H 替换
- 🖼️ **图片粘贴** —— 截图后 Ctrl+V 直接插入
- 🤖 **AI 助手** —— 接入任意 OpenAI 兼容 API，流式输出，改写 / 润色 / 续写 / 翻译
- 💾 **本地持久化** —— 数据存于 IndexedDB，API Key 系统级加密

## 快捷操作

| 操作 | 方式 |
|---|---|
| 打开 | Ctrl/⌘+O |
| 保存到磁盘 | Ctrl/⌘+S |
| 查找 | Ctrl/⌘+F |
| 替换 | Ctrl/⌘+H |
| 撤销文档操作 | Ctrl/⌘+Shift+Z |
| 重命名 | 双击左侧文档名 |
| 批量合并 | 侧边栏「多选」→ 勾选 → 合并 |

开始写点什么吧……
`;
    createDoc('欢迎.md', welcome);
  } else {
    renderDocList();
    renderEditor();
  }

  bindTopbar();
  bindEditor();
  bindFind();
  bindPaste();
  bindPreview();
  bindDragDrop();
  bindSettings();
  bindAi();
  bindPwa();
  bindWindowControls();
  bindProjectLink();
  updateRunBtnLabel();
  applyAiStatus();
  updateUndoBtn();
  switchSidebarTab('docs');
  updateSyncUI();

  // 浏览器 / 云端版：提示 AI 的密钥安全与 CORS 限制
  if (!window.desktop) { const w = $('#aiCloudWarn'); if (w) w.hidden = false; }

  // 启动后自动同步一次
  if (syncEnabled()) setTimeout(() => syncNow(), 1500);
  // 启动后检查更新（桌面版，不强制）
  setTimeout(() => checkForUpdate(), 3000);

  if (window.innerWidth < 900) $('#sidebar').classList.add('collapsed');
}

document.addEventListener('DOMContentLoaded', boot);
