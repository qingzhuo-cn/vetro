# Vetro 桌面端文档同步 · WebDAV 方案设计

> 状态：**已实现**（v2.x，Tauri 重写版）。桌面版通过标准 WebDAV 协议同步 `.md` 文档，支持 Nextcloud / ownCloud / 坚果云 / Synology NAS 等任意 WebDAV 服务器。

## 1. 为什么桌面版用 WebDAV

- 开放标准（RFC 4918），无需自建后端，服务器端无需任何代码；
- 文档就是普通 `.md` 文件，任何设备 / 工具都能直接读写；
- 可自托管（NAS / Nextcloud）= 数据完全在自己手里，契合桌面版「本地文件」定位；
- Tauri 版通过 Rust `reqwest` 代理（`http_request` 命令）发请求，天然绕过浏览器 CORS；
- 对比：Cloudflare 是静态 / 边缘平台，没有 WebDAV 文件服务，所以 Web 版才改用 D1 + Functions（见 `SYNC-DESIGN.md`）。

## 2. 架构

```
Vetro 桌面版 (Tauri 2)
   │  HTTPS（WebDAV 协议，经 Rust http_request 代理）
   ▼
WebDAV 服务器（Nextcloud / 坚果云 / NAS …）
   └── /Vetro/*.md   文档即 .md 文件
```

## 3. 同步映射

- 每个文档 = 一个 `.md` 文件，存放在同步目录（如 `/Vetro/`）。
- 文件名 = 文档名（安全化：去除 `/\:*?"<>|` 等非法字符，防路径穿越，必要时去重）。
- 文档内容原样写入 `.md`，不加包装（保持服务器端可直接阅读）。

## 4. WebDAV 操作（均已实现于 `src/webdav.ts`）

| 操作 | 方法 | 用途 |
|---|---|---|
| 列目录 | `PROPFIND /Vetro/`（Depth: 1） | 拉文件列表，解析 href |
| 下载 | `GET /Vetro/a.md` | 拉取文档内容 |
| 上传 | `PUT /Vetro/a.md` | 推送 / 更新文档 |
| 删除 | `DELETE /Vetro/a.md` | 删除文档（客户端已实现，UI 暂未接出） |
| 建目录 | `MKCOL /Vetro/` | 首次创建同步目录 |

## 5. 配置与鉴权

- 设置项（新版 `cfg.sync`）：`{ enabled, url, username, password }`，在「设置 → WebDAV 同步」填写。
- 鉴权：HTTP Basic（UTF-8 base64）。
- ⚠️ **当前实现**：密码保存在应用配置（SQLite）中，尚未接入系统钥匙串。后续改进：像 AI 密钥一样走 `keyring`（Windows DPAPI），明文不落盘。

## 6. 同步流程（当前实现）

- **上传**：把 `sync=true` 的文档逐个 `PUT` 到远端（按文件名）。
- **下载**：`PROPFIND` 列出远端 `.md` 文件 → `GET` 拉取 → 按文件名合并进文档树（同名更新，异名新建）。
- 自动同步（启动检测 / 编辑防抖推送 / 状态栏「已同步 / 同步中 / 失败」指示）为后续增强。

## 7. 冲突与时间戳（后续）

- 当前手动上传 / 下载为「直接覆盖」语义。
- 如需更精细：方案 A 每个 `.md` 加 YAML frontmatter 存 `updatedAt`（毫秒）；方案 B 旁路 `_vetro-sync.json` 存 `文件名 → { id, updatedAt }` 映射（不污染正文）。

## 8. 安全与隐私

- 全链路 HTTPS；
- 文档同步到你自己的 WebDAV 服务器（自托管 = 自己掌控）；第三方服务（坚果云等）按其隐私政策；
- **AI 的 API Key 不参与同步**，仍每台设备本地加密保存（系统钥匙串）。

## 9. 限制

- 无实时协作、无版本历史；当前为手动上传 / 下载；
- 删除操作 UI 未接出（客户端方法已实现）；
- 文件名需安全化，重命名产生「删旧建新」。

## 10. 待确认 / 后续增强

- 自动同步（启动检测、编辑防抖推送、状态栏指示）；
- WebDAV 密码接入系统钥匙串（DPAPI / Keychain）；
- 回收站 / 软删除、冲突检测（frontmatter 毫秒时间戳）；
- 「部分文档同步」或「自定义同步目录」。
