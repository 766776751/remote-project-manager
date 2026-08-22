'use strict';

/**
 * 远程项目记录 —— Node.js 后端（零依赖，仅用 Node 内置模块）
 *  - 数据库：node:sqlite（内置 SQLite，无需 npm 安装）
 *  - HTTP：node:http（内置，无需 express）
 *  - 备份导入：内置解析 multipart / JSON，无需 multer
 *
 * 与前端（static/）完全兼容，提供前端所需的全部 REST 接口。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const BASE_DIR = __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const STATIC_DIR = path.join(BASE_DIR, 'static');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(BASE_DIR, process.env.DB_PATH)
  : path.join(BASE_DIR, 'db', 'data.db');

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ---------- 配置 ----------
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) { /* ignore */ }
  return {};
}
const config = loadConfig();

// 高德密钥优先从环境变量读取，避免密钥写死进仓库 / 泄露
// 设置方式（二选一）：
//   1) 环境变量 AMAP_KEY / AMAP_SECURITY_JS_CODE
//   2) 在项目根目录创建 config.json（已被 .gitignore 排除）
config.amap_key = process.env.AMAP_KEY || config.amap_key || '';
config.amap_security_js_code = process.env.AMAP_SECURITY_JS_CODE || config.amap_security_js_code || '';

// ---------- 数据库 ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    province TEXT,
    city TEXT,
    district TEXT,
    address TEXT,
    lng REAL,
    lat REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    supports_remote INTEGER DEFAULT 0,
    remote_software TEXT DEFAULT '',
    remote_id TEXT DEFAULT '',
    remote_password TEXT DEFAULT '',
    remote_status TEXT DEFAULT 'unavailable',
    likes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0,
    last_verified_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS remote_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    note TEXT,
    operator TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
`;

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 同步阻塞短延时（用于写入遇锁时退避重试）
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const i32 = new Int32Array(sab);
  Atomics.wait(i32, 0, 0, ms);
}

// 写入遇 “readonly / busy / locked” 时自动退避重试，等文件监视器等只读锁释放
function tryWrite(fn, attempts = 15, delay = 250) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const code = e && e.errcode;
      const lockLike = msg.includes('readonly') || msg.includes('busy') ||
        code === 8 || code === 5 || code === 6;
      if (lockLike) {
        lastErr = e;
        if (i < attempts - 1) { sleepSync(delay); continue; }
      }
      throw e;
    }
  }
  throw lastErr || new Error('写入失败：超过重试次数');
}

let db = null;
let LIVE_DB_PATH = '';

// 尝试以可写方式打开指定数据库（被只读/锁占用则重试几次）
async function tryOpenReadWrite(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const d = new DatabaseSync(p, { open: true });
      d.exec('BEGIN IMMEDIATE');
      d.exec('ROLLBACK');
      d.exec('PRAGMA foreign_keys=OFF');
      return d;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      if (msg.includes('readonly') || msg.includes('busy')) {
        if (attempt % 2 === 0) console.warn(`[db] 尝试打开 ${p} 失败（只读/锁），第 ${attempt + 1} 次重试…`);
        await sleep(600);
        continue;
      }
      throw e;
    }
  }
  throw new Error('无法以可写方式打开数据库：' + p + ' —— ' + (lastErr && lastErr.message));
}

// 从「只读但可读」的源库把数据导入目标库（用于本机回退时恢复已有数据）
function seedFrom(srcPath, dstDb) {
  try {
    const cnt = dstDb.prepare('SELECT COUNT(*) c FROM customers').get().c;
    if (cnt > 0) return; // 目标已有数据，不覆盖
    const src = new DatabaseSync(srcPath, { open: true });
    const tables = ['customers', 'projects', 'remote_history'];
    for (const t of tables) {
      const rows = src.prepare(`SELECT * FROM ${t}`).all();
      if (!rows.length) continue;
      const cols = dstDb.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
      for (const row of rows) {
        const valid = {};
        for (const k of Object.keys(row)) if (cols.includes(k)) valid[k] = row[k];
        if (!Object.keys(valid).length) continue;
        const cn = Object.keys(valid).join(',');
        const ph = Object.keys(valid).map(() => '?').join(',');
        dstDb.prepare(`INSERT INTO ${t} (${cn}) VALUES (${ph})`).run(...Object.values(valid));
      }
    }
    src.close();
    console.log('[db] 已从工作区数据库恢复已有数据到当前库');
  } catch (e) {
    console.warn('[db] 从工作区恢复数据失败（可忽略）：', e.message);
  }
}

async function openDatabase() {
  // 活动库放在用户目录（WorkBuddy 文件监视器只盯工作区，不会锁定这里，
  // 因此本机可正常读写；其他电脑同样没有该监视器，稳定运行）。
  const live = path.join(os.homedir(), 'remote-project-manager-data', 'data.db');
  LIVE_DB_PATH = live;
  const fb = await tryOpenReadWrite(live);
  fb.exec(SCHEMA); // 先建表，以便下方恢复数据/首次运行
  // 若用户目录库为空（首次运行/换电脑），则从随文件夹带来、只读可读的工作区库恢复已有数据
  seedFrom(DB_PATH, fb);
  return fb;
}

function initDb() {
  db.exec(SCHEMA);
  // 迁移：补齐历史版本可能缺失的列
  const cols = db.prepare('PRAGMA table_info(projects)').all().map((r) => r.name);
  if (!cols.includes('remote_software')) db.exec("ALTER TABLE projects ADD COLUMN remote_software TEXT DEFAULT ''");
  if (!cols.includes('remote_id')) {
    db.exec("ALTER TABLE projects ADD COLUMN remote_id TEXT DEFAULT ''");
    if (cols.includes('remote_code')) db.exec("UPDATE projects SET remote_id = remote_code WHERE remote_code IS NOT NULL AND remote_id = ''");
  }
  if (!cols.includes('remote_password')) db.exec("ALTER TABLE projects ADD COLUMN remote_password TEXT DEFAULT ''");
  if (!cols.includes('rcs_url')) db.exec("ALTER TABLE projects ADD COLUMN rcs_url TEXT DEFAULT ''");
  if (!cols.includes('note')) db.exec("ALTER TABLE projects ADD COLUMN note TEXT DEFAULT ''");
}

// ---------- HTTP 工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 50 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString('utf-8'));
}

// 极简 multipart 解析（用于备份导入）
function parseMultipart(buffer, boundary) {
  const sep = Buffer.from('--' + boundary);
  const parts = [];
  let start = buffer.indexOf(sep);
  if (start === -1) return parts;
  while (true) {
    const next = buffer.indexOf(sep, start + sep.length);
    if (next === -1) break;
    let part = buffer.subarray(start + sep.length, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.subarray(2);
    if (part[0] === 0x2d && part[1] === 0x2d) break; // -- 结尾
    const he = part.indexOf('\r\n\r\n');
    if (he === -1) { start = next; continue; }
    const headerStr = part.subarray(0, he).toString('utf-8');
    let content = part.subarray(he + 4);
    if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
      content = content.subarray(0, content.length - 2);
    }
    const cd = /Content-Disposition:[^\r\n]*/i.exec(headerStr);
    const cdStr = cd ? cd[0] : '';
    const nameM = /name="([^"]*)"/i.exec(cdStr);
    const fileM = /filename="([^"]*)"/i.exec(cdStr);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : '',
      content: content.toString('utf-8'),
    });
    start = next;
  }
  return parts;
}

// ---------- 业务处理 ----------
function listCustomers() {
  return db.prepare(`
    SELECT c.*, COUNT(p.id) AS project_count
    FROM customers c
    LEFT JOIN projects p ON c.id = p.customer_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
}

function dashboard() {
  const stats = {
    customer_count: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
    project_count: db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
    remote_count: db.prepare('SELECT COUNT(*) AS c FROM projects WHERE supports_remote=1').get().c,
    available_count: db.prepare("SELECT COUNT(*) AS c FROM projects WHERE supports_remote=1 AND remote_status='available'").get().c,
  };
  const recent = db.prepare(`
    SELECT h.*, c.name AS customer_name, p.name AS project_name
    FROM remote_history h
    JOIN projects p ON h.project_id = p.id
    JOIN customers c ON p.customer_id = c.id
    ORDER BY h.created_at DESC
    LIMIT 20
  `).all();
  return { stats, recent };
}

function listProjects(customerId) {
  let sql = `SELECT p.*, c.name AS customer_name FROM projects p JOIN customers c ON p.customer_id = c.id`;
  const params = [];
  if (customerId) { sql += ' WHERE p.customer_id=?'; params.push(customerId); }
  sql += ' ORDER BY p.updated_at DESC';
  return db.prepare(sql).all(...params);
}

function createCustomer(data) {
  const name = (data.name || '').trim();
  if (!name) return { error: '客户名称不能为空', status: 400 };
  const info = db.prepare(`
    INSERT INTO customers (name, province, city, district, address, lng, lat, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, data.province || '', data.city || '', data.district || '',
    data.address || '', data.lng, data.lat, nowStr()
  );
  const row = db.prepare('SELECT * FROM customers WHERE id=?').get(info.lastInsertRowid);
  return { row, status: 201 };
}

function updateCustomer(id, data) {
  const name = (data.name || '').trim();
  if (!name) return { error: '客户名称不能为空', status: 400 };
  db.prepare(`
    UPDATE customers SET name=?, province=?, city=?, district=?, address=?, lng=?, lat=? WHERE id=?
  `).run(
    name, data.province || '', data.city || '', data.district || '',
    data.address || '', data.lng, data.lat, id
  );
  const row = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  return { row, status: 200 };
}

function deleteCustomer(id) {
  db.prepare('DELETE FROM remote_history WHERE project_id IN (SELECT id FROM projects WHERE customer_id=?)').run(id);
  db.prepare('DELETE FROM projects WHERE customer_id=?').run(id);
  db.prepare('DELETE FROM customers WHERE id=?').run(id);
  return { ok: true };
}

function createProject(data) {
  const name = (data.name || '').trim();
  const customerId = data.customer_id;
  if (!name) return { error: '项目名称不能为空', status: 400 };
  if (!customerId) return { error: '必须选择客户', status: 400 };

  const supportsRemote = data.supports_remote ? 1 : 0;
  const remoteSoftware = (data.remote_software || '').trim();
  const remoteId = (data.remote_id || '').trim();
  const remotePassword = data.remote_password || '';
  const remoteStatus = data.remote_status || 'unavailable';
  const rcsUrl = (data.rcs_url || '').trim();

  const info = db.prepare(`
    INSERT INTO projects (customer_id, name, code, supports_remote, remote_software, remote_id, remote_password, remote_status, rcs_url, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customerId, name, data.code || '', supportsRemote, remoteSoftware, remoteId,
    remotePassword, remoteStatus, rcsUrl, data.note || '', nowStr(), nowStr()
  );
  const projectId = info.lastInsertRowid;
  const remoteSummary = (remoteSoftware || remoteId || rcsUrl) ? `${remoteSoftware} | ${remoteId} | ${rcsUrl}` : '';
  db.prepare(`
    INSERT INTO remote_history (project_id, action, old_value, new_value, note, operator, created_at)
    VALUES (?, 'create', '', ?, '创建项目', ?, ?)
  `).run(projectId, remoteSummary, data.operator || '', nowStr());
  const row = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  return { row, status: 201 };
}

function updateProject(id, data) {
  const name = (data.name || '').trim();
  if (!name) return { error: '项目名称不能为空', status: 400 };
  const old = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!old) return { error: '项目不存在', status: 404 };

  const supportsRemote = data.supports_remote ? 1 : 0;
  const newSoftware = (data.remote_software || '').trim();
  const newRemoteId = (data.remote_id || '').trim();
  const newPassword = data.remote_password || '';
  const remoteStatus = data.remote_status || old.remote_status;
  const newRcsUrl = (data.rcs_url || '').trim();

  db.prepare(`
    UPDATE projects SET name=?, code=?, supports_remote=?, remote_software=?, remote_id=?, remote_password=?, remote_status=?, rcs_url=?, note=?, updated_at=?
    WHERE id=?
  `).run(
    name, data.code || '', supportsRemote, newSoftware, newRemoteId, newPassword,
    remoteStatus, newRcsUrl, data.note || '', nowStr(), id
  );

  const oldSummary = `${old.remote_software} | ${old.remote_id} | ${old.rcs_url || ''}`;
  const newSummary = `${newSoftware} | ${newRemoteId} | ${newRcsUrl}`;
  const pwChanged = newPassword !== (old.remote_password || '');
  if (old.remote_software !== newSoftware || old.remote_id !== newRemoteId || pwChanged || old.rcs_url !== newRcsUrl) {
    const noteParts = [];
    if (old.remote_software !== newSoftware) noteParts.push(`软件 ${old.remote_software || '空'}→${newSoftware || '空'}`);
    if (old.remote_id !== newRemoteId) noteParts.push(`数字码 ${old.remote_id || '空'}→${newRemoteId || '空'}`);
    if (pwChanged) noteParts.push('验证密码 已更新');
    if (old.rcs_url !== newRcsUrl) noteParts.push(`RCS地址 ${old.rcs_url || '空'}→${newRcsUrl || '空'}`);
    db.prepare(`
      INSERT INTO remote_history (project_id, action, old_value, new_value, note, operator, created_at)
      VALUES (?, 'update_remote', ?, ?, ?, ?, ?)
    `).run(id, oldSummary, newSummary, noteParts.join('；') || '更新远程信息', data.operator || '', nowStr());
  }
  if (old.remote_status !== remoteStatus) {
    db.prepare(`
      INSERT INTO remote_history (project_id, action, old_value, new_value, note, operator, created_at)
      VALUES (?, 'status_change', ?, ?, ?, ?, ?)
    `).run(id, old.remote_status, remoteStatus, data.note || '状态变更', data.operator || '', nowStr());
  }
  const row = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  return { row, status: 200 };
}

function deleteProject(id) {
  db.prepare('DELETE FROM remote_history WHERE project_id=?').run(id);
  db.prepare('DELETE FROM projects WHERE id=?').run(id);
  return { ok: true };
}

function feedbackProject(id, data) {
  const type = data.type;
  if (type !== 'like' && type !== 'dislike') return { error: '反馈类型必须是 like 或 dislike', status: 400 };
  const old = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!old) return { error: '项目不存在', status: 404 };

  if (type === 'like') {
    db.prepare('UPDATE projects SET likes=likes+1, remote_status=?, last_verified_at=? WHERE id=?',
      ).run('available', nowStr(), id);
    var action = 'feedback_available';
    var note = data.note || '反馈远程码可用';
  } else {
    db.prepare('UPDATE projects SET dislikes=dislikes+1, remote_status=?, last_verified_at=? WHERE id=?',
      ).run('unavailable', nowStr(), id);
    var action = 'feedback_unavailable';
    var note = data.note || '反馈远程码不可用';
  }
  db.prepare(`
    INSERT INTO remote_history (project_id, action, old_value, new_value, note, operator, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, action, old.remote_status, type === 'like' ? 'available' : 'unavailable', note, data.operator || '', nowStr());
  const row = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  return { row, status: 200 };
}

function projectHistory(id) {
  return db.prepare(`
    SELECT h.*, c.name AS customer_name, p.name AS project_name
    FROM remote_history h
    JOIN projects p ON h.project_id = p.id
    JOIN customers c ON p.customer_id = c.id
    WHERE h.project_id=?
    ORDER BY h.created_at DESC
  `).all(id);
}

const BACKUP_TABLES = ['customers', 'projects', 'remote_history'];

function backupExport() {
  const data = {};
  for (const t of BACKUP_TABLES) data[t] = db.prepare(`SELECT * FROM ${t}`).all();
  const payload = {
    version: 1,
    exported_at: nowStr(),
    tables: BACKUP_TABLES,
    data,
  };
  return payload;
}

function backupImport(src) {
  for (const t of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
  for (const t of BACKUP_TABLES) {
    const rows = src[t] || [];
    if (!rows.length) continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
    for (const row of rows) {
      const valid = {};
      for (const k of Object.keys(row)) if (cols.includes(k)) valid[k] = row[k];
      if (!Object.keys(valid).length) continue;
      const colNames = Object.keys(valid).join(',');
      const placeholders = Object.keys(valid).map(() => '?').join(',');
      db.prepare(`INSERT INTO ${t} (${colNames}) VALUES (${placeholders})`).run(...Object.values(valid));
    }
  }
  return { ok: true, imported: Object.fromEntries(BACKUP_TABLES.map((t) => [t, (src[t] || []).length])) };
}

// ---------- 路由 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(STATIC_DIR, rel);
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA 回退
    const idx = path.join(STATIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    fs.createReadStream(idx).pipe(res);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // ---- API ----
    if (pathname === '/api/config' && method === 'GET') {
      return sendJson(res, 200, {
        amap_key: config.amap_key || '',
        amap_security_js_code: config.amap_security_js_code || '',
      });
    }

    if (pathname === '/api/dashboard' && method === 'GET') {
      return sendJson(res, 200, dashboard());
    }

    if (pathname === '/api/customers' && method === 'GET') {
      return sendJson(res, 200, listCustomers());
    }
    if (pathname === '/api/customers' && method === 'POST') {
      const d = await readJsonBody(req);
      const r = createCustomer(d);
      return sendJson(res, r.status, r.row ? r.row : { error: r.error });
    }
    let m = pathname.match(/^\/api\/customers\/(\d+)$/);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'GET') {
        const row = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
        if (!row) return sendJson(res, 404, { error: '客户不存在' });
        return sendJson(res, 200, row);
      }
      if (method === 'PUT') {
        const d = await readJsonBody(req);
        const r = updateCustomer(id, d);
        return sendJson(res, r.status, r.row ? r.row : { error: r.error });
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, deleteCustomer(id));
      }
    }

    if (pathname === '/api/projects' && method === 'GET') {
      const cid = url.searchParams.get('customer_id');
      return sendJson(res, 200, listProjects(cid ? parseInt(cid, 10) : null));
    }
    if (pathname === '/api/projects' && method === 'POST') {
      const d = await readJsonBody(req);
      const r = createProject(d);
      return sendJson(res, r.status, r.row ? r.row : { error: r.error });
    }
    m = pathname.match(/^\/api\/projects\/(\d+)\/feedback$/);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'POST') {
        const d = await readJsonBody(req);
        const r = feedbackProject(id, d);
        return sendJson(res, r.status, r.row ? r.row : { error: r.error });
      }
    }
    m = pathname.match(/^\/api\/projects\/(\d+)\/history$/);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'GET') return sendJson(res, 200, projectHistory(id));
    }
    m = pathname.match(/^\/api\/projects\/(\d+)$/);
    if (m) {
      const id = parseInt(m[1], 10);
      if (method === 'GET') {
        const row = db.prepare('SELECT p.*, c.name AS customer_name FROM projects p JOIN customers c ON p.customer_id=c.id WHERE p.id=?').get(id);
        if (!row) return sendJson(res, 404, { error: '项目不存在' });
        return sendJson(res, 200, row);
      }
      if (method === 'PUT') {
        const d = await readJsonBody(req);
        const r = updateProject(id, d);
        return sendJson(res, r.status, r.row ? r.row : { error: r.error });
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, deleteProject(id));
      }
    }

    if (pathname === '/api/backup/export' && method === 'GET') {
      const payload = backupExport();
      const body = JSON.stringify(payload, null, 2);
      const fname = `remote-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '').replace(' ', '-')}.json`;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename=${fname}`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return;
    }
    if (pathname === '/api/backup/import' && method === 'POST') {
      let payloadText = null;
      const ct = req.headers['content-type'] || '';
      if (ct.includes('multipart/form-data')) {
        const buf = await readBody(req);
        const bM = /boundary=("?)([^";]+)\1/.exec(ct);
        if (!bM) return sendJson(res, 400, { error: 'multipart 解析失败：缺少 boundary' });
        const parts = parseMultipart(buf, bM[2]);
        const filePart = parts.find((p) => p.filename) || parts[0];
        payloadText = filePart ? filePart.content : null;
      } else {
        payloadText = (await readBody(req)).toString('utf-8');
      }
      if (!payloadText) return sendJson(res, 400, { error: '未找到上传内容' });
      let payload;
      try { payload = JSON.parse(payloadText); } catch (e) { return sendJson(res, 400, { error: '文件解析失败：' + e.message }); }
      if (!payload || typeof payload !== 'object' || !payload.data) return sendJson(res, 400, { error: '备份文件格式不正确（缺少 data 字段）' });
      try {
        const result = backupImport(payload.data);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 500, { error: '导入失败：' + e.message });
      }
    }

    // ---- 静态资源 ----
    if (method === 'GET') {
      return serveStatic(res, pathname);
    }

    return sendJson(res, 404, { error: 'Not Found' });
  } catch (e) {
    console.error('[error]', req.method, pathname, e);
    return sendJson(res, 500, { error: '服务器内部错误：' + (e.message || e) });
  }
}

// ---------- 启动 ----------
async function main() {
  try {
    db = await openDatabase();
    // 让写入在遇到文件监视器/索引器的只读锁时自动退避重试
    const _prepare = db.prepare.bind(db);
    // node:sqlite 不能绑定 undefined（会报 “cannot be bound”），统一兜底成 null
    const scrub = (a) => (a === undefined ? null : a);
    db.prepare = (sql) => {
      const stmt = _prepare(sql);
      const _run = stmt.run ? stmt.run.bind(stmt) : null;
      if (_run) stmt.run = (...args) => tryWrite(() => _run(...args.map(scrub)));
      const _get = stmt.get ? stmt.get.bind(stmt) : null;
      if (_get) stmt.get = (...args) => _get(...args.map(scrub));
      const _all = stmt.all ? stmt.all.bind(stmt) : null;
      if (_all) stmt.all = (...args) => _all(...args.map(scrub));
      return stmt;
    };
    const _exec = db.exec.bind(db);
    db.exec = (sql) => tryWrite(() => _exec(sql));
    initDb();
    console.log(`[db] 数据库已就绪：${LIVE_DB_PATH}`);
  } catch (e) {
    console.error('[db] 初始化失败：', e.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[unhandled]', e);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
    });
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n[错误] 端口 ${PORT} 已被占用，可能已有另一个实例在运行。`);
      console.error('       请先关闭它（结束 node.exe 进程，或重启电脑），再双击 start.bat。');
    } else {
      console.error('\n[错误] 服务启动失败：', err && err.message);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`远程项目记录服务已启动：http://${HOST}:${PORT}`);
    console.log(`本机访问：http://localhost:${PORT}`);
    console.log('按 Ctrl+C 或关闭窗口可停止服务。');
  });
}

main();
