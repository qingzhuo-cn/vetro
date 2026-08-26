// Vetro 后端桥接层：Tauri 命令 / HarmonyOS 原生桥 / 浏览器回退。
import { invoke } from '@tauri-apps/api/core';
import { encrypt, decrypt, generatePassword } from './crypto';

/** 是否运行在 Tauri 桌面壳内 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * HarmonyOS H5 壳原生桥：DevEco 中 registerJavaScriptProxy 把原生对象暴露为 window.vetroNative。
 * 契约：dbInit/dbSave/dbLoad/dbSearch、secureSet/Get/Delete、httpRequest、saveFile/writeFile/readFile/openFile。
 * 存在时优先走原生桥（SQLite / 钥匙串 / 网络无 CORS 限制）。
 */
interface VetroNative {
  dbInit: () => Promise<void>;
  dbSave: (state: string, docs: string) => Promise<void>;
  dbLoad: () => Promise<string | null>;
  dbSearch: (q: string, limit: number) => Promise<string[]>;
  secureSet: (k: string, v: string) => Promise<void>;
  secureGet: (k: string) => Promise<string | null>;
  secureDelete: (k: string) => Promise<void>;
  httpRequest: (req: HttpRequest) => Promise<HttpResponse>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  openFile: (ext?: string) => Promise<string | null>;
  saveFile: (name?: string) => Promise<string | null>;
  getImagesDir: () => Promise<string>;
  listImagesDir: () => Promise<{ name: string; size: number }[]>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
}
function bridge(): VetroNative | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.vetroNative as VetroNative) ?? null;
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
  // 浏览器开发态 / 鸿蒙 H5 壳的回退版本号，需与 package.json 保持一致
  return Promise.resolve('2.5.0');
}

/* ===== 浏览器端加密密码管理（IndexedDB 存储） ===== */

const DB_NAME = 'vetro-crypto';
const DB_STORE = 'keys';
const DB_KEY = 'browser-password';

function openCryptoDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getBrowserPassword(): Promise<string> {
  const db = await openCryptoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(DB_KEY);
    req.onsuccess = () => {
      const val = req.result as string | undefined;
      if (val) { resolve(val); } else { reject(new Error('no password')); }
    };
    req.onerror = () => reject(req.error);
  });
}

async function setBrowserPassword(pwd: string): Promise<void> {
  const db = await openCryptoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(pwd, DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensureBrowserPassword(): Promise<string> {
  try {
    return await getBrowserPassword();
  } catch {
    const pwd = generatePassword();
    await setBrowserPassword(pwd);
    return pwd;
  }
}

/* ===== 密钥存储（DPAPI / Keychain / 鸿蒙安全存储 / 加密 localStorage 兜底） ===== */
export async function secureSet(key: string, value: string): Promise<void> {
  const b = bridge();
  if (b) { b.secureSet(key, value); return; }
  if (isTauri) { await invoke('secure_set', { key, value }); return; }
  const pwd = await ensureBrowserPassword();
  const enc = await encrypt(value, pwd);
  localStorage.setItem('vetro::secret::' + key, enc);
}

export async function secureGet(key: string): Promise<string | null> {
  const b = bridge();
  if (b) { const v = b.secureGet(key); return v ?? null; }
  if (isTauri) return invoke<string | null>('secure_get', { key });
  const stored = localStorage.getItem('vetro::secret::' + key);
  if (!stored) return null;
  try {
    const pwd = await getBrowserPassword();
    return await decrypt(stored, pwd);
  } catch {
    // 可能是旧版明文数据，尝试直接返回并重新加密存储
    return stored;
  }
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

/* ===== 图片目录 ===== */
export async function getImagesDir(): Promise<string> {
  const b = bridge();
  if (b) return b.getImagesDir?.() || 'images';
  if (isTauri) return invoke<string>('get_images_dir');
  return 'vetro-images';
}

export async function listImagesDir(): Promise<{ name: string; size: number }[]> {
  const b = bridge();
  if (b) return b.listImagesDir?.() ?? [];
  if (isTauri) return invoke<{ name: string; size: number }[]>('list_images_dir');
  // 浏览器：从 IndexedDB 列出
  // (简化实现：返回空数组，浏览器态暂不支持)
  return [];
}

export async function deleteFile(path: string): Promise<void> {
  const b = bridge();
  if (b) { b.deleteFile?.(path); return; }
  if (isTauri) { await invoke('delete_file', { path }); return; }
  throw new Error('浏览器环境不支持文件删除');
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const b = bridge();
  if (b) { b.renameFile?.(oldPath, newPath); return; }
  if (isTauri) { await invoke('rename_file', { oldPath, newPath }); return; }
  throw new Error('浏览器环境不支持文件重命名');
}

/** 写入二进制文件（图片等），dataUrl 为 base64 data URL */
export async function writeBinaryFile(path: string, dataUrl: string): Promise<void> {
  const b = bridge();
  if (b) { b.writeFile(path, dataUrl); return; }
  if (isTauri) { await invoke('write_binary_file', { path, dataUrl }); return; }
  // 浏览器：下载
  const [meta, base64Data] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] || 'application/octet-stream';
  const bin = atob(base64Data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = path.split(/[\\/]/).pop() || 'image'; a.click();
  URL.revokeObjectURL(url);
}

export async function readBinaryFile(path: string): Promise<string> {
  const b = bridge();
  if (b) { const v = b.readFile(path); return v ?? ''; }
  if (isTauri) return invoke<string>('read_binary_file', { path });
  return '';
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
  if (b) return await b.httpRequest(req);
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

/** localStorage 兜底 / 旧数据迁移共用的存储键 */
export const STORAGE_KEY = 'vetro::v2';

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
  if (b) { const v = await b.dbSearch(query, 20); return Array.isArray(v) ? v.map((s) => ({ id: s, name: '', snippet: '' })) : []; }
  if (isTauri) return invoke<SearchHit[]>('db_search', { query });
  // 浏览器回退：对 localStorage 里的文档做朴素包含匹配
  const q = query.trim().toLowerCase();
  if (!q) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const state = JSON.parse(raw) as { docs?: { id: string; name: string; content: string }[] };
    const docs = Array.isArray(state.docs) ? state.docs : [];
    const out: SearchHit[] = [];
    for (const d of docs) {
      const content = d.content || '';
      const idx = content.toLowerCase().indexOf(q);
      const inName = (d.name || '').toLowerCase().includes(q);
      if (idx < 0 && !inName) continue;
      let snippet = '';
      if (idx >= 0) {
        // 与 Rust 端一致：原始文本 + \u0001/\u0002 高亮标记，由 SearchPanel 统一转义并替换为 <mark>
        snippet =
          '…' + content.slice(Math.max(0, idx - 40), idx) +
          '\u0001' + content.slice(idx, idx + q.length) + '\u0002' +
          content.slice(idx + q.length, idx + q.length + 20) + '…';
      }
      out.push({ id: d.id, name: d.name || '', snippet });
      if (out.length >= 50) break;
    }
    // 名称命中的排前面
    return out.sort((a, c) => Number(c.name.toLowerCase().includes(q)) - Number(a.name.toLowerCase().includes(q)));
  } catch {
    return [];
  }
}
