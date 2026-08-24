"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  return (
    <>
      {!isLoginPage && (
        <nav className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-6">
                <Link href="/" className="font-semibold text-lg">
                  SenseNova Proxy
                </Link>
                <div className="flex gap-4">
                  <NavLink href="/">仪表盘</NavLink>
                  <NavLink href="/endpoints">端点管理</NavLink>
                  <NavLink href="/stats">用量统计</NavLink>
                  <NavLink href="/logs">实时日志</NavLink>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">v1.0.0</div>
            </div>
          </div>
        </nav>
      )}
      {isLoginPage ? (
        children
      ) : (
        <main className="mx-auto w-full max-w-[1720px] px-3 py-5 sm:px-5 sm:py-6 lg:px-6">
          {children}
        </main>
      )}
    </>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
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