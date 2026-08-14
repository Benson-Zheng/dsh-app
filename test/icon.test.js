'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Resvg } = require('@resvg/resvg-js');
const {
  composeWhaleMarkSvg,
  extractWhalePath,
  toneCounts,
} = require('../scripts/rasterize-whale');
const { resolveIconPath, iconAssetPaths } = require('../src/chrome');

const root = path.join(__dirname, '..');
const WHALE = /M48\.8354 10\.0479/;

test('composeWhaleMarkSvg puts the official black whale on a white field', () => {
  const src = fs.readFileSync(path.join(root, 'assets', 'whale.svg'), 'utf8');
  const composed = composeWhaleMarkSvg(src);
  assert.equal(extractWhalePath(src).startsWith('M48.8354 10.0479'), true);
  assert.match(composed, WHALE);
  assert.match(composed, /fill="#ffffff"/);
  assert.match(composed, /fill="#000000"/);
  assert.match(composed, /scale\(/);
});

test('composed whale mark rasterizes to both black whale and white field pixels', () => {
  const src = fs.readFileSync(path.join(root, 'assets', 'whale.svg'), 'utf8');
  const rendered = new Resvg(composeWhaleMarkSvg(src, 64, 8), {
    fitTo: { mode: 'width', value: 64 },
  }).render();
  const tones = toneCounts(rendered.pixels);
  assert.ok(tones.light > 100, `expected a white field, light=${tones.light}`);
  assert.ok(tones.dark > 40, `expected a black whale, dark=${tones.dark}`);
});

test('window, packager, splash, plaza bar, and error page all use the whale mark', () => {
  const assets = iconAssetPaths();
  assert.match(fs.readFileSync(assets.whaleSvg, 'utf8'), WHALE);
  assert.ok(fs.statSync(assets.png).isFile());
  assert.ok(fs.statSync(assets.ico).isFile());
  const resolved = resolveIconPath();
  assert.ok(resolved === assets.ico || resolved === assets.png);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.win.icon.replace(/\\/g, '/'), 'assets/icon.ico');

  for (const rel of ['src/splash.html', 'src/plaza-bar.html', 'src/error.html']) {
    assert.match(fs.readFileSync(path.join(root, rel), 'utf8'), WHALE, rel);
  }
});
