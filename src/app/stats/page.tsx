"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ModelStats {
  model: string;
  requests: number;
  successful_requests: number;
  failed_requests: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}
interface StatsResponse {
  endpoints: { id: string; name: string; api_key: string }[];
  models: string[];
  stats: {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    by_model: ModelStats[];
  };
}

const ranges = [
  ["24h", "最近 24 小时"],
  ["today", "今天"],
  ["7d", "最近 7 天"],
  ["30d", "最近 30 天"],
  ["all", "全部历史"],
];

function number(value: number): string { return new Intl.NumberFormat("zh-CN").format(value || 0); }
function displayToken(value: number | null, compact: boolean): string { return value === null ? "不可用" : compact ? compactNumber(value) : number(value); }

function compactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(2).replace(/\.00$/, "")}K`;
  return number(value);
}

export default function StatsPage() {
  const [range, setRange] = useState("24h");
  const [endpointId, setEndpointId] = useState("all");
  const [model, setModel] = useState("all");
  const [compact, setCompact] = useState(true);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const formatNumber = (value: number) => compact ? compactNumber(value) : number(value);

  useEffect(() => {
    const query = new URLSearchParams({ range });
    if (endpointId !== "all") query.set("endpoint_id", endpointId);
    if (model !== "all") query.set("model", model);
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/stats?${query}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("统计数据获取失败");
          setData(await response.json());
        })
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [range, endpointId, model]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-sky-600">Analytics / Usage</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">用量统计</h1>
        <p className="mt-2 text-sm text-muted-foreground">按时间、端点 Key 和模型查看调用次数、成功率与 Token 消耗</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Select value={range} onValueChange={(value) => setRange(value ?? "24h")}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="时间范围" /></SelectTrigger>
            <SelectContent>{ranges.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={endpointId} onValueChange={(value) => setEndpointId(value ?? "all")}>
            <SelectTrigger className="w-full sm:w-[260px]"><SelectValue placeholder="按 Key 筛选" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部端点 Key</SelectItem>
              {data?.endpoints.map((endpoint) => <SelectItem key={endpoint.id} value={endpoint.id}>{endpoint.name} · {endpoint.api_key}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={model} onValueChange={(value) => setModel(value ?? "all")}>
            <SelectTrigger className="w-full sm:w-[260px]"><SelectValue placeholder="按模型筛选" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模型</SelectItem>
              {data?.models.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setCompact((value) => !value)}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {compact ? "简洁数字" : "精确数字"}
          </button>
        </CardContent>
      </Card>

      {loading && <div className="py-10 text-center text-sm text-muted-foreground">加载统计数据...</div>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {[
              ["总调用", data.stats.total_requests, "text-slate-900"],
              ["成功", data.stats.successful_requests, "text-emerald-600"],
              ["失败", data.stats.failed_requests, "text-rose-600"],
              ["总 Token", data.stats.total_tokens, "text-sky-600"],
              ["输入 Token", data.stats.prompt_tokens, "text-slate-700"],
              ["输出 Token", data.stats.completion_tokens, "text-slate-700"],
            ].map(([label, value, color]) => <Card key={String(label)}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-2 text-xl font-semibold ${color}`}>{typeof label === "string" && label.includes("Token") ? displayToken(value as number | null, compact) : formatNumber(Number(value))}</div></CardContent></Card>)}
          </div>

          <Card>
            <CardHeader><CardTitle>模型调用明细</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-5 py-3">模型</th><th className="px-3 py-3">调用次数</th><th className="px-3 py-3">成功</th><th className="px-3 py-3">失败</th><th className="px-3 py-3">成功率</th><th className="px-3 py-3">输入 Token</th><th className="px-3 py-3">输出 Token</th><th className="px-5 py-3">总 Token</th></tr></thead>
                  <tbody>{data.stats.by_model.map((item) => <tr key={item.model} className="border-b last:border-0"><td className="px-5 py-4 font-medium">{item.model}</td><td className="px-3 py-4">{formatNumber(item.requests)}</td><td className="px-3 py-4 text-emerald-600">{formatNumber(item.successful_requests)}</td><td className="px-3 py-4 text-rose-600">{formatNumber(item.failed_requests)}</td><td className="px-3 py-4">{item.requests ? `${Math.round(item.successful_requests / item.requests * 1000) / 10}%` : "-"}</td><td className="px-3 py-4">{displayToken(item.prompt_tokens, compact)}</td><td className="px-3 py-4">{displayToken(item.completion_tokens, compact)}</td><td className="px-5 py-4 font-medium">{displayToken(item.total_tokens, compact)}</td></tr>)}</tbody>
                </table>
                {data.stats.by_model.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">当前筛选条件下暂无调用记录</div>}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
