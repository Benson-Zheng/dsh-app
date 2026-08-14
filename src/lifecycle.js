'use strict';

const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_READY_INTERVAL_MS = 200;
const DEFAULT_STOP_TIMEOUT_MS = 8_000;

class DshAppError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'DshAppError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Directories that belong to this desktop shell. A copy of `dsh` living here
 * is never the runtime — the user updates `dsh` independently (npm -g / PATH).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function bundledAppDirs(env = process.env) {
  const dirs = [];
  if (env.DSH_APP_BUNDLE_DIR) dirs.push(path.resolve(env.DSH_APP_BUNDLE_DIR));
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    dirs.push(path.resolve(process.resourcesPath));
  }
  const exe = path.basename(process.execPath).toLowerCase();
  if (exe === 'dsh app.exe' || exe === 'dsh-app.exe' || exe === 'electron.exe') {
    dirs.push(path.resolve(path.dirname(process.execPath)));
  }
  return dirs;
}

function isInsideDirs(filePath, dirs) {
  const resolved = path.resolve(filePath);
  return dirs.some((dir) => {
    const root = path.resolve(dir);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

/**
 * Locate the user's independently installed `dsh`. Prefers `opts.bin` /
 * `DSH_BIN`, then PATH. Never selects a binary inside the dsh-app bundle
 * (so `npm update -g @deepseek-ai/dsh` is picked up without rebuilding the shell).
 * Skips PowerShell wrappers (`.ps1`) because they are not spawnable without a shell.
 *
 * @param {{ bin?: string | null, path?: string, env?: NodeJS.ProcessEnv, skipDirs?: string[] }} [opts]
 * @returns {string} absolute path to the dsh executable or cmd shim
 */
function resolveDsh(opts = {}) {
  const env = opts.env ?? process.env;
  const skipDirs = [...bundledAppDirs(env), ...(opts.skipDirs ?? [])];
  const explicit = opts.bin !== undefined ? opts.bin : env.DSH_BIN;
  if (explicit && String(explicit).trim()) {
    const resolved = path.resolve(String(explicit));
    if (!isFile(resolved) || isInsideDirs(resolved, skipDirs)) {
      throw new DshAppError(
        'DSH_NOT_FOUND',
        `dsh was not found at ${resolved}. Install or update it with: npm install -g @deepseek-ai/dsh`,
        { path: resolved },
      );
    }
    return resolved;
  }

  const pathEnv = opts.path !== undefined ? opts.path : env.PATH;
  const found = findOnPath(pathEnv, ['dsh.exe', 'dsh.cmd', 'dsh'], env, skipDirs);
  if (!found) {
    throw new DshAppError(
      'DSH_NOT_FOUND',
      'dsh was not found on PATH. Install or update it with: npm install -g @deepseek-ai/dsh',
    );
  }
  return found;
}

const DSH_INSTALL_HINT = 'npm install -g @deepseek-ai/dsh';

/**
 * Read a Windows registry PATH value (user or machine). Empty if unavailable.
 * @param {string} hive
 * @param {string} key
 * @returns {string}
 */
function readWindowsRegPath(hive, key) {
  try {
    const out = execFileSync('reg', ['query', `${hive}\\${key}`, '/v', 'Path'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    const match = String(out).match(/Path\s+REG_\w+\s+([^\r\n]+)/i);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function expandWindowsEnv(value, env) {
  return String(value || '').replace(/%([^%]+)%/gi, (_, name) => {
    const hit = env[name] ?? env[name.toUpperCase()] ?? env[name.toLowerCase()];
    return hit == null ? '' : String(hit);
  });
}

/**
 * User-visible Windows search PATH: process PATH + HKCU + HKLM + `%APPDATA%\npm`.
 * An elevated installer still sees a per-user `npm -g` this way.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function windowsSearchPath(env = process.env) {
  const dirs = [];
  const add = (raw) => {
    for (const part of expandWindowsEnv(raw, env).split(';')) {
      const dir = part.trim();
      if (dir && !dirs.includes(dir)) dirs.push(dir);
    }
  };
  add(env.PATH);
  add(readWindowsRegPath('HKCU', 'Environment'));
  add(readWindowsRegPath('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'));
  if (env.APPDATA) add(path.join(env.APPDATA, 'npm'));
  if (env.LOCALAPPDATA) add(path.join(env.LOCALAPPDATA, 'Programs', 'nodejs'));
  return dirs.join(path.delimiter);
}

/**
 * Detect whether an independently installed `dsh` is already present.
 * Same resolve rules as the host (PATH / DSH_BIN, skip app bundle).
 * Does not throw for a missing binary — returns `{ found: false, code: 'DSH_NOT_FOUND' }`.
 *
 * @param {{ bin?: string | null, path?: string, env?: NodeJS.ProcessEnv, skipDirs?: string[], mergeWindowsPath?: boolean }} [opts]
 * @returns {{ found: boolean, ok: boolean, code: string, path?: string, message?: string, install: string }}
 */
function detectInstalledDsh(opts = {}) {
  const env = opts.env ?? process.env;
  const search = { ...opts, env };
  if (search.path === undefined && process.platform === 'win32' && opts.mergeWindowsPath !== false) {
    search.path = windowsSearchPath(env);
  }
  try {
    const located = resolveDsh(search);
    return {
      ok: true,
      found: true,
      code: 'DSH_FOUND',
      path: located,
      install: DSH_INSTALL_HINT,
    };
  } catch (err) {
    if (err instanceof DshAppError && err.code === 'DSH_NOT_FOUND') {
      return {
        ok: false,
        found: false,
        code: 'DSH_NOT_FOUND',
        message: err.message,
        install: DSH_INSTALL_HINT,
      };
    }
    throw err;
  }
}

/**
 * Directories npm --prefix puts global bins into (Windows + POSIX).
 * @param {string} prefix
 * @returns {string[]}
 */
function npmPrefixBinDirs(prefix) {
  return [
    prefix,
    path.join(prefix, 'bin'),
    path.join(prefix, 'node_modules', '.bin'),
  ];
}

function findNpmExecutable(env, searchPath) {
  return findOnPath(searchPath, ['npm.cmd', 'npm'], env);
}

function runCommandSync(command, args, opts = {}) {
  const timeout = opts.timeoutMs ?? 180_000;
  const common = {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    env: opts.env,
    cwd: opts.cwd,
  };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    // cmd /S /C strips the first and last quote. Wrap the entire line so a
    // path like C:\Program Files\nodejs\npm.cmd stays quoted after that strip
    // (same as Node's shell:true spawn).
    const quoted = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
    const line = `"${command}" ${quoted}`;
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
      ...common,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(command, args, common);
}

/**
 * Install official `@deepseek-ai/dsh` for the user via their `npm`
 * (`npm install -g`). Optional `prefix` targets a user-writable tree so tests
 * and per-user installs do not need admin. Does not copy dsh into the app bundle.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   npmBin?: string,
 *   prefix?: string,
 *   packageSpec?: string,
 *   registry?: string,
 *   path?: string,
 *   mergeWindowsPath?: boolean,
 *   timeoutMs?: number,
 *   cwd?: string,
 * }} [opts]
 */
function installUserDsh(opts = {}) {
  const env = { ...(opts.env ?? process.env) };
  const searchPath = opts.path !== undefined
    ? opts.path
    : (process.platform === 'win32' && opts.mergeWindowsPath !== false
      ? windowsSearchPath(env)
      : env.PATH);
  const npmBin = opts.npmBin || findNpmExecutable(env, searchPath);
  if (!npmBin || !isFile(npmBin)) {
    return {
      ok: false,
      found: false,
      code: 'NPM_NOT_FOUND',
      message: 'npm was not found. Install Node.js first, then retry.',
      install: DSH_INSTALL_HINT,
    };
  }

  const spec = opts.packageSpec || '@deepseek-ai/dsh';
  const args = ['install', '-g', spec, '--no-fund', '--no-audit'];
  if (opts.prefix) args.push('--prefix', opts.prefix);
  if (opts.registry) args.push('--registry', opts.registry);

  const ran = runCommandSync(npmBin, args, {
    env,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
  });
  if (ran.error || ran.status !== 0) {
    const detail = String(ran.stderr || ran.stdout || ran.error?.message || `npm exited ${ran.status}`);
    return {
      ok: false,
      found: false,
      code: 'DSH_INSTALL_FAILED',
      message: detail.slice(0, 2000),
      install: DSH_INSTALL_HINT,
    };
  }

  const detectPath = opts.prefix
    ? npmPrefixBinDirs(opts.prefix).join(path.delimiter)
    : searchPath;
  const detected = detectInstalledDsh({
    bin: null,
    path: detectPath,
    env,
    mergeWindowsPath: opts.prefix ? false : opts.mergeWindowsPath,
  });
  if (!detected.found) {
    return {
      ok: false,
      found: false,
      code: 'DSH_INSTALL_FAILED',
      message: 'npm install finished but dsh was not found on the user prefix',
      install: DSH_INSTALL_HINT,
    };
  }
  return { ...detected, installed: true };
}

/**
 * @param {string | undefined} pathEnv
 * @param {string[]} names
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string[]} [skipDirs]
 * @returns {string | null}
 */
function findOnPath(pathEnv, names, env = process.env, skipDirs = []) {
  const dirs = String(pathEnv || '')
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  const pathext = process.platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];

  for (const dir of dirs) {
    if (isInsideDirs(dir, skipDirs)) continue;
    for (const name of names) {
      const hasExt = path.extname(name) !== '';
      const candidates = hasExt ? [name] : [name, ...pathext.map((ext) => name + ext)];
      for (const candidate of candidates) {
        if (/\.ps1$/i.test(candidate)) continue;
        const full = path.join(dir, candidate);
        if (isInsideDirs(full, skipDirs)) continue;
        if (isFile(full)) return full;
      }
    }
  }
  return null;
}

/**
 * Bind `host:0`, return the OS-assigned port, then close the socket.
 * @param {string} [host]
 * @returns {Promise<number>}
 */
function allocateFreePort(host = DEFAULT_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new DshAppError('PORT_ALLOC_FAILED', 'could not read ephemeral port'));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * Spawn a process, using `cmd.exe /c` for `.cmd`/`.bat` on Windows.
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [opts]
 */
function spawnProcess(command, args, opts = {}) {
  const windowsHide = opts.windowsHide !== false;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const quotedArgs = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
    const line = `"${command}" ${quotedArgs}`;
    return spawn(comspec, ['/d', '/s', '/c', line], {
      ...opts,
      windowsHide,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, { ...opts, windowsHide });
}

/**
 * Spawn `dsh web --host <host> --port <port>`.
 *
 * @param {{
 *   command: string,
 *   argsPrefix?: string[],
 *   host?: string,
 *   port: number,
 *   extraArgs?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   stdio?: import('node:child_process').StdioOptions,
 * }} opts
 */
function spawnDshWeb(opts) {
  const host = opts.host ?? DEFAULT_HOST;
  const args = [
    ...(opts.argsPrefix ?? []),
    'web',
    '--host',
    host,
    '--port',
    String(opts.port),
    ...(opts.extraArgs ?? []),
  ];
  const child = spawnProcess(opts.command, args, {
    env: opts.env ?? process.env,
    cwd: opts.cwd,
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  if (!child.pid) {
    const err = new DshAppError(
      'DSH_SPAWN_FAILED',
      `failed to spawn ${opts.command} ${args.join(' ')}`,
    );
    throw err;
  }
  child.spawnargs = [opts.command, ...args];
  return child;
}

/**
 * GET `origin` until it returns HTML, or throw `DSH_NOT_READY`.
 * @param {string} origin
 * @param {{ timeoutMs?: number, intervalMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ status: number, body: string }>}
 */
async function waitUntilReady(origin, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_READY_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new DshAppError('DSH_NOT_READY', `wait for ${origin} aborted`, { origin });
    }
    try {
      const result = await httpGet(origin, opts.signal);
      if (result.status >= 200 && result.status < 300 && looksLikeHtml(result.body)) {
        return result;
      }
      lastError = new Error(`HTTP ${result.status} without HTML body`);
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }

  throw new DshAppError(
    'DSH_NOT_READY',
    `dsh web did not become ready at ${origin}`,
    { origin, cause: lastError },
  );
}

function looksLikeHtml(body) {
  const text = String(body || '');
  return /<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text);
}

function httpGet(url, signal) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET ${url} timed out`));
    });
    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(new Error('aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Stop a child process. On Windows, `taskkill /T` tears down npm/cmd wrappers
 * and their node descendants so `dsh web` does not linger after Quit.
 *
 * @param {import('node:child_process').ChildProcess | null | undefined} child
 * @param {{ timeoutMs?: number }} [opts]
 */
function stopChild(child, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null || child.signalCode) {
      resolve({ alreadyExited: true, pid: child?.pid ?? null });
      return;
    }

    const pid = child.pid;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ alreadyExited: false, pid });
    };

    child.once('exit', finish);

    if (process.platform === 'win32' && pid) {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', () => {});
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }
    }

    setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish();
    }, timeoutMs).unref?.();
  });
}

/**
 * Resolve binary (unless overridden), pick a free loopback port, spawn
 * `dsh web`, and wait until that origin serves HTML.
 *
 * @param {{
 *   command?: string,
 *   argsPrefix?: string[],
 *   dshBin?: string,
 *   bin?: string | null,
 *   path?: string,
 *   host?: string,
 *   port?: number,
 *   extraArgs?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   readyTimeoutMs?: number,
 *   readyIntervalMs?: number,
 *   signal?: AbortSignal,
 * }} [opts]
 */
async function startDshWeb(opts = {}) {
  const host = opts.host ?? DEFAULT_HOST;
  const command = opts.command
    ?? opts.dshBin
    ?? resolveDsh({ bin: opts.bin, path: opts.path, env: opts.env });
  const port = opts.port ?? await allocateFreePort(host);
  const origin = `http://${host}:${port}`;

  let child;
  try {
    child = spawnDshWeb({
      command,
      argsPrefix: opts.argsPrefix,
      host,
      port,
      extraArgs: opts.extraArgs,
      env: opts.env,
      cwd: opts.cwd,
    });
  } catch (err) {
    if (err instanceof DshAppError) throw err;
    throw new DshAppError('DSH_SPAWN_FAILED', String(err && err.message ? err.message : err), {
      cause: err,
    });
  }

  const logs = { stdout: '', stderr: '' };
  child.stdout?.on('data', (buf) => {
    logs.stdout += buf.toString('utf8');
  });
  child.stderr?.on('data', (buf) => {
    logs.stderr += buf.toString('utf8');
  });

  child.once('error', () => {});

  try {
    const ready = await waitUntilReady(origin, {
      timeoutMs: opts.readyTimeoutMs,
      intervalMs: opts.readyIntervalMs,
      signal: opts.signal,
    });
    return {
      child,
      command,
      host,
      port,
      origin,
      ready,
      logs,
    };
  } catch (err) {
    await stopChild(child);
    if (err instanceof DshAppError) {
      err.logs = logs;
      throw err;
    }
    throw new DshAppError('DSH_NOT_READY', String(err && err.message ? err.message : err), {
      origin,
      cause: err,
      logs,
    });
  }
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_READY_TIMEOUT_MS,
  DSH_INSTALL_HINT,
  DshAppError,
  allocateFreePort,
  bundledAppDirs,
  detectInstalledDsh,
  findNpmExecutable,
  findOnPath,
  installUserDsh,
  npmPrefixBinDirs,
  httpGet,
  looksLikeHtml,
  resolveDsh,
  runCommandSync,
  windowsSearchPath,
  spawnDshWeb,
  spawnProcess,
  startDshWeb,
  stopChild,
  waitUntilReady,
};
