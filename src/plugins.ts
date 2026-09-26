// Vetro 插件系统：三个真实接线的扩展点 + 生命周期管理
//
// 扩展点只保留确实被消费的三个：命令 / 渲染钩子 / 编辑器扩展。
// 早期版本还声明过 Panel、AiProvider、SyncBackend 三个注册表，
// 但注册后全项目零处读取，属于未兑现的承诺，已删除。
//
// 加载方式：插件以独立文件放入 src/plugins/，由 Vite import.meta.glob
// 在构建期静态收录。**新增插件需重新构建**，不是运行时热加载 ——
// Tauri 打包环境下动态执行外部 JS 涉及 CSP 与代码执行安全，不做。
import type { Extension } from '@codemirror/state';
import { editorViewRef } from './editor';
import { activeDoc, useStore } from './store';

export interface Disposable {
  dispose(): void;
}

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface RenderHooks {
  before?: (html: string) => string;
  after?: (html: string) => string;
}

/** 插件可用的宿主能力 */
export interface HostApi {
  /** 弹出通知 */
  toast(msg: string, kind?: string): void;
  /** 在光标处插入文本（无编辑器实例时静默失败） */
  insertText(text: string): void;
  /** 读取当前文档，编辑器关闭时返回 null */
  getActiveDoc(): { id: string; name: string; content: string } | null;
  /** 整体替换当前文档内容 */
  setContent(content: string): void;
  /** 全文替换，返回命中次数 */
  replaceAll(find: string, replace: string): number;
  /** 写入插件日志 */
  log(msg: string): void;
}

export interface CommandRegistry { register(cmd: Command): Disposable; }
export interface RendererRegistry { register(hooks: RenderHooks): Disposable; }
export interface EditorRegistry { register(ext: Extension): Disposable; }

export interface PluginContext {
  commands: CommandRegistry;
  renderers: RendererRegistry;
  editors: EditorRegistry;
  api: HostApi;
}

export interface VetroPlugin {
  id: string;
  name: string;
  version: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export type PluginState = 'active' | 'failed' | 'disabled';

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  error?: string;
}

// —— 注册表实现 ——

class CommandRegistryImpl implements CommandRegistry {
  private items = new Map<string, Command>();
  register(cmd: Command): Disposable {
    this.items.set(cmd.id, cmd);
    return { dispose: () => { this.items.delete(cmd.id); } };
  }
  all(): Command[] { return Array.from(this.items.values()); }
}

class RendererRegistryImpl implements RendererRegistry {
  private items = new Set<RenderHooks>();
  register(hooks: RenderHooks): Disposable {
    this.items.add(hooks);
    return { dispose: () => { this.items.delete(hooks); } };
  }
  all(): RenderHooks[] { return Array.from(this.items); }
}

class EditorRegistryImpl implements EditorRegistry {
  private items = new Set<Extension>();
  register(ext: Extension): Disposable {
    this.items.add(ext);
    return { dispose: () => { this.items.delete(ext); } };
  }
  all(): Extension[] { return Array.from(this.items); }
}

// —— 管理器 ——

export class PluginManager {
  readonly commands = new CommandRegistryImpl();
  readonly renderers = new RendererRegistryImpl();
  readonly editors = new EditorRegistryImpl();

  private plugins = new Map<string, VetroPlugin>();
  private states = new Map<string, PluginState>();
  private errors = new Map<string, string>();
  // 每个插件注册项的 Disposable，卸载 / 激活失败时统一回收
  private disposables = new Map<string, Disposable[]>();
  private activatingId: string | null = null;

  constructor(private log: (msg: string) => void = () => {}) {}

  private track(register: () => Disposable): Disposable {
    const d = register();
    if (this.activatingId) {
      const list = this.disposables.get(this.activatingId) || [];
      list.push(d);
      this.disposables.set(this.activatingId, list);
    }
    return d;
  }

  private release(id: string) {
    for (const d of this.disposables.get(id) || []) {
      try { d.dispose(); } catch { /* 忽略单个释放失败 */ }
    }
    this.disposables.delete(id);
  }

  private context(): PluginContext {
    return {
      commands: { register: (cmd) => this.track(() => this.commands.register(cmd)) },
      renderers: { register: (hooks) => this.track(() => this.renderers.register(hooks)) },
      editors: { register: (ext) => this.track(() => this.editors.register(ext)) },
      api: {
        toast: (msg, kind) => this.log(`[toast] ${msg}${kind ? ' (' + kind + ')' : ''}`),
        insertText: (text) => {
          const v = editorViewRef.current;
          if (!v) return;
          const sel = v.state.selection.main;
          v.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length }
          });
          v.focus();
        },
        getActiveDoc: () => {
          const d = activeDoc();
          return d ? { id: d.id, name: d.name, content: d.content } : null;
        },
        setContent: (content) => {
          const d = activeDoc();
          if (!d) return;
          useStore.getState().updateDoc(d.id, { content });
        },
        replaceAll: (find, replace) => {
          const d = activeDoc();
          if (!d || !find) return 0;
          const parts = d.content.split(find);
          if (parts.length <= 1) return 0;
          useStore.getState().updateDoc(d.id, { content: parts.join(replace) });
          return parts.length - 1;
        },
        log: (msg) => this.log(`[plugin] ${msg}`)
      }
    };
  }

  /**
   * 激活单个插件。失败时回收该插件已注册的全部项并标记 failed，
   * 不影响其他插件 —— 早期版本失败会留下半激活的残留注册项。
   */
  async activate(plugin: VetroPlugin): Promise<boolean> {
    if (this.plugins.has(plugin.id)) return true;
    const ctx = this.context();
    this.activatingId = plugin.id;
    try {
      await plugin.activate(ctx);
      this.plugins.set(plugin.id, plugin);
      this.states.set(plugin.id, 'active');
      this.errors.delete(plugin.id);
      this.log(`[plugin] ${plugin.name} v${plugin.version} 已加载`);
      return true;
    } catch (e) {
      this.release(plugin.id);
      this.plugins.delete(plugin.id);
      this.states.set(plugin.id, 'failed');
      const msg = e instanceof Error ? e.message : String(e);
      this.errors.set(plugin.id, msg);
      this.log(`[plugin] ${plugin.name} 激活失败：${msg}`);
      return false;
    } finally {
      this.activatingId = null;
    }
  }

  async deactivate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    this.release(id);
    this.plugins.delete(id);
    if (plugin) {
      try { await plugin.deactivate?.(); } catch (e) {
        this.log(`[plugin] ${plugin.name} 的 deactivate 抛错：${e instanceof Error ? e.message : String(e)}`);
      }
      this.log(`[plugin] ${plugin.name} 已卸载`);
    }
    this.states.set(id, 'disabled');
  }

  /** 逐个激活，单个失败不阻断其余 */
  async activateAll(plugins: VetroPlugin[]): Promise<{ ok: number; failed: number }> {
    let ok = 0, failed = 0;
    for (const p of plugins) {
      if (await this.activate(p)) ok++; else failed++;
    }
    return { ok, failed };
  }

  /** 供设置界面展示 */
  list(): PluginStatus[] {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.id, name: p.name, version: p.version, state: this.states.get(p.id) || 'active'
    })).concat(
      Array.from(this.errors.keys())
        .filter((id) => !this.plugins.has(id))
        .map((id) => ({ id, name: id, version: '-', state: 'failed' as const, error: this.errors.get(id) }))
    );
  }

  isActive(id: string): boolean { return this.plugins.has(id); }
}
