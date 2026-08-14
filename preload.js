/* Vetro 桌面版 · preload 桥接
   通过 contextBridge 暴露安全的磁盘文件读写 + 系统级密钥加密 API 给渲染进程。 */
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

  /* 密钥加解密：桌面版走系统级 safeStorage（Windows DPAPI / macOS Keychain） */
  secure: {
    encrypt: (text) => ipcRenderer.invoke('safe-encrypt', text),
    decrypt: (b64) => ipcRenderer.invoke('safe-decrypt', b64)
  }
});
