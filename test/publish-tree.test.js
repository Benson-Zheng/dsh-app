'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

test('publish tree ignores generated dirs and ships MIT + wrapper README', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /node_modules/);
  assert.match(ignore, /^dist\/$/m);
  assert.match(ignore, /tmp-verify/);

  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted, free of charge/);

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /Windows desktop wrapper/i);
  assert.match(readme, /dsh web/);
  assert.match(readme, /not.*official DeepSeek/i);
  assert.match(readme, /does \*\*not\*\* vendor or freeze a `dsh` runtime/);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
});
