'use client';

import type { AppCategoryId } from '@/lib/app-nav';
import { APP_CATEGORY_TABS } from '@/lib/app-nav';

type Props = {
  activeCategory: AppCategoryId;
  onChange: (category: AppCategoryId) => void;
};

export function AppCategoryTabs({ activeCategory, onChange }: Props) {
  return (
    <div className="border-b border-border bg-card/80">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div
          className="inline-flex w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:w-auto"
          role="tablist"
          aria-label="功能分类"
        >
          {APP_CATEGORY_TABS.map((tab) => {
            const active = activeCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(tab.id)}
                className={`min-w-[7.5rem] flex-1 rounded-md px-4 py-2 text-sm font-medium transition sm:flex-none ${
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {APP_CATEGORY_TABS.find((t) => t.id === activeCategory)?.hint}
        </p>
      </div>
    </div>
  );
}
