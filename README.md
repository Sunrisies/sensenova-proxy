# SenseNova Proxy

商汤 SenseNova 大模型的自动故障转移代理，支持多端点路由、配额管理和 Web 管理后台。

## 功能

- **API 代理**：转发 `/v1/` 路径的请求，兼容 OpenAI 接口格式
- **多端点故障转移**：按优先级和权重路由，429 自动冷却 60 秒，500 自动摘除
- **健康检查**：每 30 秒探测端点 `/models` 可用性
- **配额管理**：OAuth 2.0 自动刷新 Token，实时查询各模型剩余额度
- **用量统计**：按端点/模型统计请求量和 Token 消耗
- **实时日志**：SSE 推送请求日志
- **Web 管理后台**：仪表盘、端点管理、用量统计、实时日志
- **登录认证**：Admin 登录保护后台，Bearer Token 保护代理接口

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Next.js 16 (App Router), React 19 |
| 数据库 | SQLite (better-sqlite3) |
| UI | Tailwind CSS 4, shadcn/ui (base-ui), Lucide Icons, Sonner |
| 测试 | Vitest 4 |
| 部署 | Docker / Docker Compose (Next.js standalone output) |

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 用途 | 必填 |
|------|------|------|
| `TOKEN_ENCRYPTION_KEY` | OAuth 凭证加密密钥（SHA-256 派生），丢失后已存凭证不可读 | 是 |
| `ADMIN_USERNAME` | 后台登录用户名 | 是 |
| `ADMIN_PASSWORD` | 后台登录密码 | 是 |
| `ADMIN_SESSION_SECRET` | 管理会话 HMAC 签名密钥，建议独立于 `TOKEN_ENCRYPTION_KEY` | 建议 |
| `PROXY_API_KEYS` | 代理接口 Bearer Token，逗号分隔 | 建议 |
| `PORT` | 服务端口，默认 `3000` | 否 |

生成随机密钥：

```bash
openssl rand -hex 32
```

### 2. 本地开发

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`，使用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

### 3. Docker 部署

```bash
docker compose up -d
```

数据持久化在 `/app/data`（SQLite 数据库）。

## 使用

### 代理 API

配置端点后，代理转发 `/v1/` 下的请求。客户端需在 `Authorization` 头中传入 `PROXY_API_KEYS` 中的一个 Token。

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-proxy-api-key" \
  -d '{"model":"SenseChat-5","messages":[{"role":"user","content":"Hello"}]}'
```

### 管理后台页面

| 页面 | 路径 | 功能 |
|------|------|------|
| 仪表盘 | `/` | 端点健康状态、配额概览，每 60 秒自动刷新 |
| 端点管理 | `/endpoints` | 增删改查端点、配置 OAuth 授权 |
| 用量统计 | `/stats` | 按端点/模型查看请求量和 Token 消耗 |
| 实时日志 | `/logs` | SSE 推送请求日志，支持分页 |
| 登录 | `/login` | Admin 登录 |

### 管理 API

| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/api/auth/login` | 登录，成功后设置 HTTP-only Cookie（有效期 8 小时） |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/status` | 端点健康状态概览 |
| `GET/POST` | `/api/endpoints` | 端点列表 / 新增 |
| `GET/PATCH/DELETE` | `/api/endpoints/[id]` | 端点详情 / 更新 / 删除 |
| `PUT/DELETE` | `/api/endpoints/[id]/authorization` | 配置 / 清除 OAuth 授权 |
| `GET/POST` | `/api/endpoints/[id]/models` | 端点模型列表 / 测试 |
| `POST` | `/api/endpoints/[id]/test` | 测试端点连通性 |
| `GET` | `/api/usages` | 各端点配额使用情况 |
| `GET` | `/api/stats` | 请求统计 |
| `GET` | `/api/logs` | 请求日志（分页） |
| `GET` | `/api/logs/stream` | SSE 实时日志流 |

## 认证机制

- **管理后台**：HMAC-SHA-256 签名的 HTTP-only Cookie，有效期 8 小时。未登录请求 `/api/` 返回 401，其他页面重定向到 `/login`。
- **代理接口**：`Authorization: Bearer <key>`，key 从 `PROXY_API_KEYS` 环境变量读取。未配置 `PROXY_API_KEYS` 时代理接口拒绝所有请求。

## 测试

```bash
npm test
```

Vitest v4，覆盖以下三项修复的验证：

| Suite | 测试数 | 内容 |
|-------|--------|------|
| OAuth refresh concurrent lock | 2 | 并发刷新锁、缓存窗口内不重复刷新 |
| 429 rate limiting cooldown | 5 | 冷却设置、端点排除、冷却恢复、代理故障转移 |
| SSE last-frame usage capture | 3 | flush 阶段捕获最后一帧 Token usage |

## 项目结构

```
├── src/
│   ├── app/
│   │   ├── page.tsx                   # 仪表盘
│   │   ├── endpoints/page.tsx         # 端点管理
│   │   ├── stats/page.tsx             # 用量统计
│   │   ├── logs/page.tsx              # 实时日志
│   │   ├── login/page.tsx             # 登录页
│   │   ├── api/                       # 管理 API
│   │   └── v1/[...path]/route.ts      # 代理入口
│   ├── lib/
│   │   ├── auth.ts                    # HMAC 会话 + API Key 验证
│   │   ├── proxy.ts                   # 代理核心（路由/故障转移/SSE）
│   │   ├── db.ts                      # SQLite 数据层
│   │   ├── health.ts                  # 健康检查
│   │   ├── quota.ts                   # 配额管理 / OAuth 刷新
│   │   └── crypto.ts                  # AES-256-GCM 加解密
│   └── middleware.ts                  # 路由守卫
├── tests/
│   └── fixes.test.ts                  # 修复验证测试
├── vitest.config.mjs
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 许可证

Private
