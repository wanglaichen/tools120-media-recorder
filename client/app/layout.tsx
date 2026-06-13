import type { Metadata } from "next";
import "./globals.css";
import { ServiceInfoBar } from "@/components/ServiceInfoBar";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

export const metadata: Metadata = {
  title: `AI聚合工作台 v${appVersion}`,
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
        <ServiceInfoBar />
        {children}
      </body>
    </html>
  );
}
