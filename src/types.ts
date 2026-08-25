// Vetro 核心数据模型（平台无关）

export interface Doc {
  id: string;
  name: string;
  content: string;
  parentId: string | null;
  filePath: string | null;
  sync: boolean;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TrashItem extends Doc {
  deletedAt: number;
}

export interface AccentTheme {
  id: string;
  name: string;
  accent: string;
  accent2: string;
  vars?: Record<string, string>;
  custom?: boolean;
}

export interface IconStyle {
  id: string;
  name: string;
  glyph: string;
}

export type ThemeMode = 'auto' | 'dark' | 'light';
export type ViewMode = 'edit' | 'split' | 'preview';

export interface AiConfig {
  endpoint: string;
  key: string;
  model: string;
  ok: boolean;
}

export interface SyncConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
}

export interface AppConfig {
  theme: ThemeMode;
  viewMode: ViewMode;
  fontSize: number;
  wrap: boolean;
  accent: string;
  icon: string;
  customThemes: AccentTheme[];
  ai: AiConfig;
  sync: SyncConfig;
  /** 专注模式：隐藏顶栏/侧栏/状态栏 */
  focusMode: boolean;
}

export function defaultConfig(): AppConfig {
  return {
    theme: 'auto',
    viewMode: 'split',
    fontSize: 15,
    wrap: true,
    accent: 'teal',
    icon: 'markdown',
    customThemes: [],
    ai: { endpoint: '', key: '', model: 'deepseek-chat', ok: false },
    sync: { enabled: false, url: '', username: '', password: '' },
    focusMode: false,
  };
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function countWords(content: string): number {
  return (content || '').replace(/\s/g, '').length;
}
