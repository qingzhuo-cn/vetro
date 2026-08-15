// AI 请求封装（走 Tauri HTTP 代理，绕过 CORS；兼容 OpenAI/DeepSeek 等接口）。
import { httpRequest } from './backend';
import type { AiConfig } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function normalizeEndpoint(e: string): string {
  let u = (e || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

/** 拉取模型列表：GET {endpoint}/models */
export async function fetchModels(cfg: AiConfig): Promise<string[]> {
  const endpoint = normalizeEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error('请先填写接口地址');
  const res = await httpRequest({
    url: endpoint + '/models',
    method: 'GET',
    headers: cfg.key ? { Authorization: 'Bearer ' + cfg.key } : undefined,
    timeout_secs: 30,
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}：${res.body.slice(0, 200)}`);
  const data = JSON.parse(res.body);
  const list: string[] = ((data.data as unknown[]) || [])
    .map((m) => (m as { id?: string })?.id)
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (!list.length) throw new Error('接口未返回模型列表');
  return list;
}

/** 非流式对话补全：POST {endpoint}/chat/completions */
export async function chatCompletion(cfg: AiConfig, messages: ChatMessage[]): Promise<string> {
  const endpoint = normalizeEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error('请先填写接口地址');
  const res = await httpRequest({
    url: endpoint + '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
    },
    body: JSON.stringify({ model: cfg.model || 'deepseek-chat', messages, stream: false }),
    timeout_secs: 120,
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}：${res.body.slice(0, 300)}`);
  const data = JSON.parse(res.body);
  return data.choices?.[0]?.message?.content ?? '';
}
