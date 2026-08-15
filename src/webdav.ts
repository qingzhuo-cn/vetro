// WebDAV 客户端（通过 Tauri HTTP 代理，支持 PROPFIND/PUT/GET/MKCOL/DELETE）。
import { httpRequest } from './backend';
import type { SyncConfig } from './types';

function baseUrl(cfg: SyncConfig): string {
  return (cfg.url || '').trim().replace(/\/+$/, '');
}

function base64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function authHeader(cfg: SyncConfig): Record<string, string> {
  if (!cfg.username) return {};
  return { Authorization: 'Basic ' + base64(cfg.username + ':' + cfg.password) };
}

/** 列出目录下的文件路径（解析 PROPFIND 返回的 href）。 */
export function parseHrefs(xml: string): string[] {
  const out: string[] = [];
  const re = /<[a-zA-Z0-9_-]*:?href[^>]*>([^<]+)<\/[a-zA-Z0-9_-]*:?href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    let h = m[1].trim();
    try { h = decodeURIComponent(h); } catch { /* keep raw */ }
    if (h && !h.endsWith('/')) out.push(h);
  }
  return out;
}

export async function webdavList(cfg: SyncConfig, path = '/'): Promise<string[]> {
  const res = await httpRequest({
    url: baseUrl(cfg) + path,
    method: 'PROPFIND',
    headers: { Depth: '1', ...authHeader(cfg) },
    timeout_secs: 30,
  });
  if (res.status >= 400) throw new Error(`PROPFIND ${res.status}：${res.body.slice(0, 200)}`);
  return parseHrefs(res.body);
}

export async function webdavGet(cfg: SyncConfig, path: string): Promise<string> {
  const res = await httpRequest({
    url: baseUrl(cfg) + path,
    method: 'GET',
    headers: authHeader(cfg),
    timeout_secs: 30,
  });
  if (res.status >= 400) throw new Error(`GET ${res.status}：${res.body.slice(0, 200)}`);
  return res.body;
}

export async function webdavPut(cfg: SyncConfig, path: string, content: string): Promise<void> {
  const res = await httpRequest({
    url: baseUrl(cfg) + path,
    method: 'PUT',
    headers: { 'Content-Type': 'text/markdown;charset=utf-8', ...authHeader(cfg) },
    body: content,
    timeout_secs: 30,
  });
  if (res.status >= 400) throw new Error(`PUT ${res.status}：${res.body.slice(0, 200)}`);
}

export async function webdavMkcol(cfg: SyncConfig, path: string): Promise<void> {
  const res = await httpRequest({
    url: baseUrl(cfg) + path,
    method: 'MKCOL',
    headers: authHeader(cfg),
    timeout_secs: 30,
  });
  // 405 = 目录已存在
  if (res.status >= 400 && res.status !== 405) throw new Error(`MKCOL ${res.status}：${res.body.slice(0, 200)}`);
}

export async function webdavDelete(cfg: SyncConfig, path: string): Promise<void> {
  const res = await httpRequest({
    url: baseUrl(cfg) + path,
    method: 'DELETE',
    headers: authHeader(cfg),
    timeout_secs: 30,
  });
  if (res.status >= 400 && res.status !== 404) throw new Error(`DELETE ${res.status}：${res.body.slice(0, 200)}`);
}

/** 编码文件名到 URL 路径段（保留中文，编码空格等非法字符）。 */
export function encodePath(name: string): string {
  return '/' + name.split('/').map(encodeURIComponent).join('/');
}
