import { EditorState, type Extension, StateField, type Range } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';

/* 当前激活的编辑器实例（供大纲跳转等使用） */
export const editorViewRef: { current: EditorView | null } = { current: null };

/* ===== [[文档链接]] 装饰器 ===== */

const wikiLinkRE = /\[\[([^\]]+)\]\]/g;

class WikiLinkWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  toDOM() {
    const a = document.createElement('a');
    a.className = 'wiki-link';
    a.textContent = this.text;
    a.title = `跳转到「${this.text}」`;
    return a;
  }
  eq(other: WikiLinkWidget) { return this.text === other.text; }
}

function wikiLinkDeco(state: EditorState): DecorationSet {
  const decos: Range<ReturnType<typeof Decoration.replace>>[] = [];
  const view = editorViewRef.current;
  if (!view) return Decoration.none;
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    let m: RegExpExecArray | null;
    wikiLinkRE.lastIndex = 0;
    while ((m = wikiLinkRE.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      decos.push(Decoration.replace({ widget: new WikiLinkWidget(m[1]), side: 1 }).range(start, end));
    }
  }
  return Decoration.set(decos, true);
}

const wikiLinkField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(deco, tr) {
    return tr.docChanged ? wikiLinkDeco(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ===== 图片处理 ===== */

/* 读取图片文件 → 压缩 → 插入相对路径 */
function insertImageFile(view: EditorView, file: File) {
  import('./image').then(({ saveImageToDisk, getImagesDir }) =>
    getImagesDir().then((dir: string) =>
      saveImageToDisk(file, dir).then(({ relativePath }) => {
        const name = file.name.replace(/\.[^.]+$/, '') || '图片';
        const alt = name.replace(/[[\]()]/g, ' ').trim() || '图片';
        const md = `![${alt}](${relativePath})`;
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: md }, selection: { anchor: from + md.length } });
      })
    )
  ).catch(() => {});
}

/* 粘贴图片 → 插入 Markdown */
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

/* ===== 创建编辑器 ===== */

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
      wikiLinkField,
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
  const n = Math.max(1, Math.min(lineNumber, v.state.doc.lines));
  const line = v.state.doc.line(n);
  v.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' })
  });
  v.focus();
}

/** 打开 CodeMirror 内置搜索面板 */
export function openEditorSearch() {
  const v = editorViewRef.current;
  if (v) openSearchPanel(v);
}
