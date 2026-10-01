<div align="center">

<img src="assets/icon-512.png" width="120" alt="Vetro Logo">

# 🥃 Vetro

**A Markdown editor with jelly physics**

Every click bounces back, every switch flows

[![version](https://img.shields.io/badge/version-v2.10.0-4ecdc4?style=flat-square&labelColor=0d1117)](https://github.com/qingzhuo-cn/vetro/releases)
[![tauri](https://img.shields.io/badge/Tauri-2-7c9eff?style=flat-square&labelColor=0d1117)](https://tauri.app)
[![license](https://img.shields.io/badge/MIT-34d399?style=flat-square&labelColor=0d1117)](LICENSE)

[🇨🇳 中文](README.md) · [🇬🇧 English](README.en.md)

**[⬇ Download latest](https://github.com/qingzhuo-cn/vetro/releases/latest)**

`Vetro_x.x.x_x64-setup.exe` · `Vetro_x.x.x_x64_en-US.msi` · Linux `.deb` / `.AppImage`

</div>

---

## ✨ Highlights

| | |
| --- | --- |
| 📚 **Doc tree** | Multi-level main / sub documents · drag to reorder · expand & collapse · favorites · per-doc sync toggle |
| 🔗 **Backlinks** | `[[Wiki links]]` with syntax highlight · click through to the target in preview |
| 🏷 **Tags** | Tag anything · filter documents by tag · central tag sidebar |
| 🗂 **Outline** | Indented by H1–H6 levels · click to jump to a heading |
| 📎 **Attachments** | Central image management · thumbnails and sizes · paste to insert |
| 🗑 **Trash** | Restore deleted documents · permanent delete supported |
| 🔍 **Full-text search** | SQLite FTS5 over the body · highlighted match snippets |
| 📤 **Export** | Single document (sub-documents merged) · all as ZIP · print to PDF |

## 🪟 Look & feel

**Jelly interaction** — not just a frosted-glass filter; every element has its own physical feedback:

- **Press squash** — squeeze animation on a charge curve with split X/Y scaling, like deforming jelly
- **Click ripple** — water-like ripple spreading from the press point
- **Cursor sheen** — highlight center follows the cursor inside each button, plus a cool edge glow
- **Staggered entrance** — list items float in one by one with increasing delays
- **Hover pause** — toast progress bars stop when hovered and resume on leave
- **Breathing state** — pulses while saving, still when done

**Transparent liquid glass, with two background modes**

The desktop build is a true transparent window (`transparent: true` + native shadow + borderless rounded clipping). The background is switchable in Settings:

- `◑ Opaque` (default) — classic dark gradient, desktop does not show through
- `◐ Transparent` — desktop and wallpaper show through, with low-alpha glass materials and a misty ambient layer

**Nine liquid-light themes** · 8 accents · 4 icons · 6 editor fonts · light / dark / auto

Each theme configures its own ambient liquid color and glass edge highlight. Jelly translucency comes from tinted edge light rather than overall tinting, so the top bar, sidebar, AI panel and every glass surface shift with the theme.

| Midnight | Dawn | Ocean | Sakura | Aurora | Mocha | Lychee | Mint | Grape |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|

## 🤖 AI assistant

Any **OpenAI-compatible API** works — relays, self-hosted gateways and local servers included.

- **8 one-click quick actions**: Polish · Continue · Summarize · Translate to EN · Translate to ZH · Title · Fix · Explain
- Save and switch between multiple platforms · fetch available models · cancel streaming replies anytime
- Apply a reply to the document with one click · targets the selection when there is one, otherwise the whole document
- Keys live in the OS keychain, never on disk

## ☁️ Sync

WebDAV smart sync, compatible with Nextcloud and other self-hosted servers.

- Snapshot validation + merge by modification time · optional auto-sync after edits
- Test connection / upload only / overwrite from cloud
- Tombstones in the trash prevent deleted documents from being resurrected

## 🔌 Plugin system (experimental)

Plugins live as standalone files in [`src/plugins/`](src/plugins/) — just export a `default` plugin object, no changes to the app itself. See [`demo.ts`](src/plugins/demo.ts).

```ts
import type { VetroPlugin } from '../plugins';

export const myPlugin: VetroPlugin = {
  id: 'my-plugin', name: 'My plugin', version: '1.0.0',
  activate(ctx) {
    ctx.commands.register({
      id: 'my.hello', title: 'Say hello',
      run: () => ctx.api.insertText('Hello, Vetro')
    });
  }
};
```

Three extension points: `ctx.commands` (command panel), `ctx.renderers` (render hooks), `ctx.editors` (CodeMirror extensions). The host API `ctx.api` offers `toast` / `insertText` / `getActiveDoc` / `setContent` / `replaceAll` / `log`.

Enable or disable plugins instantly in Settings with no restart; a failing plugin is isolated without affecting the rest.

> Collected statically at build time, not runtime hot-loading — dynamically executing external JS inside a packaged app raises CSP and code-execution safety issues, which this project deliberately avoids.

## 🛡 Security

- File access is limited to the app data directory, with extension checks
- Outbound requests refuse loopback addresses; response bodies are capped at 16 MB
- Markdown rendering is sanitized with DOMPurify
- AI keys live in the OS keychain (Windows DPAPI / macOS Keychain)

## 🛠 Stack

Tauri 2 · React 19 · TypeScript · Vite · CodeMirror 6 · Zustand · SQLite (rusqlite + FTS5) · marked · highlight.js · DOMPurify · reqwest

Fully rewritten from Electron to Tauri 2 — single process, smaller installer, faster startup, lower memory footprint.

## 🔨 Build from source

```bash
npm install          # install dependencies
npm run tauri dev    # dev mode (hot reload)
npm run tauri build  # package, output in src-tauri/target/release/bundle/
```

Requires [Node.js](https://nodejs.org) ≥ 18 and [Rust](https://rustup.rs) (stable). Windows also needs Visual Studio 2022 Build Tools ("Desktop development with C++") + Windows SDK; Linux needs WebKitGTK and other system dependencies.

<details>
<summary>Linux system dependencies</summary>

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

</details>

On Windows, if `cargo` cannot find `link.exe`, load the MSVC environment first:

```bat
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
```

## 📚 Further reading

- [Sync design](SYNC-DESIGN.md) · [WebDAV sync design](WEBDAV-SYNC-DESIGN.md) · [Cloud plan](CLOUD.md)
- [HarmonyOS port plan](HARMONYOS-PORT.md)

Linux packages are built automatically by [GitHub Actions](.github/workflows/build-linux.yml).

---

<div align="center">

📄 **License**: [MIT](LICENSE) · © 2026 qingzhuo-cn

</div>
