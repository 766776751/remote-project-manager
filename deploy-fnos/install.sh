#!/usr/bin/env bash
# ============================================================
# 远程项目记录 - 飞牛 fnOS 一键部署脚本
# 作用：装 Docker + Nginx 容器，拉取最新静态站点，启动。
# 用法：
#   全新安装 : bash install.sh
#   更新数据 : bash install.sh --update   (重新拉取 static 并重启容器)
# 依赖：飞牛 fnOS 自带 Docker；需能访问 GitHub(raw) 拉取站点文件。
# ============================================================
set -euo pipefail

RAW_BASE="https://raw.githubusercontent.com/766776751/remote-project-manager/main/static"
APP_DIR="/vol1/@appshare/remote-project-manager"
HTML_DIR="$APP_DIR/html"
PORT="8088"

echo "==> [1/6] 检查 Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "    未检测到 docker，尝试通过 apt 安装..."
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y docker.io >/dev/null 2>&1 || {
    echo "    ❌ 自动安装失败，请在飞牛『应用中心』安装 Docker 后重试。"; exit 1; }
fi
# 兼容 v1/v2 compose
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose";
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose";
else echo "    ❌ 缺少 docker compose 插件"; exit 1; fi
echo "    docker: $(docker --version) | compose: $COMPOSE"

echo "==> [2/6] 创建工作目录 $APP_DIR"
mkdir -p "$HTML_DIR/css" "$HTML_DIR/js"
cd "$APP_DIR"

echo "==> [3/6] 拉取最新站点文件 (来自 GitHub)"
FILES=("index.html" "data.js" "css/style.css" "js/app.js")
for f in "${FILES[@]}"; do
  echo "    下载 $f"
  wget -q -O "$HTML_DIR/$f" "$RAW_BASE/$f" || { echo "    ❌ 下载 $f 失败，检查网络"; exit 1; }
done

echo "==> [4/6] 写入 Nginx 配置"
cat > "$APP_DIR/nginx.conf" <<'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
    # 数据文件不缓存，改完数据即时生效
    location = /data.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    # 其它静态资源缓存 5 分钟
    location ~* \.(css|js)$ {
        add_header Cache-Control "public, max-age=300";
    }
}
EOF

echo "==> [5/6] 写入 docker-compose 并启动容器"
cat > "$APP_DIR/docker-compose.yml" <<EOF
services:
  web:
    image: nginx:alpine
    container_name: remote-project-manager
    ports:
      - "${PORT}:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped
EOF

# 若已存在则先移除，保证幂等
$COMPOSE -f "$APP_DIR/docker-compose.yml" down >/dev/null 2>&1 || true
$COMPOSE -f "$APP_DIR/docker-compose.yml" up -d

echo "==> [6/6] 本地自检"
sleep 3
if curl -fsS "http://127.0.0.1:${PORT}/" | grep -q "远程项目记录"; then
  echo "    ✅ 本地访问正常 (http://127.0.0.1:${PORT}/)"
else
  echo "    ⚠️  本地自检未通过，请查看容器日志: $COMPOSE -f $APP_DIR/docker-compose.yml logs"
fi

echo ""
echo "==================================================="
echo " 部署完成！"
echo " 容器名: remote-project-manager  本地端口: $PORT"
echo ""
echo " 外网访问（FN Connect）："
echo "   1. 浏览器登录飞牛 https://fnos.net/lq77666"
echo "   2. 进入『Docker』→ 容器 → 找到 remote-project-manager"
echo "   3. 点容器右侧的 🔗 链接图标 → 点端口 $PORT → 新窗口打开"
echo "   4. 地址形如 https://<随机串>.lq77666.5ddd.com （需先登录飞牛）"
echo "   5. 输入站点密码 SC123456 即可查看"
echo "==================================================="
