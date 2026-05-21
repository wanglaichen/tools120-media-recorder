import type { Metadata } from "next";
import "./globals.css";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "local";

export const metadata: Metadata = {
  title: `聚合工作台 v${appVersion}`,
  description: "MediaRecorder + OpenAI Whisper fp32",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased min-h-screen overflow-y-auto">
        <div
          className="flex items-center justify-end border-b border-border/40 bg-muted/15 px-4 py-1 sm:px-6"
          data-app-version={appVersion}
          data-build-id={buildId}
        >
          <span
            className="shrink-0 font-mono text-[10px] leading-none text-muted-foreground"
            title={`构建标识 ${buildId}`}
          >
            v{appVersion}
            <span className="mx-1 text-border">·</span>
            {buildId}
          </span>
        </div>
        {children}
      </body>
    </html>
  );
}
