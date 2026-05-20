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

type Props = {
  open: boolean;
  onClose: () => void;
};

const inputClass =
  'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export function SettingsDialog({ open, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    if (!open) return;
    setDraft(loadAppSettings());
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
                <div>
                  <label className="text-xs font-medium text-foreground">API Key</label>
                  <input
                    type="password"
                    autoComplete="off"
                    disabled={disabled}
                    className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    value={cfg.apiKey}
                    onChange={(e) => setProvider(meta.id, { apiKey: e.target.value })}
                    placeholder={meta.id === 'minimax' ? '从 platform.minimaxi.com 获取' : ''}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">API 地址</label>
                  <input
                    disabled={disabled}
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
          保存在本机浏览器。未填写时，MiniMax 会尝试使用根目录 .env 同步的环境变量。
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
