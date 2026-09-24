"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProxyKey { id: string; name: string; key_hash?: string; masked_key_display?: string; secret_available?: boolean; allowed_models: string[]; endpoint_group: string; max_concurrent: number; enabled: boolean; created_at: number; }
interface ModelResponse { data: string[]; endpoint_count: number; failures: string[]; }

export default function KeysPage() {
  const [keys, setKeys] = useState<ProxyKey[]>([]);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", endpoint_group: "default", max_concurrent: 1 });
  const [models, setModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [unrestricted, setUnrestricted] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const load = () => fetch("/api/proxy-keys").then(res => res.json()).then(setKeys).catch(() => toast.error("获取代理 Key 失败"));
  useEffect(() => { load(); }, []);

  async function loadModels(group = form.endpoint_group) {
    setModelsLoading(true); setModelError(null);
    try {
      const res = await fetch(`/api/proxy-keys/models?endpoint_group=${encodeURIComponent(group.trim() || "default")}`);
      const data = await res.json() as ModelResponse;
      if (!res.ok) throw new Error(data as unknown as string);
      setModels(data.data);
      if (!data.data.length) setModelError(data.endpoint_count ? "该端点组没有返回任何模型" : "该端点组没有已启用端点");
      if (data.failures.length) toast.warning(`部分端点模型读取失败：${data.failures.join("；")}`);
    } catch (error) { setModels([]); setModelError(error instanceof Error ? error.message : "加载模型失败"); }
    finally { setModelsLoading(false); }
  }

  function resetForm() { setForm({ name: "", endpoint_group: "default", max_concurrent: 1 }); setModels([]); setSelectedModels([]); setUnrestricted(false); setModelQuery(""); setModelError(null); }
  function toggleModel(model: string) { setSelectedModels(current => current.includes(model) ? current.filter(value => value !== model) : [...current, model]); }
  async function create() {
    try {
      if (!form.name.trim()) throw new Error("请输入 Key 名称");
      if (!unrestricted && selectedModels.length === 0) throw new Error("请至少选择一个模型，或选择“不限制模型”");
      const res = await fetch("/api/proxy-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, allowed_models: unrestricted ? [] : selectedModels, endpoint_group: form.endpoint_group, max_concurrent: form.max_concurrent }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setCreated(data.secret); setOpen(false); resetForm(); load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "创建失败"); }
  }
  async function remove(id: string) { if (!confirm("删除后该 Key 将立即失效，确定继续？")) return; const res = await fetch(`/api/proxy-keys/${id}`, { method: "DELETE" }); if (res.ok) { toast.success("代理 Key 已删除"); load(); } else toast.error("删除失败"); }
  async function copySecret(key: ProxyKey) { try { const res = await fetch(`/api/proxy-keys/${key.id}/secret`); const data = await res.json(); if (!res.ok) throw new Error(data.error); await navigator.clipboard.writeText(data.secret); toast.success("已复制"); } catch (error) { toast.error(error instanceof Error ? error.message : "复制失败"); } }
  const visibleModels = models.filter(model => model.toLowerCase().includes(modelQuery.toLowerCase()));

  return <div className="space-y-4">
    <div className="flex items-end justify-between border-b pb-3"><div><h1 className="text-xl font-semibold">代理 Key 与隔离策略</h1><p className="mt-1 text-xs text-muted-foreground">单实例模式：每个 Key × 模型独立并发槽位；满额时立即返回 429。</p></div>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { resetForm(); loadModels("default"); } }}><DialogTrigger render={<Button><Plus />创建代理 Key</Button>} />
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>创建代理 Key</DialogTitle></DialogHeader><div className="space-y-4 pt-2">
          <div><Label>名称</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：代码业务" /></div>
          <div><Label>端点组</Label><div className="mt-1 flex gap-2"><Input value={form.endpoint_group} onChange={e => setForm({ ...form, endpoint_group: e.target.value })} placeholder="default" /><Button type="button" variant="outline" size="icon" onClick={() => loadModels()} disabled={modelsLoading}>{modelsLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></div><p className="mt-1 text-[11px] text-muted-foreground">切换端点组后点击刷新，加载该组已启用端点实际提供的模型。</p></div>
          <div className="space-y-2"><div className="flex items-center justify-between"><Label>允许模型</Label><button type="button" className="text-xs text-primary hover:underline" onClick={() => { setUnrestricted(!unrestricted); if (!unrestricted) setSelectedModels([]); }}>{unrestricted ? "已选：不限制模型（点击改为选择模型）" : "选择模型（点击改为不限制）"}</button></div>
            {unrestricted ? <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">允许此端点组的全部模型；后续上游新增模型也可直接调用。</div> : <div className="rounded-md border"><div className="flex items-center gap-2 border-b px-2"><Search className="size-4 text-muted-foreground" /><Input className="border-0 shadow-none focus-visible:ring-0" value={modelQuery} onChange={e => setModelQuery(e.target.value)} placeholder="搜索模型" /></div><div className="max-h-48 overflow-y-auto p-1">{modelsLoading ? <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div> : modelError ? <div className="p-3 text-sm text-destructive">{modelError}</div> : visibleModels.map(model => <button type="button" key={model} onClick={() => toggleModel(model)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"><span className={`grid size-4 place-items-center rounded border ${selectedModels.includes(model) ? "border-primary bg-primary text-primary-foreground" : ""}`}>{selectedModels.includes(model) && <Check className="size-3" />}</span>{model}</button>)}{!modelsLoading && !modelError && visibleModels.length === 0 && <p className="p-3 text-sm text-muted-foreground">没有匹配的模型</p>}</div></div>}
          </div>
          <div><Label>每模型最大并发</Label><Input className="mt-1" type="number" min="1" value={form.max_concurrent} onChange={e => setForm({ ...form, max_concurrent: Math.max(1, Number(e.target.value) || 1) })} /></div><Button className="w-full" onClick={create}>生成 Key</Button>
        </div></DialogContent>
      </Dialog>
    </div>
    {created && <Card className="border-amber-300 bg-amber-50"><CardContent className="flex flex-wrap items-center gap-3 p-3"><KeyRound className="text-amber-700" /><div className="min-w-0 flex-1"><b className="text-sm text-amber-900">请立即复制并保存，此 Key 仅显示一次</b><code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{created}</code></div><Button size="sm" onClick={() => { navigator.clipboard.writeText(created); toast.success("已复制"); }}><Copy />复制</Button><Button variant="ghost" size="sm" onClick={() => setCreated(null)}>关闭</Button></CardContent></Card>}
    <div className="grid gap-3 lg:grid-cols-2">{keys.map(key => <Card key={key.id} className="py-0"><CardContent className="p-3"><div className="flex justify-between gap-3"><div><div className="flex items-center gap-2"><b>{key.name}</b><Badge variant="outline">{key.endpoint_group}</Badge></div><div className="mt-2 flex items-center gap-2"><code className="text-xs">{key.masked_key_display || key.key_hash}</code><Button size="sm" onClick={() => copySecret(key)}><Copy />复制</Button></div><p className="mt-1 text-xs text-muted-foreground">每模型最大并发：{key.max_concurrent}</p></div><Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => remove(key.id)}><Trash2 /></Button></div><div className="mt-3 flex flex-wrap gap-1">{key.allowed_models.length ? key.allowed_models.map(model => <Badge key={model} variant="secondary" className="text-[10px]">{model}</Badge>) : <span className="text-xs text-muted-foreground">允许全部模型</span>}</div></CardContent></Card>)}{keys.length === 0 && <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground lg:col-span-2">尚未创建虚拟代理 Key。旧的 <code>PROXY_API_KEYS</code> 仍可继续使用。</div>}</div>
  </div>;
}
