'use strict';

/**
 * publish.js —— 把本地录入的数据「烘焙」成前端静态文件。
 *
 * 工作流程：
 *   1) 读取本机 SQLite 活动库（~/remote-project-manager-data/data.db）
 *   2) 导出 customers / projects / remote_history
 *   3) 写入 static/data.js（window.__APP_DATA__ = {...}）
 *   4) 用户 git commit && git push 后，Vercel 重新部署即可得到只读展示站
 *
 * 部署到 Vercel 的站点因此只读取这份快照，不依赖后端数据库，
 * 彻底规避 Serverless 文件系统临时、数据不持久的问题。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const LIVE_DB = path.join(os.homedir(), 'remote-project-manager-data', 'data.db');
const OUT_FILE = path.join(__dirname, '..', 'static', 'data.js');

function fail(msg) {
  console.error('[publish] ' + msg);
  process.exit(1);
}

if (!fs.existsSync(LIVE_DB)) {
  fail('找不到本地数据库：' + LIVE_DB + '\n          请先在本机双击 start.bat 录入数据，再执行 publish。');
}

let db;
try {
  db = new DatabaseSync(LIVE_DB, { readOnly: true });
} catch (e) {
  fail('打开本地数据库失败：' + e.message);
}

try {
  const customers = db.prepare('SELECT * FROM customers ORDER BY id').all();
  const projects = db.prepare(`
    SELECT p.*, c.name AS customer_name
    FROM projects p
    JOIN customers c ON p.customer_id = c.id
    ORDER BY p.id
  `).all();

  const histories = {};
  const rows = db.prepare('SELECT * FROM remote_history ORDER BY created_at DESC').all();
  for (const r of rows) {
    (histories[r.project_id] = histories[r.project_id] || []).push({
      id: r.id,
      action: r.action,
      old_value: r.old_value,
      new_value: r.new_value,
      note: r.note,
      operator: r.operator,
      created_at: r.created_at
    });
  }

  const data = {
    customers,
    projects,
    histories,
    readonly: true,
    generated_at: new Date().toISOString()
  };

  const content = 'window.__APP_DATA__ = ' + JSON.stringify(data, null, 2) + ';\n';
  fs.writeFileSync(OUT_FILE, content, 'utf-8');

  console.log('[publish] 已生成：' + OUT_FILE);
  console.log('[publish] 客户 ' + customers.length + ' 个，项目 ' + projects.length + ' 个，历史 ' + rows.length + ' 条');
  console.log('[publish] 下一步：git add -A && git commit -m "更新展示数据" && git push');
  console.log('[publish] 之后在 Vercel Dashboard 重新部署即可看到最新内容。');
} catch (e) {
  fail('导出失败：' + e.message);
} finally {
  try { db.close(); } catch (_) {}
}
