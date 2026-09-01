"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return "未配置自动续期";
  const remaining = expiresAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return "即将刷新";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  return hours > 0 ? `${hours}小时${minutes}分后刷新` : `${Math.max(minutes, 1)}分钟后刷新`;
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
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="shrink-0 tabular-nums font-medium text-slate-900">
          {formatTokens(window.remaining)} / {formatTokens(window.limit)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${getBarColor(percent)}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400">{formatReset(window.reset_at)}</div>
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
    <div className="min-h-[calc(100vh-7rem)] space-y-5 rounded-2xl bg-slate-50 p-3 text-slate-900 shadow-sm sm:p-5">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sky-400">SenseNova Proxy / Overview</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">端点配额总览</h1>
          <p className="mt-2 text-sm text-slate-500">每个端点的健康状态、路由配置和模型剩余额度集中展示</p>
        </div>
        <div className="text-xs text-slate-500">
          每 60 秒自动刷新
          {lastUpdated && <span className="ml-2 text-slate-400">· {lastUpdated.toLocaleTimeString("zh-CN")}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["总端点", status.total, "text-slate-100"],
          ["健康", status.healthy, "text-emerald-400"],
          ["不健康", status.unhealthy, "text-rose-400"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {status.endpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 py-16 text-center text-slate-500">暂无端点，请先添加端点</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {status.endpoints.map((endpoint) => {
            const endpointUsage = usageById.get(endpoint.id);
            const pools = endpointUsage?.pools ?? [];
            const modelCount = new Set(pools.flatMap((pool) => pool.model_ids)).size;
            return (
              <Card key={endpoint.id} className="overflow-hidden border-slate-200 bg-white text-slate-900 shadow-lg shadow-slate-200/60">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${endpoint.healthy ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" : "bg-rose-400 shadow-[0_0_0_4px_rgba(251,113,133,0.12)]"}`} />
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-slate-900">{endpoint.name}</h2>
                        <p className="mt-1 truncate text-xs text-slate-500">{endpoint.url} · P{endpoint.priority} · W{endpoint.weight}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge className={endpoint.healthy ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>
                        {endpoint.healthy ? "健康" : "不健康"}
                      </Badge>
                      <span className={`text-[11px] ${endpointUsage?.authorization === "valid" ? "text-emerald-400" : endpointUsage?.authorization === "invalid" ? "text-rose-400" : "text-slate-500"}`}>
                        {endpointUsage?.authorization === "valid" ? "授权正常" : endpointUsage?.authorization === "invalid" ? "授权失效" : "未配置授权"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs">
                    <strong className="text-sm text-slate-800">
                      积分池配额
                      {endpointUsage?.plan && <span className="ml-2 font-normal text-slate-500">{endpointUsage.plan}</span>}
                    </strong>
                    <span className="text-slate-500">{endpointUsage?.authorization === "valid" ? formatExpiry(endpointUsage.expires_at) : "需要配额授权"}</span>
                  </div>

                  {endpointUsage?.authorization === "invalid" && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{endpointUsage.error ?? "请在端点管理中重新授权"}</div>}
                  {endpointUsage?.authorization === "not_configured" && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">请在端点管理中配置该账号的配额授权</div>}
                  {endpointUsage?.authorization === "valid" && (
                    <div className="mt-4 space-y-4">
                      {pools.map((pool) => (
                        <div key={pool.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-800">{pool.name}</span>
                            <span className="text-slate-400">{pool.pool_type === "dedicated" ? "专属" : "通用"}</span>
                          </div>
                          <div className="space-y-2.5">
                            <QuotaWindow label="5小时窗口" window={pool.window_5h} />
                            <QuotaWindow label="7天窗口" window={pool.window_7d} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {pool.model_ids.map((modelId) => (
                              <span key={modelId} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200">{modelId}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {pools.length === 0 && <div className="text-xs text-slate-500">该端点暂无积分池数据</div>}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-[10px] text-slate-500">
                    <span>错误数 {endpoint.error_count}</span>
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
