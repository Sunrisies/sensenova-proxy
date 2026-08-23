import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

function NavLink({ href, pathname, children }: { href: string; pathname: string; children: React.ReactNode }) {
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`text-sm transition-colors py-1 ${
        isActive
          ? "text-foreground font-medium border-b-2 border-foreground pb-1.5"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

export const metadata: Metadata = {
  title: "SenseNova Proxy",
  description: "SenseNova 自动故障转移代理",
  viewport: { width: "device-width", initialScale: 1 },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isLoginPage = pathname === "/login";

  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <div className="min-h-screen bg-background">
          {!isLoginPage && <nav className="border-b bg-card">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex h-14 items-center justify-between">
                <div className="flex items-center gap-6">
                  <Link href="/" className="font-semibold text-lg">
                    SenseNova Proxy
                  </Link>
                  <div className="flex gap-4">
                    <NavLink href="/" pathname={pathname} children="仪表盘" />
                    <NavLink href="/endpoints" pathname={pathname} children="端点管理" />
                    <NavLink href="/stats" pathname={pathname} children="用量统计" />
                    <NavLink href="/logs" pathname={pathname} children="实时日志" />
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  v1.0.0
                </div>
              </div>
            </div>
          </nav>}
          <main className={isLoginPage ? "min-h-screen" : "mx-auto w-full max-w-[1720px] px-3 py-5 sm:px-5 sm:py-6 lg:px-6"}>
            {children}
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
