import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "SenseNova Proxy",
  description: "SenseNova 自动故障转移代理",
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
          <nav className="border-b bg-card">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex h-14 items-center justify-between">
                <div className="flex items-center gap-6">
                  <a href="/" className="font-semibold text-lg">
                    SenseNova Proxy
                  </a>
                  <div className="flex gap-4">
                    <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      仪表盘
                    </a>
                    <a href="/endpoints" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      端点管理
                    </a>
                    <a href="/stats" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      用量统计
                    </a>
                    <a href="/logs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      实时日志
                    </a>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  v1.0.0
                </div>
              </div>
            </div>
          </nav>
          <main className="mx-auto w-full max-w-[1720px] px-3 py-5 sm:px-5 sm:py-6 lg:px-6">
            {children}
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
