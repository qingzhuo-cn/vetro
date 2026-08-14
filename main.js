/* Vetro 桌面版 · Electron 主进程
   提供磁盘文件读写 + 系统级密钥加密；无原生菜单栏，右键菜单保留复制/粘贴。 */
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
   safeStorage 使用操作系统级加密：Windows DPAPI / macOS Keychain / Linux libsecret。 */
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
