<div align="center">

<img src="assets/icon-512.png" width="120" alt="Vetro Logo">

# 🥃 Vetro

**果冻质感的 Markdown 编辑器 · Tauri 2 桌面应用**
**Jelly-textured Markdown editor · Tauri 2 desktop app**

每一次点击都回弹，每一次切换都流动
Every click bounces back, every switch flows

[![version](https://img.shields.io/badge/version-v2.10.0-4ecdc4?style=for-the-badge&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![tauri](https://img.shields.io/badge/Tauri-2-7c9eff?style=for-the-badge&labelColor=0d1117)](https://tauri.app)
[![platform](https://img.shields.io/badge/platform-Windows-818cf8?style=for-the-badge&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![license](https://img.shields.io/badge/license-MIT-34d399?style=for-the-badge&labelColor=0d1117)](LICENSE)

[🇨🇳 中文](#zh) | [🇬🇧 English](#en)

从 Electron 全面重写为 **Tauri 2** —— 单进程、安装包更小、启动更快、内存占用更低。
Fully rewritten from Electron to **Tauri 2** — single process, smaller installer, faster startup, lower memory footprint.

**⬇ [下载最新版](https://github.com/qingzhuo-cn/vetro/releases/latest) / [Download latest](https://github.com/qingzhuo-cn/vetro/releases/latest)**

```bash
# 从源码 3 步跑起来 / Run from source in 3 steps
npm install && npm run tauri dev
```

</div>

---

<div id="zh"></div>

## 🇨🇳 中文

### 🫧 果冻化交互

不是贴一张毛玻璃滤镜了事 —— 每个元素都有自己的物理反馈：

| 反馈 | 实现 |
| --- | --- |
| 按下回弹 | 挤压动画走 `cubic-bezier(.36,0,.66,-.56)`，横纵缩放分离，模拟果冻形变 |
| 点击涟漪 | 从按压点扩散的水波反馈 |
| 列表入场 | 逐条错峰浮起，间隔递增而非齐刷刷 |
| 悬停浮起 | 按钮整体上浮 2px，与形变动画分轨并行不打架 |
| 鼠标反光 | 高光中心跟随光标在按键内的位置，边缘带一层冷光 |
| 通知悬停 | Toast 进度条悬停即暂停，移开继续走完 |
| 保存反馈 | 保存中状态呼吸式明灭，完成即静止 |

> 悬停位移**只做纵向**：列表容器的 `overflow-y: auto` 会连带把 `overflow-x` 计算成 `auto`，横向位移会裁掉行尾的删除按钮。
>
> 特效可在「设置 → 外观模式 → ✦ 特效」随时开关，关闭后只保留基础悬停。另支持键盘聚焦反光与 `prefers-reduced-motion` 自动降级。

### 🪟 透明液态玻璃 + 背景双模式

- Tauri 桌面端为真透明窗口（`transparent: true` + 系统阴影），无边框圆角裁剪。
- **背景双模式**（单个安装包内置切换，设置 → 外观模式 → 背景）：
  - `◑ 不透明`（默认）：常规深色渐变背景，桌面不透；
  - `◐ 透明`：桌面 / 壁纸从窗口透过来，面板自动换用低透明度玻璃材质与薄雾氛围层。
- 浏览器 / H5 壳保持原渐变背景，不受影响。

### ✨ 功能亮点

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

> 插件系统此前对外宣称 6 个扩展点，实际只有 3 个真正接通，另 3 个是无人读取的空壳注册表。已砍掉空壳、补齐真实能力（错误隔离、启停 UI、插件可用的编辑器 API），详见下文插件系统章节。

### 🤖 AI 快捷操作

选中文字或整篇文档，一键执行：

`润色` `续写` `摘要` `英译` `中译` `拟标题` `修正` `解释`

任何 **OpenAI 兼容接口**均可接入 —— 中转站、自建网关、本地服务都行。内置平台预设，可保存多套配置随时切换，流式回复随时取消，回复可一键应用到文档。密钥存系统钥匙串，不落盘。

### 🎨 九套液光主题

<center>

| 暗夜 | 晨曦 | 深海 |
|:---:|:---:|:---:|
| 樱雪 | 极光 | 拿铁 |
| 荔枝 | 薄荷 | 葡萄 |

</center>

每套主题独立配置**液光氛围色**与**玻璃边缘透光高光** —— 果冻的通透感正来自边缘透光带色，而非整体染色，所以顶栏、侧栏、AI 面板等所有玻璃表面都会随主题一起变色，而不是只有背景在动。

### 🛡 安全

- 文件读写限定在应用数据目录内，且校验扩展名
- 出站请求拒绝环回地址
- 响应体上限 16 MB
- Markdown 渲染经 DOMPurify 净化
- AI 密钥存系统钥匙串（Windows DPAPI / macOS Keychain）

### 🛠 技术栈

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

### 📥 下载

<div align="center">

[![Download](https://img.shields.io/badge/⬇-下载最新版-4ecdc4?style=for-the-badge)](https://github.com/qingzhuo-cn/vetro/releases/latest)

`Vetro-x.x.x_x64-setup.exe` · `Vetro-x.x.x_x64_en-US.msi`

Linux：`vetro_x.x.x_amd64.deb` · `Vetro_x.x.x_x86_64.AppImage`

> Linux 包由 GitHub Actions 自动构建（见 [build-linux.yml](.github/workflows/build-linux.yml)）。鸿蒙版方案见 [HARMONYOS-PORT.md](HARMONYOS-PORT.md)。

</div>

### 🔨 从源码构建

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

### 🔌 插件系统（实验性）

插件以独立文件放入 [`src/plugins/`](src/plugins/)，由 Vite 在**构建期静态收录** —— 导出 `default` 插件对象即可，无需改动主程序。新增插件需重新构建，**不是运行时热加载**：Tauri 打包环境下动态执行外部 JS 涉及 CSP 与代码执行安全，本项目不做。

三个已接线的扩展点：

| 扩展点 | 能力 |
| --- | --- |
| `ctx.commands` | 命令，出现在顶栏 `⌘` 面板 |
| `ctx.renderers` | 渲染钩子，介入 Markdown → HTML 管线 |
| `ctx.editors` | CodeMirror 6 扩展（装饰、按键映射等） |

`ctx.api` 提供宿主能力：`toast` / `insertText` / `getActiveDoc` / `setContent` / `replaceAll` / `log`。

```ts
import type { VetroPlugin } from '../plugins';

export const myPlugin: VetroPlugin = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  activate(ctx) {
    ctx.commands.register({
      id: 'my.hello',
      title: '打个招呼',
      run: () => ctx.api.insertText('你好，Vetro')
    });
  }
};
```

设置面板内可**即时启停**插件，无需重启。单个插件激活失败会被隔离并标记，不影响其余插件；失败时已注册的项会被完整回收，不会留下半激活残留。

> 早期版本还声明过 Panel / AiProvider / SyncBackend 三个注册表，但注册后全项目零处读取，属于未兑现的承诺，已删除 —— 这里只保留确实能被消费的扩展点。

示例见 [`src/plugins/demo.ts`](src/plugins/demo.ts)。

---

<div id="en"></div>

## 🇬🇧 English

### 🫧 Jelly interaction

Not just a frosted-glass filter — every element has its own physical feedback:

| Feedback | Implementation |
| --- | --- |
| Press squash | Squeeze animation on `cubic-bezier(.36,0,.66,-.56)` with split X/Y scaling, like deforming jelly |
| Click ripple | Water-like ripple spreading from the press point |
| List entrance | Items float in one by one with increasing delays instead of all at once |
| Hover lift | Buttons rise 2px as a whole, on a separate track from the squash animation |
| Cursor sheen | Highlight center follows the cursor position inside each button, plus a cool edge glow |
| Toast hover | Toast progress bar pauses on hover and resumes when the cursor leaves |
| Save feedback | Pulsing "breathing" state while saving, still when done |

> Hover displacement is **vertical only**: a list container with `overflow-y: auto` computes `overflow-x` as `auto`, so horizontal shifts would clip the delete button at the row end.
>
> Effects can be toggled anytime under "Settings → Appearance → ✦ Effects"; turning them off keeps only basic hover. Keyboard-focus sheen and `prefers-reduced-motion` fallback are supported.

### 🪟 Transparent liquid glass + dual background modes

- The Tauri desktop build is a true transparent window (`transparent: true` + native shadow) with borderless rounded clipping.
- **Dual background modes** in one installer (Settings → Appearance → Background):
  - `◑ Opaque` (default): classic dark gradient background, desktop does not show through;
  - `◐ Transparent`: desktop / wallpaper shows through the window, with low-alpha glass materials and a misty ambient layer.
- Browser / H5 shells keep their original gradient background and are unaffected.

### ✨ Highlights

<div align="center">

| 📚 Doc tree | 🔗 Backlinks | 🏷 Tags |
|:---:|:---:|:---:|
| Multi-level main / sub documents | `[[Wiki links]]` with syntax highlight | Tag anything |
| Drag to reorder, one-click expand/collapse | Click through to the target in preview | Filter docs by tag |
| Favorites ★, per-doc sync toggle | —— | Central tag sidebar |

| 🗂 Outline | 📎 Attachments | 🗑 Trash |
|:---:|:---:|:---:|
| Indented by H1–H6 levels | Central image management | Restore deleted docs |
| Click to jump to a heading | Thumbnails / size at a glance | Permanent delete supported |

| 🤖 AI assistant | ☁️ WebDAV sync | 🎨 Theming |
|:---:|:---:|:---:|
| 8 one-click quick actions | Smart merge (by modification time) | **9 liquid-light themes** |
| Multi-platform switch, model fetching | Test connection / upload only / overwrite from cloud | 8 accents + 4 icons |
| Streaming replies, cancellable | Auto sync after edits | 6 editor fonts |

</div>

More: paste images · export with sub-documents merged · focus mode · three view layouts · SQLite FTS5 full-text search · borderless title bar · plugin system

> The plugin system previously advertised 6 extension points, but only 3 were actually wired — the other 3 were unread registry shells. The shells were removed and real capabilities added (error isolation, enable/disable UI, editor APIs for plugins); see the plugin section below.

### 🤖 AI quick actions

Select text or a whole document, then run with one click:

`Polish` `Continue` `Summarize` `EN→ZH` `ZH→EN` `Title` `Fix` `Explain`

Any **OpenAI-compatible API** works — relays, self-hosted gateways and local servers included. Built-in platform presets, multiple saved configs switchable anytime, streaming replies can be cancelled, and replies can be applied to the document with one click. Keys live in the OS keychain, never on disk.

### 🎨 Nine liquid-light themes

<center>

| Midnight | Dawn | Ocean |
|:---:|:---:|:---:|
| Sakura | Aurora | Mocha |
| Lychee | Mint | Grape |

</center>

Each theme configures its own **ambient liquid color** and **glass edge highlight** — the jelly translucency comes from tinted edge light, not overall tinting, so the top bar, sidebar, AI panel and every glass surface change with the theme instead of only the background moving.

### 🛡 Security

- File access is limited to the app data directory with extension checks
- Outbound requests refuse loopback addresses
- Response body cap: 16 MB
- Markdown rendering is sanitized with DOMPurify
- AI keys live in the OS keychain (Windows DPAPI / macOS Keychain)

### 🛠 Stack

<div align="center">

![Tauri 2](https://img.shields.io/badge/Desktop-Tauri%202-4ecdc4?style=flat-square)
![React](https://img.shields.io/badge/UI-React%2019-7c9eff?style=flat-square)
![TypeScript](https://img.shields.io/badge/Lang-TypeScript-818cf8?style=flat-square)
![Vite](https://img.shields.io/badge/Build-Vite-38bdf8?style=flat-square)
![CodeMirror](https://img.shields.io/badge/Editor-CodeMirror%206-34d399?style=flat-square)
![Zustand](https://img.shields.io/badge/State-Zustand-a78bfa?style=flat-square)
![SQLite](https://img.shields.io/badge/Store-SQLite%20FTS5-fbbf24?style=flat-square)

</div>

| Module | Choice |
| --- | --- |
| Desktop shell | Tauri 2 (Rust) · borderless window |
| Frontend | React 19 + TypeScript + Vite |
| Editor | CodeMirror 6 |
| State | Zustand |
| Local storage | SQLite (rusqlite) + FTS5 full-text index |
| Rendering | marked + highlight.js + DOMPurify |
| Key security | keyring (Windows DPAPI / macOS Keychain) |
| Networking | reqwest (HTTP proxy, bypasses CORS) |

### 📥 Download

<div align="center">

[![Download](https://img.shields.io/badge/⬇-Download_latest-4ecdc4?style=for-the-badge)](https://github.com/qingzhuo-cn/vetro/releases/latest)

`Vetro-x.x.x_x64-setup.exe` · `Vetro-x.x.x_x64_en-US.msi`

Linux: `vetro_x.x.x_amd64.deb` · `Vetro_x.x.x_x86_64.AppImage`

> Linux packages are built automatically by GitHub Actions (see [build-linux.yml](.github/workflows/build-linux.yml)). For the HarmonyOS plan, see [HARMONYOS-PORT.md](HARMONYOS-PORT.md).

</div>

### 🔨 Build from source

**Requirements**

- [Node.js](https://nodejs.org) ≥ 18
- [Rust](https://rustup.rs) (stable)
- Windows: Visual Studio 2022 **Build Tools** ("Desktop development with C++") + Windows SDK
- Linux (Debian/Ubuntu): WebKitGTK and system dependencies
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

```bash
npm install          # install frontend dependencies
npm run tauri dev    # dev mode (hot reload)
npm run tauri build  # package (output in src-tauri/target/release/bundle/)
```

> On Windows, if `cargo` cannot find `link.exe`, load the MSVC environment first:
> ```bat
> call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
> ```

### 🔌 Plugin system (experimental)

Plugins live as standalone files in [`src/plugins/`](src/plugins/) and are statically collected by Vite at **build time** — just export a `default` plugin object, no changes to the app itself. New plugins require a rebuild; this is **not runtime hot-loading**: dynamically executing external JS inside a packaged Tauri app raises CSP and code-execution safety issues, which this project deliberately avoids.

Three wired extension points:

| Extension point | Capability |
| --- | --- |
| `ctx.commands` | Commands, shown in the top-bar `⌘` panel |
| `ctx.renderers` | Render hooks into the Markdown → HTML pipeline |
| `ctx.editors` | CodeMirror 6 extensions (decorations, keymaps, etc.) |

`ctx.api` provides host capabilities: `toast` / `insertText` / `getActiveDoc` / `setContent` / `replaceAll` / `log`.

```ts
import type { VetroPlugin } from '../plugins';

export const myPlugin: VetroPlugin = {
  id: 'my-plugin',
  name: 'My plugin',
  version: '1.0.0',
  activate(ctx) {
    ctx.commands.register({
      id: 'my.hello',
      title: 'Say hello',
      run: () => ctx.api.insertText('Hello, Vetro')
    });
  }
};
```

Plugins can be **enabled/disabled instantly** in Settings with no restart. A failing plugin is isolated and marked without affecting the rest; its registered items are fully rolled back, leaving no half-activated residue.

> Earlier versions also declared Panel / AiProvider / SyncBackend registries, but they were never read anywhere — an unfulfilled promise, now removed. Only extension points that are actually consumed are kept here.

See [`src/plugins/demo.ts`](src/plugins/demo.ts) for an example.

---

> 欢迎贡献其他语言的介绍翻译 / Contributions for additional language versions are welcome.

<div align="center">

📄 **License**: [MIT](LICENSE) · © 2026 qingzhuo-cn

</div>
