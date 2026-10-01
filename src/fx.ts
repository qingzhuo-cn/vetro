// 按键反光：顶层单 pointermove 监听 + rAF 节流，只给当前悬停按键写 --mx/--my。
// 设计约束：
// - 不新增 DOM、不改 React 树；纯 CSS 变量驱动，React 零感知；
// - data-fx="off" 或 prefers-reduced-motion 时自动停掉监听（无开销）；
// - 只追踪 .glass-key 命中元素；离开即清除标记，不留脏变量。

const KEY_SELECTOR = '.btn, .cmd-item, .winbtn, .ai-model-chip, .ai-platform-chip, .ai-saved-item, .ai-switch-item, .accent-swatch, .icon-option, .visual-theme-option, .font-option, .tag-chip, .sidebar-tab, .tab, .export-menu-item, .img-menu button, .trash-item, .outline-item, .attachment-item, .search-item, .doc-more';
// 注意：.doc-item 不在内 —— 它内部有绝对定位的操作区（.doc-actions），
// pointermove 的 closest 会先命中 .doc-more 而非整行，整行不做反光只保留原有悬停。

let started = false;
let rafId = 0;
let pending: { el: Element; x: number; y: number } | null = null;
let lastEl: Element | null = null;

function fxEnabled(): boolean {
  if (document.documentElement.dataset.fx === 'off') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

function paint() {
  rafId = 0;
  if (lastEl && (!pending || pending.el !== lastEl)) {
    // 上一帧的按键已不在悬停：清除它的反光标记
    (lastEl as HTMLElement).style.removeProperty('--mx');
    (lastEl as HTMLElement).style.removeProperty('--my');
    (lastEl as HTMLElement).style.removeProperty('--sheen');
    lastEl = null;
  }
  if (!pending) return;
  const { el, x, y } = pending;
  pending = null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  // 百分比坐标：反光跟随鼠标在按键内的位置（钳制 0-100，防边界抖动）
  const mx = Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100));
  const my = Math.max(0, Math.min(100, ((y - r.top) / r.height) * 100));
  const s = (el as HTMLElement).style;
  s.setProperty('--mx', mx.toFixed(1));
  s.setProperty('--my', my.toFixed(1));
  // 主反光（跟随鼠标）+ 边缘冷光（朝向鼠标偏移），纯渐变位置变化
  s.setProperty(
    '--sheen',
    `radial-gradient(circle at ${mx.toFixed(1)}% ${my.toFixed(1)}%, rgba(255,255,255,0.32), rgba(255,255,255,0.10) 34%, transparent 58%),` +
    `conic-gradient(from ${((mx / 100) * 360).toFixed(0)}deg at 50% 50%, transparent 0deg, rgba(255,255,255,0.06) 40deg, transparent 90deg, transparent 200deg, rgba(255,255,255,0.05) 250deg, transparent 300deg)`
  );
  lastEl = el;
}

function onMove(e: PointerEvent) {
  if (!fxEnabled()) {
    // 关闭后把残留标记清掉
    if (lastEl) {
      (lastEl as HTMLElement).style.removeProperty('--mx');
      (lastEl as HTMLElement).style.removeProperty('--my');
      (lastEl as HTMLElement).style.removeProperty('--sheen');
      lastEl = null;
    }
    pending = null;
    return;
  }
  const t = e.target as Element | null;
  const el = t && t.nodeType === 1 ? (t.closest(KEY_SELECTOR) as Element | null) : null;
  pending = el ? { el, x: e.clientX, y: e.clientY } : null;
  if (!rafId) rafId = requestAnimationFrame(paint);
}

/** 幂等启动；模块加载一次，多次调用只挂一个监听器。 */
export function startGlassFx() {
  if (started) return;
  started = true;
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', () => { pending = null; }, true);
}

// —— 开发期自检探针：?fxprobe=1 时运行，import.meta.env.DEV 门控，生产包 tree-shake ——
// 注意：该探针只断言 JS 行为（变量写/清、开关门控）与 DOM 数据属性（shell/bgmode/fx）。
// :hover 触发的反光与浮起需真人/真浏览器验证。
// 用法：npm run dev 后用浏览器打开 http://localhost:1420/?fxprobe=1，
// 页面 2.5 秒后自动把 FXPROBE>>>JSON<<< 写进 #fxprobe-result。
if (import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('fxprobe')) {
  setTimeout(() => {
    const out: Record<string, string> = {};
    try {
      out.shell = document.body.dataset.shell || '(unset)';
      out.fx = document.documentElement.dataset.fx || '(unset)';
      out.bgmode = document.body.dataset.bgmode || '(unset)';
      const btn = [...document.querySelectorAll('.topbar-actions .btn')]
        .find((b) => (b.textContent || '').includes('新建')) as HTMLElement | undefined;
      out.btn = btn ? 'found' : 'MISSING';
      if (btn) {
        const r = btn.getBoundingClientRect();
        const x = r.left + r.width * 0.75, y = r.top + r.height * 0.75;
        btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try {
            const pct = 100 * 0.75;
            const mx = parseFloat(btn.style.getPropertyValue('--mx'));
            const my = parseFloat(btn.style.getPropertyValue('--my'));
            out.mx_ok = Math.abs(mx - pct) < 5 ? `ok(${mx})` : `BAD(${mx})`;
            out.my_ok = Math.abs(my - 50) < 15 ? `ok(${my})` : `BAD(${my})`;
            out.sheen_set = btn.style.getPropertyValue('--sheen').includes('radial-gradient') ? 'yes' : 'NO';
            // 合成事件不触发 :hover，反光层此时应仍不可见（opacity 0）
            out.before_opacity_nohover = getComputedStyle(btn, '::before').opacity;
            // fx=off 后再移动：变量必须被清除
            document.documentElement.dataset.fx = 'off';
            btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
            requestAnimationFrame(() => requestAnimationFrame(() => {
              out.off_cleared = btn.style.getPropertyValue('--mx') === '' ? 'yes' : 'NO:' + btn.style.getPropertyValue('--mx');
              document.documentElement.dataset.fx = 'on';
              const pre = document.createElement('pre');
              pre.id = 'fxprobe-result';
              pre.textContent = 'FXPROBE>>>' + JSON.stringify(out) + '<<<';
              document.body.appendChild(pre);
            }));
          } catch (e) {
            const pre = document.createElement('pre');
            pre.id = 'fxprobe-result';
            pre.textContent = 'FXPROBE>>>{"error":"' + String(e) + '"}<<<';
            document.body.appendChild(pre);
          }
        }));
      } else {
        const pre = document.createElement('pre');
        pre.id = 'fxprobe-result';
        pre.textContent = 'FXPROBE>>>' + JSON.stringify(out) + '<<<';
        document.body.appendChild(pre);
      }
    } catch (e) {
      const pre = document.createElement('pre');
      pre.id = 'fxprobe-result';
      pre.textContent = 'FXPROBE>>>{"fatal":"' + String(e) + '"}<<<';
      document.body.appendChild(pre);
    }
  }, 2500);
}
