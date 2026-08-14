'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  DSH_INSTALL_HINT,
  detectInstalledDsh,
} = require('../src/lifecycle');

const CLI = path.join(__dirname, '..', 'scripts', 'detect-dsh.js');

test('detectInstalledDsh reports DSH_NOT_FOUND when PATH has no dsh', () => {
  const result = detectInstalledDsh({
    bin: null,
    path: path.join(os.tmpdir(), 'dsh-detect-empty'),
    env: { PATH: '', PATHEXT: '.CMD;.EXE' },
    mergeWindowsPath: false,
  });
  assert.equal(result.found, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DSH_NOT_FOUND');
  assert.equal(result.install, DSH_INSTALL_HINT);
  assert.match(result.install, /npm install -g @deepseek-ai\/dsh/);
});

test('detectInstalledDsh reports FOUND for a stand-in on PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-detect-hit-'));
  const shim = path.join(dir, 'dsh.cmd');
  fs.writeFileSync(shim, '@echo fake\r\n');
  const result = detectInstalledDsh({
    bin: null,
    path: dir,
    env: { PATH: dir, PATHEXT: '.CMD;.EXE' },
    mergeWindowsPath: false,
  });
  assert.equal(result.found, true);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'DSH_FOUND');
  assert.equal(result.path, shim);
});

test('detectInstalledDsh does not treat a bundled-only copy as installed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-detect-bundle-'));
  const bundled = path.join(root, 'app-bundle');
  fs.mkdirSync(bundled);
  fs.writeFileSync(path.join(bundled, 'dsh.cmd'), '@echo frozen\r\n');
  const result = detectInstalledDsh({
    bin: null,
    path: bundled,
    env: {
      PATH: bundled,
      PATHEXT: '.CMD;.EXE',
      DSH_APP_BUNDLE_DIR: bundled,
    },
    mergeWindowsPath: false,
  });
  assert.equal(result.found, false);
  assert.equal(result.code, 'DSH_NOT_FOUND');
});

test('detect-dsh.js CLI reports FOUND for a PATH stand-in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-detect-cli-hit-'));
  const shim = path.join(dir, 'dsh.cmd');
  fs.writeFileSync(shim, '@echo cli\r\n');
  const outFile = path.join(dir, 'result.txt');
  const ran = spawnSync(process.execPath, [CLI], {
    env: {
      ...process.env,
      PATH: dir,
      PATHEXT: '.CMD;.EXE',
      DSH_BIN: '',
      DSH_DETECT_PATH: dir,
      DSH_DETECT_MERGE_WINDOWS: '0',
      DSH_DETECT_OUT: outFile,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(ran.status, 0);
  assert.equal(ran.stdout.trim(), `FOUND|${shim}`);
  const body = fs.readFileSync(outFile, 'utf8');
  assert.match(body, /^FOUND\r?\n/);
  assert.ok(body.includes(shim), body);
});

test('NSIS include invokes the shipped detect script and shows the install hint', () => {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /customPageAfterChangeDir/);
  assert.match(nsh, /detect-dsh\.js/);
  assert.match(nsh, /install-dsh\.js/);
  assert.match(nsh, /lifecycle\.js/);
  assert.match(nsh, /立即安装 dsh/);
  assert.match(nsh, /已检测到本机的 dsh/);
});

test('detect-dsh.js CLI reports MISSING with the npm install hint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-detect-cli-miss-'));
  const outFile = path.join(dir, 'result.txt');
  const ran = spawnSync(process.execPath, [CLI], {
    env: {
      ...process.env,
      PATH: dir,
      PATHEXT: '.CMD;.EXE',
      DSH_BIN: '',
      DSH_DETECT_PATH: dir,
      DSH_DETECT_MERGE_WINDOWS: '0',
      DSH_DETECT_OUT: outFile,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(ran.status, 2);
  assert.equal(ran.stdout.trim(), `MISSING|${DSH_INSTALL_HINT}`);
  const body = fs.readFileSync(outFile, 'utf8');
  assert.match(body, /^MISSING\r?\n/);
  assert.match(body, /npm install -g @deepseek-ai\/dsh/);
});
