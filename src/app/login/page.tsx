"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || `登录失败（${response.status}）`);
        return;
      }
      window.location.replace(new URL("/", window.location.origin).toString());
    } catch {
      setError("无法连接服务，请确认服务已启动后重试");
    } finally {
      setLoading(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><Card className="w-full max-w-sm"><CardHeader><CardTitle>SenseNova Proxy 登录</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label>用户名</Label><Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></div><div className="space-y-2"><Label>密码</Label><div className="relative"><Input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="pr-10" /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>{error && <p className="text-sm text-destructive">{error}</p>}<Button type="submit" className="w-full" disabled={loading}>{loading ? "登录中..." : "登录"}</Button></form></CardContent></Card></main>;
}
