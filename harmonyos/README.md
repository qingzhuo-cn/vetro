# Vetro HarmonyOS 壳（H5 + Web 组件）

本目录是 **Vetro 鸿蒙版（H5 壳）工程模板**，用 HarmonyOS 的 ArkUI `Web` 组件加载现有 React 前端（H5 包），并通过 `registerJavaScriptProxy` 暴露原生桥 `window.vetroNative`，让 H5 使用 SQLite / 安全存储 / 网络代理等原生能力。

> ⚠️ **本模板为最佳努力（best-effort）编写，未经 DevEco Studio 编译验证。**
> 请用 **DevEco Studio（HarmonyOS NEXT / API 12+）** 打开本目录，按需修正 ArkTS API 细节后再构建。构建产物为 `.hap`，需华为开发者账号签名后安装。

## 目录结构

```
harmonyos/
├── AppScope/
│   └── app.json5                 # 应用级配置（bundleName 等）
├── build-profile.json5            # 工程构建配置（SDK 版本 / 签名）
├── hvigorfile.ts
├── oh-package.json5
└── entry/
    ├── build-profile.json5
    ├── hvigorfile.ts
    ├── oh-package.json5
    └── src/main/
        ├── module.json5          # 模块配置（权限：INTERNET 等）
        ├── ets/
        │   ├── entryability/EntryAbility.ets
        │   ├── pages/Index.ets   # Web 组件 + 注册原生桥
        │   └── common/VetroBridge.ets  # 原生桥实现（SQLite/安全存储/网络/文件）
        └── resources/
            ├── base/element/{string,color}.json
            ├── base/profile/main_pages.json
            ├── base/media/app_icon.png    # 应用图标（可复用 assets/icon-512.png）
            └── rawfile/www/              # ⬅ 前端 H5 包放这里（见下）
```

## 构建步骤

1. **出 H5 包**（在仓库根目录）：

   ```bash
   npm install
   npm run build
   ```

2. **把 H5 包拷贝到 rawfile**：

   ```bash
   # 把 dist/ 的内容整体复制到 harmonyos/entry/src/main/resources/rawfile/www/
   xcopy /E /I /Y dist harmonyos\entry\src\main\resources\rawfile\www
   ```

   最终应存在 `rawfile/www/index.html`（Vite 已配置 `base: './'`，相对路径可直接在 Web 组件中加载）。

3. **用 DevEco Studio 打开 `harmonyos/` 目录**，等待 SDK 同步。

4. 按需在 `build-profile.json5` 配置签名（华为开发者账号 + AppGallery Connect 创建应用，`bundleName` 需与签名一致），然后 **Run** 到真机 / 模拟器，或 Build → **Build App(s)** 生成 `.hap`。

## 桥接契约（H5 ⇄ 原生）

前端 `src/backend.ts` 会检测 `window.vetroNative`，存在则优先走原生桥（否则回退 Tauri / 浏览器）。方法清单：

| 前端调用 | 桥方法 | 原生实现（模板） |
|---|---|---|
| `dbInit/dbSaveState/dbLoadState` | `dbInit/dbSave/dbLoad` | `@ohos.data.relationalStore`（或 preferences 简化版） |
| `dbSearch` | `dbSearch` | relationalStore LIKE / FTS 查询 |
| `secureSet/Get/Delete` | 同名 | `@ohos.security.asset`（加密资产存储） |
| `httpRequest` | `httpRequest` | `@ohos.net.http`（无 CORS 限制） |
| `saveFileDialog/writeTextFile` | `saveFile/writeFile` | `@ohos.file.picker` + `@ohos.file.fs` |
| `openFileDialog/readTextFile` | `openFile/readFile` | 同上 |

> 注意：`registerJavaScriptProxy` 的方法为**同步调用**。异步原生操作（如数据库查询）请用回调模式：原生侧把结果暂存，再用 `controller.runJavaScript('window.__vetroAsyncResult = ...')` 回写，H5 侧轮询或订阅。详见 `HARMONYOS-PORT.md`。

## 说明

- 浏览器模式下的能力限制（无钥匙串 / 无本地文件 / AI 受 CORS / 无 SQLite）在接入原生桥后即可解除。
- 鸿蒙 NEXT（5.0+）不支持 Android 应用，必须用本方案（或 ArkTS 原生重写）。
