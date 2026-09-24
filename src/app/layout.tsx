import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AdminNav } from "./nav";

export const metadata: Metadata = {
  title: "SenseNova Proxy",
  description: "SenseNova 自动故障转移代理",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <div className="min-h-screen bg-background">
          <AdminNav>{children}</AdminNav>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
