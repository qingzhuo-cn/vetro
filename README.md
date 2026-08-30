<div align="center">

<img src="assets/icon-512.png" width="120" alt="Vetro Logo">

# 🥃 Vetro

**玻璃拟态 Markdown 编辑器 · Tauri 2 桌面应用**

透明 · 轻盈 · 流光

[![version](https://img.shields.io/badge/version-v2.6.0-4ecdc4?style=for-the-badge&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![tauri](https://img.shields.io/badge/Tauri-2-7c9eff?style=for-the-badge&labelColor=0d1117)](https://tauri.app)
[![platform](https://img.shields.io/badge/platform-Windows-818cf8?style=for-the-badge&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![license](https://img.shields.io/badge/license-MIT-34d399?style=for-the-badge&labelColor=0d1117)](LICENSE)

从 Electron 全面重写为 **Tauri 2** —— 单进程、安装包更小、启动更快、内存占用更低。

**⬇ [下载最新版](https://github.com/qingzhuo-cn/vetro/releases/latest)**
`Vetro-x.x.x_x64-setup.exe`（Windows） · `.msi` · Linux `.deb` / `.AppImage`

```bash
# 从源码 3 步跑起来
npm install && npm run tauri dev
```

</div>

---

## 📸 截图

<!-- 在此插入应用截图（建议 1280×800，2–3 张：主界面 · 实时预览 · AI 助手）。
     例如：<img src="assets/screenshots/main.png" width="720" alt="Vetro 主界面"> -->
主界面 · 实时预览 · AI 助手

---

## ✨ 功能亮点

<div align="center">

| 📚 文档树 | ✍️ Markdown 实时预览 | 🤖 AI 助手 |
|:---:|:---:|:---:|
| 主 / 子文档多级嵌套 | 分栏 / 编辑 / 预览三视图 | 获取模型 + 流式对话 |
| 一键收起展开、拖拽整理 | 语法高亮 + 安全过滤 | 密钥存系统钥匙串 |

| 🔍 全文搜索 | ☁️ WebDAV 同步 | 🎨 主题定制 |
|:---:|:---:|:---:|
| SQLite FTS5 秒搜正文 | 一键上传 / 下载 | 8 色强调 + 4 图标 |
| 匹配高亮片段预览 | 兼容 Nextcloud 等 | 浅色 / 深色 / 自动 |

| ⌨️ 查找替换 | 🗂 大纲导航 | 📦 回收站 |
|:---:|:---:|:---:|
| Ctrl+F 原生搜索面板 | 点击跳到对应标题 | 误删可恢复 |

</div>

更多：图片粘贴 · 导出合并子文档 · 无边框自定义标题栏 · 插件系统

---

## 🛠 技术栈

<div align="center">

![Tauri 2](https://img.shields.io/badge/Desktop-Tauri%202-4ecdc4?style=flat-square)
![React](https://img.shields.io/badge/UI-React%2019-7c9eff?style=flat-square)
![TypeScript](https://img.shields.io/badge/Lang-TypeScript-818cf8?style=flat-square)
![Vite](https://img.shields.io/badge/Build-Vite-38bdf8?style=flat-square)
![CodeMirror](https://img.shields.io/badge/Editor-CodeMirror%206-34d399?style=flat-square)
![Zustand](https://img.shields.io/badge/State-Zustand-a78bfa?style=flat-square)
![SQLite](https://img.shields.io/badge/Store-SQLite%20FTS5-fbbf24?style=flat-square)

</div>

| 模块 | 方案 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust）· 无边框窗口 |
| 前端 | React 19 + TypeScript + Vite |
| 编辑器 | CodeMirror 6 |
| 状态管理 | Zustand |
| 本地存储 | SQLite（rusqlite）+ FTS5 全文索引 |
| 渲染 | marked + highlight.js + DOMPurify |
| 密钥安全 | keyring（Windows DPAPI / macOS Keychain） |
| 网络 | reqwest（HTTP 代理，绕过 CORS） |

---

## 📥 下载安装

<div align="center">

[![Download](https://img.shields.io/badge/⬇-下载最新版-4ecdc4?style=for-the-badge)](https://github.com/qingzhuo-cn/vetro/releases/latest)

`Vetro-x.x.x_x64-setup.exe`（Windows 推荐） · `Vetro-x.x.x_x64_en-US.msi`

Linux：`vetro_x.x.x_amd64.deb`（Debian/Ubuntu） · `Vetro_x.x.x_x86_64.AppImage`

> Linux 包由 GitHub Actions 自动构建（见 [build-linux.yml](.github/workflows/build-linux.yml)）。鸿蒙版方案见 [HARMONYOS-PORT.md](HARMONYOS-PORT.md)。

</div>

---

## 🔨 从源码构建

**环境要求**

- [Node.js](https://nodejs.org) ≥ 18
- [Rust](https://rustup.rs)（stable）
- Windows：Visual Studio 2022 **Build Tools**（勾选「使用 C++ 的桌面开发」）+ Windows SDK
- Linux（Debian/Ubuntu）：WebKitGTK 等系统依赖
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式（热更新）
npm run tauri build  # 打包（产物在 src-tauri/target/release/bundle/）
```

> Windows 上若 `cargo` 提示找不到 `link.exe`，请先加载 MSVC 环境：
> ```bat
> call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
> ```

---

## 🔌 插件系统（实验性）

插件可注册 **命令**、**渲染钩子**、**编辑器扩展**、**面板 / AI Provider / 同步后端** 等扩展点。
示例见 [`src/demo-plugin.ts`](src/demo-plugin.ts)。

---

<div align="center">

📄 **License**: [MIT](LICENSE) · © 2026 qingzhuo-cn

</div>
