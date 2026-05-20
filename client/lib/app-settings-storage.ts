/**
 * 工作台 AI 提供商配置（localStorage，仅本机浏览器）
 */

export type AiProviderId = 'minimax' | 'deepseek';

export interface AiProviderConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AppSettings {
  providers: Record<AiProviderId, AiProviderConfig>;
}

export const APP_SETTINGS_STORAGE_KEY = 'tools120-app-settings-v2';

const DEFAULT_BASE_URLS: Record<AiProviderId, string> = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com',
};

export const AI_PROVIDER_META: {
  id: AiProviderId;
  label: string;
  enabled: boolean;
  hint?: string;
}[] = [
  { id: 'minimax', label: 'MiniMax', enabled: true },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    enabled: false,
    hint: '即将支持',
  },
];

function emptyProviders(): Record<AiProviderId, AiProviderConfig> {
  return {
    minimax: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.minimax },
    deepseek: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.deepseek },
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  providers: emptyProviders(),
};

function normalizeBaseUrl(raw: string, fallback: string): string {
  const base = (raw.trim() || fallback).replace(/\/+$/, '');
  return base.replace(/\/v1$/i, '');
}

/** 从构建时环境变量填充（根目录 .env 同步的 NEXT_PUBLIC_*） */
export function envDefaultsForProvider(id: AiProviderId): AiProviderConfig {
  if (id === 'minimax') {
    return {
      apiKey: process.env.NEXT_PUBLIC_MINIMAX_API_KEY?.trim() ?? '',
      baseUrl: normalizeBaseUrl(
        process.env.NEXT_PUBLIC_MINIMAX_API_BASE_URL ?? '',
        DEFAULT_BASE_URLS.minimax,
      ),
    };
  }
  return { apiKey: '', baseUrl: DEFAULT_BASE_URLS.deepseek };
}

function mergeProvider(
  id: AiProviderId,
  stored?: Partial<AiProviderConfig>,
): AiProviderConfig {
  const env = envDefaultsForProvider(id);
  const fallback = DEFAULT_BASE_URLS[id];
  const apiKeyRaw = stored?.apiKey?.trim() || env.apiKey;
  const apiKey = apiKeyRaw === 'your_api_key_here' ? '' : apiKeyRaw;
  const baseUrl = stored?.baseUrl?.trim()
    ? normalizeBaseUrl(stored.baseUrl, fallback)
    : normalizeBaseUrl(env.baseUrl, fallback);
  return { apiKey, baseUrl };
}

export function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return {
      providers: {
        minimax: envDefaultsForProvider('minimax'),
        deepseek: emptyProviders().deepseek,
      },
    };
  }
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        providers: {
          minimax: mergeProvider('minimax'),
          deepseek: mergeProvider('deepseek'),
        },
      };
    }
    const parsed = JSON.parse(raw) as {
      providers?: Partial<Record<AiProviderId, Partial<AiProviderConfig>>>;
    };
    if (parsed.providers) {
      return {
        providers: {
          minimax: mergeProvider('minimax', parsed.providers.minimax),
          deepseek: mergeProvider('deepseek', parsed.providers.deepseek),
        },
      };
    }
  } catch {
    /* ignore */
  }
  return {
    providers: {
      minimax: mergeProvider('minimax'),
      deepseek: mergeProvider('deepseek'),
    },
  };
}

export function saveAppSettings(settings: AppSettings): void {
  const normalized: AppSettings = {
    providers: {
      minimax: {
        apiKey: settings.providers.minimax.apiKey.trim(),
        baseUrl: normalizeBaseUrl(
          settings.providers.minimax.baseUrl,
          DEFAULT_BASE_URLS.minimax,
        ),
      },
      deepseek: {
        apiKey: settings.providers.deepseek.apiKey.trim(),
        baseUrl: normalizeBaseUrl(
          settings.providers.deepseek.baseUrl,
          DEFAULT_BASE_URLS.deepseek,
        ),
      },
    },
  };
  localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
}

export function getProviderConfig(id: AiProviderId): AiProviderConfig {
  return loadAppSettings().providers[id];
}
