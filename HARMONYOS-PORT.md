# Vetro 鸿蒙版移植设计（H5 壳 + Web 组件）

> 状态：**方案与模板已就绪，未在 DevEco Studio 中编译验证**。目标设备：HarmonyOS NEXT（5.0+，手机 / 平板）。
> Tauri 2 官方不支持 HarmonyOS，因此采用「**现有 React 前端打包为 H5 + 鸿蒙 ArkUI Web 组件 + 原生 JS 桥**」方案，工作量最小、复用度最高。

## 1. 架构

```
┌──────────────────────────────────────────────┐
│ HarmonyOS 应用（.hap，ArkTS 壳）               │
│  entry/src/main/ets/pages/Index.ets          │
│   └── Web 组件（加载 rawfile/www/index.html）  │
│         │ registerJavaScriptProxy            │
│         ▼                                    │
│  window.vetroNative ── VetroBridge.ets ── 原生能力 │
│    · SQLite/状态  → preferences / relationalStore │
│    · 安全存储     → @ohos.security.asset         │
│    · 网络代理     → @ohos.net.http（无 CORS）    │
│    · 文件        → @ohos.file.picker + fs      │
└──────────────────────────────────────────────┘
        ▲
        │  H5（src/ 现有前端，isTauri=false → 检测桥）
└──────────────────────────────────────────────┘
```

## 2. 桥接契约（`src/backend.ts` 已实现路由）

前端 `backend.ts` 的每个能力函数按 **鸿蒙桥 → Tauri → 浏览器回退** 的顺序取用：

| 前端函数 | 桥方法 `vetroNative.*` | 推荐原生实现 |
|---|---|---|
| `dbInit` | `dbInit()` | `@ohos.data.relationalStore` 建库建表 |
| `dbSaveState(state, docs)` | `dbSave(stateJson, docsJson)` | 状态 JSON 存 preferences / 文档写 relationalStore + FTS |
| `dbLoadState` | `dbLoad()` | relationalStore 读状态 |
| `dbSearch(query)` | `dbSearch(query)` → `[{id,name,snippet}]` | relationalStore LIKE / FTS 查询 |
| `secureSet/Get/Delete` | 同名 | `@ohos.security.asset`（加密资产） |
| `httpRequest(req)` | `httpRequest(req)` → `{status,headers,body}` | `@ohos.net.http`（绕过 CORS） |
| `saveFileDialog` | `saveFile(name)` → uri | `@ohos.file.picker` save |
| `writeTextFile` | `writeFile(path, content)` | `@ohos.file.fs` 写 |
| `openFileDialog` | `openFile()` → uri | `@ohos.file.picker` select |
| `readTextFile` | `readFile(path)` → text | `@ohos.file.fs` 读 |

WebDAV 的 `PROPFIND` 等自定义方法：`@ohos.net.http` 的 `RequestMethod` 不含 PROPFIND，需要自定义（如 `request` 底层或改走服务器支持的方法），或先只做 PUT/GET（上传/下载）——见 §5 限制。

## 3. 同步限制与异步回写模式

`registerJavaScriptProxy` 暴露的方法对 H5 是**同步调用**，而 relationalStore / preferences 读取是**异步**的。模板对 `dbLoad/secureGet` 先返回 `null`（H5 回退 localStorage）。生产方案：

1. 原生侧把异步结果暂存到字段；
2. 用 `controller.runJavaScript('window.__vetroAsyncResult = …')` 回写；
3. H5 侧轮询 / 订阅 `__vetroAsyncResult`。

或者：把 `registerJavaScriptProxy` 的同步方法改为「触发异步 + 状态标记」，前端统一走「先读标记、再取结果」两段式。

## 4. 前端改动（已完成）

- `vite.config.ts`：`base: './'` —— 相对路径，兼容 Web 组件 `file://`/rawfile 加载。
- `src/backend.ts`：新增 `bridge()` 检测 `window.vetroNative`，所有能力函数按 桥 → Tauri → 浏览器 路由。
- 其余前端代码零改动（AI / WebDAV / 编辑器 / 预览等照常工作）。

## 5. 已知限制（模板阶段）

- ❌ 未在 DevEco Studio 编译验证；ArkTS API 细节（`requestSync`、`relationalStore`、`asset`、`picker`）需按实际 SDK 版本修正。
- WebDAV PROPFIND/DELETE/MKCOL 在 `@ohos.net.http` 无对应枚举，需自定义或先支持 PUT/GET。
- 模板未包含：应用图标（需把 `assets/icon-512.png` 复制为 `entry/src/main/resources/base/media/app_icon.png`）、签名配置（需华为开发者账号）。
- Web 组件内 localStorage 可用（作为无桥时的兜底）；接入桥后以原生存储为准。

## 6. 构建步骤

```bash
# 1) 出 H5 包（仓库根目录）
npm install
npm run build

# 2) 复制到 rawfile
xcopy /E /I /Y dist harmonyos\entry\src\main\resources\rawfile\www

# 3) 复制应用图标
copy assets\icon-512.png harmonyos\entry\src\main\resources\base\media\app_icon.png

# 4) DevEco Studio 打开 harmonyos/，配置签名（AppGallery Connect 建应用，bundleName 一致）
# 5) Build → Build App(s) → 生成 .hap；连接真机 Run
```

## 7. 后续可选

- 鸿蒙 PC（HarmonyOS PC / OpenHarmony）：社区有 Tauri 交叉编译实验方案，可另调研（与本 H5 方案不同路线）。
- 若未来 Tauri 官方或社区提供 HarmonyOS target，可考虑回退原生 Tauri 路线。
