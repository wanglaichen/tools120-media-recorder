import { getProviderConfig, type AiProviderId } from '@/lib/app-settings-storage';

export function resolveMiniMaxConfig(): { apiKey: string; baseUrl: string } {
  const c = getProviderConfig('minimax');
  return { apiKey: c.apiKey.trim(), baseUrl: c.baseUrl };
}

export function assertMiniMaxApiKey(): string {
  const { apiKey } = resolveMiniMaxConfig();
  if (!apiKey) {
    throw new Error('请在右上角「设置」中配置 MiniMax API Key');
  }
  return apiKey;
}

export function resolveMiniMaxBaseUrl(): string {
  return resolveMiniMaxConfig().baseUrl;
}

/** 预留：DeepSeek 接入后使用 */
export function resolveDeepSeekConfig(): { apiKey: string; baseUrl: string } {
  return getProviderConfig('deepseek');
}

export type { AiProviderId };
