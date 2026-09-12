"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ModelTrendCharts } from "@/components/model-trend-charts";

interface EndpointStatus {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  healthy: boolean;
  priority: number;
  weight: number;
  error_count: number;
}

interface StatusResponse {
  total: number;
  healthy: number;
  unhealthy: number;
  endpoints: EndpointStatus[];
}

interface PoolWindow {
  limit: number;
  used: number;
  remaining: number;
  reset_at: number;
}

interface QuotaPool {
  id: string;
  name: string;
  model_ids: string[];
  window_5h: PoolWindow;
  window_7d: PoolWindow;
  pool_type: string;
}

interface UsageEndpoint {
  id: string;
  name: string;
  authorization: "not_configured" | "valid" | "invalid";
  expires_at?: number;
  plan?: string | null;
  pools?: QuotaPool[];
  error?: string;
}

interface UsageResponse {
  endpoints: UsageEndpoint[];
}

function formatReset(resetAt: number): string {
  if (!resetAt) return "";
  const remaining = resetAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return "即将重置";
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (days > 0) return `${days}天${hours}小时后重置`;
  if (hours > 0) return `${hours}小时${minutes}分后重置`;
  return `${Math.max(minutes, 1)}分钟后重置`;
}

function formatTokens(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

function getBarColor(percent: number): string {
  if (percent > 50) return "bg-emerald-500";
  if (percent > 20) return "bg-amber-500";
  return "bg-rose-500";
}

function QuotaWindow({ label, window }: { label: string; window: PoolWindow }) {
  const percent = window.limit > 0 ? Math.max(0, Math.min(100, (window.remaining / window.limit) * 100)) : 0;
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">{label}</span>
        <span className="shrink-0 tabular-nums font-medium text-slate-800">
          {formatTokens(window.remaining)} <span className="text-slate-400">/ {formatTokens(window.limit)}</span>
          <span className={`ml-1.5 font-semibold ${percent > 50 ? "text-emerald-600" : percent > 20 ? "text-amber-600" : "text-rose-600"}`}>{percent.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-slate-200/70">
        <div className={`h-full rounded-full transition-all ${getBarColor(percent)}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] leading-tight text-slate-400">{formatReset(window.reset_at)}</div>
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [usage, setUsage] = useState<UsageEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function fetchStatus() {
    try {
      const response = await fetch("/api/status");
      setStatus(await response.json());
    } catch (error) {
      console.error("Failed to fetch status:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsage() {
    try {
      const response = await fetch("/api/usages");
      if (!response.ok) return;
      const data: UsageResponse = await response.json();
      setUsage(data.endpoints);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Failed to fetch quota:", error);
    }
  }

  useEffect(() => {
    const initialFetch = setTimeout(() => {
      void fetchStatus();
      void fetchUsage();
    }, 0);
    const interval = setInterval(() => {
      void fetchStatus();
      void fetchUsage();
    }, 60000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, []);

  if (loading) return <div className="text-muted-foreground">加载中...</div>;
  if (!status) return <div className="text-destructive">获取状态失败</div>;

  const usageById = new Map(usage.map((item) => [item.id, item]));

  return (
    <div className="min-h-[calc(100vh-7rem)] space-y-4 rounded-2xl bg-slate-50 p-4 text-slate-900 shadow-sm">
      {/* 头部：标题 + 内联统计 + 刷新信息，一行搞定 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">端点配额总览</h1>
          <span className="text-[11px] uppercase tracking-[0.18em] text-sky-500">SenseNova Proxy</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 tabular-nums text-slate-600 ring-1 ring-slate-200">
            总端点 <strong className="font-semibold text-slate-900">{status.total}</strong>
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 tabular-nums text-emerald-700 ring-1 ring-emerald-200">
            健康 <strong className="font-semibold">{status.healthy}</strong>
          </span>
          <span className="rounded-full bg-rose-50 px-2.5 py-1 tabular-nums text-rose-700 ring-1 ring-rose-200">
            不健康 <strong className="font-semibold">{status.unhealthy}</strong>
          </span>
        </div>
        <div className="ml-auto text-[11px] text-slate-400">
          每 60 秒自动刷新{lastUpdated && <span className="ml-1.5">· {lastUpdated.toLocaleTimeString("zh-CN")}</span>}
        </div>
      </div>

      <ModelTrendCharts />

      {status.endpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-slate-500">暂无端点，请先添加端点</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {status.endpoints.map((endpoint) => {
            const endpointUsage = usageById.get(endpoint.id);
            const pools = endpointUsage?.pools ?? [];
            const modelCount = new Set(pools.flatMap((pool) => pool.model_ids)).size;
            return (
              <Card key={endpoint.id} className="overflow-hidden border-slate-200 bg-white py-0 text-slate-900 shadow-sm">
                <CardContent className="p-3">
                  {/* 端点头部 */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${endpoint.healthy ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]" : "bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.15)]"}`} />
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold leading-tight text-slate-900">{endpoint.name}</h2>
                        <p className="truncate text-[11px] leading-tight text-slate-400">{endpoint.url} · P{endpoint.priority} · W{endpoint.weight}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <Badge className={endpoint.healthy ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>
                        {endpoint.healthy ? "健康" : "不健康"}
                      </Badge>
                      <span className={`text-[10px] ${endpointUsage?.authorization === "valid" ? "text-emerald-500" : endpointUsage?.authorization === "invalid" ? "text-rose-500" : "text-slate-400"}`}>
                        {endpointUsage?.authorization === "valid" ? "授权正常" : endpointUsage?.authorization === "invalid" ? "授权失效" : "未配置授权"}
                      </span>
                    </div>
                  </div>

                  {/* 配额标题行 */}
                  <div className="mt-2.5 flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-700">
                      积分池{endpointUsage?.plan && <span className="ml-1.5 font-normal text-slate-400">{endpointUsage.plan}</span>}
                    </span>
                    {endpointUsage?.authorization !== "valid" && <span className="text-slate-400">需要配额授权</span>}
                  </div>

                  {endpointUsage?.authorization === "invalid" && <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">{endpointUsage.error ?? "请在端点管理中重新授权"}</div>}
                  {endpointUsage?.authorization === "not_configured" && <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">请在端点管理中配置该账号的配额授权</div>}
                  {endpointUsage?.authorization === "valid" && (
                    <div className="mt-2 space-y-2">
                      {pools.map((pool) => (
                        <div key={pool.id} className="rounded-md bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
                          <div className="mb-1.5 flex items-center justify-between text-[11px]">
                            <span className="font-medium text-slate-800">{pool.name}</span>
                            <span className="text-slate-400">{pool.pool_type === "dedicated" ? "专属" : "通用"}</span>
                          </div>
                          <div className="space-y-1.5">
                            <QuotaWindow label="5小时" window={pool.window_5h} />
                            <QuotaWindow label="7天" window={pool.window_7d} />
                          </div>
                          <div className="mt-1.5 truncate font-mono text-[10px] text-slate-400" title={pool.model_ids.join("、")}>
                            {pool.model_ids.join(" · ")}
                          </div>
                        </div>
                      ))}
                      {pools.length === 0 && <div className="text-[11px] text-slate-400">该端点暂无积分池数据</div>}
                    </div>
                  )}

                  {/* 底部信息 */}
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                    <span>错误 {endpoint.error_count}</span>
                    <span>{modelCount} 个模型</span>
                    <span>{endpoint.enabled ? "已启用" : "已禁用"}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
