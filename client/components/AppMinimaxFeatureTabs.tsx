'use client';

import type { AppNavItem, AppPageKey } from '@/lib/app-nav';
import { getNavItemsByCategory } from '@/lib/app-nav';

type Props = {
  activePage: AppPageKey;
  onSelect: (page: AppPageKey) => void;
};

export function AppMinimaxFeatureTabs({ activePage, onSelect }: Props) {
  const items: AppNavItem[] = getNavItemsByCategory('minimax');

  return (
    <div className="border-b border-border bg-muted/20">
      <div className="mx-auto w-full max-w-7xl px-4 py-2 sm:px-6">
        <div
          className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="MiniMax 功能"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(item.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground'
                }`}
              >
                <Icon size={15} className="shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
