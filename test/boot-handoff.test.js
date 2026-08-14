'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { bootHandoff, localPageUrl } = require('../src/lifecycle');

test('bootHandoff sends a ready runtime to the loopback origin', () => {
  const dest = bootHandoff({ origin: 'http://127.0.0.1:3456' }, null);
  assert.equal(dest.ok, true);
  assert.equal(dest.kind, 'origin');
  assert.equal(dest.origin, 'http://127.0.0.1:3456');
});

test('bootHandoff replaces splash with error.html when boot fails', () => {
  const err = Object.assign(new Error('dsh web did not become ready at http://127.0.0.1:11106'), {
    code: 'DSH_NOT_READY',
  });
  const dest = bootHandoff(null, err);
  assert.equal(dest.ok, false);
  assert.equal(dest.kind, 'error');
  assert.equal(dest.file, 'error.html');
  assert.equal(dest.code, 'DSH_NOT_READY');
  assert.match(dest.message, /did not become ready/);
});

test('localPageUrl keeps Program Files paths valid for error.html queries', () => {
  const url = localPageUrl('C:\\Program Files\\dsh app\\resources\\app.asar\\src\\error.html', {
    code: 'DSH_NOT_READY',
    message: 'dsh web did not become ready',
  });
  assert.match(url, /^file:\/\//);
  assert.match(url, /error\.html/);
  assert.match(url, /code=DSH_NOT_READY/);
  assert.doesNotMatch(url, /file:\/\/C:\\Program Files/);
  assert.ok(URL.canParse(url), url);
});

test('main boot path uses bootHandoff and loadFile instead of staying on splash', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /bootHandoff/);
  assert.match(main, /loadFile/);
  assert.match(main, /showMissingDsh/);
  assert.match(main, /loadLocal\('splash\.html'\)/);
  assert.match(main, /loadURL\(origin\)/);
});
