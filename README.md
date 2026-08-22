# 远程项目记录 Web 应用

一个用于记录客户、项目以及远程维护信息（远程软件 / 数字码 / 验证码 / RCS 网页服务地址）的局域网 Web 工具。
适用于项目变多、远程码容易忘记的场景，支持在电脑上管理、手机通过同一 WiFi 查看远程信息。

## 功能清单

- **客户管理**：记录客户名称、省份 / 城市 / 区县 / 详细地址（接入高德地图，可搜索选点自动回填；未配置 Key 时手动填写）。
- **项目管理**：一个客户可挂多个项目，记录项目名称、项目编号、是否支持远程。
- **远程信息**：支持远程的项目可填写
  - 远程软件（下拉选择：网易UU远程 / ToDesk / 向日葵 / 其他）
  - 远程数字码
  - 远程验证密码
  - RCS 网页服务地址
- **远程卡片墙（首页）**：进网页首页即为远程显示页，以方块卡片突出展示客户名称、项目名称、项目编号、远程 ID、验证码，支持一键复制。
- **维护历史**：修改远程信息（软件 / 数字码 / 验证码 / RCS 地址）自动留痕，可查看变更前后对比。验证密码只标注「已更新」，不存明文。
- **可用性反馈**：👍 标记可用 / 👎 标记不可用，同步更新远程状态（可用 / 不可用 / 未验证）。
- **仪表盘统计**：客户数、项目数、支持远程数、当前可用远程码数、最近动态。
- **Excel 导出**：可将客户数据导出为 Excel 备份。
- **响应式布局**：手机浏览器同样可用。

## 技术栈

- 后端：Node.js（零依赖，仅用 Node 内置模块 `node:http` + `node:sqlite`，无需 `npm install`）
- 前端：原生 HTML / CSS / JS（由 Node 直接托管 `static/`）
- 数据库：SQLite（Node 内置 `node:sqlite`，单文件）
- 地图：高德地图 JS API（浏览器端，地址搜索选点）
- 局域网访问：Node 监听 `0.0.0.0`，手机同网段打开电脑 IP 即可

## 运行方式

### 方式一：双击启动（推荐，零配置）

直接双击项目目录下的 `start.bat`：

1. 脚本会自动检测系统是否已安装 Node.js（>= 22.5，需支持内置 `node:sqlite`）；
2. 若未安装，将**自动从官网下载官方 Node 运行环境（ZIP 免安装）并解压部署到本地 `node-runtime/`**，无需管理员权限、不依赖微软商店；
3. 无需执行 `npm install`（本程序零第三方依赖）；
4. 自动以 `node server.js` 启动服务。

启动成功后命令行会显示监听地址（默认 `http://0.0.0.0:5000`）。

### 方式二：命令行启动

确保本机已安装 Node.js（>= 22.5，需支持内置 `node:sqlite`），然后在项目目录执行：

```bash
node server.js
```

> 端口默认 `5000`，可在 `config.json` 的 `port` 字段修改；`host` 默认 `0.0.0.0`（允许局域网访问）。

### 数据存储说明（重要）

- 活动数据库位于**用户目录**：`C:\Users\你的用户名\remote-project-manager-data\data.db`
  （放在用户目录是为了避免被项目目录内的文件监视器加只读锁，导致写入失败）。
- 项目内的 `db/data.db` 仅作为**首次运行的种子库**：当活动库为空时，会自动把里面的已有数据导入活动库。日常新增 / 修改都写在用户目录的活动库里。
- 首次运行会自动创建活动库及数据表。

### 访问地址

- **本机访问**：浏览器打开 `http://127.0.0.1:5000`
- **手机 / 局域网访问**：手机连接同一 WiFi，打开 `http://电脑IP:5000`
  （电脑 IP 可在命令行用 `ipconfig` 查看，取无线局域网适配器的 IPv4 地址）

## 高德地图配置（可选）

如需在新增 / 编辑客户时使用地图搜索选点，请配置高德 Key。出于安全考虑，`config.json`（含真实 Key）**不会进入 Git 仓库**，仓库中仅提供 `config.example.json` 模板。

配置方式（任选其一）：

**方式 A：环境变量（推荐，适合部署）**

```bash
# Windows（cmd）
set AMAP_KEY=你的Key
set AMAP_SECURITY_JS_CODE=你的安全密钥

# 或在系统环境变量 / 启动脚本中设置
```

**方式 B：本地 config.json**

```bash
cp config.example.json config.json
# 然后编辑 config.json，填入你申请到的 Key 和安全密钥
```

```json
{
  "amap_key": "你的Key",
  "amap_security_js_code": "你的安全密钥"
}
```

保存后**重启服务**生效。

> 不填也不影响其它功能，客户地址部分会自动降级为手动填写省市区。
> 高德 JS API 需要同时配置 **Key** 和 **安全密钥** 两项，且两者需来自同一应用。

## 目录结构

```
remote-project-manager/
├── server.js              # Node.js 后端（零依赖）：HTTP 服务 + SQLite + REST API
├── config.example.json    # 配置模板（含占位符，进仓库）
├── config.json            # 本地配置（含真实 Key，不进仓库，由你自行创建）
├── package.json           # 项目配置（含 start 脚本）
├── start.bat              # Windows 一键启动脚本（自动检测/下载部署 Node 并运行）
├── launcher.ps1           # 启动逻辑（查找/下载 Node、预检端口、启动服务）
├── db/
│   └── data.db            # 种子库（已清空的表结构模板，首次运行导入活动库）
├── static/
│   ├── index.html          # 前端单页应用
│   ├── css/
│   │   └── style.css       # 样式
│   └── js/
│       └── app.js          # 前端逻辑（路由、表单、卡片墙、历史、反馈等）
```

> 注：本地可能还存在 `data.db.bak-prenode`（迁移前原始数据备份）、`*.log`（运行日志）、
> `node-runtime/`（自动下载的 Node 运行环境）、`remote-project-manager-data/`（活动数据库），
> 这些均已被 `.gitignore` 排除，不会进入仓库。

## 从 GitHub 部署 / 克隆运行

本项目已部署到 GitHub（私有仓库）：**https://github.com/766776751/remote-project-manager**

真实密钥（`config.json`）和真实业务数据均不进入仓库，可放心克隆运行。

### 克隆并运行

```bash
git clone git@github.com:766776751/remote-project-manager.git
cd remote-project-manager

# 配置高德 Key（任选：环境变量 / 复制 config.example.json 为 config.json 填写）
cp config.example.json config.json
# 编辑 config.json 填入你的高德 Key 与安全密钥

# Windows：双击启动（会自动检测/下载部署 Node）
start.bat
# 或命令行：node server.js
```

> 仓库内的 `db/data.db` 是**已清空的表结构模板**（不含任何真实数据），首次运行会自动用它初始化用户目录下的活动数据库。

### 当前部署状态

- 仓库地址：`git@github.com:766776751/remote-project-manager.git`（SSH）
- 默认分支：`main`（已设上游跟踪 `origin/main`）
- 最新提交：`e308cb1` 远程项目记录：纯 Node.js 零依赖后端 + 前端，一键自动部署 Node 环境
- 已配置 SSH 部署密钥：`C:\Users\LQ\.ssh\id_ed25519`（公钥已添加到 GitHub，推送免密）

### 后续更新代码

本机修改代码后，按常规流程提交并推送即可：

```bash
git add -A
git commit -m "改动说明"
git push
```

> 首次推送需 GitHub 账号授权（SSH key 已配好，直接 `git push` 即可，无需密码）。
> 若更换电脑，重新生成 SSH key 并把公钥添加到 GitHub 的 SSH keys 即可。

## 数据备份

业务数据存放在用户目录的活动库 `C:\Users\你的用户名\remote-project-manager-data\data.db`（SQLite 单文件）。

- **整库备份**：直接复制该 `.db` 文件到安全位置即可。
- **应用内备份**：网页内提供「备份导出 / 导入」功能，可导出为 JSON 并原样回灌，等效于整库备份。
- **恢复**：将备份的 `.db` 文件覆盖回原活动库路径，重启服务即可。

> 建议定期备份活动库，避免误删或磁盘损坏导致数据丢失。

## 常见问题

**Q：首页远程卡片点「编辑 / 维护」没反应？**
A：请刷新浏览器（建议 `Ctrl+F5` 强刷）清除旧 JS 缓存。

**Q：客户地址地图搜索框没有联想下拉？**
A：确认已正确配置高德 Key 和安全密钥（环境变量或 `config.json`），并重启服务。未配置时该区域为手动填写。

**Q：远程验证码在列表里看不到？**
A：出于保护考虑，列表页不显示验证码，需进入项目编辑 / 维护弹窗或首页远程卡片查看。

**Q：手机打不开网页？**
A：确认手机与电脑在同一 WiFi；使用电脑在局域网中的真实 IP（非 127.0.0.1）访问；并检查活动库路径所在目录未被占用锁死。

**Q：双击 start.bat 提示端口被占用？**
A：可能已有服务在运行（如之前手动启动过 `node server.js`）。先结束占用 5000 端口的 `node.exe` 进程，再双击启动。
