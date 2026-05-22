/**
 * 构建时内联的 NEXT_PUBLIC_* 环境变量。
 * 必须写死 process.env.NEXT_PUBLIC_XXX，不能用 process.env[变量名] 动态读取。
 */
import { resolveApiBase } from '@/lib/recordings';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';

/** 设置页「环境变量（调试）」展示项 */
export const PUBLIC_ENV_DEBUG = [
  {
    key: 'NEXT_PUBLIC_API_BASE_URL',
    label: 'API 基础地址',
    value: apiBaseUrl,
  },
  {
    key: '（实际请求）',
    label: '音频/接口基址',
    value: resolveApiBase(),
  },
] as const;
