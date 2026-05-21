import { getProviderConfig, type AiProviderId } from '@/lib/app-settings-storage';

export function resolveMiniMaxConfig(): { apiKey: string; baseUrl: string } {
  const c = getProviderConfig('minimax');
  return { apiKey: c.apiKey.trim(), baseUrl: c.baseUrl };
}

export function assertMiniMaxApiKey(): string {
  const { apiKey } = resolveMiniMaxConfig();
  if (!apiKey) {
    throw new Error(
      '未配置 MiniMax：请在项目根目录 .env 设置 MINIMAX_API_KEY 并启动 API 服务（start.ps1），或在「设置」中填写 API Key',
    );
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
