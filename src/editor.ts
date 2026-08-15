import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

/* 当前激活的编辑器实例（供大纲跳转等使用） */
export const editorViewRef: { current: EditorView | null } = { current: null };

/* 粘贴图片 → 插入 base64 Markdown */
function imagePasteHandler(event: Event, view: EditorView): boolean {
  const ce = event as ClipboardEvent;
  const items = ce.clipboardData?.items;
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) return;
        const md = `![图片](${dataUrl})`;
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length } });
      };
      reader.readAsDataURL(file);
      ce.preventDefault();
      return true;
    }
  }
  return false;
}

export function createEditor(parent: HTMLElement, doc: string, onChange: (value: string) => void, extra: Extension[] = []): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.domEventHandlers({ paste: imagePasteHandler }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
      ...extra
    ]
  });
  return new EditorView({ state, parent });
}

/** 将编辑器光标跳到指定行并滚动到可视区 */
export function jumpToLine(lineNumber: number) {
  const v = editorViewRef.current;
  if (!v) return;
  const n = Math.max(1, lineNumber);
  const line = v.state.doc.line(n);
  v.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' })
  });
  v.focus();
}
