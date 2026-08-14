import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import type { RenderHooks } from './plugins';

marked.setOptions({ breaks: true, gfm: true });

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

export function highlightCode(root: Element): void {
  root.querySelectorAll('pre code').forEach((el) => {
    try { hljs.highlightElement(el as HTMLElement); } catch (e) { /* ignore */ }
  });
}
