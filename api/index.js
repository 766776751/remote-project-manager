'use strict';

/**
 * Vercel Serverless Function 入口
 * 直接复用 lib/server.js 的默认 handler，避免二次包装导致导出失效。
 */

const serverHandler = require('../lib/server.js');

module.exports = serverHandler;
module.exports.default = serverHandler;
