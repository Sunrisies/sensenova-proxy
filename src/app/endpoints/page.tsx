"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";

interface Endpoint {
  id: string;
  name: string;
  url: string;
  api_key: string;
  priority: number;
  weight: number;
  enabled: boolean;
  healthy: boolean;
  error_count: number;
  quota_authorization: "not_configured" | "valid";
  quota_expires_at?: number;
}

interface Model {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
}

interface TestResult {
  success: boolean;
  status: number;
  duration: number;
  content?: string;
  model?: string;
  error?: string;
}

interface EndpointPanel {
  models: Model[];
  modelsLoading: boolean;
  selectedModel: string;
  testing: boolean;
  testResult: TestResult | null;
  expanded: boolean;
}

export default function EndpointsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState<Endpoint | null>(null);
  const [form, setForm] = useState({
    name: "",
    url: "",
    api_key: "",
    priority: 0,
    weight: 1,
  });
  const [authorizationForm, setAuthorizationForm] = useState({
    sensenova_account_id: "",
    console_access_token: "",
    console_refresh_token: "",
  });

  // Per-endpoint panels state
  const [panels, setPanels] = useState<Record<string, EndpointPanel>>({});

  useEffect(() => {
    fetchEndpoints();
  }, []);

  function getPanel(id: string): EndpointPanel {
    return panels[id] ?? {
      models: [],
      modelsLoading: false,
      selectedModel: "",
      testing: false,
      testResult: null,
      expanded: false,
    };
  }

  function updatePanel(id: string, update: Partial<EndpointPanel>) {
    setPanels(prev => ({ ...prev, [id]: { ...getPanel(id), ...update } }));
  }

  async function fetchEndpoints() {
    try {
      const res = await fetch("/api/endpoints");
      const data = await res.json();
      setEndpoints(data);
    } catch {
      toast.error("获取端点失败");
    } finally {
      setLoading(false);
    }
  }

  async function fetchModelsForEndpoint(ep: Endpoint) {
    updatePanel(ep.id, { modelsLoading: true, models: [], selectedModel: "", testResult: null });

    try {
      const res = await fetch(`/api/endpoints/${ep.id}/models`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "获取模型失败");
      }

      const modelList = data.data ?? data;
      updatePanel(ep.id, { models: modelList, modelsLoading: false });
      toast.success(`获取到 ${modelList.length} 个模型`);
    } catch (error) {
      updatePanel(ep.id, { modelsLoading: false });
      toast.error(error instanceof Error ? error.message : "获取模型失败");
    }
  }

  async function testEndpoint(ep: Endpoint) {
    const panel = getPanel(ep.id);
    if (!panel.selectedModel) {
      toast.error("请先选择模型");
      return;
    }

    updatePanel(ep.id, { testing: true, testResult: null });

    try {
      const res = await fetch(`/api/endpoints/${ep.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: panel.selectedModel }),
      });

      const data: TestResult = await res.json();
      updatePanel(ep.id, { testing: false, testResult: data });

      if (data.success) {
        toast.success(`测试成功 (${data.duration}ms)`);
      } else {
        toast.error(`测试失败: ${data.error}`);
      }
    } catch (error) {
      updatePanel(ep.id, {
        testing: false,
        testResult: {
          success: false,
          status: 0,
          duration: 0,
          error: error instanceof Error ? error.message : "测试失败",
        },
      });
      toast.error("测试请求失败");
    }
  }

  async function handleSubmit() {
    try {
      const url = editingId ? `/api/endpoints/${editingId}` : "/api/endpoints";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "操作失败");
      }

      toast.success(editingId ? "端点已更新" : "端点已添加");
      setDialogOpen(false);
      setEditingId(null);
      setForm({ name: "", url: "", api_key: "", priority: 0, weight: 1 });
      fetchEndpoints();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "未知错误");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除这个端点吗？")) return;

    try {
      const res = await fetch(`/api/endpoints/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");

      toast.success("端点已删除");
      fetchEndpoints();
    } catch {
      toast.error("删除失败");
    }
  }

  function openEdit(ep: Endpoint) {
    setEditingId(ep.id);
    setForm({
      name: ep.name,
      url: ep.url,
      api_key: "",
      priority: ep.priority,
      weight: ep.weight,
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", url: "", api_key: "", priority: 0, weight: 1 });
    setDialogOpen(true);
  }

  function openAuthorization(ep: Endpoint) {
    setAuthorizationEndpoint(ep);
    setAuthorizationForm({ sensenova_account_id: "", console_access_token: "", console_refresh_token: "" });
  }

  async function saveAuthorization() {
    if (!authorizationEndpoint) return;
    try {
      const res = await fetch(`/api/endpoints/${authorizationEndpoint.id}/authorization`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authorizationForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新授权失败");
      toast.success("配额授权已更新");
      setAuthorizationEndpoint(null);
      fetchEndpoints();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新授权失败");
    }
  }

  async function removeAuthorization() {
    if (!authorizationEndpoint || !confirm(`确定移除“${authorizationEndpoint.name}”的配额授权吗？`)) return;
    try {
      const res = await fetch(`/api/endpoints/${authorizationEndpoint.id}/authorization`, { method: "DELETE" });
      if (!res.ok) throw new Error("移除授权失败");
      toast.success("配额授权已移除");
      setAuthorizationEndpoint(null);
      fetchEndpoints();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移除授权失败");
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">端点管理</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button onClick={openCreate} />}>
            添加端点
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? "编辑端点" : "添加端点"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：主端点"
                />
              </div>
              <div className="space-y-2">
                <Label>API URL</Label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="例如：https://token.sensenova.cn/v1"
                />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={editingId ? "留空则不更新" : "sk-xxx"}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>优先级（越小越高）</Label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>权重</Label>
                  <Input
                    type="number"
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>
              <Button onClick={handleSubmit} className="w-full">
                {editingId ? "更新" : "添加"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(authorizationEndpoint)} onOpenChange={(open) => !open && setAuthorizationEndpoint(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{authorizationEndpoint?.name} · 配额授权</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">保存后会完整替换该端点现有的 SenseNova 配额授权。Token 仅在服务端加密保存。</p>
              <div className="space-y-2">
                <Label>账号 ID</Label>
                <Input value={authorizationForm.sensenova_account_id} onChange={(e) => setAuthorizationForm({ ...authorizationForm, sensenova_account_id: e.target.value })} placeholder="控制台 URL 中的 account_id" />
              </div>
              <div className="space-y-2">
                <Label>Console Access Token</Label>
                <Input type="password" value={authorizationForm.console_access_token} onChange={(e) => setAuthorizationForm({ ...authorizationForm, console_access_token: e.target.value })} placeholder="OAuth access_token" />
              </div>
              <div className="space-y-2">
                <Label>Console Refresh Token</Label>
                <Input type="password" value={authorizationForm.console_refresh_token} onChange={(e) => setAuthorizationForm({ ...authorizationForm, console_refresh_token: e.target.value })} placeholder="OAuth refresh_token" />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveAuthorization} className="flex-1">更新授权</Button>
                {authorizationEndpoint?.quota_authorization === "valid" && <Button variant="destructive" onClick={removeAuthorization}>移除授权</Button>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {endpoints.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            暂无端点，点击上方按钮添加
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {endpoints.map((ep) => {
            const panel = getPanel(ep.id);
            return (
              <Card key={ep.id} className="h-fit overflow-hidden">
                <CardContent className="p-4">
                  {/* Endpoint Info Row */}
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <Badge variant={ep.healthy ? "default" : "destructive"}>
                        {ep.healthy ? "健康" : "不健康"}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{ep.name}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground" title={ep.url}>{ep.url}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground" title={ep.api_key}>Key: {ep.api_key}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-y py-2 text-xs text-muted-foreground">
                      <span>P:{ep.priority} · W:{ep.weight}</span>
                      <span>配额: {ep.quota_authorization === "valid" ? "已配置" : "未配置"}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(ep)}>编辑</Button>
                      <Button variant="outline" size="sm" onClick={() => openAuthorization(ep)}>配额授权</Button>
                      <Button variant="outline" size="sm" onClick={() => updatePanel(ep.id, { expanded: !panel.expanded })}>
                        {panel.expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
                        {panel.expanded ? "收起" : "模型测试"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(ep.id)}>删除</Button>
                    </div>
                  </div>

                  {/* Expanded Panel: Models & Test */}
                  {panel.expanded && (
                    <div className="mt-4 border-t pt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchModelsForEndpoint(ep)}
                          disabled={panel.modelsLoading}
                        >
                          {panel.modelsLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : null}
                          获取模型列表
                        </Button>

                        {panel.models.length > 0 && (
                          <>
                            <Select
                              value={panel.selectedModel}
                              onValueChange={(v) => updatePanel(ep.id, { selectedModel: v ?? "" })}
                            >
                              <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="选择模型" />
                              </SelectTrigger>
                              <SelectContent>
                                {panel.models.map((model) => (
                                  <SelectItem key={model.id} value={model.id}>
                                    {model.name || model.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Button
                              size="sm"
                              onClick={() => testEndpoint(ep)}
                              disabled={panel.testing || !panel.selectedModel}
                            >
                              {panel.testing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : null}
                              测试
                            </Button>
                          </>
                        )}
                      </div>

                      {/* Test Result */}
                      {panel.testResult && (
                        <div className={`p-3 rounded-lg text-sm ${panel.testResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            {panel.testResult.success ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                            <span className={panel.testResult.success ? "text-green-700" : "text-red-700"}>
                              {panel.testResult.success ? "测试成功" : "测试失败"}
                            </span>
                          </div>
                          <div className="text-xs space-y-1">
                            <div>状态码: {panel.testResult.status} | 耗时: {panel.testResult.duration}ms</div>
                            {panel.testResult.model && <div>模型: {panel.testResult.model}</div>}
                            {panel.testResult.content && <div>响应: {panel.testResult.content}</div>}
                            {panel.testResult.error && <div className="text-red-600">错误: {panel.testResult.error}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
