use std::collections::HashMap;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

/* ===== 版本 ===== */

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/* ===== 密钥存储（DPAPI / Keychain / libsecret） ===== */

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new("vetro", &key)
        .map_err(|e| e.to_string())?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("vetro", &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("vetro", &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/* ===== 文件读写（仅限 Markdown/文本文件，防止任意路径读写） ===== */

fn ensure_text_path(path: &str) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("路径为空".into());
    }
    let ext = std::path::Path::new(p)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    // 无扩展名也放行：部分编辑器习惯保存无后缀的纯文本
    const ALLOWED: [&str; 3] = ["md", "markdown", "txt"];
    if !ext.is_empty() && !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("仅允许读写 Markdown/文本文件（.{ext} 不在白名单）"));
    }
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    ensure_text_path(&path)?;
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败：{e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    ensure_text_path(&path)?;
    std::fs::write(&path, content).map_err(|e| format!("写入失败：{e}"))
}

/* ===== 图片目录 ===== */

#[tauri::command]
fn get_images_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let img_dir = dir.join("images");
    std::fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    Ok(img_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn write_binary_file(path: String, data_url: String) -> Result<(), String> {
    // 从 data URL 中提取 base64 数据并解码写入
    use base64::Engine;
    let parts: Vec<&str> = data_url.splitn(2, ',').collect();
    if parts.len() != 2 { return Err("无效的 data URL".into()); }
    let b64 = parts[1];
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 解码失败：{e}"))?;
    // 校验扩展名：仅允许图片文件
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    const ALLOWED: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("仅允许写入图片文件（.{ext}）"));
    }
    // 确保父目录存在
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("写入失败：{e}"))
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取失败：{e}"))?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{b64}"))
}

/* ===== 文件对话框 ===== */

fn path_to_string(fp: FilePath) -> String {
    match fp {
        FilePath::Path(p) => p.to_string_lossy().to_string(),
        FilePath::Url(u) => u.to_string(),
    }
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .add_filter("所有文件", &["*"])
        .blocking_pick_file();
    Ok(picked.map(path_to_string))
}

#[tauri::command]
fn save_file_dialog(app: tauri::AppHandle, default_name: Option<String>) -> Result<Option<String>, String> {
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .add_filter("所有文件", &["*"]);
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    let picked = builder.blocking_save_file();
    Ok(picked.map(path_to_string))
}

/* ===== HTTP 代理（绕过 CORS，用于 AI / WebDAV / 更新检查） ===== */

/// 出站请求校验：仅放行 http/https；阻断云元数据链路本地段（169.254.0.0/16、fe80::/10），
/// 防止前端被注入后借此探测/窃取实例凭据。局域网地址（NAS WebDAV、本机 LLM 服务）保留可用。
fn validate_outbound_url(raw: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(raw.trim()).map_err(|e| format!("非法 URL：{e}"))?;
    match u.scheme() {
        "http" | "https" => {}
        s => return Err(format!("不允许的协议：{s}")),
    }
    let host = u.host_str().unwrap_or("");
    if host.is_empty() {
        return Err("URL 缺少主机名".into());
    }
    let blocked = match u.host() {
        Some(url::Host::Ipv4(v4)) => v4.is_link_local() || v4.is_broadcast(),
        Some(url::Host::Ipv6(v6)) => {
            // IPv4-mapped IPv6（::ffff:169.254.x.x）需还原为 v4 再判，否则可绕过元数据拦截
            if let Some(v4) = v6.to_ipv4_mapped() {
                v4.is_link_local() || v4.is_broadcast()
            } else {
                (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 链路本地
            }
        }
        _ => false, // 域名：由系统解析，这里不做 DNS 级拦截
    };
    if blocked {
        return Err("禁止访问链路本地/元数据地址".into());
    }
    Ok(u)
}

#[derive(serde::Deserialize)]
struct HttpRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    timeout_secs: Option<u64>,
}

#[derive(serde::Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    use reqwest::header::{HeaderName, HeaderValue};

    let url = validate_outbound_url(&req.url)?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("非法 HTTP 方法：{e}"))?;

    let mut builder = reqwest::Client::builder();
    if let Some(t) = req.timeout_secs {
        builder = builder.timeout(std::time::Duration::from_secs(t.max(1)));
    }
    let client = builder.build().map_err(|e| e.to_string())?;

    let mut rb = client.request(method, url);
    for (k, v) in &req.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::try_from(k.as_str()),
            HeaderValue::try_from(v.as_str()),
        ) {
            rb = rb.header(name, value);
        }
    }
    if let Some(body) = &req.body {
        rb = rb.body(body.clone());
    }

    let res = rb.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, headers, body })
}

/* ===== AI 流式输出（SSE 通过 Channel 推送给前端） ===== */

#[tauri::command]
async fn ai_stream(req: HttpRequest, on_chunk: tauri::ipc::Channel<String>) -> Result<(), String> {
    use futures_util::StreamExt;
    use reqwest::header::{HeaderName, HeaderValue};

    let url = validate_outbound_url(&req.url)?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("非法 HTTP 方法：{e}"))?;
    let client = reqwest::Client::new();
    let mut rb = client.request(method, url);
    for (k, v) in &req.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::try_from(k.as_str()),
            HeaderValue::try_from(v.as_str()),
        ) {
            rb = rb.header(name, value);
        }
    }
    if let Some(body) = &req.body {
        rb = rb.body(body.clone());
    }

    let res = rb.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if status >= 400 {
        let body = res.text().await.map_err(|e| e.to_string())?;
        let tail: String = body.chars().take(300).collect();
        return Err(format!("HTTP {status}：{tail}"));
    }

    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut done = false;
    while !done {
        match stream.next().await {
            Some(Ok(chunk)) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(idx) = buf.find('\n') {
                    let line = buf[..idx].to_string();
                    buf.drain(..=idx);
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let data = data.trim();
                    if data == "[DONE]" {
                        done = true;
                        break;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        let delta = &v["choices"][0]["delta"];
                        let reasoning = delta["reasoning_content"].as_str().unwrap_or("");
                        let content = delta["content"].as_str().unwrap_or("");
                        // reasoner 模型的思考内容先流式输出，再接正式回答
                        if !reasoning.is_empty() {
                            let _ = on_chunk.send(format!("🧠 {reasoning}"));
                        }
                        if !content.is_empty() {
                            let _ = on_chunk.send(content.to_string());
                        }
                    }
                }
            }
            Some(Err(e)) => return Err(e.to_string()),
            None => break,
        }
    }
    Ok(())
}

/* ===== SQLite 存储 + FTS5 全文搜索 ===== */

#[derive(serde::Deserialize)]
struct DocForIndex {
    id: String,
    name: String,
    content: String,
}

#[derive(serde::Serialize)]
struct SearchHit {
    id: String,
    name: String,
    snippet: String,
}

fn open_db(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("vetro.db");
    let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
    // WAL 提升并发读写稳定性；PRAGMA 返回结果行，用 query_row 显式消费
    let _mode: String = conn
        .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// docs_fts 的建表语句（含 trigram 分词器）。旧版本无分词器参数，需要迁移重建。
const FTS_DDL: &str =
    "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, name, content, tokenize = 'trigram')";

fn ensure_fts_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    let sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'docs_fts'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    match sql {
        Some(existing) => {
            if !existing.contains("trigram") {
                // 旧 schema：丢弃重建（索引会在下次保存时全量补齐）
                conn.execute_batch("DROP TABLE docs_fts;").map_err(|e| e.to_string())?;
                conn.execute_batch(FTS_DDL).map_err(|e| e.to_string())?;
            }
        }
        None => {
            conn.execute_batch(FTS_DDL).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn db_init(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    ensure_fts_schema(&conn)
}

#[tauri::command]
fn db_save(app: tauri::AppHandle, state_json: String, docs_json: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    ensure_fts_schema(&conn)?;
    let docs: Vec<DocForIndex> = serde_json::from_str(&docs_json).map_err(|e| e.to_string())?;

    // 状态与索引在同一个事务里，避免状态落盘而索引未更新
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES ('state', ?1)",
        rusqlite::params![state_json],
    )
    .map_err(|e| e.to_string())?;

    // 增量更新：逐条 upsert，再清掉已删除文档的残留行
    {
        let mut del_stmt = tx
            .prepare("DELETE FROM docs_fts WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut ins_stmt = tx
            .prepare("INSERT INTO docs_fts (id, name, content) VALUES (?1, ?2, ?3)")
            .map_err(|e| e.to_string())?;
        for d in &docs {
            del_stmt.execute(rusqlite::params![d.id]).map_err(|e| e.to_string())?;
            ins_stmt
                .execute(rusqlite::params![d.id, d.name, d.content])
                .map_err(|e| e.to_string())?;
        }
    }
    // 删除不在本次集合里的残留（已删除/彻底清除的文档）
    let placeholders = docs
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    if placeholders.is_empty() {
        tx.execute("DELETE FROM docs_fts", []).map_err(|e| e.to_string())?;
    } else {
        let ids: Vec<&str> = docs.iter().map(|d| d.id.as_str()).collect();
        tx.execute(
            &format!("DELETE FROM docs_fts WHERE id NOT IN ({placeholders})"),
            rusqlite::params_from_iter(ids.iter()),
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE key = 'state'")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(row) => {
            let value: String = row.get(0).map_err(|e| e.to_string())?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn db_search(app: tauri::AppHandle, query: String) -> Result<Vec<SearchHit>, String> {
    const MARK_START: &str = "\u{0001}";
    const MARK_END: &str = "\u{0002}";

    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_db(&app)?;
    ensure_fts_schema(&conn)?;
    let char_count = q.chars().count();

    // trigram 分词器要求 ≥3 字符；更短的查询回退到 LIKE 扫描
    let hits: Vec<SearchHit> = if char_count >= 3 {
        // 转义引号并做短语搜索
        let escaped = q.replace('"', "\"\"");
        let fts_query = format!("\"{escaped}\"");
        let sql = "SELECT id, name, snippet(docs_fts, 2, '\u{0001}', '\u{0002}', ' … ', 24) AS s \
                   FROM docs_fts WHERE docs_fts MATCH ?1 ORDER BY rank LIMIT 50";
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query(rusqlite::params![fts_query]).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let name: String = row.get(1).map_err(|e| e.to_string())?;
            let snippet: Option<String> = row.get(2).map_err(|e| e.to_string())?;
            out.push(SearchHit { id, name, snippet: snippet.unwrap_or_default() });
        }
        out
    } else {
        let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let sql = "SELECT id, name, content FROM docs_fts \
                   WHERE content LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' LIMIT 200";
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query(rusqlite::params![like]).map_err(|e| e.to_string())?;
        let mut out: Vec<SearchHit> = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let name: String = row.get(1).map_err(|e| e.to_string())?;
            let content: String = row.get(2).map_err(|e| e.to_string())?;
            // 手工截取命中窗口作为摘要（按字符索引，避免字节边界问题）
            let needle: Vec<char> = q.to_lowercase().chars().collect();
            let hay: Vec<char> = content.chars().collect();
            let hay_lower: Vec<char> = content.to_lowercase().chars().collect();
            let snippet = match hay_lower.windows(needle.len().max(1)).position(|w| w == needle) {
                Some(pos) => {
                    let start = pos.saturating_sub(40);
                    let end = (pos + needle.len() + 20).min(hay.len());
                    let mut s = String::new();
                    if start > 0 { s.push('…'); }
                    s.extend(&hay[start..pos]);
                    s.push_str(MARK_START);
                    s.extend(&hay[pos..pos + needle.len()]);
                    s.push_str(MARK_END);
                    s.extend(&hay[(pos + needle.len())..end]);
                    if end < hay.len() { s.push('…'); }
                    s
                }
                None => hay.iter().take(60).collect(),
            };
            out.push(SearchHit { id, name, snippet });
            if out.len() >= 50 {
                break;
            }
        }
        // 名称命中的排前面
        let ql = q.to_lowercase();
        out.sort_by_key(|h| !h.name.to_lowercase().contains(&ql));
        out
    };

    Ok(hits)
}

/* ===== 入口 ===== */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_version,
            secure_set,
            secure_get,
            secure_delete,
            read_text_file,
            write_text_file,
            write_binary_file,
            read_binary_file,
            get_images_dir,
            open_file_dialog,
            save_file_dialog,
            http_request,
            ai_stream,
            db_init,
            db_save,
            db_load,
            db_search
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
