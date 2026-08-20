"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface EndpointStatus {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  healthy: boolean;
  priority: number;
  weight: number;
  error_count: number;
  last_check: number;
}

interface StatusResponse {
  total: number;
  healthy: number;
  unhealthy: number;
  endpoints: EndpointStatus[];
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error("Failed to fetch status:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  if (!status) {
    return <div className="text-destructive">获取状态失败</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">仪表盘</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">总端点数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{status.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">健康</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{status.healthy}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">不健康</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{status.unhealthy}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>端点状态</CardTitle>
        </CardHeader>
        <CardContent>
          {status.endpoints.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              暂无端点，请先添加端点
            </div>
          ) : (
            <div className="space-y-3">
              {status.endpoints.map((ep) => (
                <div
                  key={ep.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={ep.healthy ? "default" : "destructive"}>
                      {ep.healthy ? "健康" : "不健康"}
                    </Badge>
                    <div>
                      <div className="font-medium">{ep.name}</div>
                      <div className="text-sm text-muted-foreground">{ep.url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>优先级: {ep.priority}</span>
                    <span>权重: {ep.weight}</span>
                    <span>错误数: {ep.error_count}</span>
                    <Badge variant={ep.enabled ? "outline" : "secondary"}>
                      {ep.enabled ? "启用" : "禁用"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
