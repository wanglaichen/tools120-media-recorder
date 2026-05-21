'use client';

import { useEffect, useState } from 'react';
import { resolveApiBase, resolveApiOrigin, resolveHealthUrl } from '@/lib/recordings';

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? 'local';

type HealthPayload = {
  clientIp?: string;
};

export function ServiceInfoBar() {
  const apiEndpoint = resolveApiBase();
  const apiOrigin = resolveApiOrigin() || '（未配置）';
  const [frontendOrigin, setFrontendOrigin] = useState('…');
  const [serverIp, setServerIp] = useState('…');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setFrontendOrigin(window.location.origin);
    }
  }, []);

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
    <div
      className="flex items-center gap-3 border-b border-border/40 bg-muted/15 px-4 py-1 sm:px-6"
      data-app-version={appVersion}
      data-build-id={buildId}
    >
      <p className="min-w-0 flex-1 truncate text-xs leading-snug text-muted-foreground">
        <span className="font-mono text-foreground/80">v{appVersion}</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="font-mono" title={`构建标识 ${buildId}`}>
          {buildId}
        </span>
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/80">前端</span>{' '}
        <span className="font-mono text-foreground/70">{frontendOrigin}</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/80">Server</span>{' '}
        <span className="font-mono text-foreground/70">{apiOrigin}</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/80">接口</span>{' '}
        <span className="font-mono text-foreground/70">{apiEndpoint}</span>
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/80">IP</span>{' '}
        <span className="font-mono text-foreground/70">{serverIp}</span>
      </p>
    </div>
  );
}
