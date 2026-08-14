# Vetro 桌面端文档同步 · WebDAV 方案设计

> 状态：**草案，未实现**。桌面版（Electron）通过标准 WebDAV 协议同步 `.md` 文档，支持 Nextcloud / ownCloud / 坚果云 / Synology NAS 等任意 WebDAV 服务器。

## 1. 为什么桌面版用 WebDAV

- 开放标准（RFC 4918），无需自建后端，服务器端无需任何代码；
- 文档就是普通 `.md` 文件，任何设备 / 工具都能直接读写；
- 可自托管（NAS / Nextcloud）= 数据完全在自己手里，契合桌面版「本地文件」定位；
- 对比：Cloudflare 是静态 / 边缘平台，没有 WebDAV 文件服务，所以云端版才改用 D1 + Functions（见 cloud 分支的 `SYNC-DESIGN.md`）。

## 2. 架构

```
Vetro 桌面版 (Electron)
   │  HTTPS（WebDAV 协议）
   ▼
WebDAV 服务器（Nextcloud / 坚果云 / NAS …）
   └── /Vetro/*.md   文档即 .md 文件
```

## 3. 同步映射

- 每个文档 = 一个 `.md` 文件，存放在同步目录（如 `/Vetro/`）。
- 文件名 = 文档名（安全化：去除 `/\:*?"<>|` 等非法字符，防路径穿越，必要时去重）。
- 本地维护 `id ↔ 远程路径` 映射；重命名 = 删除旧文件 + 上传新文件。
- 文档内容原样写入 `.md`，不加包装（保持服务器端可直接阅读）。

## 4. WebDAV 操作

| 操作 | 方法 | 用途 |
|---|---|---|
| 列目录 | `PROPFIND /Vetro/`（Depth: 1） | 拉文件列表 + `getlastmodified` |
| 下载 | `GET /Vetro/a.md` | 拉取文档内容 |
| 上传 | `PUT /Vetro/a.md` | 推送 / 更新文档 |
| 删除 | `DELETE /Vetro/a.md` | 删除文档 |
| 建目录 | `MKCOL /Vetro/` | 首次创建同步目录 |

## 5. 配置与鉴权

- 设置项：`sync.enabled`、`sync.url`（如 `https://dav.example.com/remote.php/dav/files/user/Vetro`）、`sync.username`、`sync.password`（或应用专用 token）。
- 凭证用 Electron `safeStorage`（DPAPI / Keychain）加密保存，**明文不落盘**。
- 鉴权：HTTP Basic（多数 WebDAV 服务器支持）。

## 6. 同步流程

1. **启动**（enabled）→ `PROPFIND` 拉远端清单；
2. 与本地比对（`updatedAt` ↔ 远端 `getlastmodified`）：
   - 本地更新 → `PUT` 推送；
   - 远端更新 → `GET` 拉取覆盖；
   - 双方冲突 → 最后写入者胜（较新时间戳）；
   - 仅一端存在 → 上传（本地独有）或下载（远端独有）。
3. **编辑**：本地保存防抖 ~1s 后 `PUT`；
4. **删除**：`DELETE`；撤销恢复后重新 `PUT`；
5. **状态指示**：状态栏「已同步 / 同步中 / 失败(重试)」+ 设置里「立即同步」。

## 7. 冲突与时间戳

- 主要依赖远端 `getlastmodified`（**秒级精度**）。
- 秒级精度下「同一秒内多设备编辑」可能漏判冲突。如需更精确：
  - 方案 A：每个 `.md` 加 YAML frontmatter 存 `updatedAt`（毫秒，自包含、可读）；
  - 方案 B：旁路 `_vetro-sync.json` 存 `文件名 → { id, updatedAt }` 映射（不污染正文）。
- **v1 先做秒级 last-write-wins，并标注此限制。**

## 8. 安全与隐私

- 全链路 HTTPS；凭证 safeStorage 加密；
- 文档同步到你自己的 WebDAV 服务器（自托管 = 自己掌控）；第三方服务（坚果云等）按其隐私政策；
- **AI 的 API Key 不参与同步**，仍每台设备本地加密保存。

## 9. 限制

- 无实时协作、无版本历史、无回收站（删除即删远端）；
- 文件名需安全化，重命名产生「删旧建新」；
- 秒级时间戳精度（见 §7）。

## 10. 待确认

- 是否需要「回收站 / 软删除」？
- 是否加 frontmatter / 旁路时间戳做毫秒级冲突检测？
- 是否支持「部分文档同步」或「自定义同步目录」？
