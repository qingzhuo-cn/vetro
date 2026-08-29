import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { editorViewRef } from './editor';
import {
  AI_PRESET_ACTIONS,
  AI_SYSTEM_PROMPT,
  buildPresetMessages,
  buildPresetPrompt,
  chatCompletionStream,
  fetchModels,
  isAbortError,
} from './ai';
import type { AiPresetId, AiPromptContext, ChatMessage } from './ai';
import type { AiConfig } from './types';

type ApplyMode = 'selection' | 'cursor' | 'document';
type MessageStatus = 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';

interface CapturedContext extends AiPromptContext {
  docId: string | null;
  from: number;
  to: number;
  applyMode: ApplyMode;
}

interface PanelMessage extends ChatMessage {
  id: number;
  status: MessageStatus;
  context?: CapturedContext;
  preset?: AiPresetId;
  applied?: boolean;
  applyError?: string;
}

const WELCOME = '你好，我是 Vetro 的 AI 助手。先在「设置」里填写接口地址与密钥，再点「获取模型」。';

function captureContext(applyMode: ApplyMode = 'document'): CapturedContext {
  const state = useStore.getState();
  const active = state.docs.find((doc) => doc.id === state.activeId);
  const view = editorViewRef.current;
  const source = view?.state.doc.toString() ?? active?.content ?? '';
  const from = view ? view.state.selection.main.from : 0;
  const to = view ? view.state.selection.main.to : 0;
  const hasSelection = to > from;
  return {
    docId: active?.id ?? null,
    document: source,
    selectedText: hasSelection ? source.slice(from, to) : '',
    hasSelection,
    from,
    to,
    applyMode: hasSelection ? 'selection' : applyMode,
  };
}

function contextForPreset(id: AiPresetId): CapturedContext {
  return captureContext(id === 'continue' || id === 'title' ? 'cursor' : 'document');
}

function requestHistory(messages: PanelMessage[]): ChatMessage[] {
  return messages
    .filter((message, index) => index > 0 || message.content !== WELCOME)
    .filter((message) => message.status === 'done' || message.role === 'user')
    .map(({ role, content }) => ({ role, content }));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function AiPanel({ onClose }: { onClose: () => void }) {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);
  const updateDocWithUndo = useStore((s) => s.updateDocWithUndo);
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const ai = cfg.ai;

  const [messages, setMessages] = useState<PanelMessage[]>([
    { id: 1, role: 'assistant', content: WELCOME, status: 'done' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(!ai.ok);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextMessageId = useRef(2);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (busy) abortRef.current?.abort();
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      abortRef.current?.abort();
    };
  }, [busy, onClose]);

  const set = (patch: Partial<AiConfig>) => setCfg({ ai: { ...ai, ...patch } });

  const cancel = () => abortRef.current?.abort();

  const loadModels = async () => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const list = await fetchModels(ai, { signal: controller.signal });
      setModels(list);
      if (list.length && !list.includes(ai.model)) set({ model: list[0] });
    } catch (error) {
      if (!isAbortError(error)) {
        setMessages((current) => [...current, {
          id: nextMessageId.current++,
          role: 'assistant',
          content: '获取模型失败：' + errorText(error),
          status: 'error',
        }]);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const runRequest = async (
    displayText: string,
    requestMessages: ChatMessage[],
    context: CapturedContext,
    preset?: AiPresetId,
  ) => {
    if (busy) return;
    const userId = nextMessageId.current++;
    const assistantId = nextMessageId.current++;
    const userMessage: PanelMessage = { id: userId, role: 'user', content: displayText, status: 'done' };
    const assistantMessage: PanelMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'pending',
      context,
      preset,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await chatCompletionStream(ai, requestMessages, (delta) => {
        setMessages((current) => current.map((message) => message.id === assistantId
          ? { ...message, content: message.content + delta, status: 'streaming' }
          : message));
      }, { signal: controller.signal });
      setMessages((current) => current.map((message) => message.id === assistantId
        ? { ...message, status: 'done' }
        : message));
      set({ ok: true });
    } catch (error) {
      setMessages((current) => current.map((message) => {
        if (message.id !== assistantId) return message;
        if (isAbortError(error)) {
          return { ...message, status: 'cancelled', content: message.content || '请求已取消' };
        }
        return {
          ...message,
          status: 'error',
          content: message.content
            ? `${message.content}\n\n请求失败：${errorText(error)}`
            : '请求失败：' + errorText(error),
        };
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    const context = captureContext('document');
    const prompt = context.hasSelection
      ? `${text}\n\n请优先处理以下选中的 Markdown 片段：\n<selection>\n${context.selectedText}\n</selection>`
      : text;
    setInput('');
    const history = requestHistory(messages);
    void runRequest(text, [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: prompt },
    ], context);
  };

  const runPreset = (id: AiPresetId) => {
    if (busy) return;
    const context = contextForPreset(id);
    const request = buildPresetMessages(id, context);
    void runRequest(
      `执行：${AI_PRESET_ACTIONS.find((preset) => preset.id === id)?.label ?? id}`,
      request,
      context,
      id,
    );
  };

  const applyResult = (message: PanelMessage) => {
    const context = message.context;
    if (!context || message.status !== 'done' || !message.content.trim()) return;
    if (!context.docId) {
      setMessages((current) => current.map((item) => item.id === message.id
        ? { ...item, applyError: '没有可应用的文档' }
        : item));
      return;
    }
    const state = useStore.getState();
    const target = state.docs.find((doc) => doc.id === context.docId);
    if (!target) {
      setMessages((current) => current.map((item) => item.id === message.id
        ? { ...item, applyError: '目标文档已不存在' }
        : item));
      return;
    }
    const view = state.activeId === context.docId ? editorViewRef.current : null;
    const currentContent = view?.state.doc.toString() ?? target.content;
    // A stale range can silently overwrite new edits, so require the captured snapshot.
    if (currentContent !== context.document) {
      setMessages((current) => current.map((item) => item.id === message.id
        ? { ...item, applyError: '文档在请求期间已修改，请重新生成后再应用' }
        : item));
      return;
    }
    const max = currentContent.length;
    const from = context.applyMode === 'document' ? 0 : Math.min(context.from, max);
    const to = context.applyMode === 'document' ? max : Math.min(Math.max(context.to, from), max);
    const nextContent = currentContent.slice(0, from) + message.content + currentContent.slice(to);
    updateDocWithUndo(context.docId, { content: nextContent });
    if (view) {
      view.dispatch({
        changes: { from, to, insert: message.content },
        selection: { anchor: from + message.content.length },
      });
      view.focus();
    }
    setMessages((current) => current.map((item) => item.id === message.id
      ? { ...item, applied: true, applyError: undefined }
      : item));
  };

  return (
    <div className="ai-overlay" role="presentation" onClick={onClose}>
      <div
        className="ai-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-panel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-head">
          <span className="ai-title" id="ai-panel-title">AI 助手</span>
          <div className="ai-head-actions">
            <button
              type="button"
              className="btn ghost sm"
              aria-label={showSettings ? '返回 AI 对话' : '打开 AI 设置'}
              onClick={() => setShowSettings(!showSettings)}
            >{showSettings ? '对话' : '设置'}</button>
            <button type="button" className="winbtn" aria-label="关闭 AI 助手" onClick={onClose}>✕</button>
          </div>
        </header>

        {showSettings ? (
          <div className="ai-settings">
            <label className="ai-field">
              <span>接口地址</span>
              <input aria-label="AI 接口地址" value={ai.endpoint} placeholder="https://api.deepseek.com/v1" spellCheck={false}
                onChange={(e) => set({ endpoint: e.target.value })} />
            </label>
            <label className="ai-field">
              <span>API 密钥</span>
              <input aria-label="AI API 密钥" type="password" value={ai.key} placeholder="sk-..." spellCheck={false}
                onChange={(e) => set({ key: e.target.value })} />
            </label>
            <div className="ai-field">
              <span>模型</span>
              <div className="ai-model-row">
                <input aria-label="AI 模型名称" value={ai.model} spellCheck={false} onChange={(e) => set({ model: e.target.value })} />
                <button type="button" className="btn ghost sm" onClick={loadModels} disabled={busy} aria-label="获取可用模型">
                  {busy ? '获取中…' : '获取模型'}
                </button>
              </div>
            </div>
            {models.length > 0 && (
              <div className="ai-models" aria-label="可用模型">
                {models.map((model) => (
                  <button type="button" key={model} className={'ai-model-chip' + (model === ai.model ? ' active' : '')}
                    aria-pressed={model === ai.model} onClick={() => set({ model })}>{model}</button>
                ))}
              </div>
            )}
            {busy && <button type="button" className="btn ghost sm" onClick={cancel} aria-label="取消当前 AI 请求">取消请求</button>}
            <button type="button" className="btn primary ai-done" onClick={() => { set({ ok: true }); setShowSettings(false); }}>完成</button>
          </div>
        ) : (
          <>
            <div className="ai-log" ref={listRef} role="log" aria-live="polite" aria-label="AI 对话记录">
              {messages.map((message) => (
                <div key={message.id} className={'ai-msg ' + message.role} aria-label={message.role === 'user' ? '我的消息' : 'AI 回复'}>
                  <div>{message.content || (message.status === 'pending' || message.status === 'streaming' ? '生成中…' : '(空回复)')}</div>
                  {message.role === 'assistant' && message.status === 'done' && message.content.trim() && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{ display: 'block', marginTop: 8 }}
                      disabled={message.applied}
                      aria-label={message.applied ? '此回复已应用到文档' : '将此回复应用到文档'}
                      onClick={() => applyResult(message)}
                    >{message.applied ? '已应用' : '应用到文档'}</button>
                  )}
                  {message.applyError && <div role="alert" style={{ marginTop: 6 }}>{message.applyError}</div>}
                </div>
              ))}
            </div>
            <div className="ai-presets" role="toolbar" aria-label="AI 快捷操作">
              {AI_PRESET_ACTIONS.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className="btn ghost sm"
                  onClick={() => runPreset(preset.id)}
                  disabled={busy}
                  aria-label={`对当前${captureContext().hasSelection ? '选中文本' : '文档'}执行${preset.label}`}
                >{preset.label}</button>
              ))}
            </div>
            <div className="ai-input-row">
              <input
                ref={inputRef}
                aria-label="发送给 AI 的消息"
                value={input}
                placeholder="输入消息，回车发送"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
                }}
                onChange={(event) => setInput(event.target.value)}
              />
              {busy ? (
                <button type="button" className="btn ghost" onClick={cancel} aria-label="取消当前 AI 请求">取消</button>
              ) : (
                <button type="button" className="btn primary" onClick={send} disabled={!input.trim()} aria-label="发送消息">发送</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
