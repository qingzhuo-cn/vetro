// AI 请求封装（走 Tauri HTTP 代理，绕过 CORS；兼容 OpenAI/DeepSeek 等接口）。
import { invoke, Channel } from '@tauri-apps/api/core';
import { httpRequest, isTauri } from './backend';
import type { AiConfig } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequestOptions {
  signal?: AbortSignal;
}

export interface AiPromptContext {
  document: string;
  selectedText: string;
  hasSelection: boolean;
}

export const AI_SYSTEM_PROMPT = [
  '你是 Vetro Markdown 编辑器中的助手。',
  '请直接返回可应用到文档的原始 Markdown，不要包裹在代码围栏中，不要添加解释性前言。',
  '保留用户原文中的 Markdown 语法、链接、代码围栏和换行；只有在任务明确要求时才改写它们。',
].join('');

export const AI_PRESET_ACTIONS = [
  { id: 'polish', label: '润色', instruction: '润色目标内容，提升清晰度、准确性和可读性，保留原意。' },
  { id: 'continue', label: '续写', instruction: '沿着目标内容的语气、结构和主题自然续写。' },
  { id: 'summary', label: '摘要', instruction: '将目标内容压缩为简洁、准确的 Markdown 摘要。' },
  { id: 'translate-en', label: '英译', instruction: '将目标内容翻译成自然准确的英文，保留 Markdown 结构。' },
  { id: 'translate-zh', label: '中译', instruction: '将目标内容翻译成自然准确的简体中文，保留 Markdown 结构。' },
  { id: 'title', label: '拟标题', instruction: '为目标内容拟一个简洁准确的 Markdown 标题，只返回标题文本。' },
  { id: 'fix', label: '修正', instruction: '修正目标内容中的事实、语法、拼写和 Markdown 格式问题，尽量保留原意。' },
  { id: 'explain', label: '解释', instruction: '解释目标内容，让读者容易理解；使用清晰的 Markdown 结构。' },
] as const;

export type AiPresetId = (typeof AI_PRESET_ACTIONS)[number]['id'];

function normalizeEndpoint(e: string): string {
  let u = (e || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

function abortError(): Error {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** 在不改变 Tauri HTTP 请求契约的前提下，为调用方提供取消语义。 */
function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const sample = (text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(sample ? `接口返回了无法解析的内容：${sample}` : '接口返回了空内容');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part;
      const record = asRecord(part);
      return record ? textFromContent(record.text ?? record.content ?? record.value) : '';
    }).join('');
  }
  const record = asRecord(value);
  if (!record) return '';
  return textFromContent(record.text ?? record.content ?? record.value);
}

function completionText(data: unknown): { found: boolean; text: string } {
  const root = asRecord(data);
  if (!root) return { found: false, text: '' };
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = asRecord(choices[0]);
  if (first) {
    const message = asRecord(first.message);
    const messageText = textFromContent(message?.content);
    if (message?.content !== undefined) return { found: true, text: messageText };
    if (first.text !== undefined) return { found: true, text: textFromContent(first.text) };
    const delta = asRecord(first.delta);
    if (delta?.content !== undefined) return { found: true, text: textFromContent(delta.content) };
  }
  if (root.output_text !== undefined) return { found: true, text: textFromContent(root.output_text) };
  if (root.content !== undefined) return { found: true, text: textFromContent(root.content) };
  return { found: false, text: '' };
}

function responseError(status: number, body: string): Error {
  let detail = (body || '').trim().replace(/\s+/g, ' ');
  try {
    const parsed = asRecord(JSON.parse(body));
    const apiError = asRecord(parsed?.error);
    detail = textFromContent(apiError?.message) || textFromContent(parsed?.message) || detail;
  } catch { /* 保留原始响应片段 */ }
  return new Error(`HTTP ${status}${detail ? `：${detail.slice(0, 300)}` : ''}`);
}

function presetById(id: AiPresetId) {
  return AI_PRESET_ACTIONS.find((preset) => preset.id === id) ?? AI_PRESET_ACTIONS[0];
}

export function buildPresetPrompt(id: AiPresetId, context: AiPromptContext): string {
  const preset = presetById(id);
  const target = context.hasSelection ? context.selectedText : context.document;
  const targetLabel = context.hasSelection ? '选中的 Markdown 片段' : '当前文档 Markdown';
  return [
    preset.instruction,
    '只输出最终结果本身，保持原始 Markdown；不要使用 ``` 包裹结果。',
    `${targetLabel}：`,
    '<document>',
    target,
    '</document>',
  ].join('\n\n');
}

export function buildPresetMessages(id: AiPresetId, context: AiPromptContext): ChatMessage[] {
  return [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'user', content: buildPresetPrompt(id, context) },
  ];
}

/** 拉取模型列表：GET {endpoint}/models */
export async function fetchModels(cfg: AiConfig, options: AiRequestOptions = {}): Promise<string[]> {
  const endpoint = normalizeEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error('请先填写接口地址');
  throwIfAborted(options.signal);
  const request = httpRequest({
    url: endpoint + '/models',
    method: 'GET',
    headers: cfg.key ? { Authorization: 'Bearer ' + cfg.key } : undefined,
    timeout_secs: 30,
  });
  const res = await waitWithAbort(request, options.signal);
  if (res.status >= 400) throw responseError(res.status, res.body);
  const data = parseJson(res.body);
  const root = asRecord(data);
  const rawList = Array.isArray(root?.data) ? root.data : Array.isArray(data) ? data : [];
  const list = rawList.map((model) => {
    if (typeof model === 'string') return model;
    return textFromContent(asRecord(model)?.id);
  }).filter((model): model is string => model.length > 0);
  if (!list.length) throw new Error('接口未返回模型列表');
  return list;
}

/** 非流式对话补全：POST {endpoint}/chat/completions */
export async function chatCompletion(
  cfg: AiConfig,
  messages: ChatMessage[],
  options: AiRequestOptions = {},
): Promise<string> {
  const endpoint = normalizeEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error('请先填写接口地址');
  throwIfAborted(options.signal);
  const request = httpRequest({
    url: endpoint + '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
    },
    body: JSON.stringify({ model: cfg.model || 'deepseek-chat', messages, stream: false }),
    timeout_secs: 120,
  });
  const res = await waitWithAbort(request, options.signal);
  if (res.status >= 400) throw responseError(res.status, res.body);
  const result = completionText(parseJson(res.body));
  if (!result.found) throw new Error('接口返回中没有可用的文本回复');
  throwIfAborted(options.signal);
  return result.text;
}

/** 流式对话补全：逐段回调 onDelta（Tauri 走 ai_stream Channel；浏览器回退为非流式）。 */
export async function chatCompletionStream(
  cfg: AiConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options: AiRequestOptions = {},
): Promise<void> {
  const endpoint = normalizeEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error('请先填写接口地址');
  throwIfAborted(options.signal);
  const headers = {
    'Content-Type': 'application/json',
    ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
  };
  const body = JSON.stringify({ model: cfg.model || 'deepseek-chat', messages, stream: true });

  if (!isTauri) {
    // 浏览器回退：保持 HTTP 代理边界，一次性回调非流式结果。
    const text = await chatCompletion(cfg, messages, options);
    if (text) onDelta(text);
    return;
  }

  let received = false;
  const channel = new Channel<string>();
  channel.onmessage = (delta) => {
    if (options.signal?.aborted || !delta) return;
    received = true;
    onDelta(delta);
  };
  const streamRequest = invoke('ai_stream', {
    req: { url: endpoint + '/chat/completions', method: 'POST', headers, body, timeout_secs: 120 },
    onChunk: channel,
  });

  try {
    await waitWithAbort(streamRequest, options.signal);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw abortError();
    // Some compatible providers reject stream=true or return a non-SSE body. Retry once
    // through the existing non-stream HTTP boundary when no usable chunk was received.
    if (received) throw error;
    const text = await chatCompletion(cfg, messages, options);
    if (text) onDelta(text);
    return;
  }

  throwIfAborted(options.signal);
  // A successful command with no SSE data usually means the provider ignored streaming.
  if (!received) {
    const text = await chatCompletion(cfg, messages, options);
    if (text) onDelta(text);
  }
}
