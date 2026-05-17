'use client';

import { ArrowRight, Check, Download, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { RecordingClip } from '@/types/recording';

type RecordingListProps = {
  recordings: RecordingClip[];
  activeRecordingId: string;
  listLoading: boolean;
  listError: string;
  editingId: string;
  editingName: string;
  savingId: string;
  onSelect: (clip: RecordingClip) => void;
  onStartEdit: (clip: RecordingClip) => void;
  onCancelEdit: () => void;
  onSaveEdit: (clipId: string) => void;
  onEditingNameChange: (value: string) => void;
  onConvert: (clip: RecordingClip) => void;
  onDelete: (clipId: string) => void;
  onClear: () => void;
  formatDuration: (seconds: number) => string;
  formatFileSize: (bytes: number) => string;
  formatDateTime: (timestamp: number) => string;
  getAudioExtension: (mimeType: string) => string;
};

export function RecordingList({
  recordings,
  activeRecordingId,
  listLoading,
  listError,
  editingId,
  editingName,
  savingId,
  onSelect,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditingNameChange,
  onConvert,
  onDelete,
  onClear,
  formatDuration,
  formatFileSize,
  formatDateTime,
  getAudioExtension,
}: RecordingListProps) {
  if (listLoading) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        加载列表…
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border bg-muted px-4 py-8 text-center text-sm font-medium text-muted-foreground">
        暂无采集记录
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {listError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {listError}
        </div>
      )}
      <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
        <ul className="divide-y divide-border">
          {recordings.map((clip) => {
            const isActive = clip.id === activeRecordingId;
            const isEditing = editingId === clip.id;
            const isBusy = savingId === clip.id || clip.id.startsWith('pending-');

            return (
              <li
                key={clip.id}
                className={`transition ${isActive ? 'bg-indigo-50/70 dark:bg-indigo-950/50' : 'bg-card hover:bg-muted'}`}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  {isEditing ? (
                    <input
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onSaveEdit(clip.id);
                        if (event.key === 'Escape') onCancelEdit();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(clip)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="truncate text-sm font-semibold text-card-foreground">{clip.displayName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDuration(clip.duration)} · {formatFileSize(clip.size)}
                      </span>
                      {isBusy && <Loader2 className="shrink-0 animate-spin text-muted-foreground" size={14} />}
                    </button>
                  )}

                  <div className="flex shrink-0 items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onSaveEdit(clip.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
                          title="保存"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={onCancelEdit}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                          title="取消"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onStartEdit(clip)}
                          disabled={isBusy}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                          title="编辑名称"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onConvert(clip)}
                          disabled={!isActive || isBusy}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950"
                          title="转换"
                        >
                          <ArrowRight size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(clip.id)}
                          disabled={isBusy}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-40"
                          title="删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isActive && !isEditing && (
                  <div className="border-t border-indigo-100 px-3 pb-3 pt-2 dark:border-indigo-900">
                    <audio controls src={clip.url} className="h-9 w-full" />
                    <div className="mt-2 flex items-center gap-2">
                      <a
                        href={clip.url}
                        download={`${clip.displayName}.${getAudioExtension(clip.type)}`}
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-semibold text-card-foreground hover:bg-muted"
                      >
                        <Download size={14} />
                        下载
                      </a>
                      <span className="truncate text-xs text-muted-foreground">{formatDateTime(clip.createdAt)}</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-card-foreground transition hover:bg-muted"
      >
        <Trash2 size={15} />
        清空列表
      </button>
    </div>
  );
}