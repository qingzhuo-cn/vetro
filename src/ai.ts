// AI 请求封装（走 Tauri HTTP 代理，绕过 CORS；兼容 OpenAI/DeepSeek 等接口）。
import { invoke, Channel } from '@tauri-apps/api/core';
import { httpRequest, isTauri } from './backend';
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

/** 流式对话补全：逐段回调 onDelta（Tauri 走 ai_stream Channel；浏览器回退为非流式）。 */
export async function chatCompletionStream(
  cfg: AiConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<void> {
  const endpoint = normalizeEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error('请先填写接口地址');
  const headers = {
    'Content-Type': 'application/json',
    ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
  };
  const body = JSON.stringify({ model: cfg.model || 'deepseek-chat', messages, stream: true });

  if (isTauri) {
    const channel = new Channel<string>();
    channel.onmessage = (delta) => onDelta(delta);
    await invoke('ai_stream', {
      req: { url: endpoint + '/chat/completions', method: 'POST', headers, body, timeout_secs: 120 },
      onChunk: channel,
    });
    return;
  }

  // 浏览器回退：非流式，一次性回调
  const text = await chatCompletion(cfg, messages);
  onDelta(text);
}
