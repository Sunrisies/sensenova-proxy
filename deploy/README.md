# 部署说明

本项目通过 SSH 将 Docker 镜像部署到 Linux 服务器。

- 应用运行在 Docker 容器中。
- Caddy 作为独立容器运行在服务器上。
- Caddy 将 `https://proxy.sunrise1024.top` 反向代理到应用的本机 `3001` 端口。

## 首次配置

### 1. 配置本地发布目标

在本地项目根目录执行：

```bash
cp deploy/server.local.env.example deploy/server.local.env
```

编辑 `deploy/server.local.env`，填写实际服务器信息：

```env
DEPLOY_HOST=47.111.168.59
DEPLOY_USER=root
DEPLOY_PATH=/home/www
```

该文件已被 Git 忽略，不会进入版本库，不要手工提交。

### 2. 配置服务器应用环境变量

服务器必须存在 `/home/www/.env`。普通发布不会上传或覆盖此文件，真实密钥只保存在服务器上。

参考配置：

```env
TOKEN_ENCRYPTION_KEY=稳定不变的加密密钥
MYSQL_HOST=MySQL地址
MYSQL_PORT=3306
MYSQL_DATABASE=sensenova_proxy
MYSQL_USER=MySQL用户名
MYSQL_PASSWORD=MySQL密码
MYSQL_SSL=false
ADMIN_USERNAME=后台用户名
ADMIN_PASSWORD_HASH=scrypt:...
ADMIN_SESSION_SECRET=稳定不变的会话密钥
PROXY_API_KEYS=客户端调用代理时使用的密钥
PORT=3001
PROXY_REQUEST_TIMEOUT_MS=120000
```

注意：`TOKEN_ENCRYPTION_KEY` 和 `ADMIN_SESSION_SECRET` 必须保持不变。

- 更换 `TOKEN_ENCRYPTION_KEY` 后，已保存的加密授权信息无法解密。
- 更换 `ADMIN_SESSION_SECRET` 后，现有后台登录会话会失效。

### 3. 配置 Caddy

Caddy 的配置文件位于服务器 `/home/www/Caddyfile`：

```caddyfile
{
  servers {
    protocols h1
  }
}

proxy.sunrise1024.top {
  reverse_proxy localhost:3001 {
    flush_interval -1
  }
}
```

应用容器仅绑定 `127.0.0.1:3001`，不会直接暴露到公网。公网 HTTPS 请求由 Caddy 接收并转发到本机应用。

## 日常发布

每次需要发布新版本时，在本地项目根目录执行：

```bash
deploy/push.sh
```

脚本会根据 `deploy/server.local.env` 自动完成以下步骤：

1. 检查免密 SSH、服务器 Docker 和服务器 `.env` 是否存在。
2. 在本机构建带时间戳的新 Docker 镜像。
3. 使用 `docker save` 导出镜像，并用 gzip 压缩。
4. 使用 `scp` 将压缩镜像上传到服务器目录。
5. 在服务器执行 `docker load` 导入新镜像。
6. 仅停止并删除旧的 `sensenova-proxy` 应用容器。
7. 使用新镜像启动新的 `sensenova-proxy` 容器。
8. 等待 `http://127.0.0.1:3001/api/status` 返回 HTTP `200` 或 `401`。
9. 删除服务器上临时上传的镜像压缩包。

HTTP `401` 是正常的健康结果，因为 `/api/status` 需要后台登录认证。

发布脚本不会停止、删除或修改独立运行的 Caddy 容器。

## 验证发布

在服务器执行，检查容器状态：

```bash
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'
```

预期看到类似内容：

```text
sensenova-proxy Up ... 127.0.0.1:3001->3001/tcp
caddy Up ...
```

直接检查应用：

```bash
curl -i http://127.0.0.1:3001/api/status
```

检查公网 HTTPS 反向代理：

```bash
curl -i https://proxy.sunrise1024.top/api/status
```

未携带后台登录 Cookie 时，两条命令通常返回 HTTP `401`：

```json
{"error":"Admin authentication required"}
```

使用客户端代理密钥测试 OpenAI 兼容流式接口：

```bash
curl --no-buffer \
  -H 'Authorization: Bearer 你的PROXY_API_KEYS密钥' \
  -H 'Content-Type: application/json' \
  https://proxy.sunrise1024.top/v1/chat/completions \
  -d '{"model":"sensenova-6.8-flash-lite","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

## 查看日志

查看应用实时日志：

```bash
docker logs -f sensenova-proxy
```

查看 Caddy 实时日志：

```bash
docker logs -f caddy
```

## 手工重启

仅重启应用：

```bash
docker restart sensenova-proxy
```

修改 `/home/www/Caddyfile` 后，仅重启 Caddy：

```bash
docker restart caddy
```

## 回滚版本

每次发布都会生成一个时间戳镜像标签，`deploy/push.sh` 结束时会输出对应标签。

列出服务器已有版本：

```bash
docker images 'sensenova-proxy' --format '{{.Repository}}:{{.Tag}}'
```

将下方 `IMAGE_TAG` 替换为要回滚到的历史标签：

```bash
docker rm -f sensenova-proxy
docker run -d \
  --name sensenova-proxy \
  --restart unless-stopped \
  --env-file /home/www/.env \
  -p 127.0.0.1:3001:3001 \
  sensenova-proxy:IMAGE_TAG
```

## 注意事项

- 服务器使用旧版 `docker-compose 1.29.2`，且当前发布流程不依赖它。
- 不要在服务器 `/home/www` 目录执行 `docker-compose up --remove-orphans`；该命令可能误删除独立运行的 Caddy 容器。
- 发布脚本使用 `docker run` 更新应用，专门避开 Compose v1 的兼容问题。
- 上游请求默认超时为 120 秒。需要调整时，修改服务器 `/home/www/.env` 的 `PROXY_REQUEST_TIMEOUT_MS`，再执行 `docker restart sensenova-proxy`。
