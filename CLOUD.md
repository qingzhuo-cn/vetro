# Vetro 云端 / 部署与同步说明

> 更新于 v2.x：Vetro 已从 Electron 全面重写为 **Tauri 2** 桌面应用，本文档说明桌面版的同步方案，以及「云端 / Web 版」的定位与限制。

## 桌面版（Tauri 2）

- 平台：Windows（`setup.exe` / `msi`）。
- 本地存储：**SQLite（rusqlite + FTS5）**，数据库位于 `%APPDATA%\com.qingzhuo.vetro\vetro.db`。
- 文档同步：**WebDAV 已内置**（设置面板「WebDAV 同步」，上传 / 下载），详见 `WEBDAV-SYNC-DESIGN.md`。
- AI 密钥：存系统钥匙串（Windows DPAPI），明文不落盘。
- AI / 同步请求统一走 Rust `reqwest` 代理（`http_request` 命令），无 CORS 问题。

## 云端 / Web 版（可选）

Tauri 是原生桌面壳，不能直接部署到静态平台；但**前端（React + Vite）本身可在浏览器运行**（内置浏览器回退模式），因此理论上可将前端构建后部署到 Cloudflare Pages / Netlify / Vercel。注意浏览器版的能力限制：

- **无系统钥匙串**：AI 密钥仅做混淆存储（没有桌面版的 DPAPI / Keychain）。
- **无本地文件能力**：文件读写 / 保存对话框不可用。
- **AI 受 CORS 限制**：浏览器回退直接用 `fetch`，多数 OpenAI 兼容接口因跨域无法直连。
- **无 SQLite**：浏览器版回退到 localStorage，且无 FTS5 全文搜索。

浏览器版文档同步的设计（Cloudflare Pages Functions + D1）见 `SYNC-DESIGN.md`（草案，未实现）。

## 安全

- 预览 HTML 已用 DOMPurify 净化（防 XSS）。
- WebDAV 全链路 HTTPS；桌面版 AI 密钥 DPAPI 加密。
