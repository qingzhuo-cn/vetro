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
export const VISUAL_THEMES = ['midnight', 'dawn', 'ocean', 'sakura', 'aurora', 'mocha'] as const;
export type VisualTheme = (typeof VISUAL_THEMES)[number];
export const FONT_FAMILIES = ['sans', 'hei', 'kai', 'song', 'fang', 'mono'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export interface AiConfig {
  /** 当前平台显示名，如「智谱 GLM」「DeepSeek」 */
  name: string;
  endpoint: string;
  key: string;
  model: string;
  ok: boolean;
}

/** 用户保存的 AI 平台配置（密钥不入此结构，单独存系统钥匙串） */
export interface AiProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  model: string;
}

/** 内置平台预设：一键填入地址与默认模型（均为 OpenAI 兼容接口） */
export const AI_PLATFORM_PRESETS = [
  { id: 'zhipu', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'moonshot', name: 'Kimi', endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'qwen', name: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'doubao', name: '豆包', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-1.5-pro-32k' },
  { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'siliconflow', name: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'groq', name: 'Groq', endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'xai', name: 'xAI Grok', endpoint: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  { id: 'mistral', name: 'Mistral', endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { id: 'gemini', name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { id: 'ollama', name: 'Ollama 本地', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  { id: 'lmstudio', name: 'LM Studio 本地', endpoint: 'http://localhost:1234/v1', model: 'local-model' },
] as const;

export interface SyncConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  autosync: boolean;
  lastSync: number;
}

export interface AppConfig {
  theme: ThemeMode;
  visualTheme: VisualTheme;
  viewMode: ViewMode;
  fontSize: number;
  fontFamily: FontFamily;
  dividerRatio: number;
  immersionPreviousView: ViewMode | null;
  wrap: boolean;
  accent: string;
  icon: string;
  customThemes: AccentTheme[];
  ai: AiConfig;
  /** 用户保存的 AI 平台列表，可在设置中一键切换 */
  aiProviders: AiProviderPreset[];
  sync: SyncConfig;
  /** 专注模式：隐藏顶栏/侧栏/状态栏 */
  focusMode: boolean;
  /** 打字机模式：光标所在行始终保持在视口中央 */
  typewriterMode: boolean;
}

export function defaultConfig(): AppConfig {
  return {
    theme: 'auto',
    visualTheme: 'midnight',
    viewMode: 'split',
    fontSize: 15,
    fontFamily: 'sans',
    dividerRatio: 0.5,
    immersionPreviousView: null,
    wrap: true,
    accent: 'teal',
    icon: 'markdown',
    customThemes: [],
    ai: { name: '', endpoint: '', key: '', model: 'deepseek-chat', ok: false },
    aiProviders: [],
    sync: { enabled: false, url: '', username: '', password: '', autosync: false, lastSync: 0 },
    focusMode: false,
    typewriterMode: false,
  };
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function countWords(content: string): number {
  const text = content || '';
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fff\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}
