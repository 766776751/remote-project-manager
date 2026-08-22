'use strict';

/**
 * Vercel Serverless Function 入口
 * 复用 server.js 的逻辑，避免重复实现。
 */

const { initDatabase, handle } = require('../server.js');

let initPromise = null;
let initDone = false;

function ensureInit() {
  if (initDone) return Promise.resolve();
  if (!initPromise) {
    initPromise = initDatabase()
      .then(() => { initDone = true; })
      .catch((e) => {
        initPromise = null;
        throw e;
      });
  }
  return initPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureInit();
    await handle(req, res);
  } catch (e) {
    console.error('[vercel error]', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '服务器内部错误：' + (e.message || e) }));
    }
  }
};
