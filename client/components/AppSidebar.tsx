'use client';

import type { AppNavItem, AppPageKey } from '@/lib/app-nav';

export type { AppPageKey, AppNavItem };

type AppSidebarProps = {
  items: AppNavItem[];
  activeKey: AppPageKey;
  onSelect: (key: AppPageKey) => void;
  /** 为 false 时侧栏暂不高亮任何项（等待服务端恢复页签） */
  pageReady?: boolean;
  sectionTitle?: string;
};

/** 侧栏样式对齐 AntiCheatCore：灰底 + 右侧圆角选中条 */
export function AppSidebar({
  items,
  activeKey,
  onSelect,
  pageReady = true,
  sectionTitle,
}: AppSidebarProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-muted/40 py-2 dark:bg-muted/25">
      {sectionTitle ? (
        <div className="px-4 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {sectionTitle}
        </div>
      ) : null}
      <nav className="space-y-1 px-1" aria-label="页面列表">
        {items.map((page) => {
          const Icon = page.icon;
          const isActive = pageReady && activeKey === page.key;
          return (
            <button
              key={page.key}
              type="button"
              onClick={() => onSelect(page.key)}
              className={`flex w-full items-center gap-3 rounded-r-lg px-4 py-3 text-left text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-muted text-foreground shadow-sm dark:bg-accent/80'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:hover:bg-accent/40'
              }`}
            >
              <Icon size={20} className="shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{page.label}</span>
                <span
                  className={`mt-0.5 block truncate text-xs font-normal ${
                    isActive ? 'text-foreground/75' : 'text-muted-foreground'
                  }`}
                >
                  {page.detail}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
