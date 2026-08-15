// Vetro 后端桥接层：Tauri 命令 / HarmonyOS 原生桥 / 浏览器回退。
import { invoke } from '@tauri-apps/api/core';

/** 是否运行在 Tauri 桌面壳内 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * HarmonyOS H5 壳原生桥：DevEco 中 registerJavaScriptProxy 把原生对象暴露为 window.vetroNative。
 * 契约：dbInit/dbSave/dbLoad/dbSearch、secureSet/Get/Delete、httpRequest、saveFile/writeFile/readFile/openFile。
 * 存在时优先走原生桥（SQLite / 钥匙串 / 网络无 CORS 限制）。
 */
function bridge(): any {
  return typeof window !== 'undefined' ? (window as any).vetroNative ?? null : null;
}

export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_secs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SearchHit {
  id: string;
  name: string;
  snippet: string;
}

/* ===== 版本 ===== */
export function getVersion(): Promise<string> {
  if (isTauri) return invoke<string>('get_version');
  return Promise.resolve('2.2.0');
}

/* ===== 密钥存储（DPAPI / Keychain / 鸿蒙安全存储 / localStorage 兜底） ===== */
export async function secureSet(key: string, value: string): Promise<void> {
  const b = bridge();
  if (b) { b.secureSet(key, value); return; }
  if (isTauri) { await invoke('secure_set', { key, value }); return; }
  localStorage.setItem('vetro::secret::' + key, value);
}

export async function secureGet(key: string): Promise<string | null> {
  const b = bridge();
  if (b) { const v = b.secureGet(key); return v ?? null; }
  if (isTauri) return invoke<string | null>('secure_get', { key });
  return localStorage.getItem('vetro::secret::' + key);
}

export async function secureDelete(key: string): Promise<void> {
  const b = bridge();
  if (b) { b.secureDelete(key); return; }
  if (isTauri) { await invoke('secure_delete', { key }); return; }
  localStorage.removeItem('vetro::secret::' + key);
}

/* ===== 文件读写 ===== */
export async function readTextFile(path: string): Promise<string> {
  const b = bridge();
  if (b) { const v = b.readFile(path); if (v != null) return v; }
  if (isTauri) return invoke<string>('read_text_file', { path });
  throw new Error('浏览器环境不支持直接读取本地文件');
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  const b = bridge();
  if (b) { b.writeFile(path, content); return; }
  if (isTauri) { await invoke('write_text_file', { path, content }); return; }
  // 浏览器回退：触发下载
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split(/[\\/]/).pop() || 'document.md';
  a.click();
  URL.revokeObjectURL(url);
}

/* ===== 文件对话框 ===== */
export async function openFileDialog(): Promise<string | null> {
  const b = bridge();
  if (b) { const v = b.openFile(); return v ?? null; }
  if (isTauri) return invoke<string | null>('open_file_dialog');
  return null;
}

export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  const b = bridge();
  if (b) { const v = b.saveFile(defaultName ?? ''); return v ?? null; }
  if (isTauri) return invoke<string | null>('save_file_dialog', { defaultName: defaultName ?? null });
  return null;
}

/* ===== HTTP 代理（Tauri reqwest / 鸿蒙桥 / fetch 兜底） ===== */
export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const b = bridge();
  if (b) return b.httpRequest(req) as HttpResponse;
  if (isTauri) return invoke<HttpResponse>('http_request', { req });
  // 浏览器回退：直接 fetch（受 CORS 限制，仅用于开发调试）
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body ?? undefined,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { status: res.status, headers, body: await res.text() };
}

/* ===== SQLite 存储 + FTS5 全文搜索（Tauri rusqlite / 鸿蒙 relationalStore / localStorage 兜底） ===== */

const STORAGE_KEY = 'vetro::v2';

export async function dbInit(): Promise<void> {
  const b = bridge();
  if (b) { b.dbInit(); return; }
  if (isTauri) { await invoke('db_init'); }
}

export async function dbLoadState(): Promise<string | null> {
  const b = bridge();
  if (b) { const v = b.dbLoad(); return v ?? null; }
  if (isTauri) return invoke<string | null>('db_load');
  return localStorage.getItem(STORAGE_KEY);
}

export async function dbSaveState(stateJson: string, docsJson: string): Promise<void> {
  const b = bridge();
  if (b) { b.dbSave(stateJson, docsJson); return; }
  if (isTauri) { await invoke('db_save', { stateJson, docsJson }); return; }
  localStorage.setItem(STORAGE_KEY, stateJson);
}

export async function dbSearch(query: string): Promise<SearchHit[]> {
  const b = bridge();
  if (b) { const v = b.dbSearch(query); return Array.isArray(v) ? v : []; }
  if (isTauri) return invoke<SearchHit[]>('db_search', { query });
  return [];
}
