// 插件入口约定：每个 .ts 模块需导出一个 default 插件对象
// （或具名导出任意 VetroPlugin 对象）。Vite 在构建期静态收录本目录。
import type { VetroPlugin } from '../plugins';
import { PluginManager } from '../plugins';

// 注意：必须排除 index.ts 自身，否则 glob 会把本模块也收进来形成循环引用
const modules = import.meta.glob<{ default?: VetroPlugin } & Record<string, unknown>>(['./*.ts', '!./index.ts'], { eager: true });

/** 全局插件管理器。放在此模块以便 App 与设置面板共享，避免循环依赖。 */
export const pm = new PluginManager((m) => console.log(m));

/** 收集插件目录下的全部插件对象，按 id 去重 */
export function collectPlugins(): VetroPlugin[] {
  const seen = new Set<string>();
  const out: VetroPlugin[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const candidates: unknown[] = [mod.default, ...Object.values(mod)];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      const p = c as Partial<VetroPlugin>;
      if (typeof p.id !== 'string' || typeof p.activate !== 'function') continue;
      if (typeof p.name !== 'string' || typeof p.version !== 'string') continue;
      if (seen.has(p.id)) {
        console.warn(`[plugin] ${path} 中的 ${p.id} 与已加载插件重名，已跳过`);
        continue;
      }
      seen.add(p.id);
      out.push({ id: p.id, name: p.name, version: p.version, activate: p.activate.bind(c), deactivate: p.deactivate?.bind(c) });
    }
  }
  return out;
}
