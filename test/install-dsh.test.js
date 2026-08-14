'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  detectInstalledDsh,
  findNpmExecutable,
  installUserDsh,
} = require('../src/lifecycle');

function writeLocalDshPackage(root) {
  const pkgDir = path.join(root, 'pkg');
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.0.0-test',
    bin: { dsh: 'bin/dsh.js' },
  }));
  fs.writeFileSync(
    path.join(pkgDir, 'bin', 'dsh.js'),
    '#!/usr/bin/env node\nconsole.log("stand-in-dsh");\n',
  );
  return pkgDir;
}

test('installUserDsh returns NPM_NOT_FOUND when npm is missing', () => {
  const result = installUserDsh({
    npmBin: path.join(os.tmpdir(), 'no-such-npm.cmd'),
    path: path.join(os.tmpdir(), 'empty-path'),
    mergeWindowsPath: false,
    env: { PATH: '', PATHEXT: '.CMD;.EXE' },
  });
  assert.equal(result.found, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NPM_NOT_FOUND');
});

test('installUserDsh runs npm.cmd when the path contains spaces (Program Files)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh Program Files '));
  const dir = path.join(root, 'nodejs');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'invoked.txt');
  const npmBin = path.join(dir, 'npm.cmd');
  assert.match(npmBin, / /);
  fs.writeFileSync(
    npmBin,
    `@echo off\r\necho invoked>"${marker}"\r\nexit /b 7\r\n`,
  );
  const result = installUserDsh({
    npmBin,
    path: dir,
    mergeWindowsPath: false,
    env: { PATH: dir, PATHEXT: '.CMD;.EXE' },
    timeoutMs: 10_000,
  });
  assert.equal(fs.existsSync(marker), true, 'spaced npm.cmd was never executed');
  assert.equal(result.found, false);
  assert.equal(result.code, 'DSH_INSTALL_FAILED');
});

test('installUserDsh returns DSH_INSTALL_FAILED when npm exits nonzero', () => {
  const fail = path.join(__dirname, 'fixtures', 'npm-fail.cmd');
  const result = installUserDsh({
    npmBin: fail,
    path: path.dirname(fail),
    mergeWindowsPath: false,
    env: { PATH: path.dirname(fail), PATHEXT: '.CMD;.EXE' },
    timeoutMs: 10_000,
  });
  assert.equal(result.found, false);
  assert.equal(result.code, 'DSH_INSTALL_FAILED');
});

test('installUserDsh via spaced Program Files npm.cmd installs into the prefix', async (t) => {
  const realNpm = findNpmExecutable(process.env, process.env.PATH)
    || (fs.existsSync(path.join('C:', 'nvm4w', 'nodejs', 'npm.cmd'))
      ? path.join('C:', 'nvm4w', 'nodejs', 'npm.cmd')
      : null);
  if (!realNpm) {
    t.skip('npm not available for spaced-path prefix install');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh Program Files '));
  const dir = path.join(root, 'nodejs');
  fs.mkdirSync(dir, { recursive: true });
  const npmBin = path.join(dir, 'npm.cmd');
  assert.match(npmBin, / /);
  fs.writeFileSync(
    npmBin,
    `@echo off\r\ncall "${realNpm}" %*\r\n`,
  );
  const prefix = path.join(root, 'prefix');
  fs.mkdirSync(prefix);
  const pkgDir = writeLocalDshPackage(root);
  const result = installUserDsh({
    prefix,
    packageSpec: pkgDir,
    npmBin,
    mergeWindowsPath: false,
    timeoutMs: 120_000,
    env: process.env,
  });
  assert.equal(result.found, true, result.message || result.code);
  assert.ok(path.resolve(result.path).startsWith(path.resolve(prefix)));
});

test('installUserDsh into a temp prefix is then detected as found', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-user-install-'));
  const prefix = path.join(root, 'prefix');
  fs.mkdirSync(prefix);
  const pkgDir = writeLocalDshPackage(root);

  const before = detectInstalledDsh({
    bin: null,
    path: prefix,
    mergeWindowsPath: false,
    env: { PATH: prefix, PATHEXT: '.CMD;.EXE' },
  });
  assert.equal(before.found, false);

  const npmBin = findNpmExecutable(process.env, process.env.PATH)
    || (fs.existsSync(path.join('C:', 'nvm4w', 'nodejs', 'npm.cmd'))
      ? path.join('C:', 'nvm4w', 'nodejs', 'npm.cmd')
      : null);
  if (!npmBin) {
    t.skip('npm not available for prefix install');
    return;
  }

  const result = installUserDsh({
    prefix,
    packageSpec: pkgDir,
    npmBin,
    mergeWindowsPath: false,
    timeoutMs: 120_000,
    env: process.env,
  });
  if (result.code === 'DSH_INSTALL_FAILED' && /ENOTFOUND|ECONN|registry|404|ETIMEDOUT/i.test(result.message || '')) {
    t.skip(`npm registry unavailable: ${result.message}`);
    return;
  }

  assert.equal(result.found, true, result.message || result.code);
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.ok(result.path);
  const resolved = path.resolve(result.path);
  assert.ok(
    resolved.startsWith(path.resolve(prefix)),
    `expected detect path under prefix ${prefix}, got ${result.path}`,
  );

  const after = detectInstalledDsh({
    bin: null,
    path: [prefix, path.join(prefix, 'bin')].join(path.delimiter),
    mergeWindowsPath: false,
    env: { PATH: prefix, PATHEXT: '.CMD;.EXE' },
  });
  assert.equal(after.found, true);
  assert.ok(path.resolve(after.path).startsWith(path.resolve(prefix)));
});

test('error page and installer invoke the shipped install action', () => {
  const errorHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'error.html'), 'utf8');
  assert.match(errorHtml, /dshApp\.installDsh/);
  assert.match(errorHtml, /一键安装 dsh/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(preload, /dsh:install/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /installUserDsh/);
  assert.match(main, /dsh:install/);
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /install-dsh\.js/);
  assert.match(nsh, /立即安装 dsh/);
  assert.match(nsh, /OnInstallDsh/);
});
