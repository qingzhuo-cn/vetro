import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

/* 当前激活的编辑器实例（供大纲跳转等使用） */
export const editorViewRef: { current: EditorView | null } = { current: null };

/* 在光标处插入一张 base64 图片的 Markdown */
function insertImageDataUrl(view: EditorView, dataUrl: string, name = '图片') {
  // 去除会破坏 Markdown 语法的字符（]、(、)、[）
  const alt = (name || '图片').replace(/[\\[\]()]/g, ' ').trim() || '图片';
  const md = `![${alt}](${dataUrl})`;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length } });
}

/* 读取图片文件 → 插入 */
function insertImageFile(view: EditorView, file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    if (!dataUrl) return;
    insertImageDataUrl(view, dataUrl, file.name.replace(/\.[^.]+$/, '') || '图片');
  };
  reader.readAsDataURL(file);
}

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
      insertImageFile(view, file);
      ce.preventDefault();
      return true;
    }
  }
  return false;
}

/* 拖拽图片文件进入编辑器 → 允许放下 */
function imageDragOverHandler(event: Event): boolean {
  const de = event as DragEvent;
  const types = de.dataTransfer?.types;
  if (types && Array.from(types).some((t) => t === 'Files')) {
    de.preventDefault();
    de.dataTransfer!.dropEffect = 'copy';
    return true;
  }
  return false;
}

/* 放下图片文件 → 插入 */
function imageDropHandler(event: Event, view: EditorView): boolean {
  const de = event as DragEvent;
  const files = de.dataTransfer?.files;
  if (!files || files.length === 0) return false;
  let inserted = false;
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      insertImageFile(view, file);
      inserted = true;
    }
  }
  if (inserted) de.preventDefault();
  return inserted;
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
      EditorView.domEventHandlers({
        paste: imagePasteHandler,
        dragover: imageDragOverHandler,
        drop: imageDropHandler
      }),
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
