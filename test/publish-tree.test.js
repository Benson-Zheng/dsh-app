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

test('README shows the two published app screenshots', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const rel of ['docs/screenshots/session.png', 'docs/screenshots/plaza.png']) {
    const file = path.join(root, rel);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 10 * 1024, `${rel} too small`);
    assert.ok(bytes.subarray(0, 4).equals(png), `${rel} is not a PNG`);
    assert.match(readme, new RegExp(rel.replace('.', '\\.')));
  }
  assert.match(readme, /!\[会话\]\(docs\/screenshots\/session\.png\)/);
  assert.match(readme, /!\[插件广场\]\(docs\/screenshots\/plaza\.png\)/);
});
