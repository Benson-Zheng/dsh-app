'use strict';

/**
 * Start the desktop entry, wait until it publishes a loopback origin, GET that
 * origin, then tear down the process tree. Used for dual-launch verification.
 *
 * Usage: node scripts/launch-verify.js <logPath> [readyPath] [exeOrElectron]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const logPath = process.argv[2];
const readyPath = process.argv[3] || path.join(path.dirname(logPath), 'ready.json');
const entry = process.argv[4] || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

if (!logPath) {
  console.error('usage: node scripts/launch-verify.js <logPath> [readyPath] [entry]');
  process.exit(2);
}

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  fs.appendFileSync(logPath, text);
  process.stdout.write(text);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET ${url} timed out`));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '');
  try { fs.unlinkSync(readyPath); } catch { /* ok */ }

  const isElectronBin = /electron\.exe$/i.test(entry);
  const args = isElectronBin
    ? [root, `--ready-file=${readyPath}`]
    : [`--ready-file=${readyPath}`];

  log(`spawning ${entry} ${args.join(' ')}`);
  const child = spawn(entry, args, {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  log(`app pid ${child.pid}`);

  const chunks = { out: '', err: '' };
  child.stdout.on('data', (buf) => {
    const s = buf.toString('utf8');
    chunks.out += s;
    fs.appendFileSync(logPath, s);
  });
  child.stderr.on('data', (buf) => {
    const s = buf.toString('utf8');
    chunks.err += s;
    fs.appendFileSync(logPath, s);
  });

  const deadline = Date.now() + 120_000;
  let ready = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(readyPath)) {
      try {
        ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
        if (ready && (ready.origin || ready.ok === false)) break;
      } catch {
        /* still writing */
      }
    }
    if (child.exitCode !== null) {
      throw new Error(`desktop entry exited early with code ${child.exitCode}`);
    }
    await sleep(250);
  }

  if (!ready) throw new Error('timed out waiting for ready file');
  log(`ready file: ${JSON.stringify(ready)}`);

  if (!ready.ok || !ready.origin) {
    throw new Error(`desktop entry failed: ${ready.code || ''} ${ready.message || ''}`);
  }

  const probe = await httpGet(ready.origin);
  log(`GET ${ready.origin} -> HTTP ${probe.status}`);
  log(`body-snippet: ${probe.body.slice(0, 600).replace(/\s+/g, ' ')}`);

  if (probe.status < 200 || probe.status >= 400) {
    throw new Error(`unexpected HTTP ${probe.status}`);
  }
  if (!/__DSH_BOOT__/.test(probe.body) || !/DeepSeek Harness/i.test(probe.body)) {
    throw new Error('response is not the dsh web harness UI');
  }
  log('harness UI confirmed');

  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('exit', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }

  const stopDeadline = Date.now() + 15_000;
  while (Date.now() < stopDeadline && child.exitCode === null) {
    await sleep(100);
  }
  log(`app exitCode=${child.exitCode}`);
  log('VERIFY_OK');
}

main().catch((err) => {
  log(`VERIFY_FAIL ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
