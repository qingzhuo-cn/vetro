import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { dbSearch } from './backend';
import type { SearchHit } from './backend';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** FTS 用私有控制字符 \u0001/\u0002 标记匹配片段，这里转成 <mark> 高亮（先转义 HTML 再打标，正文里的 [ ] 不会被误吃） */
function highlight(s: string): string {
  return escapeHtml(s)
    .replace(/\u0001/g, '<mark>')
    .replace(/\u0002/g, '</mark>');
}

export default function SearchPanel({ onClose }: { onClose: () => void }) {
  const setActive = useStore((s) => s.setActive);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 序号守卫：快速连续输入时丢弃过期查询的响应，避免旧结果覆盖新结果
  const seqRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = async (query: string) => {
    setQ(query);
    const seq = ++seqRef.current;
    if (!query.trim()) { setHits([]); return; }
    setBusy(true);
    try {
      const res = await dbSearch(query);
      if (seq === seqRef.current) setHits(res);
    } catch (e) {
      console.warn('搜索失败:', e);
      if (seq === seqRef.current) setHits([]);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  };

  const open = (id: string) => { setActive(id); onClose(); };

  return (
    <div className="ai-overlay" onClick={onClose}>
      <div className="ai-panel search-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ai-head">
          <input className="search-input" ref={inputRef} value={q} placeholder="搜索所有文档内容…"
            spellCheck={false}
            onChange={(e) => run(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
          <button className="winbtn" onClick={onClose}>✕</button>
        </header>
        <div className="search-results">
          {busy && <div className="doc-empty">搜索中…</div>}
          {!busy && !q.trim() && <div className="doc-empty">输入关键词，搜索全部文档正文</div>}
          {!busy && q.trim() && hits.length === 0 && <div className="doc-empty">无匹配结果</div>}
          {hits.map((h) => (
            <button key={h.id} className="search-item" onClick={() => open(h.id)}>
              <div className="search-name">{h.name}</div>
              {h.snippet && <div className="search-snippet" dangerouslySetInnerHTML={{ __html: highlight(h.snippet) }} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
