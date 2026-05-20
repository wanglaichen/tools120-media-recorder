'use client';

import { AlertCircle, ExternalLink, Wallet } from 'lucide-react';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';

type Props = {
  error: unknown;
  featureLabel?: string;
};

export function MiniMaxBillingAlert({ error, featureLabel = '当前功能' }: Props) {
  const alert = buildMiniMaxBillingAlert(error);
  if (!alert) return null;

  const Icon = alert.kind === 'balance' ? Wallet : AlertCircle;

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
    >
      <div className="flex items-start gap-2">
        <Icon size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">{alert.title}</p>
          <p className="leading-relaxed text-amber-900/90 dark:text-amber-50/90">
            {featureLabel}无法继续：{alert.summary}
          </p>
          <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed opacity-90">
            {alert.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <a
            href="https://platform.minimaxi.com/user-center/payment/token-plan"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 underline hover:text-amber-950 dark:text-amber-200"
          >
            前往 MiniMax 控制台
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}
