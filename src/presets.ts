import type { AccentTheme, IconStyle } from './types';

export const ACCENTS: AccentTheme[] = [
  { id: 'teal', name: '青绿', accent: '#4ecdc4', accent2: '#7c9eff' },
  { id: 'indigo', name: '靛蓝', accent: '#818cf8', accent2: '#a78bfa' },
  { id: 'violet', name: '紫罗兰', accent: '#a78bfa', accent2: '#f472b6' },
  { id: 'rose', name: '玫瑰', accent: '#fb7185', accent2: '#f472b6' },
  { id: 'amber', name: '琥珀', accent: '#fbbf24', accent2: '#fb923c' },
  { id: 'emerald', name: '翡翠', accent: '#34d399', accent2: '#2dd4bf' },
  { id: 'sky', name: '天蓝', accent: '#38bdf8', accent2: '#818cf8' },
  { id: 'crimson', name: '绯红', accent: '#e11d48', accent2: '#fb7185' }
];

export const ICONS: IconStyle[] = [
  {
    id: 'markdown',
    name: 'Markdown',
    glyph: '<path d="M11 22 V13 L16.5 16.8 L22 13 V22" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 23.5 V26.6 M14.6 26.6 L16.5 28.6 L18.4 26.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>'
  },
  {
    id: 'prism',
    name: '棱镜',
    glyph: '<path d="M18 9 L28 18 L18 27 L8 18 Z" fill="none" stroke="#fff" stroke-width="2.3" stroke-linejoin="round"/><path d="M18 9 V27 M8 18 H28" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" opacity="0.7"/>'
  },
  {
    id: 'v',
    name: 'V 字',
    glyph: '<path d="M12.5 13 L18 24 L23.5 13" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>'
  },
  {
    id: 'spark',
    name: '星芒',
    glyph: '<path d="M18 8 L19.7 14.3 L26 16 L19.7 17.7 L18 24 L16.3 17.7 L10 16 L16.3 14.3 Z" fill="#fff" stroke="none"/>'
  }
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6 || Number.isNaN(parseInt(full, 16))) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex);
  if (!c) return `rgba(78,205,196,${a})`;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

export function lighten(hex: string, amt: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const mix = (v: number) => Math.round(v + (255 - v) * amt);
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function darken(hex: string, amt: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const mix = (v: number) => Math.round(v * (1 - amt));
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
