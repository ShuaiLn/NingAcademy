import type { Metadata } from "next";
import { SpeedInsightsGate } from "./_components/speed-insights-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "NingAcademy",
  description: "一对一辅导教学平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        {children}
        <footer className="fixed bottom-2 right-3 text-xs text-slate-600">
          Developed by Ning 鲁宁
        </footer>
        <SpeedInsightsGate />
      </body>
    </html>
  );
}
