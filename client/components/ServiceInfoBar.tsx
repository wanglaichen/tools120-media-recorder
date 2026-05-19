'use client';

import { useEffect, useState } from 'react';
import { resolveApiBase, resolveApiOrigin, resolveHealthUrl } from '@/lib/recordings';

type HealthPayload = {
  clientIp?: string;
};

export function ServiceInfoBar() {
  const apiEndpoint = resolveApiBase();
  const apiOrigin = resolveApiOrigin() || '（未配置）';
  const [serverIp, setServerIp] = useState('…');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(resolveHealthUrl(), { cache: 'no-store' });
        const data = (await response.json()) as HealthPayload;
        if (!cancelled) setServerIp(data.clientIp?.trim() || '-');
      } catch {
        if (!cancelled) setServerIp('-');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="border-b border-border/50 bg-muted/20 px-4 py-1 text-[10px] leading-snug text-muted-foreground sm:px-6">
      <p className="truncate">
        <span className="text-muted-foreground/80">Server</span>{' '}
        <span className="font-mono text-[10px] text-foreground/70">{apiOrigin}</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/80">接口</span>{' '}
        <span className="font-mono text-[10px] text-foreground/70">{apiEndpoint}</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/80">服务器 IP</span>{' '}
        <span className="font-mono text-[10px] text-foreground/70">{serverIp}</span>
      </p>
    </div>
  );
}
