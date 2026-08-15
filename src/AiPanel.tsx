import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { fetchModels, chatCompletionStream } from './ai';
import type { ChatMessage } from './ai';
import type { AiConfig } from './types';

export default function AiPanel({ onClose }: { onClose: () => void }) {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);
  const ai = cfg.ai;

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '你好，我是 Vetro 的 AI 助手。先在「设置」里填写接口地址与密钥，再点「获取模型」。' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(!ai.ok);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const set = (patch: Partial<AiConfig>) => setCfg({ ai: { ...ai, ...patch } });

  const loadModels = async () => {
    setBusy(true);
    try {
      const list = await fetchModels(ai);
      setModels(list);
      if (list.length && !list.includes(ai.model)) set({ model: list[0] });
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: '获取模型失败：' + (e instanceof Error ? e.message : String(e)) }]);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      await chatCompletionStream(ai, next, (delta) => {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, content: last.content + delta };
          }
          return copy;
        });
      });
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && !last.content) {
          copy[copy.length - 1] = { ...last, content: '(空回复)' };
        }
        return copy;
      });
      set({ ok: true });
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: '请求失败：' + (e instanceof Error ? e.message : String(e)) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-overlay" onClick={onClose}>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ai-head">
          <span className="ai-title">AI 助手</span>
          <div className="ai-head-actions">
            <button className="btn ghost sm" onClick={() => setShowSettings(!showSettings)}>{showSettings ? '对话' : '设置'}</button>
            <button className="winbtn" onClick={onClose}>✕</button>
          </div>
        </header>

        {showSettings ? (
          <div className="ai-settings">
            <label className="ai-field">
              <span>接口地址</span>
              <input value={ai.endpoint} placeholder="https://api.deepseek.com/v1" spellCheck={false}
                onChange={(e) => set({ endpoint: e.target.value })} />
            </label>
            <label className="ai-field">
              <span>API 密钥</span>
              <input type="password" value={ai.key} placeholder="sk-..." spellCheck={false}
                onChange={(e) => set({ key: e.target.value })} />
            </label>
            <div className="ai-field">
              <span>模型</span>
              <div className="ai-model-row">
                <input value={ai.model} spellCheck={false} onChange={(e) => set({ model: e.target.value })} />
                <button className="btn ghost sm" onClick={loadModels} disabled={busy}>{busy ? '获取中…' : '获取模型'}</button>
              </div>
            </div>
            {models.length > 0 && (
              <div className="ai-models">
                {models.map((m) => (
                  <button key={m} className={'ai-model-chip' + (m === ai.model ? ' active' : '')}
                    onClick={() => set({ model: m })}>{m}</button>
                ))}
              </div>
            )}
            <button className="btn primary ai-done" onClick={() => { set({ ok: true }); setShowSettings(false); }}>完成</button>
          </div>
        ) : (
          <>
            <div className="ai-log" ref={listRef}>
              {messages.map((m, i) => (
                <div key={i} className={'ai-msg ' + m.role}>{m.content}</div>
              ))}
            </div>
            <div className="ai-input-row">
              <input value={input} placeholder="输入消息，回车发送" spellCheck={false}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                onChange={(e) => setInput(e.target.value)} />
              <button className="btn primary" onClick={send} disabled={busy || !input.trim()}>{busy ? '…' : '发送'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
