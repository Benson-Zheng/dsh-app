'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const guide = fs.readFileSync(path.join(root, 'docs', '全新电脑安装.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('package.json packager artifact names are the documented exe names', () => {
  assert.equal(pkg.build.nsis.artifactName, 'dsh-app-setup.exe');
  assert.equal(pkg.build.portable.artifactName, 'dsh-app.exe');
  assert.ok(pkg.build.win.target.some((t) => t.target === 'nsis'));
});

test('fresh-PC install guide names Node, independent dsh, both shell artifacts, and first launch', () => {
  assert.match(guide, /Node\.js/);
  assert.match(guide, /npm install -g @deepseek-ai\/dsh/);
  assert.match(guide, /dsh-app-setup\.exe/);
  assert.match(guide, /dsh-app\.exe/);
  assert.match(guide, /dsh app/);
  assert.match(guide, /npm update -g @deepseek-ai\/dsh/);
  assert.match(guide, /第一次打开|第一次/);
  assert.doesNotMatch(guide, /把 dsh 打进 exe|bundled dsh as the only backend/i);
});

test('documented artifact names match package.json exactly', () => {
  assert.match(guide, new RegExp(pkg.build.nsis.artifactName.replace('.', '\\.')));
  assert.match(guide, new RegExp(pkg.build.portable.artifactName.replace('.', '\\.')));
  assert.match(guide, /@deepseek-ai\/dsh/);
  assert.match(readme, /dsh-app-setup\.exe/);
  assert.match(readme, /dsh-app\.exe/);
  assert.match(readme, /npm install -g @deepseek-ai\/dsh/);
  assert.match(readme, /docs\/全新电脑安装\.md/);
});
