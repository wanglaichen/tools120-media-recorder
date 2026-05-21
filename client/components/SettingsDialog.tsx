'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Settings, X } from 'lucide-react';
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
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export function SettingsDialog({ open, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [serverMiniMax, setServerMiniMax] = useState(false);
  const [showApiKey, setShowApiKey] = useState<Record<AiProviderId, boolean>>({
    minimax: false,
    deepseek: false,
  });

  useEffect(() => {
    if (!open) return;
    setDraft(loadAppSettings());
    setShowApiKey({ minimax: false, deepseek: false });
    resetMiniMaxTransportCache();
    void detectMiniMaxTransport().then((mode) => setServerMiniMax(mode === 'server'));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

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

  const toggleKeyVisible = (id: AiProviderId) => {
    setShowApiKey((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩：仅阻挡背景操作，点击不关闭 */}
      <div
        className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60"
        aria-hidden="true"
      />
      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
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
            const keyDisabled = disabled || (meta.id === 'minimax' && serverMiniMax);
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
                  <div className="relative mt-1">
                    <input
                      type={showApiKey[meta.id] ? 'text' : 'password'}
                      autoComplete="off"
                      disabled={keyDisabled}
                      className={`${inputClass} pr-10 disabled:cursor-not-allowed disabled:opacity-50`}
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
                    <button
                      type="button"
                      disabled={keyDisabled}
                      onClick={() => toggleKeyVisible(meta.id)}
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      aria-label={showApiKey[meta.id] ? '隐藏 API Key' : '显示 API Key'}
                      tabIndex={keyDisabled ? -1 : 0}
                    >
                      {showApiKey[meta.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">API 地址</label>
                  <input
                    disabled={disabled || (meta.id === 'minimax' && serverMiniMax)}
                    className={`${inputClass} mt-1 disabled:cursor-not-allowed disabled:opacity-50`}
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
