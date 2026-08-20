# 发现与决策

## 需求
- 自动故障转移代理，用户无感知
- 动态配置多个端点
- 心跳预检 + 请求时兜底
- Web 管理界面

## 研究发现
- SenseNova API 兼容 OpenAI 格式
- Base URL: https://token.sensenova.cn/v1
- 认证: Authorization: Bearer <key>
- 端点: /v1/chat/completions, /v1/models 等

## 技术决策
| 决策 | 理由 |
|------|------|
| Next.js API Routes | 原生支持，无需额外框架 |
| better-sqlite3 | 同步 API，简单高效 |
| SSE | 比 WebSocket 更简单的实时推送 |
| shadcn/ui | 现代设计，Tailwind 集成 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
|      |         |
