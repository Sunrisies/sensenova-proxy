"use client";

import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Range = "24h" | "7d" | "30d";
type Point = { bucket: number; model: string; requests: number; total_tokens: number };
const COLORS = ["#0f86bd", "#db8a32", "#168762", "#9c61b6", "#d04d68"];

function formatBucket(value: number, range: Range) {
  return new Date(value * 1000).toLocaleString("zh-CN", range === "24h"
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { month: "numeric", day: "numeric" });
}

function TrendChart({ title, data, models, metric, range }: {
  title: string; data: Record<string, number | string>[]; models: string[]; metric: "requests" | "total_tokens"; range: Range;
}) {
  return <Card className="border-slate-200 bg-white py-0 shadow-sm"><CardContent className="p-3">
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-800">{title}</h2><span className="text-[11px] text-slate-400">按模型</span></div>
    <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={28} />
      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
      <Tooltip formatter={(value) => [Number(value).toLocaleString(), metric === "requests" ? "请求" : "Token"]} labelFormatter={(_, values) => formatBucket(Number(values[0]?.payload?.bucket), range)} />
      {models.map((model, index) => <Line key={model} type="monotone" dataKey={model} stroke={COLORS[index]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />)}
    </LineChart></ResponsiveContainer></div>
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">{models.map((model, index) => <span key={model}><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS[index] }} />{model}</span>)}</div>
  </CardContent></Card>;
}

export function ModelTrendCharts() {
  const [range, setRange] = useState<Range>("24h");
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true;
    // Fetching a new range intentionally resets the loading state before the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); fetch(`/api/stats/trends?range=${range}`).then(async res => {
    if (!res.ok) throw new Error(); const data = await res.json(); if (active) setPoints(data.points);
  }).catch(() => active && setPoints([])).finally(() => active && setLoading(false)); return () => { active = false; }; }, [range]);

  const { models, data } = useMemo(() => {
    const ranked = new Map<string, number>();
    for (const point of points) ranked.set(point.model, (ranked.get(point.model) ?? 0) + point.requests);
    const models = [...ranked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([model]) => model);
    const buckets = new Map<number, Record<string, number | string>>();
    for (const point of points) { if (!models.includes(point.model)) continue; const row = buckets.get(point.bucket) ?? { bucket: point.bucket, label: formatBucket(point.bucket, range) }; row[`${point.model}:requests`] = point.requests; row[`${point.model}:total_tokens`] = point.total_tokens; buckets.set(point.bucket, row); }
    const data = [...buckets.values()].sort((a, b) => Number(a.bucket) - Number(b.bucket)).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.includes(":") ? key : key, value])));
    return { models, data: data.map(row => { const normalized: Record<string, number | string> = { bucket: row.bucket, label: row.label }; for (const model of models) { normalized[model] = Number(row[`${model}:requests`] ?? 0); normalized[`${model} tokens`] = Number(row[`${model}:total_tokens`] ?? 0); } return normalized; }) };
  }, [points, range]);

  const tokenData = data.map(row => { const next: Record<string, number | string> = { bucket: row.bucket, label: row.label }; for (const model of models) next[model] = row[`${model} tokens`] as number; return next; });
  return <section className="border-t border-slate-200 pt-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold text-slate-900">模型趋势</h2><p className="text-[11px] text-slate-400">仅统计业务请求，不包含测试请求</p></div><div className="flex rounded-md border border-slate-200 bg-white p-0.5">{(["24h", "7d", "30d"] as Range[]).map(value => <Button key={value} variant={range === value ? "secondary" : "ghost"} size="xs" onClick={() => setRange(value)}>{value === "24h" ? "24 小时" : value === "7d" ? "7 天" : "30 天"}</Button>)}</div></div>
    {loading ? <div className="h-44 text-center text-sm leading-[11rem] text-slate-400">加载趋势数据...</div> : models.length === 0 ? <div className="rounded-md border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">此时间范围内暂无业务请求</div> : <div className="grid gap-3 lg:grid-cols-2"><TrendChart title="请求量趋势" data={data} models={models} metric="requests" range={range} /><TrendChart title="Token 消耗趋势" data={tokenData} models={models} metric="total_tokens" range={range} /></div>}
  </section>;
}
