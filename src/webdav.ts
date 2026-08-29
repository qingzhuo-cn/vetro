// WebDAV 客户端（通过 Tauri HTTP 代理，支持 PROPFIND/PUT/GET/MKCOL/DELETE）。
import { httpRequest } from './backend';
import type { Doc, SyncConfig, TrashItem } from './types';

export class WebDavError extends Error {
  readonly status: number;
  readonly path: string;
  readonly code: 'http' | 'network' | 'not_found' | 'invalid_config';

  constructor(message: string, options: { status?: number; path?: string; code?: WebDavError['code'] } = {}) {
    super(message);
    this.name = 'WebDavError';
    this.status = options.status ?? 0;
    this.path = options.path ?? '';
    this.code = options.code ?? (this.status === 404 ? 'not_found' : 'http');
  }
}

export interface SyncSnapshot {
  version: 1;
  updatedAt: number;
  docs: Doc[];
  trash: TrashItem[];
}

const SNAPSHOT_FILE = '/.vetro-state.json';

function baseUrl(cfg: SyncConfig): string {
  const raw = (cfg.url || '').trim().replace(/\/+$/, '');
  if (!raw) throw new WebDavError('请先填写 WebDAV 服务器地址', { code: 'invalid_config' });
  if (!/^https?:\/\//i.test(raw)) throw new WebDavError('WebDAV 地址必须以 http:// 或 https:// 开头', { code: 'invalid_config' });
  return raw;
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

async function request(
  cfg: SyncConfig,
  method: string,
  path: string,
  extraHeaders: Record<string, string> = {},
  body?: string,
) {
  try {
    return await httpRequest({
      url: baseUrl(cfg) + path,
      method,
      headers: { ...extraHeaders, ...authHeader(cfg) },
      body,
      timeout_secs: 30,
    });
  } catch (e) {
    throw new WebDavError(`WebDAV 网络请求失败：${e instanceof Error ? e.message : String(e)}`, { path, code: 'network' });
  }
}

function makeHttpError(method: string, status: number, path: string, body: string): WebDavError {
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 200);
  const message = status === 401 || status === 403
    ? `${method} ${status}：账号或密码错误，请使用 WebDAV 应用密码`
    : `${method} ${status}${detail ? `：${detail}` : ''}`;
  return new WebDavError(message, { status, path, code: status === 404 ? 'not_found' : 'http' });
}

/** 列出目录下的文件路径（解析 PROPFIND 返回的 href）。 */
export function parseHrefs(xml: string): string[] {
  const out: string[] = [];
  const re = /<[a-zA-Z0-9_-]*:?href[^>]*>([^<]+)<\/[a-zA-Z0-9_-]*:?href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    let h = m[1].trim();
    try { h = decodeURIComponent(h); } catch { /* keep raw */ }
    if (!h || h.endsWith('/')) continue;
    // 部分服务器返回完整 URL（http://host/path），剥掉 origin 只留路径，避免拼接出非法请求地址
    h = h.replace(/^https?:\/\/[^/]+/i, '');
    out.push(h);
  }
  return out;
}

export async function webdavList(cfg: SyncConfig, path = '/'): Promise<string[]> {
  const { status, body } = await request(cfg, 'PROPFIND', path, { Depth: '1' });
  if (status >= 400) throw makeHttpError('PROPFIND', status, path, body);
  return parseHrefs(body);
}

export async function webdavGet(cfg: SyncConfig, path: string): Promise<string> {
  const { status, body } = await request(cfg, 'GET', path);
  if (status >= 400) throw makeHttpError('GET', status, path, body);
  return body;
}

export async function webdavPut(cfg: SyncConfig, path: string, content: string): Promise<void> {
  const { status, body } = await request(cfg, 'PUT', path, { 'Content-Type': 'text/markdown;charset=utf-8' }, content);
  if (status >= 400) throw makeHttpError('PUT', status, path, body);
}

export async function webdavMkcol(cfg: SyncConfig, path: string): Promise<void> {
  const { status, body } = await request(cfg, 'MKCOL', path);
  // 405 = 目录已存在
  if (status >= 400 && status !== 405) throw makeHttpError('MKCOL', status, path, body);
}

export async function webdavDelete(cfg: SyncConfig, path: string): Promise<void> {
  const { status, body } = await request(cfg, 'DELETE', path);
  if (status >= 400 && status !== 404) throw makeHttpError('DELETE', status, path, body);
}

/** 连接测试：OPTIONS 被拒绝时再用 Depth:0 的 PROPFIND。 */
export async function webdavTest(cfg: SyncConfig): Promise<void> {
  const first = await request(cfg, 'OPTIONS', '/');
  if (first.status === 401 || first.status === 403) throw makeHttpError('OPTIONS', first.status, '/', first.body);
  if (first.status >= 200 && first.status < 400) return;
  if (![405, 501].includes(first.status)) throw makeHttpError('OPTIONS', first.status, '/', first.body);
  const second = await request(cfg, 'PROPFIND', '/', { Depth: '0' });
  if (second.status >= 400) throw makeHttpError('PROPFIND', second.status, '/', second.body);
}

function isDoc(value: unknown): value is Doc {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<Doc>;
  return typeof d.id === 'string' && typeof d.name === 'string' && typeof d.content === 'string' && typeof d.updatedAt === 'number';
}

function isTrash(value: unknown): value is TrashItem {
  return isDoc(value) && typeof (value as TrashItem).deletedAt === 'number';
}

export function validateSnapshot(value: unknown): SyncSnapshot {
  if (!value || typeof value !== 'object') throw new WebDavError('云端同步文件不是 JSON 对象');
  const raw = value as Partial<SyncSnapshot>;
  if (raw.version !== 1 || !Array.isArray(raw.docs) || !Array.isArray(raw.trash) || !raw.docs.every(isDoc) || !raw.trash.every(isTrash)) {
    throw new WebDavError('云端同步文件格式不受支持或已损坏');
  }
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    docs: raw.docs,
    trash: raw.trash,
  };
}

export async function webdavGetSnapshot(cfg: SyncConfig): Promise<SyncSnapshot | null> {
  try {
    const text = await webdavGet(cfg, SNAPSHOT_FILE);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new WebDavError('云端同步文件不是有效 JSON', { path: SNAPSHOT_FILE }); }
    return validateSnapshot(parsed);
  } catch (e) {
    if (e instanceof WebDavError && e.code === 'not_found') return null;
    throw e;
  }
}

export async function webdavPutSnapshot(cfg: SyncConfig, snapshot: SyncSnapshot): Promise<void> {
  const safe: SyncSnapshot = {
    version: 1,
    updatedAt: snapshot.updatedAt,
    docs: snapshot.docs.filter(isDoc),
    trash: snapshot.trash.filter(isTrash),
  };
  await webdavPut(cfg, SNAPSHOT_FILE, JSON.stringify(safe));
}

/** 编码文件名到 URL 路径段（保留中文，编码空格等非法字符）。 */
export function encodePath(name: string): string {
  return '/' + name.split('/').map(encodeURIComponent).join('/');
}
