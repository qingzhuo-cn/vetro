use std::collections::HashMap;

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
            http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
