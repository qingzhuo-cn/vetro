<div align="center">

<img src="assets/icon-512.png" width="120" alt="Vetro Logo">

# 🥃 Vetro

**果冻质感的 Markdown 编辑器**

每一次点击都回弹，每一次切换都流动

[![version](https://img.shields.io/badge/version-v2.10.0-4ecdc4?style=flat-square&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![tauri](https://img.shields.io/badge/Tauri-2-7c9eff?style=flat-square&labelColor=0d1117)](https://tauri.app)
[![license](https://img.shields.io/badge/MIT-34d399?style=flat-square&labelColor=0d1117)](LICENSE)

[🇨🇳 中文](README.md) · [🇬🇧 English](README.en.md)

**[⬇ 下载最新版](https://github.com/qingzhuo-cn/vetro/releases/latest)**

`Vetro_x.x.x_x64-setup.exe` · `Vetro_x.x.x_x64_en-US.msi` · Linux `.deb` / `.AppImage`

</div>

---

## ✨ 功能

| | |
| --- | --- |
| 📚 **文档树** | 主 / 子文档多级嵌套 · 拖拽整理 · 一键收展 · 收藏 · 单独同步开关 |
| 🔗 **双向链接** | `[[Wiki 链接]]` 语法高亮 · 预览中点击直达目标文档 |
| 🏷 **标签体系** | 任意打标签 · 按标签筛选 · 侧栏集中管理 |
| 🗂 **大纲** | 按 H1–H6 分级缩进 · 点击跳到对应标题 |
| 📎 **附件** | 图片集中管理 · 缩略图与体积一览 · 粘贴即用 |
| 🗑 **回收站** | 误删可恢复 · 支持彻底删除 |
| 🔍 **全文搜索** | SQLite FTS5 索引正文 · 匹配片段高亮 |
| 📤 **导出** | 单篇导出（自动合并子文档）· 全部导出 ZIP · 打印为 PDF |

## 🪟 视觉

**果冻化交互** —— 不是贴一张毛玻璃滤镜了事，每个元素都有自己的物理反馈：

- **按下回弹** 挤压动画走蓄力曲线，横纵缩放分离，模拟果冻形变
- **点击涟漪** 从按压点扩散的水波反馈
- **鼠标反光** 高光中心跟随光标在按键内的位置，边缘带一层冷光
- **错峰入场** 列表逐条浮起，间隔递增而非齐刷刷
- **悬停暂停** 通知进度条悬停即停，移开继续走完
- **呼吸反馈** 保存中状态明灭，完成即静止

**透明液态玻璃 + 背景双模式**

桌面端是真透明窗口（`transparent: true` + 系统阴影 + 无边框圆角裁剪），背景可在设置里切换：

- `◑ 不透明`（默认）—— 常规深色渐变，桌面不透
- `◐ 透明` —— 桌面与壁纸透过来，面板自动换用低透明度玻璃材质与薄雾氛围层

**九套液光主题** · 8 色强调 · 4 图标 · 6 种正文字体 · 浅色/深色/自动

每套主题独立配置液光氛围色与玻璃边缘透光高光。果冻的通透感正来自边缘透光带色而非整体染色，所以顶栏、侧栏、AI 面板等所有玻璃表面都会随主题一起变色。

| 暗夜 | 晨曦 | 深海 | 樱雪 | 极光 | 拿铁 | 荔枝 | 薄荷 | 葡萄 |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|

## 🤖 AI 助手

任何 **OpenAI 兼容接口**均可接入 —— 中转站、自建网关、本地服务都行。

- **8 个一键快捷操作**：润色 · 续写 · 摘要 · 英译 · 中译 · 拟标题 · 修正 · 解释
- 多平台保存与切换 · 一键获取可用模型 · 流式回复随时取消
- 回复可一键应用到文档 · 有选区时针对选中文本，无选区则处理整篇
- 密钥存系统钥匙串，不落盘

## ☁️ 同步

WebDAV 智能同步，兼容 Nextcloud 等自建服务。

- 快照校验 + 按修改时间合并 · 修改后自动同步（可选）
- 测试连接 / 仅上传 / 云端覆盖本机
- 智能合并保留回收站墓碑，避免已删文档被"复活"

## 🔌 插件系统（实验性）

插件以独立文件放入 [`src/plugins/`](src/plugins/)，导出 `default` 插件对象即可，无需改动主程序。示例见 [`demo.ts`](src/plugins/demo.ts)。

```ts
import type { VetroPlugin } from '../plugins';

export const myPlugin: VetroPlugin = {
  id: 'my-plugin', name: '我的插件', version: '1.0.0',
  activate(ctx) {
    ctx.commands.register({
      id: 'my.hello', title: '打个招呼',
      run: () => ctx.api.insertText('你好，Vetro')
    });
  }
};
```

三个扩展点：`ctx.commands`（命令面板）、`ctx.renderers`（渲染钩子）、`ctx.editors`（CodeMirror 扩展）。宿主能力 `ctx.api` 提供 `toast` / `insertText` / `getActiveDoc` / `setContent` / `replaceAll` / `log`。

设置面板内可即时启停，无需重启；单个插件加载失败会被隔离，不影响其余。

> 构建期静态收录，不是运行时热加载 —— 打包环境下动态执行外部 JS 涉及 CSP 与代码执行安全，本项目不做。

## 🛡 安全

- 文件读写限定在应用数据目录内，且校验扩展名
- 出站请求拒绝环回地址，响应体上限 16 MB
- Markdown 渲染经 DOMPurify 净化
- AI 密钥存系统钥匙串（Windows DPAPI / macOS Keychain）

## 🛠 技术栈

Tauri 2 · React 19 · TypeScript · Vite · CodeMirror 6 · Zustand · SQLite (rusqlite + FTS5) · marked · highlight.js · DOMPurify · reqwest

从 Electron 全面重写为 Tauri 2 —— 单进程、安装包更小、启动更快、内存占用更低。

## 🔨 从源码构建

```bash
npm install          # 安装依赖
npm run tauri dev    # 开发模式（热更新）
npm run tauri build  # 打包，产物在 src-tauri/target/release/bundle/
```

需要 [Node.js](https://nodejs.org) ≥ 18 与 [Rust](https://rustup.rs)（stable）。Windows 另需 Visual Studio 2022 Build Tools（勾选「使用 C++ 的桌面开发」）+ Windows SDK；Linux 需 WebKitGTK 等系统依赖。

<details>
<summary>Linux 系统依赖</summary>

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

</details>

Windows 上若 `cargo` 提示找不到 `link.exe`，先加载 MSVC 环境：

```bat
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
```

## 📚 相关文档

- [同步设计](SYNC-DESIGN.md) · [WebDAV 同步设计](WEBDAV-SYNC-DESIGN.md) · [云端方案](CLOUD.md)
- [鸿蒙版移植方案](HARMONYOS-PORT.md)

Linux 包由 [GitHub Actions](.github/workflows/build-linux.yml) 自动构建。

---

<div align="center">

📄 **License**: [MIT](LICENSE) · © 2026 qingzhuo-cn

</div>
