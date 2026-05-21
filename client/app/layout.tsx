import type { Metadata } from "next";
import { BuildVersionBadge } from "@/components/BuildVersionBadge";
import "./globals.css";

export const metadata: Metadata = {
  title: "聚合工作台",
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
        <div className="flex items-center justify-end border-b border-border/40 bg-muted/15 px-4 py-1 sm:px-6">
          <BuildVersionBadge />
        </div>
        {children}
      </body>
    </html>
  );
}