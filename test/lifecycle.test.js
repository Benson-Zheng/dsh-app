'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  DshAppError,
  allocateFreePort,
  resolveDsh,
  startDshWeb,
  stopChild,
  waitUntilReady,
} = require('../src/lifecycle');

const FAKE_DSH = path.join(__dirname, 'fixtures', 'fake-dsh.js');

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('resolveDsh throws named DSH_NOT_FOUND when the binary is missing', () => {
  const missing = path.join(os.tmpdir(), 'dsh-app-no-such-binary.exe');
  assert.equal(fs.existsSync(missing), false);
  assert.throws(
    () => resolveDsh({ bin: missing, path: '' }),
    (err) => err instanceof DshAppError && err.code === 'DSH_NOT_FOUND',
  );
});

test('resolveDsh throws DSH_NOT_FOUND when PATH has no dsh', () => {
  assert.throws(
    () => resolveDsh({ bin: null, path: path.join(os.tmpdir(), 'empty-path-dir'), env: { PATH: '' } }),
    (err) => err instanceof DshAppError && err.code === 'DSH_NOT_FOUND',
  );
});

test('resolveDsh returns an existing explicit binary', () => {
  const resolved = resolveDsh({ bin: FAKE_DSH, path: '' });
  assert.equal(resolved, path.resolve(FAKE_DSH));
});

test('resolveDsh follows a swapped PATH so an updated dsh wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-app-path-swap-'));
  const stale = path.join(root, 'stale');
  const updated = path.join(root, 'updated');
  fs.mkdirSync(stale);
  fs.mkdirSync(updated);
  const staleBin = path.join(stale, 'dsh.cmd');
  const updatedBin = path.join(updated, 'dsh.cmd');
  fs.writeFileSync(staleBin, '@echo stale\r\n');
  fs.writeFileSync(updatedBin, '@echo updated\r\n');

  const picked = resolveDsh({
    bin: null,
    path: [updated, stale].join(path.delimiter),
    env: { PATH: [updated, stale].join(path.delimiter), PATHEXT: '.CMD;.EXE' },
  });
  assert.equal(picked, updatedBin);

  const staleFirst = resolveDsh({
    bin: null,
    path: [stale, updated].join(path.delimiter),
    env: { PATH: [stale, updated].join(path.delimiter), PATHEXT: '.CMD;.EXE' },
  });
  assert.equal(staleFirst, staleBin);
});

test('resolveDsh skips a bundled app copy so an independent install wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-app-bundle-skip-'));
  const bundled = path.join(root, 'dsh-app-bundle');
  const user = path.join(root, 'user-npm');
  fs.mkdirSync(bundled);
  fs.mkdirSync(user);
  const bundledBin = path.join(bundled, 'dsh.cmd');
  const userBin = path.join(user, 'dsh.cmd');
  fs.writeFileSync(bundledBin, '@echo bundled-frozen\r\n');
  fs.writeFileSync(userBin, '@echo user-updated\r\n');

  const picked = resolveDsh({
    bin: null,
    path: [bundled, user].join(path.delimiter),
    env: {
      PATH: [bundled, user].join(path.delimiter),
      PATHEXT: '.CMD;.EXE',
      DSH_APP_BUNDLE_DIR: bundled,
    },
  });
  assert.equal(picked, userBin);
  assert.notEqual(picked, bundledBin);
});

test('startDshWeb resolves the PATH-updated stand-in (not a command override)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-app-updated-'));
  const shim = path.join(dir, 'dsh.cmd');
  fs.writeFileSync(
    shim,
    `@echo off\r\n"${process.execPath}" "${FAKE_DSH}" %*\r\n`,
  );
  const runtime = await startDshWeb({
    bin: null,
    path: dir,
    env: { ...process.env, PATH: dir, PATHEXT: '.CMD;.EXE', DSH_BIN: '' },
    host: '127.0.0.1',
    readyTimeoutMs: 10_000,
  });
  try {
    assert.equal(path.normalize(runtime.command), path.normalize(shim));
    assert.match(runtime.ready.body, /data-standin="dsh-web"/);
  } finally {
    await stopChild(runtime.child);
  }
});

test('allocateFreePort returns a bindable loopback port', async () => {
  const port = await allocateFreePort('127.0.0.1');
  assert.ok(Number.isInteger(port) && port > 0);
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
});

test('startDshWeb + stopChild drives a stand-in dsh through ready HTML then exit', async () => {
  const runtime = await startDshWeb({
    command: process.execPath,
    argsPrefix: [FAKE_DSH],
    host: '127.0.0.1',
    readyTimeoutMs: 10_000,
  });

  assert.equal(typeof runtime.child.pid, 'number');
  assert.ok(runtime.child.pid > 0);
  assert.match(runtime.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(runtime.ready.status >= 200 && runtime.ready.status < 300);
  assert.match(runtime.ready.body, /DeepSeek Harness/i);
  assert.ok(pidAlive(runtime.child.pid));

  const live = await fetch(runtime.origin);
  assert.equal(live.status, 200);
  const html = await live.text();
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /data-standin="dsh-web"/);

  const pid = runtime.child.pid;
  await stopChild(runtime.child);

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && pidAlive(pid)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(pidAlive(pid), false, `stand-in pid ${pid} still alive after stopChild`);
});

test('waitUntilReady fails with DSH_NOT_READY when nothing is listening', async () => {
  const port = await allocateFreePort('127.0.0.1');
  await assert.rejects(
    () => waitUntilReady(`http://127.0.0.1:${port}`, { timeoutMs: 400, intervalMs: 50 }),
    (err) => err instanceof DshAppError && err.code === 'DSH_NOT_READY',
  );
});

test('startDshWeb with a non-server stand-in stops the child and names DSH_NOT_READY', async () => {
  await assert.rejects(
    () => startDshWeb({
      command: process.execPath,
      argsPrefix: [FAKE_DSH, '--missing'],
      host: '127.0.0.1',
      readyTimeoutMs: 800,
      readyIntervalMs: 50,
    }),
    (err) => err instanceof DshAppError && (err.code === 'DSH_NOT_READY' || err.code === 'DSH_SPAWN_FAILED'),
  );
});

test('real dsh on PATH: spawn-ready-stop cycle serves harness HTML', async (t) => {
  let bin;
  try {
    bin = resolveDsh();
  } catch (err) {
    t.skip(`real dsh not installed: ${err.message}`);
    return;
  }

  const runtime = await startDshWeb({
    command: bin,
    host: '127.0.0.1',
    readyTimeoutMs: 90_000,
  });

  try {
    assert.ok(runtime.child.pid > 0);
    assert.notEqual(runtime.ready.status, 0);
    assert.match(runtime.ready.body, /<html/i);
    assert.match(runtime.ready.body, /DeepSeek Harness/i);
    assert.match(runtime.ready.body, /__DSH_BOOT__/);
    const probe = await new Promise((resolve, reject) => {
      http.get(runtime.origin, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      }).on('error', reject);
    });
    assert.ok(probe.status >= 200 && probe.status < 400);
    assert.match(probe.body, /<html/i);
    assert.match(probe.body, /DeepSeek Harness/i);
    assert.match(probe.body, /__DSH_BOOT__/);
  } finally {
    const pid = runtime.child.pid;
    await stopChild(runtime.child);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && pidAlive(pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});
