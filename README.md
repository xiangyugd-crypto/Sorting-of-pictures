# 图片海报云端版

这是一个可上传云服务器部署的版本，包含登录、管理员账号、用户存储配额、图片上传压缩和 SQLite 数据库。

## 本地运行

```bash
APP_SECRET="换成一段随机长字符串" \
ADMIN_USERNAME="admin" \
ADMIN_PASSWORD="请改成强密码" \
PORT=8080 \
python3 server.py
```

打开：

```text
http://服务器IP:8080
```

首次启动会自动创建管理员账号。默认管理员是 `admin / ChangeMe123!`，正式部署必须通过环境变量改掉。

## 数据和容量

- 数据库文件：`data/app.db`
- 上传图片：`data/uploads/`
- SQLite 最大页数已设置为约 `10GB`
- 管理员可在网页里给每个账号分配存储空间，例如 `500mb`、`2gb`
- 本地图片会在浏览器端压缩后上传，目标是保证生成大图清晰，同时减少服务器空间占用

## Docker 部署

```bash
docker build -t poster-cloud .
docker run -d \
  --name poster-cloud \
  -p 8080:8080 \
  -e APP_SECRET="换成一段随机长字符串" \
  -e ADMIN_USERNAME="admin" \
  -e ADMIN_PASSWORD="请改成强密码" \
  -v poster-cloud-data:/app/data \
  poster-cloud
```

## 云服务器注意事项

- 建议用 Nginx 反向代理并启用 HTTPS。
- 如果上传很多图片，确保服务器磁盘空间大于所有用户配额总和。
- 不建议在公网使用默认管理员密码。
