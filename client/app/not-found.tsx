'use client';

import { useEffect } from 'react';

/** 静态托管下若路由未匹配，回到首页（避免长期显示 Next 默认 404） */
export default function NotFound() {
  useEffect(() => {
    window.location.replace('/');
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      页面不存在，正在返回首页…
    </main>
  );
}
