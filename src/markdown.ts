import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import type { RenderHooks } from './plugins';

marked.setOptions({ breaks: true, gfm: true });

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

/* 当前预览容器（供大纲滚动定位） */
export const previewElRef: { current: HTMLElement | null } = { current: null };

export function renderMarkdown(md: string, hooks: RenderHooks[] = []): string {
  let html: string;
  try {
    html = marked.parse(md || '') as string;
  } catch (e) {
    return '<pre>渲染失败</pre>';
  }
  for (const h of hooks) { if (h.before) html = h.before(html); }
  html = DOMPurify.sanitize(html) as string;
  for (const h of hooks) { if (h.after) html = h.after(html); }
  return html;
}

/** 预览（所见即所得）HTML → Markdown，用于把预览里的编辑同步回源码 */
export function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html || '').trim();
  } catch (e) {
    return '';
  }
}

export function highlightCode(root: Element): void {
  root.querySelectorAll('pre code').forEach((el) => {
    try { hljs.highlightElement(el as HTMLElement); } catch (e) { /* ignore */ }
  });
}
