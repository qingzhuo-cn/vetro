import { useEffect, useState } from 'react';
import { useStore } from './store';
import { ACCENTS, ICONS } from './presets';
import { webdavList, webdavGet, webdavPut, encodePath } from './webdav';
import { checkForUpdates } from './updater';
import { getVersion } from './backend';
import type { ThemeMode, SyncConfig } from './types';

function UpdateSection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [current, setCurrent] = useState('');
  useEffect(() => { getVersion().then(setCurrent).catch(() => {}); }, []);
  const check = async () => {
    setBusy(true); setStatus('');
    try {
      const info = await checkForUpdates();
      if (info) {
        setStatus(`发现新版本 ${info.latest}（当前 ${current || '?'}）。下载：${info.url}`);
      } else {
        setStatus(current ? `已是最新版本（v${current}）` : '未发现新版本');
      }
    } catch (e) {
      setStatus('检查失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-group">
      <h3>检查更新</h3>
      <div className="settings-row">
        <button className="btn ghost sm" onClick={check} disabled={busy}>{busy ? '检查中…' : '检查更新'}</button>
        {current && <span className="fontsize-val">当前 v{current}</span>}
      </div>
      {status && <p className="sync-status">{status}</p>}
    </section>
  );
}

function SyncSection() {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);
  const docs = useStore((s) => s.docs);
  const createDoc = useStore((s) => s.createDoc);
  const updateDoc = useStore((s) => s.updateDoc);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const sync = cfg.sync;

  const set = (patch: Partial<SyncConfig>) => setCfg({ sync: { ...sync, ...patch } });

  const upload = async () => {
    setBusy(true); setStatus('');
    try {
      let n = 0;
      for (const d of docs) {
        if (d.sync === false) continue;
        await webdavPut(sync, encodePath(d.name), d.content || '');
        n++;
      }
      setStatus(`已上传 ${n} 个文档`);
    } catch (e) {
      setStatus('上传失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true); setStatus('');
    try {
      const paths = await webdavList(sync, '/');
      const files = paths.filter((p) => /\.(md|markdown|txt)$/i.test(p));
      let n = 0;
      for (const p of files) {
        const name = decodeURIComponent(p.split('/').filter(Boolean).pop() || p);
        const content = await webdavGet(sync, p);
        const existing = docs.find((d) => d.name === name);
        if (existing) updateDoc(existing.id, { content });
        else createDoc(name, content, null);
        n++;
      }
      setStatus(`已下载 ${n} 个文档`);
    } catch (e) {
      setStatus('下载失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-group">
      <h3>WebDAV 同步</h3>
      <label className="ai-field">
        <span>服务器地址</span>
        <input value={sync.url} placeholder="https://dav.example.com/remote.php/dav/files/user/vetro" spellCheck={false}
          onChange={(e) => set({ url: e.target.value, enabled: !!e.target.value })} />
      </label>
      <label className="ai-field">
        <span>用户名</span>
        <input value={sync.username} placeholder="username" spellCheck={false}
          onChange={(e) => set({ username: e.target.value })} />
      </label>
      <label className="ai-field">
        <span>密码</span>
        <input type="password" value={sync.password} placeholder="password" spellCheck={false}
          onChange={(e) => set({ password: e.target.value })} />
      </label>
      <div className="settings-row">
        <button className="btn ghost sm" onClick={upload} disabled={busy || !sync.url}>{busy ? '同步中…' : '上传'}</button>
        <button className="btn ghost sm" onClick={download} disabled={busy || !sync.url}>{busy ? '同步中…' : '下载'}</button>
      </div>
      {status && <p className="sync-status">{status}</p>}
    </section>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);

  return (
    <div className="ai-overlay" onClick={onClose}>
      <div className="ai-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="ai-head">
          <span className="ai-title">设置</span>
          <div className="ai-head-actions"><button className="winbtn" onClick={onClose}>✕</button></div>
        </header>
        <div className="settings-body">
          <section className="settings-group">
            <h3>主题</h3>
            <div className="settings-row">
              {(['auto', 'dark', 'light'] as ThemeMode[]).map((t) => (
                <button key={t} className={'btn sm ' + (cfg.theme === t ? 'primary' : 'ghost')} onClick={() => setCfg({ theme: t })}>
                  {t === 'auto' ? '自动' : t === 'dark' ? '深色' : '浅色'}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h3>强调色</h3>
            <div className="accent-grid">
              {ACCENTS.map((a) => (
                <button key={a.id} className={'accent-swatch' + (cfg.accent === a.id ? ' active' : '')} title={a.name}
                  onClick={() => setCfg({ accent: a.id })}>
                  <span className="accent-dot" style={{ background: `linear-gradient(135deg, ${a.accent}, ${a.accent2})` }} />
                  <span className="accent-name">{a.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h3>图标</h3>
            <div className="icon-grid">
              {ICONS.map((i) => (
                <button key={i.id} className={'icon-option' + (cfg.icon === i.id ? ' active' : '')} title={i.name}
                  onClick={() => setCfg({ icon: i.id })}>
                  <svg viewBox="0 0 36 36">
                    <defs>
                      <linearGradient id={'iconGrad-' + i.id} x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stopColor="var(--accent)" />
                        <stop offset="1" stopColor="var(--accent-2)" />
                      </linearGradient>
                    </defs>
                    <rect x="2" y="2" width="32" height="32" rx="9" fill={'url(#iconGrad-' + i.id + ')'} />
                    <g dangerouslySetInnerHTML={{ __html: i.glyph }} />
                  </svg>
                  <span>{i.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h3>字号</h3>
            <div className="settings-row">
              <button className="btn ghost sm" onClick={() => setCfg({ fontSize: Math.max(12, cfg.fontSize - 1) })}>A−</button>
              <span className="fontsize-val">{cfg.fontSize}px</span>
              <button className="btn ghost sm" onClick={() => setCfg({ fontSize: Math.min(22, cfg.fontSize + 1) })}>A＋</button>
            </div>
          </section>

          <SyncSection />
          <UpdateSection />
        </div>
      </div>
    </div>
  );
}
