// Vetro 后端桥接层：Tauri 命令封装 + 浏览器开发环境回退。
import { invoke } from '@tauri-apps/api/core';

/** 是否运行在 Tauri 桌面壳内 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

/* ===== 版本 ===== */
export function getVersion(): Promise<string> {
  if (isTauri) return invoke<string>('get_version');
  return Promise.resolve('2.0.0');
}

/* ===== 密钥存储 ===== */
export async function secureSet(key: string, value: string): Promise<void> {
  if (isTauri) {
    await invoke('secure_set', { key, value });
    return;
  }
  localStorage.setItem('vetro::secret::' + key, value);
}

export async function secureGet(key: string): Promise<string | null> {
  if (isTauri) return invoke<string | null>('secure_get', { key });
  return localStorage.getItem('vetro::secret::' + key);
}

export async function secureDelete(key: string): Promise<void> {
  if (isTauri) {
    await invoke('secure_delete', { key });
    return;
  }
  localStorage.removeItem('vetro::secret::' + key);
}

/* ===== 文件读写 ===== */
export async function readTextFile(path: string): Promise<string> {
  if (isTauri) return invoke<string>('read_text_file', { path });
  throw new Error('浏览器环境不支持直接读取本地文件');
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isTauri) {
    await invoke('write_text_file', { path, content });
    return;
  }
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
  if (isTauri) return invoke<string | null>('open_file_dialog');
  return null;
}

export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  if (isTauri) return invoke<string | null>('save_file_dialog', { defaultName: defaultName ?? null });
  return null;
}

/* ===== HTTP 代理 ===== */
export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
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
