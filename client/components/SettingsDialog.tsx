'use client';

import { useEffect, useState } from 'react';
import { Settings, X } from 'lucide-react';
import {
  AI_PROVIDER_META,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  type AiProviderConfig,
  type AiProviderId,
  type AppSettings,
} from '@/lib/app-settings-storage';
import {
  detectMiniMaxTransport,
  getMiniMaxConfigEndpoint,
  resetMiniMaxTransportCache,
} from '@/lib/minimax-transport';

type Props = {
  open: boolean;
  onClose: () => void;
};

const inputClass =
  'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export function SettingsDialog({ open, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [serverMiniMax, setServerMiniMax] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(loadAppSettings());
    resetMiniMaxTransportCache();
    void detectMiniMaxTransport().then((mode) => setServerMiniMax(mode === 'server'));
  }, [open]);

  const setProvider = (id: AiProviderId, patch: Partial<AiProviderConfig>) => {
    setDraft((prev) => ({
      providers: {
        ...prev.providers,
        [id]: { ...prev.providers[id], ...patch },
      },
    }));
  };

  const persist = () => {
    saveAppSettings(draft);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 dark:bg-slate-950/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-primary" />
            <h2 id="settings-dialog-title" className="text-base font-semibold">
              设置
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[min(70vh,480px)] space-y-5 overflow-y-auto px-4 py-4">
          {AI_PROVIDER_META.map((meta) => {
            const cfg = draft.providers[meta.id];
            const disabled = !meta.enabled;
            return (
              <section
                key={meta.id}
                className={`space-y-3 ${meta.id !== 'minimax' ? 'border-t border-border pt-4' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
                  {meta.hint ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {meta.hint}
                    </span>
                  ) : null}
                </div>
                {meta.id === 'minimax' && serverMiniMax ? (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-foreground">
                    已由服务器统一配置（根目录 <code className="text-[11px]">.env</code> 的{' '}
                    <code className="text-[11px]">MINIMAX_API_KEY</code>），所有浏览器共用，无需在本机填写
                    Key。请保持 API 服务运行（{getMiniMaxConfigEndpoint()}）。
                  </p>
                ) : null}
                <div>
                  <label className="text-xs font-medium text-foreground">API Key</label>
                  <input
                    type="password"
                    autoComplete="off"
                    disabled={disabled || (meta.id === 'minimax' && serverMiniMax)}
                    className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    value={cfg.apiKey}
                    onChange={(e) => setProvider(meta.id, { apiKey: e.target.value })}
                    placeholder={
                      meta.id === 'minimax' && serverMiniMax
                        ? '由服务器 .env 提供'
                        : meta.id === 'minimax'
                          ? '从 platform.minimaxi.com 获取'
                          : ''
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">API 地址</label>
                  <input
                    disabled={disabled || (meta.id === 'minimax' && serverMiniMax)}
                    className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    value={cfg.baseUrl}
                    onChange={(e) => setProvider(meta.id, { baseUrl: e.target.value })}
                    placeholder="https://api.minimaxi.com"
                  />
                </div>
              </section>
            );
          })}
        </div>

        <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          {serverMiniMax
            ? '推荐：在根目录 .env 配置 MINIMAX_API_KEY，用 start.ps1 启动；任意浏览器访问即可使用 MiniMax。'
            : '未检测到服务器密钥时，可在此填写（仅当前浏览器）。本地开发请优先配置根目录 .env 并启动 API 服务。'}
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={persist}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
