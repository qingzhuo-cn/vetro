import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { useStore } from './store';
import { ACCENTS, ICONS } from './presets';
import { webdavList, webdavGet, webdavPut, webdavTest, webdavGetSnapshot, webdavPutSnapshot, encodePath, type WebDavError } from './webdav';
import { VISUAL_THEMES, FONT_FAMILIES } from './types';
import { checkForUpdates } from './updater';
import { getVersion, readBinaryFile } from './backend';
import type { ThemeMode, SyncConfig } from './types';
import { docTreeContent } from './store';

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
  const trash = useStore((s) => s.trash);
  const replaceDocuments = useStore((s) => s.replaceDocuments);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const sync = cfg.sync;

  const set = (patch: Partial<SyncConfig>) => setCfg({ sync: { ...sync, ...patch } });
  const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);
  const markSynced = () => set({ lastSync: Date.now() });

  const upload = async () => {
    setBusy(true); setStatus('');
    try {
      await webdavPutSnapshot(sync, { version: 1, updatedAt: Date.now(), docs, trash });
      markSynced();
      setStatus(`已上传 ${docs.length} 篇文档和 ${trash.length} 个回收站项目`);
    } catch (e) {
      setStatus('上传失败：' + describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const merge = (localDocs: typeof docs, localTrash: typeof trash, remoteDocs: typeof docs, remoteTrash: typeof trash) => {
    const docMap = new Map(localDocs.map((doc) => [doc.id, doc]));
    const trashMap = new Map(localTrash.map((item) => [item.id, item]));
    //
    // 按 修改/删除时间 比较，采用「严格大于才覆盖」。时间戳相等视为冲突：
    // 不静默翻转文档的 普通/回收站 状态，避免复活已删除的文档或凭空吞掉恢复。
    //
    for (const remote of remoteDocs) {
      const local = docMap.get(remote.id);
      const tombstone = trashMap.get(remote.id);
      const remoteVersion = remote.updatedAt || 0;
      const localVersion = Math.max(local?.updatedAt || 0, tombstone?.deletedAt || 0);
      if (remoteVersion > localVersion) {
        docMap.set(remote.id, remote);
        trashMap.delete(remote.id);
      }
      // remoteVersion === localVersion：
      //   - 本机也是普通文档 → 内容相同，忽略即可
      //   - 本机在回收站 → 时间戳相同无法判定删除顺序，保守保留回收站（不复活）
    }
    for (const remote of remoteTrash) {
      const local = docMap.get(remote.id);
      const localTrash = trashMap.get(remote.id);
      const remoteVersion = Math.max(remote.updatedAt || 0, remote.deletedAt || 0);
      const localVersion = Math.max(local?.updatedAt || 0, localTrash?.deletedAt || 0);
      if (remoteVersion > localVersion) {
        docMap.delete(remote.id);
        trashMap.set(remote.id, remote);
      }
      // remoteVersion === localVersion：
      //   - 本机也在回收站 → 忽略即可
      //   - 本机是普通文档 → 时间戳相同无法判定删除顺序，保守保留普通文档（不吞掉恢复）
    }
    return { docs: [...docMap.values()], trash: [...trashMap.values()] };
  };

  const smartSync = async () => {
    setBusy(true); setStatus('');
    try {
      const remote = await webdavGetSnapshot(sync);
      if (!remote) {
        await webdavPutSnapshot(sync, { version: 1, updatedAt: Date.now(), docs, trash });
        markSynced();
        setStatus('云端没有快照，已安全创建本机快照');
        return;
      }
      const merged = merge(docs, trash, remote.docs, remote.trash);
      // 先上传合并结果，成功后再落本地——避免上传失败导致本地与云端分叉
      await webdavPutSnapshot(sync, { version: 1, updatedAt: Date.now(), docs: merged.docs, trash: merged.trash });
      replaceDocuments(merged.docs, merged.trash, useStore.getState().activeId);
      markSynced();
      setStatus(`智能同步完成：${merged.docs.length} 篇文档，${merged.trash.length} 个回收站项目`);
    } catch (e) {
      setStatus('智能同步失败：' + describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true); setStatus('');
    try {
      const remote = await webdavGetSnapshot(sync);
      if (!remote) { setStatus('云端没有可恢复的快照'); return; }
      replaceDocuments(remote.docs, remote.trash, remote.docs[0]?.id ?? null);
      markSynced();
      setStatus(`已从云端覆盖：${remote.docs.length} 篇文档，${remote.trash.length} 个回收站项目`);
    } catch (e) {
      setStatus('下载失败：' + describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setStatus('');
    try { await webdavTest(sync); setStatus('连接成功 ✓'); }
    catch (e) { setStatus('连接失败：' + describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="settings-group sync-card">
      <h3>WebDAV 同步</h3>
      <p className="settings-help">使用原生 HTTP 代理同步完整文档树和回收站，不受浏览器 CORS 限制。智能同步按最新修改时间合并。</p>
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
        <span>密码 / 应用密码</span>
        <input type="password" value={sync.password} placeholder="仅保存在系统密钥链" spellCheck={false}
          onChange={(e) => set({ password: e.target.value })} />
      </label>
      <label className="sync-check"><input type="checkbox" checked={sync.autosync} onChange={(e) => set({ autosync: e.target.checked, enabled: e.target.checked || !!sync.url })} /> 修改后自动同步</label>
      <div className="settings-row sync-actions">
        <button className="btn ghost sm" onClick={test} disabled={busy || !sync.url}>测试连接</button>
        <button className="btn primary sm" onClick={smartSync} disabled={busy || !sync.url}>智能同步</button>
        <button className="btn ghost sm" onClick={upload} disabled={busy || !sync.url}>仅上传</button>
        <button className="btn ghost sm danger-action" onClick={download} disabled={busy || !sync.url}>云端覆盖本机</button>
      </div>
      {sync.lastSync > 0 && <p className="sync-meta">上次同步：{new Date(sync.lastSync).toLocaleString()}</p>}
      {status && <p className="sync-status" role="status">{status}</p>}
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
            <h3>外观模式</h3>
            <div className="settings-row">
              {(['auto', 'dark', 'light'] as ThemeMode[]).map((t) => (
                <button key={t} className={'btn sm ' + (cfg.theme === t ? 'primary' : 'ghost')} onClick={() => setCfg({ theme: t })}>
                  {t === 'auto' ? '自动' : t === 'dark' ? '深色' : '浅色'}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group visual-theme-group">
            <h3>液态玻璃主题</h3>
            <div className="visual-theme-grid">
              {VISUAL_THEMES.map((theme) => (
                <button key={theme} type="button" className={'visual-theme-option' + (cfg.visualTheme === theme ? ' active' : '')}
                  onClick={() => setCfg({ visualTheme: theme })}>
                  <span className={'visual-theme-swatch theme-' + theme} />
                  <span>{({ midnight: '暗夜', dawn: '晨曦', ocean: '深海', sakura: '樱雪', aurora: '极光', mocha: '拿铁' } as Record<string, string>)[theme]}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h3>正文字体</h3>
            <div className="font-grid">
              {FONT_FAMILIES.map((font) => (
                <button key={font} type="button" className={'font-option font-' + font + (cfg.fontFamily === font ? ' active' : '')}
                  onClick={() => setCfg({ fontFamily: font })}>
                  {({ sans: '默认黑体', hei: '苹方 / 雅黑', kai: '霞鹜文楷', song: '宋体', fang: '仿宋', mono: '等宽' } as Record<string, string>)[font]}
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

          <section className="settings-group">
            <h3>导出</h3>
            <div className="settings-row">
              <button className="btn ghost sm" onClick={() => {
                const docs = useStore.getState().docs;
                const html = docs.map((d) => {
                  const content = d.content || '';
                  return `<div style="page-break-after:always;padding:20px;">
                    <h1>${d.name.replace(/\.\w+$/i, '')}</h1>
                    <pre style="white-space:pre-wrap;font-family:sans-serif;">${content.replace(/</g, '&lt;')}</pre>
                  </div>`;
                }).join('');
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(`<html><head><title>Vetro Export</title>
                    <style>body{font-family:sans-serif;margin:40px;} h1{border-bottom:1px solid #ccc;padding-bottom:8px;}</style>
                  </head><body>${html}</body></html>`);
                  win.document.close();
                  win.print();
                }
              }}>全部导出为 PDF</button>
            </div>
          </section>

          <SyncSection />
          <UpdateSection />
        </div>
      </div>
    </div>
  );
}
