"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LogEntry {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  success: boolean;
  switched: boolean;
  error?: string;
  model?: string;
  stream?: boolean;
  client_ip?: string;
  first_byte_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  created_at: number;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch initial logs
    fetchLogs();

    // Connect to SSE stream
    const eventSource = new EventSource("/api/logs/stream");

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;
        setLogs((prev) => [data, ...prev].slice(0, 200));
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  async function fetchLogs() {
    try {
      const res = await fetch("/api/logs?limit=100");
      const data = await res.json();
      setLogs(data);
    } catch {
      console.error("Failed to fetch logs");
    }
  }

  function formatTime(ts: number) {
    return new Date(ts * 1000).toLocaleTimeString("zh-CN");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">实时日志</h1>
        <div className="flex items-center gap-4">
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "已连接" : "未连接"}
          </Badge>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            自动滚动
          </label>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>请求日志</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无日志，等待请求...
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {logs.map((log) => (
                <div key={log.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={log.success ? "default" : "destructive"}>{log.status}</Badge>
                    <Badge variant="outline">{log.stream ? "流式" : "非流式"}</Badge>
                    {log.switched && <Badge variant="outline" className="text-orange-500">已切换 Key</Badge>}
                    <span className="font-mono font-medium">{log.model || "未知模型"}</span>
                    <span className="ml-auto text-muted-foreground">{formatTime(log.created_at)}</span>
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <span>入站: <code>{log.path}</code></span>
                    <span>端点: {log.endpoint_name}</span>
                    <span>客户端: {log.client_ip || "未知"}</span>
                    <span>方法: {log.method}</span>
                    <span>首字: {log.first_byte_ms != null ? `${(log.first_byte_ms / 1000).toFixed(2)}s` : "-"}</span>
                    <span>总耗时: {(log.duration / 1000).toFixed(2)}s</span>
                    <span>Token: {log.total_tokens ?? "-"}（输入 {log.prompt_tokens ?? "-"} / 输出 {log.completion_tokens ?? "-"}）</span>
                    <span>费用: {log.cost != null ? `$${log.cost.toFixed(6)}` : "-"}</span>
                  </div>
                  {log.error && <div className="mt-2 truncate text-xs text-destructive" title={log.error}>{log.error}</div>}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
