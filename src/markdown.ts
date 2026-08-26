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
  // 预处理 [[wiki-link]] → <a class="wiki-link" data-wiki="目标文档名">目标文档名</a>
  // 完整 HTML 转义防注入：对 < > & ' " 全部转义
  const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let processed = (md || '').replace(/\[\[([^\]]+)\]\]/g, (_m, name: string) =>
    `<a class="wiki-link" data-wiki="${escapeAttr(name)}">${escapeText(name)}</a>`
  );
  let html: string;
  try {
    html = marked.parse(processed) as string;
  } catch (e) {
    return '<pre>渲染失败</pre>';
  }
  for (const h of hooks) { if (h.before) html = h.before(html); }
  html = DOMPurify.sanitize(html, { ADD_TAGS: ['a'], ADD_ATTR: ['data-wiki', 'class'] }) as string;
  for (const h of hooks) { if (h.after) html = h.after(html); }
  return html;
}

/** 预览（所见即所得）HTML → Markdown，用于把预览里的编辑同步回源码 */
export function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html || '').trim();
  } catch (e) {
    console.warn('HTML → Markdown 转换失败:', e);
    return '';
  }
}

export function highlightCode(root: Element): void {
  root.querySelectorAll('pre code').forEach((el) => {
    try { hljs.highlightElement(el as HTMLElement); } catch (e) { console.warn('代码高亮失败:', e); }
  });
}
