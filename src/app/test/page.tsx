"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  Radio,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface Endpoint {
  id: string;
  name: string;
  url: string;
  priority: number;
  weight: number;
  enabled: boolean;
  healthy: boolean;
  api_key?: string;
}
interface Model {
  id: string;
  name?: string;
}
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  token_estimated?: boolean;
}
interface TestRecord {
  id: string;
  endpointName: string;
  model: string;
  stream: boolean;
  status: "running" | "success" | "error";
  content: string;
  duration?: number;
  ttfb?: number;
  usage?: Usage;
  error?: string;
  timestamp: Date;
}

function token(value?: number) {
  return value == null ? "-" : value.toLocaleString();
}
function usageLabel(usage?: Usage) {
  return usage?.token_estimated ? "本地估算" : "上游真实 Usage";
}

export default function TestPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingEndpoints, setLoadingEndpoints] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [streamMode, setStreamMode] = useState(true);
  const [testing, setTesting] = useState(false);
  const [history, setHistory] = useState<TestRecord[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/endpoints")
      .then((res) => res.json())
      .then(setEndpoints)
      .catch(() => toast.error("获取端点失败"))
      .finally(() => setLoadingEndpoints(false));
  }, []);
  useEffect(() => {
    if (!selectedEndpoint) return;
    let active = true;
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const res = await fetch(`/api/endpoints/${selectedEndpoint}/models`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "获取模型失败");
        const list =
          data.data.filter(
            (model: Model) => model.id !== "sensenova-6.7-flash-lite",
          ) ??
          data.filter(
            (model: Model) => model.id !== "sensenova-6.7-flash-lite",
          );
        if (active) {
          setModels(list);
          setSelectedModel(list[0]?.id ?? "");
        }
      } catch (error) {
        if (active)
          toast.error(error instanceof Error ? error.message : "获取模型失败");
      } finally {
        if (active) setLoadingModels(false);
      }
    };
    void loadModels();
    return () => {
      active = false;
    };
  }, [selectedEndpoint]);

  function updateRecord(id: string, patch: Partial<TestRecord>) {
    setHistory((prev) =>
      prev.map((record) =>
        record.id === id ? { ...record, ...patch } : record,
      ),
    );
  }

  async function runTest() {
    if (!selectedEndpoint || !selectedModel)
      return toast.error("请选择端点和模型");
    const endpoint = endpoints.find((item) => item.id === selectedEndpoint);
    const id = crypto.randomUUID();
    const started = Date.now();
    setHistory((prev) => [
      {
        id,
        endpointName: endpoint?.name ?? "未知端点",
        model: selectedModel,
        stream: streamMode,
        status: "running",
        content: "",
        timestamp: new Date(),
      },
      ...prev,
    ]);
    setTesting(true);
    let partialContent = "";
    console.log(selectedModel,'selectedModel')
    try {
      const res = await fetch(`/api/endpoints/${selectedEndpoint}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, stream: streamMode }),
      });
      if (!streamMode) {
        const data = await res.json();
        updateRecord(id, {
          status: data.success ? "success" : "error",
          content: data.content || "",
          error: data.error,
          duration: data.duration,
          usage: data.usage,
        });
        if (!data.success) toast.error(data.error || `HTTP ${res.status}`);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        updateRecord(id, {
          status: "error",
          error: data.error || `HTTP ${res.status}`,
          content: data.error || "",
          duration: Date.now() - started,
        });
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("响应没有内容");
      const decoder = new TextDecoder();
      let buffer = "";
      let usage: Usage | undefined;
      let ttfb: number | undefined;
      const consume = (line: string) => {
        if (!line.startsWith("data:")) return;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") return;
        try {
          const event = JSON.parse(raw);
          if (event.test_result) {
            usage = event.test_result.usage;
            updateRecord(id, {
              usage,
              duration: event.test_result.duration,
              ttfb: event.test_result.ttfb,
            });
            return;
          }
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            if (ttfb === undefined) ttfb = Date.now() - started;
            partialContent += delta;
            updateRecord(id, { content: partialContent, ttfb });
          }
        } catch {
          /* partial SSE event */
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      }
      buffer += decoder.decode();
      buffer.split("\n").forEach(consume);
      updateRecord(id, {
        status: "success",
        content: partialContent,
        duration: Date.now() - started,
        ttfb,
        usage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "测试失败";
      updateRecord(id, {
        status: "error",
        error: message,
        content: partialContent,
        duration: Date.now() - started,
      });
    } finally {
      setTesting(false);
    }
  }

  const endpoint = endpoints.find((item) => item.id === selectedEndpoint);
  return (
    <div className="min-h-[calc(100vh-7rem)] space-y-4 rounded-2xl bg-slate-50 p-4 text-slate-900">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            模型连通性测试
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            验证指定 Key、模型和流式响应，记录保留在当前会话
          </p>
        </div>
        <Badge
          variant="outline"
          className="gap-1 border-sky-200 bg-sky-50 text-sky-700"
        >
          <Radio className="h-3 w-3" />
          实时输出
        </Badge>
      </div>
      <Card className="border-slate-200 bg-white py-0 shadow-sm">
        <CardContent className="p-3">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1.4fr_auto_auto] lg:items-end">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">
                端点 / Key
              </label>
              <Select
                value={selectedEndpoint}
                onValueChange={(value) => {
                  setSelectedEndpoint(value ?? "");
                  setModels([]);
                  setSelectedModel("");
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={loadingEndpoints ? "加载中..." : "选择端点"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {endpoints.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="flex items-center gap-2">
                        <i
                          className={`h-2 w-2 rounded-full ${item.healthy ? "bg-emerald-400" : "bg-rose-400"}`}
                        />
                        {item.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">
                模型{" "}
                {loadingModels && (
                  <span className="ml-1 text-sky-600">自动加载中...</span>
                )}
              </label>
              <Select
                value={selectedModel}
                onValueChange={(value) => setSelectedModel(value ?? "")}
                disabled={!models.length || loadingModels}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={loadingModels ? "正在获取模型" : "选择模型"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name || item.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">
                响应方式
              </label>
              <div className="flex h-8 rounded-md border border-slate-200 bg-white p-0.5">
                <Button
                  size="xs"
                  variant={streamMode ? "secondary" : "ghost"}
                  onClick={() => setStreamMode(true)}
                >
                  <Zap />
                  流式
                </Button>
                <Button
                  size="xs"
                  variant={!streamMode ? "secondary" : "ghost"}
                  onClick={() => setStreamMode(false)}
                >
                  <FileText />
                  普通
                </Button>
              </div>
            </div>
            <Button onClick={runTest} disabled={testing || !selectedModel}>
              <Play />
              {testing ? "测试中..." : "运行测试"}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <span>
              地址{" "}
              <b className="font-medium text-slate-600">
                {endpoint?.url || "未选择"}
              </b>
            </span>
            <span>
              模型列表{" "}
              <b className="font-medium text-slate-600">
                {loadingModels ? "加载中" : `${models.length} 个`}
              </b>
            </span>
            <span>Key 仅用于服务端请求，不在页面展示</span>
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto h-5 text-slate-400"
              onClick={() => setHistory([])}
              disabled={!history.length}
            >
              <Trash2 />
              清空记录
            </Button>
          </div>
        </CardContent>
      </Card>
      <div ref={outputRef} className="space-y-3">
        {history.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-white py-0">
            <CardContent className="py-16 text-center text-sm text-slate-400">
              选择端点后模型会自动加载，准备好后运行测试
            </CardContent>
          </Card>
        ) : (
          history.map((record) => (
            <TestResult key={record.id} record={record} />
          ))
        )}
      </div>
    </div>
  );
}

function TestResult({ record }: { record: TestRecord }) {
  const success = record.status === "success";
  return (
    <Card className="overflow-hidden border-slate-200 bg-white py-0 shadow-sm">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {record.status === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
            ) : success ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-600" />
            )}
            <b className="truncate text-sm text-slate-800">{record.model}</b>
            <Badge variant="outline" className="text-[10px]">
              {record.endpointName}
            </Badge>
            <Badge
              variant={record.stream ? "default" : "secondary"}
              className="text-[10px]"
            >
              {record.stream ? "流式" : "普通"}
            </Badge>
            <Badge
              variant={record.status === "error" ? "destructive" : "outline"}
              className="text-[10px]"
            >
              {record.status === "running"
                ? "运行中"
                : success
                  ? "成功 · 200"
                  : "失败"}
            </Badge>
          </div>
          <span className="text-[11px] text-slate-400">
            {record.timestamp.toLocaleTimeString("zh-CN")}
          </span>
        </div>
        <div className="grid gap-3 p-3 lg:grid-cols-[1.3fr_.7fr]">
          <div className="min-h-40 rounded-md bg-[#101820] p-3 font-mono text-sm leading-6 text-emerald-300">
            <pre className="whitespace-pre-wrap break-words">
              {record.content ||
                (record.status === "running"
                  ? "等待上游响应..."
                  : "无输出内容")}
              {record.status === "running" && (
                <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-emerald-300" />
              )}
            </pre>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-100 bg-slate-50">
            <Metric
              label="首字延迟"
              value={record.ttfb == null ? "-" : `${record.ttfb} ms`}
            />
            <Metric
              label="总耗时"
              value={
                record.duration == null
                  ? "-"
                  : `${(record.duration / 1000).toFixed(2)} s`
              }
            />
            <Metric
              label="输入 Token"
              value={token(record.usage?.prompt_tokens)}
            />
            <Metric
              label="输出 Token"
              value={token(record.usage?.completion_tokens)}
            />
            <Metric
              label="总 Token"
              value={token(record.usage?.total_tokens)}
            />
            <Metric
              label="数据来源"
              value={record.usage ? usageLabel(record.usage) : "-"}
            />
          </div>
        </div>
        {record.error && (
          <div className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {record.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-slate-100 bg-white p-2.5">
      <span className="block text-[10px] text-slate-400">{label}</span>
      <b className="mt-1 block text-sm text-slate-800">{value}</b>
    </div>
  );
}
