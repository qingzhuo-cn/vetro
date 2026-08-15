Vetro v2.1.0 — SQLite 存储 + 全文搜索 + AI 流式

从 Electron 重写为 **Tauri 2**（单进程、体积更小、启动更快）。

技术栈：Tauri 2 + React 19 + TypeScript + Vite + CodeMirror 6 + Zustand + SQLite(FTS5)

功能：
- 文档树（主文档 / 子文档，多级嵌套）
- Markdown 实时预览（marked + highlight.js + DOMPurify）
- 8 种强调色 + 4 种图标 + 字号调节（浅色/深色/自动）
- AI 助手：获取模型 + 流式对话，API 密钥存入系统钥匙串（DPAPI/Keychain）
- SQLite 本地存储 + FTS5 全文搜索（顶栏 🔍）
- WebDAV 同步（上传 / 下载）
- 查找替换（Ctrl+F）、大纲导航、图片粘贴
- 回收站、导出（合并子文档为主文档）
- 无边框窗口 + 自定义标题栏
- 内置插件系统（命令 / 渲染器 / 编辑器扩展 / 面板 / AI Provider / 同步后端等扩展点）
