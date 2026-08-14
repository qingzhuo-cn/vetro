/* Vetro 桌面版 · Electron 主进程
   提供磁盘文件读写 + 系统级密钥加密 + WebDAV 文档同步（无原生菜单栏）。 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';

/* 最近打开的文件（会话内） */
let lastDir = app.getPath('documents');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    title: 'Vetro',
    icon: path.join(__dirname, 'assets', 'icon-512.png'),
    backgroundColor: '#07090d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');

  // 外部链接用系统浏览器打开（预览里的 a 标签）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 右键菜单（复制 / 剪切 / 粘贴 / 全选），替代被移除的顶部菜单栏
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push({ role: 'cut', label: '剪切' });
      items.push({ role: 'copy', label: '复制' });
      items.push({ role: 'paste', label: '粘贴' });
    } else if (params.selectionText && params.selectionText.trim()) {
      items.push({ role: 'copy', label: '复制' });
    }
    if (params.isEditable || (params.selectionText && params.selectionText.trim())) {
      items.push({ role: 'selectAll', label: '全选' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  return win;
}

/* ===== 文件对话框 IPC ===== */

// 打开一个或多个 .md 文件
ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开 Markdown 文档',
    defaultPath: lastDir,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt', 'mdown'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  lastDir = path.dirname(r.filePaths[0]);
  const files = r.filePaths.map((p) => {
    let content = '';
    try { content = fs.readFileSync(p, 'utf-8'); } catch (e) { content = ''; }
    return { path: p, name: path.basename(p), content };
  });
  return { canceled: false, files };
});

// 保存：有原路径则直接写回，否则弹另存为
ipcMain.handle('save-file', async (_e, { content, filePath, name }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog({
      title: '保存 Markdown 文档',
      defaultPath: path.join(lastDir, name || '未命名.md'),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    target = r.filePath;
  }
  try {
    fs.writeFileSync(target, content, 'utf-8');
    lastDir = path.dirname(target);
    return { canceled: false, filePath: target, name: path.basename(target) };
  } catch (e) {
    return { canceled: true, error: e.message };
  }
});

// 另存为
ipcMain.handle('save-file-as', async (_e, { content, name }) => {
  const r = await dialog.showSaveDialog({
    title: '另存为',
    defaultPath: path.join(lastDir, name || '未命名.md'),
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    fs.writeFileSync(r.filePath, content, 'utf-8');
    lastDir = path.dirname(r.filePath);
    return { canceled: false, filePath: r.filePath, name: path.basename(r.filePath) };
  } catch (e) {
    return { canceled: true, error: e.message };
  }
});

/* ===== 密钥安全存储 =====
   safeStorage 使用操作系统级加密。 */
ipcMain.handle('safe-encrypt', (_e, text) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false };
    return { ok: true, data: safeStorage.encryptString(String(text)).toString('base64') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('safe-decrypt', (_e, b64) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false };
    return { ok: true, data: safeStorage.decryptString(Buffer.from(String(b64), 'base64')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ===== AI 模型列表（走主进程 fetch，规避浏览器 CORS 限制） ===== */
ipcMain.handle('ai-models', async (_e, { endpoint, key }) => {
  try {
    const url = String(endpoint || '').replace(/\/+$/, '') + '/models';
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + String(key || '') } });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) {}
      return { ok: false, error: msg };
    }
    const data = await res.json();
    const models = (data && Array.isArray(data.data) ? data.data : []).map((m) => m && m.id).filter(Boolean).sort();
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ===== WebDAV 客户端（无依赖，基于 Node 内置 fetch） ===== */

function basicAuth(user, pass) {
  return 'Basic ' + Buffer.from((user || '') + ':' + (pass || '')).toString('base64');
}
function decodeXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function decodePath(seg) {
  try { return decodeURIComponent(seg); } catch (e) { return seg; }
}
function joinUrl(base, name) {
  return String(base).replace(/\/+$/, '') + '/' + encodeURIComponent(name);
}

async function webdavRequest(method, url, opts) {
  const o = opts || {};
  const h = Object.assign({}, o.headers);
  if (o.user || o.pass) h.Authorization = basicAuth(o.user, o.pass);
  if (o.depth != null) h.Depth = String(o.depth);
  if (o.body !== undefined && h['Content-Type'] === undefined) h['Content-Type'] = 'text/plain; charset=utf-8';
  const res = await fetch(url, { method, headers: h, body: o.body });
  const text = await res.text();
  return { status: res.status, ok: res.ok, statusText: res.statusText, text };
}

function extractXml(block, tagName) {
  const re = new RegExp('<(?:[^>]*?:)?' + tagName + '[^>]*>([\\s\\S]*?)<\\/(?:[^>]*?:)?' + tagName + '>', 'i');
  const m = re.exec(block);
  return m ? m[1] : null;
}

function parsePropfind(xml) {
  const out = [];
  const respRe = /<(?:[^>]*?:)?response[^>]*>([\s\S]*?)<\/(?:[^>]*?:)?response>/gi;
  let m;
  while ((m = respRe.exec(xml))) {
    const block = m[1];
    const href = extractXml(block, 'href');
    if (!href) continue;
    const lm = extractXml(block, 'getlastmodified');
    const cl = extractXml(block, 'getcontentlength');
    const isDir = /collection\s*\/?>/i.test(block);
    let name = decodePath(decodeXml(href.trim())).replace(/\/+$/, '');
    const idx = name.lastIndexOf('/');
    name = idx >= 0 ? name.slice(idx + 1) : name;
    if (!name) continue;
    out.push({
      name,
      mtime: lm ? new Date(lm.trim()).getTime() : 0,
      size: cl ? (parseInt(cl.trim(), 10) || 0) : 0,
      isDir
    });
  }
  return out;
}

/* ===== WebDAV IPC ===== */

ipcMain.handle('webdav-test', async (_e, cfg) => {
  try {
    const r = await webdavRequest('PROPFIND', cfg.url, { user: cfg.username, pass: cfg.password, depth: '0' });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('webdav-list', async (_e, cfg) => {
  try {
    const r = await webdavRequest('PROPFIND', cfg.url, { user: cfg.username, pass: cfg.password, depth: '1' });
    if (r.status >= 400) return { ok: false, error: 'HTTP ' + r.status + ' ' + r.statusText };
    return { ok: true, files: parsePropfind(r.text).filter((f) => !f.isDir) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('webdav-get', async (_e, cfg, name) => {
  try {
    const r = await webdavRequest('GET', joinUrl(cfg.url, name), { user: cfg.username, pass: cfg.password });
    if (r.status >= 400) return { ok: false, error: 'HTTP ' + r.status };
    return { ok: true, content: r.text };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('webdav-put', async (_e, cfg, name, content) => {
  try {
    const r = await webdavRequest('PUT', joinUrl(cfg.url, name), { user: cfg.username, pass: cfg.password, body: String(content || '') });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('webdav-delete', async (_e, cfg, name) => {
  try {
    const r = await webdavRequest('DELETE', joinUrl(cfg.url, name), { user: cfg.username, pass: cfg.password });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('webdav-mkcol', async (_e, cfg) => {
  try {
    const r = await webdavRequest('MKCOL', cfg.url, { user: cfg.username, pass: cfg.password });
    return { ok: r.status === 201 || r.status === 405 || (r.status >= 200 && r.status < 300), status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('webdav-move', async (_e, cfg, from, to) => {
  try {
    const r = await webdavRequest('MOVE', joinUrl(cfg.url, from), {
      user: cfg.username,
      pass: cfg.password,
      headers: { Destination: joinUrl(cfg.url, to), Overwrite: 'T' }
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* ===== 生命周期 ===== */
app.whenReady().then(() => {
  // Windows / Linux：去掉原生「文件 编辑 视图 帮助」菜单栏；macOS 保留系统菜单（系统集成需要）
  if (!isMac) Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
