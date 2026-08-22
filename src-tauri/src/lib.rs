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

/* ===== 文件读写 ===== */

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败：{e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入失败：{e}"))
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

    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("非法 HTTP 方法：{e}"))?;

    let mut builder = reqwest::Client::builder();
    if let Some(t) = req.timeout_secs {
        builder = builder.timeout(std::time::Duration::from_secs(t.max(1)));
    }
    let client = builder.build().map_err(|e| e.to_string())?;

    let mut rb = client.request(method, &req.url);
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

    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("非法 HTTP 方法：{e}"))?;
    let client = reqwest::Client::new();
    let mut rb = client.request(method, &req.url);
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
    rusqlite::Connection::open(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_init(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(id UNINDEXED, name, content);",
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save(app: tauri::AppHandle, state_json: String, docs_json: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    conn.execute(
        "INSERT OR REPLACE INTO kv (key, value) VALUES ('state', ?1)",
        rusqlite::params![state_json],
    )
    .map_err(|e| e.to_string())?;

    let docs: Vec<DocForIndex> = serde_json::from_str(&docs_json).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM docs_fts", []).map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("INSERT INTO docs_fts (id, name, content) VALUES (?1, ?2, ?3)")
            .map_err(|e| e.to_string())?;
        for d in &docs {
            stmt.execute(rusqlite::params![d.id, d.name, d.content])
                .map_err(|e| e.to_string())?;
        }
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
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // 转义引号并做短语搜索，中文按字符切分也能精确匹配连续串
    let escaped = q.replace('"', "\"\"");
    let fts_query = format!("\"{escaped}\"");
    let conn = open_db(&app)?;
    let sql = "SELECT id, name, snippet(docs_fts, 2, '[', ']', ' … ', 24) AS s \
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
    Ok(out)
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
