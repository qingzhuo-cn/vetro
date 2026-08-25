// Vetro 插件系统：扩展点 + 注册表 + 管理器
import type { Extension } from '@codemirror/state';
import type { ComponentType } from 'react';

export interface Disposable {
  dispose(): void;
}

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface Panel {
  id: string;
  title: string;
  component: ComponentType;
}

export interface RenderHooks {
  before?: (html: string) => string;
  after?: (html: string) => string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  signal?: AbortSignal;
}

export interface AiProvider {
  id: string;
  name: string;
  listModels(endpoint: string, key: string): Promise<string[]>;
  chat(messages: ChatMessage[], opts: ChatOptions, endpoint: string, key: string): Promise<ReadableStream<string> | string>;
}

export interface RemoteFile {
  name: string;
  mtime: number;
  size: number;
}

export interface SyncBackend {
  id: string;
  name: string;
  list(): Promise<RemoteFile[]>;
  get(name: string): Promise<string>;
  put(name: string, content: string): Promise<void>;
  del(name: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

export interface UiApi {
  toast(msg: string, kind?: string): void;
}

export interface CommandRegistry { register(cmd: Command): Disposable; }
export interface PanelRegistry { register(panel: Panel): Disposable; }
export interface RendererRegistry { register(hooks: RenderHooks): Disposable; }
export interface EditorRegistry { register(ext: Extension): Disposable; }
export interface AiProviderRegistry { register(provider: AiProvider): Disposable; }
export interface SyncBackendRegistry { register(backend: SyncBackend): Disposable; }

export interface PluginContext {
  commands: CommandRegistry;
  panels: PanelRegistry;
  renderers: RendererRegistry;
  editors: EditorRegistry;
  aiProviders: AiProviderRegistry;
  syncBackends: SyncBackendRegistry;
  ui: UiApi;
  log: (msg: string) => void;
}

export interface VetroPlugin {
  id: string;
  name: string;
  version: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
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

class PanelRegistryImpl implements PanelRegistry {
  private items = new Map<string, Panel>();
  register(panel: Panel): Disposable {
    this.items.set(panel.id, panel);
    return { dispose: () => { this.items.delete(panel.id); } };
  }
  all(): Panel[] { return Array.from(this.items.values()); }
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

class AiProviderRegistryImpl implements AiProviderRegistry {
  private items = new Map<string, AiProvider>();
  register(provider: AiProvider): Disposable {
    this.items.set(provider.id, provider);
    return { dispose: () => { this.items.delete(provider.id); } };
  }
  get(id: string): AiProvider | undefined { return this.items.get(id); }
  all(): AiProvider[] { return Array.from(this.items.values()); }
}

class SyncBackendRegistryImpl implements SyncBackendRegistry {
  private items = new Map<string, SyncBackend>();
  register(backend: SyncBackend): Disposable {
    this.items.set(backend.id, backend);
    return { dispose: () => { this.items.delete(backend.id); } };
  }
  get(id: string): SyncBackend | undefined { return this.items.get(id); }
  all(): SyncBackend[] { return Array.from(this.items.values()); }
}

// —— 管理器 ——

export class PluginManager {
  readonly commands = new CommandRegistryImpl();
  readonly panels = new PanelRegistryImpl();
  readonly renderers = new RendererRegistryImpl();
  readonly editors = new EditorRegistryImpl();
  readonly aiProviders = new AiProviderRegistryImpl();
  readonly syncBackends = new SyncBackendRegistryImpl();

  private plugins = new Map<string, VetroPlugin>();
  // 每个插件激活期间注册项的 Disposable，卸载时统一释放
  private disposables = new Map<string, Disposable[]>();
  private activatingId: string | null = null;

  constructor(private ui: UiApi, private log: (msg: string) => void = () => {}) {}

  /** 记录当前激活中插件的注册动作，便于 deactivate 时回收 */
  private track(register: () => Disposable): Disposable {
    const d = register();
    if (this.activatingId) {
      const list = this.disposables.get(this.activatingId) || [];
      list.push(d);
      this.disposables.set(this.activatingId, list);
    }
    return d;
  }

  private context(): PluginContext {
    return {
      commands: { register: (cmd) => this.track(() => this.commands.register(cmd)) },
      panels: { register: (panel) => this.track(() => this.panels.register(panel)) },
      renderers: { register: (hooks) => this.track(() => this.renderers.register(hooks)) },
      editors: { register: (ext) => this.track(() => this.editors.register(ext)) },
      aiProviders: { register: (p) => this.track(() => this.aiProviders.register(p)) },
      syncBackends: { register: (b) => this.track(() => this.syncBackends.register(b)) },
      ui: this.ui,
      log: this.log
    };
  }

  async activate(plugin: VetroPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      this.log(`[plugin] ${plugin.name} 已在运行，忽略重复激活`);
      return;
    }
    const ctx = this.context();
    this.activatingId = plugin.id;
    try {
      await plugin.activate(ctx);
      this.plugins.set(plugin.id, plugin);
      this.log(`[plugin] ${plugin.name} 已加载`);
    } finally {
      this.activatingId = null;
    }
  }

  async deactivate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    await plugin.deactivate?.();
    // 释放该插件注册的全部命令 / 面板 / 钩子 / 扩展
    for (const d of this.disposables.get(id) || []) {
      try { d.dispose(); } catch { /* 忽略单个释放失败 */ }
    }
    this.disposables.delete(id);
    this.plugins.delete(id);
    this.log(`[plugin] ${plugin.name} 已卸载`);
  }
}
