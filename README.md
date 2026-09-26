<div align="center">

<img src="assets/icon-512.png" width="120" alt="Vetro Logo">

# 🥃 Vetro

**果冻质感的 Markdown 编辑器 · Tauri 2 桌面应用**

每一次点击都回弹，每一次切换都流动

[![version](https://img.shields.io/badge/version-v2.9.3-4ecdc4?style=for-the-badge&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![tauri](https://img.shields.io/badge/Tauri-2-7c9eff?style=for-the-badge&labelColor=0d1117)](https://tauri.app)
[![platform](https://img.shields.io/badge/platform-Windows-818cf8?style=for-the-badge&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![license](https://img.shields.io/badge/license-MIT-34d399?style=for-the-badge&labelColor=0d1117)](LICENSE)

从 Electron 全面重写为 **Tauri 2** —— 单进程、安装包更小、启动更快、内存占用更低。

**⬇ [下载最新版](https://github.com/qingzhuo-cn/vetro/releases/latest)**

```bash
# 从源码 3 步跑起来
npm install && npm run tauri dev
```

</div>

---

## 🫧 果冻化交互

不是贴一张毛玻璃滤镜了事 —— 每个元素都有自己的物理反馈：

| 反馈 | 实现 |
| --- | --- |
| 按下回弹 | 挤压动画走 `cubic-bezier(.36,0,.66,-.56)`，横纵缩放分离，模拟果冻形变 |
| 点击涟漪 | 从按压点扩散的水波反馈 |
| 列表入场 | 逐条错峰浮起，间隔递增而非齐刷刷 |
| 悬停浮起 | 按钮整体上浮 2px，与形变动画分轨并行不打架 |
| 通知悬停 | Toast 进度条悬停即暂停，移开继续走完 |
| 保存反馈 | 保存中状态呼吸式明灭，完成即静止 |

> 悬停位移**只做纵向**：列表容器的 `overflow-y: auto` 会连带把 `overflow-x` 计算成 `auto`，横向位移会裁掉行尾的删除按钮。

---

## ✨ 功能亮点

<div align="center">

| 📚 文档树 | 🔗 双向链接 | 🏷 标签体系 |
|:---:|:---:|:---:|
| 主 / 子文档多级嵌套 | `[[Wiki 链接]]` 语法高亮 | 任意打标签 |
| 拖拽整理、一键收展 | 预览中点击直达目标文档 | 按标签筛选文档 |
| 收藏 ★、单独同步开关 | —— | 标签侧栏集中管理 |

| 🗂 大纲 | 📎 附件 | 🗑 回收站 |
|:---:|:---:|:---:|
| 按 H1–H6 分级缩进 | 图片集中管理 | 误删可恢复 |
| 点击跳到对应标题 | 缩略图 / 体积一览 | 支持彻底删除 |

| 🤖 AI 助手 | ☁️ WebDAV 同步 | 🎨 主题定制 |
|:---:|:---:|:---:|
| 8 个一键快捷操作 | 智能合并（按修改时间） | **9 套液光主题** |
| 多平台切换、获取模型 | 测试连接 / 仅上传 / 云端覆盖 | 8 色强调 + 4 图标 |
| 流式回复、可取消 | 修改后自动同步 | 6 种正文字体 |

</div>

更多：图片粘贴 · 导出合并子文档 · 专注模式 · 三视图分栏 · SQLite FTS5 全文搜索 · 无边框标题栏 · 插件系统

---

## 🤖 AI 快捷操作

选中文字或整篇文档，一键执行：

`润色` `续写` `摘要` `英译` `中译` `拟标题` `修正` `解释`

任何 **OpenAI 兼容接口**均可接入 —— 中转站、自建网关、本地服务都行。内置平台预设，可保存多套配置随时切换，流式回复随时取消，回复可一键应用到文档。密钥存系统钥匙串，不落盘。

---

## 🎨 九套液光主题

<center>

| 暗夜 | 晨曦 | 深海 |
|:---:|:---:|:---:|
| 樱雪 | 极光 | 拿铁 |
| 荔枝 | 薄荷 | 葡萄 |

</center>

每套主题独立配置**液光氛围色**与**玻璃边缘透光高光** —— 果冻的通透感正来自边缘透光带色，而非整体染色，所以顶栏、侧栏、AI 面板等所有玻璃表面都会随主题一起变色，而不是只有背景在动。

---

## 🛡 安全

- 文件读写限定在应用数据目录内，且校验扩展名
- 出站请求拒绝环回地址
- 响应体上限 16 MB
- Markdown 渲染经 DOMPurify 净化
- AI 密钥存系统钥匙串（Windows DPAPI / macOS Keychain）

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

## 📥 下载

<div align="center">

[![Download](https://img.shields.io/badge/⬇-下载最新版-4ecdc4?style=for-the-badge)](https://github.com/qingzhuo-cn/vetro/releases/latest)

`Vetro-x.x.x_x64-setup.exe` · `Vetro-x.x.x_x64_en-US.msi`

Linux：`vetro_x.x.x_amd64.deb` · `Vetro_x.x.x_x86_64.AppImage`

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
