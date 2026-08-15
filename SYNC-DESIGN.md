# Vetro 文档云同步 · 方案设计（Cloudflare，云端 / Web 版）

> 状态：**草案，未实现**。适用于「云端 / Web 版」的跨设备同步。
>
> 桌面版（Tauri 2）的文档同步采用 **WebDAV**，**已实现**，见 `WEBDAV-SYNC-DESIGN.md`。

## 1. 目标与范围

- 跨设备同步文档（列表、名称、内容、时间戳）。
- 定位：单用户、个人自用为主，不承诺多人实时协作。
- **AI API Key 不参与同步**（桌面版存钥匙串；Web 版仅本地混淆存储）。
- 保持静态部署：仅新增 Pages Functions + D1，不引入独立服务器。

## 2. 架构

```
浏览器 (Vetro Web)
   │  HTTPS 同源
   ▼
Cloudflare Pages
   ├── /          → 静态资源（前端构建产物）
   └── /api/*     → Pages Functions（同步 API）
                        │
                        ▼
                 Cloudflare D1 (SQLite)
```

- API 与页面同域名，天然无 CORS 问题。
- 纯静态 + 边缘函数，无需自建服务器、无需运维数据库实例。

## 3. 数据模型（D1）

```sql
CREATE TABLE IF NOT EXISTS docs (
  id         TEXT PRIMARY KEY,   -- 文档 id（复用前端 uid()）
  token_hash TEXT NOT NULL,      -- SHA-256(同步密钥)，用于数据隔离
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  updated_at INTEGER NOT NULL,   -- 毫秒时间戳
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_token_updated ON docs(token_hash, updated_at);
```

- 存 `token_hash` 而非明文 token，避免库泄露时直接暴露密钥。

## 4. API

鉴权：每个请求携带 `Authorization: Bearer <sync-token>`。服务端校验 token 非空且长度 ≤ 128，计算 `token_hash = SHA-256(token)`，所有查询按 `token_hash` 隔离。

### `GET /api/docs`
拉取元数据列表（不含正文，省流量）。

```json
{ "docs": [ { "id": "abc", "name": "a.md", "updatedAt": 1710000000000, "createdAt": 1710000000000 } ] }
```

### `GET /api/docs/:id`
拉取单个文档全文。404 返回 `{ "error": "not_found" }`。

```json
{ "id": "abc", "name": "a.md", "content": "# 标题", "updatedAt": 1710000000000, "createdAt": 1710000000000 }
```

### `PUT /api/docs/:id`
上传 / 更新（upsert）。

```json
{ "name": "a.md", "content": "# 标题", "updatedAt": 1710000000000, "createdAt": 1710000000000 }
```

```json
{ "ok": true, "id": "abc", "updatedAt": 1710000000000 }
```

```json
{ "ok": false, "conflict": true, "server": { "id": "abc", "name": "a.md", "content": "…", "updatedAt": 1710000000001, "createdAt": 1710000000000 } }
```

**冲突策略（最后写入者胜）**：无记录 → 插入；`body.updatedAt >= 记录.updated_at` → 覆盖；否则返回 409 + 服务器当前版本。

### `DELETE /api/docs/:id`

```json
{ "ok": true }
```

## 5. 前端同步逻辑

配置项（新版 `cfg.sync` 结构）：

```json
{ "enabled": false, "url": "", "username": "", "password": "" }
```

WebDAV 版用 `url + username + password`；云端版可扩展为 `endpoint` + `token`。

流程：

1. **启动时**（`enabled` 为真）→ `GET /api/docs` 拉元数据，与本地 `updatedAt` 对比：
   - 本地更新 → `PUT` 推送；
   - 云端更新 → `GET` 拉取覆盖本地；
   - 双方冲突 → 以 `updatedAt` 大者为准。
2. **编辑时**：本地保存后（防抖 ~1s）→ `PUT` 当前文档。
3. **删除时**：`DELETE`；本地的「撤销」恢复后重新 `PUT`。
4. **状态指示**：状态栏显示「已同步 / 同步中 / 同步失败（可重试）」。
5. **手动**：设置里提供「立即同步」按钮。

错误处理：网络失败 → 保留本地、标记未同步、稍后重试；409 → 采纳服务器版本。

## 6. 安全与隐私

- 全链路 HTTPS；文档仅经同源 API 传输。
- `token_hash` 隔离：不同密钥的数据互不可见。
- **开启同步后，文档会存储在 Cloudflare D1**（静态加密，但明文对 Cloudflare 可见）——与桌面版「本地 SQLite」不同，需在 UI 明示。
- 可选增强：客户端加密（上传前密码加密）——牺牲搜索 / 服务器端合并，本方案暂不包含。
- 可选：per-token 限流、Cloudflare Access 鉴权。

## 7. 部署

1. 在 `cloud` 分支加入：
   - `wrangler.toml`（`pages_build_output_dir` 指向前端构建产物，`d1_databases` binding）
   - `functions/api/[[path]].js`（或按文件路由拆分）
2. 创建 D1 并建表：

   ```bash
   npx wrangler d1 create vetro-sync
   npx wrangler d1 execute vetro-sync --file=db/schema.sql
   ```

3. 把 D1 binding 关联到 Pages 项目，`npx wrangler pages deploy`。

## 8. 已知限制

- 最后写入者胜：多设备同时改同一文档，较新时间戳覆盖较旧（个人使用可接受）。
- 无实时协作、无版本历史、无回收站（删除即删）。
- 同步粒度是「整篇文档」，不做行级 / 增量 diff。

## 9. 待确认项

- 是否需要「回收站 / 软删除」（便于误删恢复）？
- 是否需要客户端加密？
- 是否要 per-token 限流或 Cloudflare Access 鉴权？
