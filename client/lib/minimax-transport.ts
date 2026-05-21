/**
 * MiniMax 请求走服务端代理（根目录 .env）或浏览器直连（localStorage / NEXT_PUBLIC_*）
 */

export type MiniMaxTransportMode = 'server' | 'client';

let cachedMode: MiniMaxTransportMode | null = null;
let detectPromise: Promise<MiniMaxTransportMode> | null = null;

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
}

export function getMiniMaxProxyEndpoint(): string {
  const base = apiBaseUrl();
  return base ? `${base}/api/minimax/proxy` : '/api/minimax/proxy';
}

export function getMiniMaxConfigEndpoint(): string {
  const base = apiBaseUrl();
  return base ? `${base}/api/minimax/config` : '/api/minimax/config';
}

export async function detectMiniMaxTransport(): Promise<MiniMaxTransportMode> {
  if (cachedMode) return cachedMode;
  if (typeof window === 'undefined') return 'client';
  if (!detectPromise) {
    detectPromise = (async () => {
      try {
        const r = await fetch(getMiniMaxConfigEndpoint());
        if (r.ok) {
          const j = (await r.json()) as { mode?: string; configured?: boolean };
          if (j.mode === 'server' && j.configured) {
            cachedMode = 'server';
            return cachedMode;
          }
        }
      } catch {
        /* API 未启动或静态站点无后端时走客户端 Key */
      }
      cachedMode = 'client';
      return cachedMode;
    })();
  }
  return detectPromise;
}

export function resetMiniMaxTransportCache(): void {
  cachedMode = null;
  detectPromise = null;
}

export async function useMiniMaxServerProxy(): Promise<boolean> {
  return (await detectMiniMaxTransport()) === 'server';
}
