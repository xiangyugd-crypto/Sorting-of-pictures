# 阿里云安全部署建议

你的 `http://101.132.23.9:8000` 已经有两个平台，建议先不要改动 8000 端口。

## 推荐方案：独立端口部署

默认使用宿主机 `18080` 端口，容器内部仍然是 `8080`。这样不会影响现有 `8000` 上的两个平台。

```bash
cd /opt/poster-cloud
docker compose up -d --build
```

访问：

```text
http://101.132.23.9:18080
```

如果阿里云安全组没有开放 `18080`，需要在安全组里放行 TCP `18080`。

## 如果必须挂到 8000

只有在确认 `8000` 前面是 Nginx/Caddy 等反向代理，并且知道现有两个平台的路由规则后，再加一个子路径，例如：

```text
http://101.132.23.9:8000/poster/
```

这时容器建议只绑定本机：

```yaml
ports:
  - "127.0.0.1:18080:8080"
environment:
  APP_BASE_PATH: "/poster"
```

Nginx 可参考：

```nginx
location /poster/ {
    proxy_pass http://127.0.0.1:18080/poster/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

不要直接占用或替换 `8000` 端口，否则可能影响已有平台。
