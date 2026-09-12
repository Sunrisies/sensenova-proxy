"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationButton,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

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
  token_estimated?: boolean;
  cost?: number;
  switch_chain?: string;
  created_at: number;
  attempts?: { endpoint_name: string; status: number; success: boolean; error?: string }[];
  is_test?: boolean;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export default function LogsPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-muted-foreground">加载中...</div>}>
      <LogsView />
    </Suspense>
  );
}

function LogsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 页码由 URL 驱动，刷新/分享后保留
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function setPage(target: number) {
    router.replace(`/logs?page=${target}`, { scroll: false });
  }

  async function fetchLogs(targetPage: number) {
    try {
      const res = await fetch(`/api/logs?page=${targetPage}&pageSize=${pageSize}`);
      const data: LogsResponse = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      if (data.page !== targetPage) {
        router.replace(`/logs?page=${data.page}`, { scroll: false });
      }
    } catch {
      console.error("Failed to fetch logs");
    }
  }

  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // 页码变化时拉取对应页数据
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // SSE 连接只建立一次，不随翻页重建
  useEffect(() => {
    const eventSource = new EventSource("/api/logs/stream");

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;
        // 只有停留在第一页时才实时插入新日志
        if (pageRef.current === 1) {
          setLogs((prev) => [data, ...prev.filter((log) => log.id !== data.id)].slice(0, pageSize));
          setTotal((value) => value + 1);
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">实时日志</h1>
        <div className="flex items-center gap-4">
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "已连接" : "未连接"}
          </Badge>
          <span className="text-sm text-muted-foreground">共 {total} 条，最新在前</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>请求日志</CardTitle>
        </CardHeader>
        <CardContent className="px-2">
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无日志，等待请求...
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                  <TableRow>
                    <TableHead>状态</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>入站</TableHead>
                    <TableHead>端点</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>费用</TableHead>
                    <TableHead>延迟</TableHead>
                    <TableHead className="text-right">时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <LogRow key={log.id} log={log} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <span className="text-sm text-muted-foreground text-center sm:text-left">第 {page} / {totalPages} 页</span>
        <LogPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        <span className="hidden sm:block" />
      </div>
    </div>
  );
}

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
}

function formatTokens(log: LogEntry) {
  if (log.total_tokens == null) return "-";
  return `${log.total_tokens.toLocaleString()}（入 ${log.prompt_tokens?.toLocaleString() ?? "-"} / 出 ${log.completion_tokens?.toLocaleString() ?? "-"}）${log.token_estimated ? " · 估算" : ""}`;
}

function formatLatency(log: LogEntry) {
  const total = `${(log.duration / 1000).toFixed(2)}s`;
  if (log.first_byte_ms == null) return total;
  return `首字 ${(log.first_byte_ms / 1000).toFixed(2)}s / 总 ${total}`;
}

function LogRow({ log }: { log: LogEntry }) {
  const hasDetail = Boolean(log.error || (log.attempts && log.attempts.length > 1));

  return (
    <>
      <TableRow>
        <TableCell>
          <Badge variant={log.success ? "default" : "destructive"}>{log.status || "错误"}</Badge>
        </TableCell>
        <TableCell className="font-mono font-medium">{log.model || "未知模型"}</TableCell>
        <TableCell>
          <code className="text-xs">{log.method} {log.path}</code>
        </TableCell>
        <TableCell>
          <div>{log.endpoint_name}</div>
          {log.switch_chain && (
            <div className="text-xs text-muted-foreground">链路: {log.switch_chain}</div>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">{log.client_ip || "未知"}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Badge variant="outline">{log.stream ? "流式" : "非流式"}</Badge>
            {log.switched && <Badge variant="outline" className="text-orange-500">已切换</Badge>}
            {log.is_test && <Badge variant="outline" className="border-sky-200 text-sky-600">测试</Badge>}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{formatTokens(log)}</TableCell>
        <TableCell className="text-muted-foreground">{log.cost != null ? `$${log.cost.toFixed(6)}` : "-"}</TableCell>
        <TableCell className="text-muted-foreground">{formatLatency(log)}</TableCell>
        <TableCell className="text-right text-muted-foreground">{formatTime(log.created_at)}</TableCell>
      </TableRow>
      {hasDetail && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={10} className="whitespace-normal pt-0 text-xs">
            {log.error && (
              <div className="text-destructive" title={log.error}>{log.error}</div>
            )}
            {log.attempts && log.attempts.length > 1 && (
              <div className="text-muted-foreground">
                尝试明细：{log.attempts.map((attempt, index) => (
                  <span key={`${attempt.endpoint_name}-${index}`} className={attempt.success ? "text-emerald-600" : "text-rose-600"}>
                    {index > 0 ? " → " : ""}{attempt.endpoint_name} ({attempt.status || "网络错误"})
                  </span>
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** 生成页码序列，如 [1, '…', 4, 5, 6, '…', 20] */
function getPageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const items: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) items.push("ellipsis");
    items.push(sorted[i]);
  }
  return items;
}

function LogPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const items = getPageItems(page, totalPages);

  return (
    <Pagination className="mx-auto">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          />
        </PaginationItem>
        {items.map((item, index) =>
          item === "ellipsis" ? (
            <PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              <PaginationButton
                isActive={item === page}
                onClick={() => onPageChange(item)}
              >
                {item}
              </PaginationButton>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNext
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
