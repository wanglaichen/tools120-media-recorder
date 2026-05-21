import { APP_VERSION, BUILD_ID } from '@/lib/build-info';

/** 构建版本（服务端渲染，会写入静态 HTML，便于核对线上是否最新发版） */
export function BuildVersionBadge() {
  return (
    <span
      className="shrink-0 font-mono text-[10px] leading-none text-muted-foreground"
      title={`构建标识 ${BUILD_ID}`}
    >
      v{APP_VERSION}
      <span className="mx-1 text-border">·</span>
      {BUILD_ID}
    </span>
  );
}
