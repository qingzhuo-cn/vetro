# Vetro · 玻璃拟态 Markdown 编辑器

一个漂亮的本地 Markdown 编辑器：**Tauri 2 + React + TypeScript** 构建，无边框玻璃拟态界面，支持文档树、AI 助手、全文搜索与 WebDAV 同步。

> 从 Electron 全面重写为 Tauri 2 —— 单进程、安装包更小（约 10 MB 级）、启动更快、内存占用更低。

## ✨ 功能

- **文档树**：主文档 / 子文档多级嵌套，一键收起展开
- **Markdown 实时预览**：分栏 / 编辑 / 预览三种视图，marked + highlight.js 语法高亮 + DOMPurify 安全过滤
- **主题定制**：8 种强调色 + 4 种图标 + 字号调节，浅色 / 深色 / 跟随系统
- **AI 助手**：兼容 OpenAI / DeepSeek 等接口，获取模型、**流式对话**，API 密钥存入系统钥匙串（Windows DPAPI / macOS Keychain）
- **全文搜索**：SQLite FTS5 索引，顶栏 🔍 秒搜所有文档正文
- **WebDAV 同步**：一键上传 / 下载，支持任意 WebDAV 服务器（Nextcloud、坚果云等）
- **查找替换**：`Ctrl+F`，CodeMirror 原生搜索面板
- **大纲导航**：侧栏大纲，点击跳到对应标题
- **图片粘贴**：直接粘贴剪贴板图片，自动转 Base64 插入
- **回收站**：误删可恢复
- **导出**：主文档自动合并其子文档内容，一键导出为单个 Markdown
- **无边框窗口**：自定义标题栏，拖拽 / 最小化 / 最大化 / 关闭
- **插件系统**：命令 / 渲染器 / 编辑器扩展 / 面板 / AI Provider / 同步后端等扩展点

## 🛠 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | [Tauri 2](https://tauri.app)（Rust） |
| 前端 | React 19 + TypeScript + Vite |
| 编辑器 | CodeMirror 6 |
| 状态 | Zustand |
| 存储 | SQLite（rusqlite + FTS5） |
| 渲染 | marked + highlight.js + DOMPurify |
| 密钥 | keyring（DPAPI / Keychain / libsecret） |
| 网络 | reqwest（HTTP 代理，绕过 CORS） |

## 📥 下载

前往 [GitHub Releases](https://github.com/qingzhuo-cn/vetro/releases) 下载最新安装包：

- `Vetro-x.x.x_x64-setup.exe` — Windows 安装程序（推荐）
- `Vetro-x.x.x_x64_en-US.msi` — Windows MSI

## 🔨 从源码构建

**环境要求**

- [Node.js](https://nodejs.org) ≥ 18
- [Rust](https://rustup.rs)（stable，MSVC 工具链）
- Windows：Visual Studio 2022 **Build Tools**（勾选「使用 C++ 的桌面开发」），并安装 Windows SDK

**步骤**

```bash
npm install                # 安装前端依赖
npm run tauri dev          # 开发模式（热更新）
npm run tauri build        # 打包（产物在 src-tauri/target/release/bundle/）
```

> 在 Windows 上若 `cargo` 提示找不到 `link.exe`，请先在一个已加载 MSVC 环境的终端（如 Developer PowerShell）里构建，或运行：
> ```bat
> call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
> ```

## 🔌 插件系统（实验性）

Vetro 内置插件扩展点，插件可注册：

- **命令**：出现在顶部 ⌘ 命令菜单
- **渲染钩子**：Markdown 渲染前 / 后处理（`before` / `after`）
- **编辑器扩展**：向 CodeMirror 注入 `Extension`
- **面板 / AI Provider / 同步后端**：预留扩展点

示例见 `src/demo-plugin.ts`。

## 📄 License

[MIT](LICENSE)
