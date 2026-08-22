#!/usr/bin/env bash
# ============================================================
# 远程项目记录 - 飞牛 fnOS 一键部署脚本（可编辑版 / 带数据库）
# 作用：拉取完整项目（后端 lib/ + 数据库 db/ + 前端 static/），
#       用 Node 容器跑 lib/server.js，线上可直接增删改，数据存飞牛硬盘。
# 用法：
#   全新安装 : bash install-live.sh
#   更新代码 : bash install-live.sh --update   (重写后端/前端代码，不丢数据库)
# 依赖：飞牛 fnOS 自带 Docker；需能访问 GitHub(raw) 拉取项目文件。
# ============================================================
set -euo pipefail

SELF_URL="https://raw.githubusercontent.com/766776751/remote-project-manager/main/deploy-fnos/install-live.sh"
GH_BASE="https://raw.githubusercontent.com/766776751/remote-project-manager/main"
APP_DIR="/vol1/@appshare/remote-project-manager"
PORT="8088"

# ---- 自动提权：当前用户无 Docker 权限时，尝试 sudo 重新执行 ----
if ! docker info >/dev/null 2>&1; then
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    echo "⚠️  当前用户无 Docker 权限，尝试通过 sudo 重新执行安装脚本..."
    exec sudo bash -c "$(curl -fsSL "$SELF_URL")" "$@"
  fi
fi

# 兼容 v1/v2 compose
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose";
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE="docker-compose";
else echo "    ❌ 缺少 docker compose 插件"; exit 1; fi

echo "==> [1/6] 创建工作目录 $APP_DIR"
mkdir -p "$APP_DIR/lib" "$APP_DIR/db" "$APP_DIR/static/css" "$APP_DIR/static/js"
cd "$APP_DIR"

echo "==> [2/6] 拉取完整项目文件 (来自 GitHub)"
# 后端 + 配置
for f in "lib/server.js" "package.json" "config.example.json"; do
  echo "    下载 $f"
  wget -q -O "$APP_DIR/$f" "$GH_BASE/$f" || { echo "    ❌ 下载 $f 失败，检查网络"; exit 1; }
done
# 前端（注意：可编辑版不下载 data.js，避免前端进入只读模式）
for f in "static/index.html" "static/css/style.css" "static/js/app.js"; do
  echo "    下载 $f"
  wget -q -O "$APP_DIR/$f" "$GH_BASE/$f" || { echo "    ❌ 下载 $f 失败，检查网络"; exit 1; }
done
# 确保 static/data.js 不存在（否则前端会判断为只读）
rm -f "$APP_DIR/static/data.js"

# 数据库：仅首次安装时拉取（更新代码不会覆盖已有数据）
if [ ! -f "$APP_DIR/db/data.db" ]; then
  echo "==> [2b] 首次安装：拉取本地数据库（含已录入数据）"
  wget -q -O "$APP_DIR/db/data.db" "$GH_BASE/db/data.db" || echo "    ⚠️  无种子数据库，将自动新建空库"
else
  echo "==> [2b] 检测到已有数据库，保留不动（--update 不会覆盖数据）"
fi

echo "==> [3/6] 修正权限"
chmod -R a+rX "$APP_DIR"
chmod 644 "$APP_DIR/lib/server.js" "$APP_DIR/package.json" 2>/dev/null || true

echo "==> [4/6] 写入 docker-compose（Node 容器，带数据库持久卷）"
cat > "$APP_DIR/docker-compose.yml" <<EOF
services:
  web:
    image: node:22-alpine
    container_name: remote-project-manager
    working_dir: /app
    command: node lib/server.js
    environment:
      - PORT=5000
      - HOST=0.0.0.0
      - DB_PATH=/app/db/data.db
    ports:
      - "${PORT}:5000"
    volumes:
      - ./lib:/app/lib:ro
      - ./static:/app/static:ro
      - ./package.json:/app/package.json:ro
      - ./db:/app/db
    restart: unless-stopped
EOF

echo "==> [5/6] 启动容器"
$COMPOSE -f "$APP_DIR/docker-compose.yml" down >/dev/null 2>&1 || true
$COMPOSE -f "$APP_DIR/docker-compose.yml" up -d

echo "==> [6/6] 本地自检"
sleep 6
if curl -fsS "http://127.0.0.1:${PORT}/" | grep -q "远程项目记录"; then
  echo "    ✅ 本地访问正常 (http://127.0.0.1:${PORT}/)"
else
  echo "    ⚠️  本地自检未通过，请查看容器日志: $COMPOSE -f $APP_DIR/docker-compose.yml logs"
fi

echo ""
echo "==================================================="
echo " 可编辑版部署完成！"
echo " 容器名: remote-project-manager  本地端口: $PORT"
echo " 数据库: $APP_DIR/db/data.db (飞牛硬盘持久化)"
echo ""
echo " 外网访问（FN Connect）："
echo "   1. 浏览器登录飞牛 https://fnos.net/lq77666"
echo "   2. 进入『Docker』→ 容器 → 找到 remote-project-manager"
echo "   3. 点容器右侧的 🔗 链接图标 → 点端口 $PORT → 新窗口打开"
echo "   4. 地址形如 https://<随机串>.lq77666.5ddd.com （需先登录飞牛）"
echo "   5. 输入站点密码 SC123456 即可在线编辑"
echo "==================================================="
