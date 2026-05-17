'use client';

import { Loader2, X } from 'lucide-react';
import type { RecordingClip } from '@/types/recording';

type RecordingPickerModalProps = {
  open: boolean;
  recordings: RecordingClip[];
  listLoading: boolean;
  listError: string;
  pickingId: string;
  onClose: () => void;
  onSelect: (clip: RecordingClip) => void;
  formatDuration: (seconds: number) => string;
  formatFileSize: (bytes: number) => string;
  formatDateTime: (timestamp: number) => string;
};

export function RecordingPickerModal({
  open,
  recordings,
  listLoading,
  listError,
  pickingId,
  onClose,
  onSelect,
  formatDuration,
  formatFileSize,
  formatDateTime,
}: RecordingPickerModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 dark:bg-slate-950/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recording-picker-title"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="recording-picker-title" className="text-base font-semibold text-card-foreground">
            选择采集录音
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[min(60vh,420px)] overflow-auto p-2">
          {listError && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {listError}
            </div>
          )}

          {listLoading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={18} />
              加载中…
            </div>
          ) : recordings.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              暂无采集记录，请先在「音频采集」页录音
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {recordings.map((clip) => {
                const isPicking = pickingId === clip.id;
                const isPending = clip.id.startsWith('pending-');

                return (
                  <li key={clip.id}>
                    <button
                      type="button"
                      disabled={isPending || isPicking}
                      onClick={() => onSelect(clip)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-indigo-950/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-card-foreground">
                          {clip.displayName}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatDateTime(clip.createdAt)} · {formatDuration(clip.duration)} ·{' '}
                          {formatFileSize(clip.size)}
                        </span>
                      </span>
                      {isPicking && <Loader2 className="shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" size={18} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}