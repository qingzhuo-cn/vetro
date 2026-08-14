/* Vetro 桌面版 · preload 桥接
   通过 contextBridge 暴露安全的磁盘文件读写 + 密钥加密 + WebDAV 同步 API。 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  /* 打开文件对话框 → { canceled, files:[{path,name,content}] } */
  openFile: () => ipcRenderer.invoke('open-file'),

  /* 保存 → { canceled, filePath, name, error? } */
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),

  /* 另存为 → { canceled, filePath, name, error? } */
  saveFileAs: (payload) => ipcRenderer.invoke('save-file-as', payload),

  /* 密钥加解密：桌面版走系统级 safeStorage */
  secure: {
    encrypt: (text) => ipcRenderer.invoke('safe-encrypt', text),
    decrypt: (b64) => ipcRenderer.invoke('safe-decrypt', b64)
  },

  /* 获取 AI 模型列表（走主进程，规避浏览器 CORS 限制） */
  aiModels: (payload) => ipcRenderer.invoke('ai-models', payload),

  /* WebDAV 同步 */
  webdav: {
    test: (cfg) => ipcRenderer.invoke('webdav-test', cfg),
    list: (cfg) => ipcRenderer.invoke('webdav-list', cfg),
    get: (cfg, name) => ipcRenderer.invoke('webdav-get', cfg, name),
    put: (cfg, name, content) => ipcRenderer.invoke('webdav-put', cfg, name, content),
    del: (cfg, name) => ipcRenderer.invoke('webdav-delete', cfg, name),
    mkcol: (cfg) => ipcRenderer.invoke('webdav-mkcol', cfg),
    move: (cfg, from, to) => ipcRenderer.invoke('webdav-move', cfg, from, to)
  }
});
