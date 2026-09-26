// 内置示例插件：演示命令 / 渲染钩子 / 编辑器扩展三个扩展点
import type { VetroPlugin } from '../plugins';
import { EditorView, keymap } from '@codemirror/view';
import { Decoration, DecorationSet } from '@codemirror/view';

const todoMark = Decoration.mark({ class: 'cm-todo-done' });

/** 编辑器扩展：给已勾选的待办行加删除线 */
const todoHighlighter = EditorView.decorations.compute([], (state) => {
  const deco: { from: number; to: number }[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (/^\s*[-*]\s+\[x\]\s/.test(line.text)) deco.push({ from: line.from, to: line.to });
  }
  return Decoration.set(deco.map((d) => todoMark.range(d.from, d.to)));
});

/** 编辑器扩展：Alt+Shift+T 插入时间戳 */
const insertTimeKeymap = keymap.of([
  {
    key: 'Alt-Shift-t',
    run: (view) => {
      const sel = view.state.selection.main;
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: stamp },
        selection: { anchor: sel.from + stamp.length }
      });
      return true;
    }
  }
]);

export const demoPlugin: VetroPlugin = {
  id: 'demo',
  name: '示例插件',
  version: '1.1.0',
  activate(ctx) {
    // 扩展点 1：命令 —— 出现在顶栏命令面板
    ctx.commands.register({
      id: 'demo.insert-time',
      title: '插入当前时间',
      shortcut: 'Alt+Shift+T',
      run: () => {
        const now = new Date().toLocaleString('zh-CN', { hour12: false });
        ctx.api.insertText(now);
        ctx.api.toast(`已插入时间：${now}`, 'ok');
      }
    });

    ctx.commands.register({
      id: 'demo.append-footer',
      title: '在文末追加页脚',
      run: () => {
        const doc = ctx.api.getActiveDoc();
        if (!doc) { ctx.api.toast('没有打开的文档', 'err'); return; }
        const n = ctx.api.replaceAll('[待补充]', '—');
        ctx.api.toast(n ? `已替换 ${n} 处「待补充」` : '未找到「待补充」', n ? 'ok' : 'err');
      }
    });

    // 扩展点 2：渲染钩子 —— 给引用块加标记类
    ctx.renderers.register({
      after(html) {
        return html.replace(/<blockquote>/g, '<blockquote class="hook-demo">');
      }
    });

    // 扩展点 3：编辑器扩展 —— 待办高亮 + 快捷键
    ctx.editors.register(todoHighlighter);
    ctx.editors.register(insertTimeKeymap);

    ctx.api.log(`示例插件 v1.1.0 已激活（2 命令 / 1 钩子 / 2 编辑器扩展）`);
  }
};
