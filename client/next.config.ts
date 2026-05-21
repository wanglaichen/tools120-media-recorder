import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  // 仅开发环境代理 API；静态导出不会应用 rewrites，避免构建告警
  ...(isDev
    ? {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: 'http://127.0.0.1:8787/api/:path*',
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;