import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { dbSearch } from './backend';
import type { SearchHit } from './backend';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** FTS5 用 [ ] 标记匹配片段，这里转成 <mark> 高亮 */
function highlight(s: string): string {
  return escapeHtml(s).replace(/\[/g, '<mark>').replace(/\]/g, '</mark>');
}

export default function SearchPanel({ onClose }: { onClose: () => void }) {
  const setActive = useStore((s) => s.setActive);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = async (query: string) => {
    setQ(query);
    if (!query.trim()) { setHits([]); return; }
    setBusy(true);
    try { setHits(await dbSearch(query)); } catch { setHits([]); } finally { setBusy(false); }
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
