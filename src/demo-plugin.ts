// 内置示例插件：演示插件系统的命令 / 渲染钩子扩展点
import type { VetroPlugin } from './plugins';

export const demoPlugin: VetroPlugin = {
  id: 'demo',
  name: '示例插件',
  version: '1.0.0',
  activate(ctx) {
    ctx.commands.register({
      id: 'demo.insert-time',
      title: '插入当前时间',
      run: () => {
        ctx.ui.toast('示例插件：命令已触发', 'ok');
      }
    });
    ctx.renderers.register({
      after(html) {
        // 给引用块加个标记，演示渲染钩子
        return html.replace(/<blockquote>/g, '<blockquote class="hook-demo">');
      }
    });
    ctx.log('示例插件已激活');
  },
  deactivate() {
    // 无副作用
  }
};
