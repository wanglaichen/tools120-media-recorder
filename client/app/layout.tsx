import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "音视频工作台",
  description: "MediaRecorder + OpenAI Whisper fp32",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased min-h-screen overflow-y-auto">
        <main>{children}</main>
      </body>
    </html>
  );
}