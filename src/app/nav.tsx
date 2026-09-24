"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Network,
  KeyRound,
  FlaskConical,
  ChartColumnBig,
  ScrollText,
  HeartPulse,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard, section: "概览" },
  { href: "/stats", label: "用量统计", icon: ChartColumnBig, section: "概览" },
  { href: "/endpoints", label: "端点管理", icon: Network, section: "配置" },
  { href: "/keys", label: "代理 Key", icon: KeyRound, section: "配置" },
  { href: "/test", label: "测试", icon: FlaskConical, section: "诊断" },
  { href: "/logs", label: "实时日志", icon: ScrollText, section: "诊断" },
] as const;

interface StatusSnapshot {
  total: number;
  healthy: number;
  unhealthy: number;
}

export function AdminNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<StatusSnapshot | null>(null);

  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStatus({ total: data.total ?? 0, healthy: data.healthy ?? 0, unhealthy: data.unhealthy ?? 0 });
      } catch {
        // 静默失败，保留上次的值
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isLoginPage]);

  if (isLoginPage) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        {/* Brand */}
        <Link href="/" className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm">
            <span className="text-[13px] font-bold">N</span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold tracking-tight text-slate-900">
              SenseNova <span className="text-indigo-600">Proxy</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Admin Console</div>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groupNavItems(NAV_ITEMS).map(({ section, items }) => (
            <div key={section} className="mb-4">
              <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {section}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.href} href={item.href} icon={item.icon}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* KPI 区块 */}
        <div className="border-t border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-3">
          <div className="mb-2.5 flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5">
              <HeartPulse className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.5} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">总览</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-[10px] font-medium text-emerald-600">Running</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <KpiBox label="端点" value={status?.total} tone="slate" />
            <KpiBox label="健康" value={status?.healthy} tone="emerald" />
            <KpiBox label="异常" value={status?.unhealthy} tone={status?.unhealthy ? "rose" : "emerald"} />
          </div>
          <div className="mt-2 px-0.5 text-right">
            <span className="font-mono text-[10px] text-slate-400">v1.0.0</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-md">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="text-slate-400">Home</span>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-900">{pageTitle(pathname)}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-500">
              local:3000
            </span>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

function KpiBox({ label, value, tone }: { label: string; value?: number; tone: "slate" | "emerald" | "rose" }) {
  const toneMap = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    rose: "text-rose-600",
  } as const;
  return (
    <div className="rounded-lg bg-white px-1.5 py-1.5 text-center ring-1 ring-slate-200/70">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums leading-tight ${toneMap[tone]}`}>
        {value ?? "-"}
      </div>
    </div>
  );
}

function groupNavItems(items: readonly (typeof NAV_ITEMS)[number][]) {
  type NavItem = (typeof NAV_ITEMS)[number];
  const sections: { section: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else sections.push({ section: item.section, items: [item] });
  }
  return sections;
}

function pageTitle(pathname: string) {
  const match = NAV_ITEMS.find((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)));
  return match?.label ?? "仪表盘";
}

function NavLink({
  href,
  children,
  icon: Icon,
}: {
  href: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
        isActive
          ? "bg-indigo-50 font-medium text-indigo-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon className={`h-4 w-4 ${isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"}`} />
      {children}
    </Link>
  );
}
