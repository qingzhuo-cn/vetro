<div align="center">

<img src="assets/icon-512.png" width="120" height="120" alt="Vetro logo" />

# Vetro ✨

**液态玻璃质感 · 本地优先的 Markdown 编辑器**

[![theme](https://img.shields.io/badge/theme-glassmorphism-%234ecdc4)](https://github.com/qingzhuo-cn/vetro)
[![pwa](https://img.shields.io/badge/PWA-installable-%237c9eff)](https://github.com/qingzhuo-cn/vetro)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![release](https://img.shields.io/github/v/release/qingzhuo-cn/vetro?color=4ecdc4&label=release)](https://github.com/qingzhuo-cn/vetro/releases)

**拖拽导入 · 实时预览 · AI 改写润色 · WebDAV 同步 · 完全本地 · 可部署 Cloudflare**

</div>

---

## ✨ 核心特性

| 能力 | 说明 |
|---|---|
| 📥 **批量导入** | 拖入多个 `.md` / `.txt` 文件自动拆分为独立文档，可多选合并、一键撤销 |
| ✏️ **实时双栏** | 左侧编辑、右侧所见即所得预览，Markdown + 代码高亮（本地内置 marked + highlight.js） |
| 🗂️ **文档大纲** | 侧边栏「大纲」页签解析标题，点击平滑跳转 |
| 🔍 **查找替换** | `Ctrl/⌘+F` 查找、`Ctrl/⌘+H` 替换，支持逐个 / 全部替换 |
| 🖼️ **图片粘贴** | 截图后 `Ctrl+V` 直接内嵌，也支持拖入图片 |
| 🤖 **AI 助手** | 接入任意 **OpenAI 兼容 API**，流式输出，改写 / 润色 / 续写 / 翻译 / 总结 |
| 💾 **本地持久化** | 数据存于 IndexedDB（无 5MB 限制），API Key 系统级加密，支持导出 `.md` |
| 📦 **可安装** | 提供 Windows 安装包 / 免安装版（见 [Releases](https://github.com/qingzhuo-cn/vetro/releases)），也可作为 PWA 安装 |
| 🎨 **玻璃态设计** | 暗色毛玻璃 + 渐变光晕，支持暗色 / 亮色 / 跟随系统三种外观 |
| 🎨 **主题定制** | 8 套强调色 + 4 种图标样式，支持导入 / 导出 `.json` 主题 |
| ✨ **流畅动效** | 抽屉 / 弹窗 / 侧栏 / 页签 / Toast 全程弹簧缓动，支持「减少动态效果」 |
| 🗂️ **多文档管理** | 侧边栏文档列表，新建 / 切换 / 删除 / 重命名 / 折叠，实时字数统计 |

---

## 🚀 快速开始

### 方式一：直接下载（推荐）

从 [GitHub Releases](https://github.com/qingzhuo-cn/vetro/releases) 下载最新版：

- `Vetro-Setup-x.x.x.exe` —— 安装版（可选安装目录，创建桌面 / 开始菜单快捷方式）
- `Vetro-Portable-x.x.x.exe` —— 免安装版（双击即用）

### 方式二：自行构建

```bash
npm install
npm run build
# 产物在 dist/ 下：Vetro-Setup-*.exe 与 Vetro-Portable-*.exe
```

### 方式三：浏览器 / 本地服务

用浏览器直接打开 `index.html`，或用静态服务器：

```bash
python -m http.server 8765
# 浏览器打开 http://localhost:8765
```

### 方式四：部署到 Cloudflare Pages

1. 把整个 `vetro` 目录推到 GitHub 仓库；
2. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages**；
3. 连接该仓库，构建配置：
   - **Framework preset**: None
   - **Build command**: （留空）
   - **Build output directory**: （留空，用根目录 `/`）
4. 部署完成，得到 `https://xxx.pages.dev`，**任何设备浏览器直接访问 + 可安装到桌面**。

> 也可用 Wrangler CLI：`npx wrangler pages deploy .` —— 纯静态，无需构建。

> 🛡️ **安全**：仓库自带 `_headers`，部署后自动应用 CSP / `nosniff` 等安全响应头（阻断 Markdown 内联脚本）。云端部署**不建议使用 AI 功能**（见下方「AI 助手」说明）。

---

## 🤖 AI 助手配置

任意 **OpenAI 兼容接口**都能接入（`POST /chat/completions`）：

| 服务 | API 地址 | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
| 本地 Ollama | `http://localhost:11434/v1` | `llama3` |

**使用步骤**：

1. 点击右上角 **✦ AI 助手**；
2. 填入 API 地址 + Key + 模型名，点「保存并测试连接」；
3. 在编辑器中**选中一段文字**，选「改写 / 润色 / 翻译」，点「执行 AI 操作」；
4. 结果会显示在下方面板，可**插入到文档 / 复制 / 全文替换**。

> 🔒 **隐私**：所有内容都在本地。只有你主动点「执行 AI 操作」时，才会把**当次选中的文本**发送给你配置的 API。API Key 桌面版用系统级加密（Windows DPAPI / macOS Keychain）保存，浏览器版仅混淆保存，不会上传到任何服务器。

> ⚠️ **云端部署请勿使用 AI**：Web / Cloudflare 版中 API Key 只有混淆（无系统级加密），且多数 OpenAI 兼容接口会因 **CORS 跨域**限制无法从浏览器直接调用。AI 功能面向**桌面版**设计，云端部署时请把 Vetro 当作纯 Markdown 编辑器使用。

---

## ⌨️ 快捷键

| 操作 | 快捷键 |
|---|---|
| 打开文件 | `Ctrl` / `⌘` + `O` |
| 保存到磁盘 | `Ctrl` / `⌘` + `S` |
| 另存为 | `Ctrl` / `⌘` + `Shift` + `S` |
| 查找 / 替换 | `Ctrl` / `⌘` + `F` / `H` |
| 切换视图 | `Ctrl` / `⌘` + `\` |
| 撤销文档操作 | `Ctrl` / `⌘` + `Shift` + `Z` |
| Tab 缩进 | `Tab` |

---

## 📁 项目结构

```
vetro/
├── index.html      # 页面骨架 + UI 结构（应用内图标均为内联 SVG）
├── style.css       # 玻璃态暗色主题（CSS 变量，暗/亮可切换）
├── app.js          # 全部逻辑：渲染、拖拽、存储、AI 调用、密钥加解密
├── main.js         # Electron 主进程：磁盘读写 + safeStorage 密钥加密
├── preload.js      # 渲染进程安全桥接
├── manifest.json   # PWA 清单（可安装）
├── sw.js           # Service Worker（离线缓存）
├── vendor/         # marked + highlight.js + DOMPurify（本地内置，离线可用）
├── assets/         # 应用图标（液态玻璃渐变，PNG/ICO）
├── _headers        # Cloudflare 安全响应头（CSP 等）
└── dist/           # 构建产物：Setup / Portable 安装程序（发布到 Releases）
```

**无构建步骤、无后端、无框架** —— 一个目录拖到任何静态托管就能跑。

---

## 🔧 技术要点

- **渲染**：`marked`（Markdown）+ `highlight.js`（代码高亮），本地内置 `vendor/`（离线可用）；
- **安全**：预览经 `DOMPurify` 净化（防 XSS），外部链接走系统浏览器；云端由 `_headers` 下发 CSP；
- **持久化**：IndexedDB（`vetro` 数据库），旧版 `glassmark` 数据自动迁移；
- **主题系统**：8 套强调色 + 4 种图标样式，JSON 主题导入 / 导出（存入 IndexedDB）；
- **密钥安全**：桌面版用 Electron `safeStorage`（Windows DPAPI / macOS Keychain）加密 API Key，明文永不落盘；
- **AI 流式**：`stream: true` SSE 逐字渲染，可随时停止；
- **撤销/合并**：文档级操作快照栈 + 侧边栏多选合并；
- **文件读写**：桌面版走 Electron 原生磁盘读写，浏览器版优先 `File System Access API`，降级为下载；
- **拖拽**：`dragenter` / `drop` 全局监听，支持多文件；
- **桌面安装**：`npm run build`（electron-builder）产出 NSIS 安装包 + 免安装版；
- **PWA**：`beforeinstallprompt` 捕获 + Service Worker 离线缓存；
- **同步**：桌面版 WebDAV（Nextcloud / 坚果云 / NAS，含回收站、毫秒级冲突检测、部分文档同步），见 `WEBDAV-SYNC-DESIGN.md`；云端版方案见 cloud 分支 `SYNC-DESIGN.md`。

---

## 🎨 主题文件规范（导入 / 导出）

主题是 JSON 文件，最小格式只需指定强调色：

```json
{
  "name": "我的主题",
  "accent": "#4ecdc4",
  "accent2": "#7c9eff"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 主题名，显示在色板中 |
| `accent` | — | 主强调色（十六进制），默认 `#4ecdc4` |
| `accent2` | — | 渐变第二色，默认 `#7c9eff` |
| `vars` | — | 可选，覆盖任意 CSS 变量（高级定制） |

带 `vars` 的高级定制示例：

```json
{
  "name": "石墨黑",
  "accent": "#4ecdc4",
  "accent2": "#7c9eff",
  "vars": { "--bg-0": "#0a0c12", "--radius": "14px" }
}
```

导入：设置 → 「导入主题 (.json)」；导出：设置 → 「导出当前配色」。

---

## 📄 License

[MIT](LICENSE) —— 自由使用、修改、分发。
