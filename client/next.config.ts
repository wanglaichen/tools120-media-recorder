import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8787/api/:path*',
      },
    ];
  },
};

export default nextConfig;