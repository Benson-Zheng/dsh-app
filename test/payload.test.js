'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const pkg = require('../package.json');

test('packager ships the shell only and excludes a frozen dsh runtime', () => {
  const files = pkg.build.files;
  assert.ok(files.some((f) => f.includes('src')));
  assert.ok(files.some((f) => f.includes('@deepseek-ai/dsh') && f.startsWith('!')));
  assert.ok(files.some((f) => f.includes('dsh.exe') && f.startsWith('!')));
  assert.ok(pkg.build.win.target.some((t) => t.target === 'nsis'));
});

test('unpacked payload does not contain a dsh runtime when dist exists', (t) => {
  const unpacked = path.join(__dirname, '..', 'dist', 'win-unpacked');
  if (!fs.existsSync(unpacked)) {
    t.skip('dist/win-unpacked not built yet');
    return;
  }
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(unpacked, full).replace(/\\/g, '/').toLowerCase();
      const base = ent.name.toLowerCase();
      if (rel.includes('node_modules/@deepseek-ai/dsh') || base === 'dsh.exe' || base === 'dsh.cmd' || base === 'dsh') {
        hits.push(rel);
      }
    }
  };
  walk(unpacked);
  assert.deepEqual(hits, []);
});
