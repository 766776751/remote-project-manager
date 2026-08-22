'use strict';
const fs = require('node:fs');
const path = require('node:path');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

try {
  copyDir('static', 'public');
  console.log('[build] static -> public copied');
} catch (e) {
  console.error('[build] error:', e.message);
  process.exit(1);
}
