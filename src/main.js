'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserView, BrowserWindow, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const { DshAppError, installUserDsh, startDshWeb, stopChild } = require('./lifecycle');
const {
  inspectAfterInstall,
  loadSnapshot,
  profileDir,
  resolveInstallableSpec,
  runProfilePlugin,
  settingsFile,
} = require('./marketplace/profile');
const {
  DARK_CHROME,
  LIGHT_CHROME,
  attachCloseHidesToTray,
  hostChromeLayout,
  hostThemeOverlay,
  readThemePreferenceFromYaml,
  resolveHostTheme,
  resolveIconPath,
  setupTray,
  showMainWindow,
  windowChromeOptions,
} = require('./chrome');

const PRODUCT_NAME = 'dsh app';

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('electron').BrowserView | null} */
let barView = null;
/** @type {import('electron').BrowserView | null} */
let harnessView = null;
/** @type {import('electron').BrowserView | null} */
let plazaView = null;
let surface = 'harness';
/** @type {Promise<void> | null} */
let plazaLoad = null;
/** @type {import('electron').Tray | null} */
let tray = null;
/** @type {import('node:child_process').ChildProcess | null} */
let dshChild = null;
let quitting = false;
let origin = null;
let hostTheme = 'light';
/** @type {import('node:fs').FSWatcher | null} */
let settingsWatcher = null;

function isQuitting() {
  return quitting;
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function readyFilePath() {
  return parseArg('ready-file')
    || process.env.DSH_APP_READY_FILE
    || path.join(app.getPath('userData'), 'runtime.json');
}

function writeReadyFile(payload) {
  const file = readyFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[dsh-app] failed to write ready file', err);
  }
}

function resolveIcon() {
  const file = resolveIconPath();
  if (!file) return nativeImage.createEmpty();
  try {
    const buf = fs.readFileSync(file);
    const image = nativeImage.createFromBuffer(buf);
    if (!image.isEmpty()) return image;
  } catch {
    /* fall through */
  }
  try {
    return nativeImage.createFromPath(file);
  } catch {
    return nativeImage.createEmpty();
  }
}

function viewPrefs(opts = {}) {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: opts.backgroundThrottling !== false,
  };
}

function makeContentView() {
  const view = new BrowserView({ webPreferences: viewPrefs({ backgroundThrottling: false }) });
  view.setBackgroundColor('#ffffff');
  view.setAutoResize({ width: true, height: true });
  view.webContents.setBackgroundThrottling(false);
  return view;
}

function activeContentView() {
  return surface === 'plaza' ? plazaView : harnessView;
}

function layoutHostChrome() {
  if (!mainWindow || mainWindow.isDestroyed() || !barView || !harnessView || !plazaView) return;
  const { width, height } = mainWindow.getContentBounds();
  const layout = hostChromeLayout(width, height);
  barView.setBounds(layout.bar);
  harnessView.setBounds(layout.content);
  plazaView.setBounds(layout.content);
  const top = activeContentView();
  if (top && !top.webContents.isDestroyed()) {
    mainWindow.setTopBrowserView(top);
  }
}

function readSettingsPreference() {
  try {
    return readThemePreferenceFromYaml(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return 'system';
  }
}

function themeFromSettings() {
  return resolveHostTheme(readSettingsPreference(), nativeTheme.shouldUseDarkColors);
}

function chromeColor() {
  return hostTheme === 'dark' ? DARK_CHROME : LIGHT_CHROME;
}

function pushHostTheme() {
  const theme = hostTheme === 'dark' ? 'dark' : 'light';
  const color = chromeColor();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(color);
    try {
      mainWindow.setTitleBarOverlay(hostThemeOverlay(theme));
    } catch {
      /* overlay may be unavailable on some hosts */
    }
  }
  for (const view of [barView, harnessView, plazaView]) {
    if (view) view.setBackgroundColor(color);
  }
  for (const view of [barView, plazaView]) {
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send('theme:set', theme);
    }
  }
}

function applyHostTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (next === hostTheme) {
    pushHostTheme();
    return;
  }
  hostTheme = next;
  pushHostTheme();
}

function syncThemeFromSettings() {
  applyHostTheme(themeFromSettings());
}

const HARNESS_THEME_WATCH = `(() => {
  if (window.__dshHostThemeWatch) return window.document.body
    && window.document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
  window.__dshHostThemeWatch = true;
  const report = () => {
    const dark = !!(window.document.body && window.document.body.hasAttribute('data-ds-dark-theme'))
      || String(window.document.documentElement.style.colorScheme || '').includes('dark');
    if (window.dshApp && window.dshApp.theme && window.dshApp.theme.report) {
      window.dshApp.theme.report(dark ? 'dark' : 'light');
    }
  };
  const opts = { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] };
  if (window.document.documentElement) new MutationObserver(report).observe(window.document.documentElement, opts);
  if (window.document.body) new MutationObserver(report).observe(window.document.body, opts);
  report();
  return window.document.body && window.document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
})()`;

function isHarnessOrigin() {
  if (!origin || !harnessView || harnessView.webContents.isDestroyed()) return false;
  const url = harnessView.webContents.getURL();
  return typeof url === 'string' && url.startsWith(origin);
}

function watchHarnessTheme() {
  if (!isHarnessOrigin()) return;
  harnessView.webContents.executeJavaScript(HARNESS_THEME_WATCH, true).then((live) => {
    if (live === 'dark' || live === 'light') applyHostTheme(live);
  }).catch(() => {});
}

function watchSettingsTheme() {
  if (settingsWatcher) return;
  const file = settingsFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    settingsWatcher = fs.watch(path.dirname(file), { persistent: false }, (_event, name) => {
      if (name && !/settings\.ya?ml$/i.test(String(name))) return;
      setTimeout(syncThemeFromSettings, 150);
    });
  } catch {
    /* settings may not exist yet */
  }
  nativeTheme.on('updated', () => {
    if (readSettingsPreference() === 'system') syncThemeFromSettings();
  });
}

function createWindow() {
  hostTheme = themeFromSettings();
  const icon = resolveIcon();
  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    icon,
    show: true,
    ...windowChromeOptions(hostTheme),
    webPreferences: viewPrefs(),
  });
  mainWindow.setMenuBarVisibility(false);
  attachCloseHidesToTray(mainWindow, { isQuitting });

  barView = new BrowserView({ webPreferences: viewPrefs() });
  harnessView = makeContentView();
  plazaView = makeContentView();
  barView.setBackgroundColor(chromeColor());
  harnessView.setBackgroundColor(chromeColor());
  plazaView.setBackgroundColor(chromeColor());
  mainWindow.addBrowserView(harnessView);
  mainWindow.addBrowserView(plazaView);
  mainWindow.addBrowserView(barView);
  barView.setAutoResize({ width: true, height: false });
  barView.webContents.loadFile(path.join(__dirname, 'plaza-bar.html'));
  barView.webContents.on('did-finish-load', () => {
    notifyPlazaBar();
    pushHostTheme();
  });
  harnessView.webContents.on('did-finish-load', watchHarnessTheme);
  plazaView.webContents.on('did-finish-load', pushHostTheme);
  ensurePlazaLoaded();
  layoutHostChrome();
  watchSettingsTheme();
  mainWindow.on('resize', layoutHostChrome);
  mainWindow.on('closed', () => {
    mainWindow = null;
    barView = null;
    harnessView = null;
    plazaView = null;
    plazaLoad = null;
  });
  return mainWindow;
}

function contentContents() {
  return harnessView && !harnessView.webContents.isDestroyed()
    ? harnessView.webContents
    : mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.webContents
      : null;
}

function ensurePlazaLoaded() {
  if (plazaLoad) return plazaLoad;
  if (!plazaView || plazaView.webContents.isDestroyed()) return Promise.resolve();
  plazaLoad = plazaView.webContents
    .loadFile(path.join(__dirname, 'marketplace.html'))
    .then(() => undefined)
    .catch((err) => {
      plazaLoad = null;
      throw err;
    });
  return plazaLoad;
}

function loadLocal(file, query) {
  const contents = contentContents();
  if (!contents) return;
  const url = new URL(`file://${path.join(__dirname, file)}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return contents.loadURL(url.toString());
}

function showMissingDsh(err) {
  const message = err instanceof DshAppError
    ? err.message
    : (err && err.message) || String(err);
  const code = err && err.code ? err.code : 'DSH_NOT_FOUND';
  console.error(`[dsh-app] ${code}: ${message}`);
  writeReadyFile({
    ok: false,
    code,
    message,
    pid: process.pid,
  });
  return loadLocal('error.html', { code, message });
}

function notifyPlazaBar() {
  if (barView && !barView.webContents.isDestroyed()) {
    barView.webContents.send('plaza:active', surface);
  }
}

function showMainSurface(which) {
  const next = which === 'plaza' ? 'plaza' : 'harness';
  const changed = next !== surface;
  surface = next;
  notifyPlazaBar();
  const ready = surface === 'plaza' ? ensurePlazaLoaded() : Promise.resolve();
  return ready.then(() => {
    layoutHostChrome();
    const top = activeContentView();
    if (changed && top && !top.webContents.isDestroyed()) {
      top.webContents.focus();
    }
  });
}

function openMarketplace() {
  showMainWindow(mainWindow);
  return showMainSurface('plaza');
}

function pluginFail(ran, prefix) {
  const detail = (ran.stderr || ran.stdout || 'dsh plugin 失败').trim();
  const hint = /pnpm not found|pnpm 不是|not recognized/i.test(detail)
    ? `${detail}\n请先安装 pnpm：npm install -g pnpm`
    : detail;
  return {
    ok: false,
    message: prefix ? `${prefix}\n${hint}` : hint,
    command: ran.command,
  };
}

async function restartHarness(reason) {
  console.log(`[dsh-app] restarting dsh web (${reason || 'reload'})`);
  try {
    await stopChild(dshChild);
  } catch (err) {
    console.error('[dsh-app] stopChild failed', err);
  }
  dshChild = null;
  origin = null;
  await bootBackend();
}

async function marketplaceInstall(pluginId, action) {
  const snap = await loadSnapshot();
  const plugin = snap.plugins.find((entry) => entry.id === pluginId);
  if (!plugin) return { ok: false, message: `目录中没有插件 ${pluginId}` };
  const dir = snap.profileDir || profileDir('web');

  if (action === 'uninstall') {
    const spec = plugin.installedName || plugin.spec;
    const ran = runProfilePlugin({ action: 'uninstall', spec });
    if (!ran.ok) return pluginFail(ran);
    await restartHarness('plugin uninstall');
    return { ok: true, message: `已卸载 ${spec} 并重启 dsh web`, command: ran.command, restarted: true };
  }

  if (action === 'repair' && plugin.installedName) {
    runProfilePlugin({ action: 'uninstall', spec: plugin.installedName });
  }

  const resolved = await resolveInstallableSpec(plugin);
  let spec = action === 'repair'
    ? (plugin.recommendedSpec || resolved.spec)
    : resolved.spec;
  let ran = runProfilePlugin({ action: 'install', spec });
  if (!ran.ok) return pluginFail(ran);

  const info = inspectAfterInstall(dir, plugin);
  if (info.installedName && !info.mountable && info.recommendedSpec && info.recommendedSpec !== spec) {
    runProfilePlugin({ action: 'uninstall', spec: info.installedName });
    spec = info.recommendedSpec;
    ran = runProfilePlugin({ action: 'install', spec });
    if (!ran.ok) {
      return pluginFail(ran, `GitHub 仓库源码无法挂载，改装 ${spec} 失败`);
    }
  } else if (info.installedName && !info.mountable) {
    await restartHarness('plugin install');
    return {
      ok: false,
      message: `已下载 ${info.installedName}，但它不是可挂载的 dsh 插件（缺少 dsh.bundle.patch）。请改用仓库 README 里的 npm 包名。`,
      command: ran.command,
      restarted: true,
    };
  }

  await restartHarness(action === 'repair' ? 'plugin repair' : 'plugin install');
  await showMainSurface('harness');
  return {
    ok: true,
    message: `已安装 ${spec} 并重启 dsh web，切到会话即可看到插件`,
    command: ran.command,
    spec,
    restarted: true,
  };
}

async function quitApp() {
  if (quitting) return;
  quitting = true;
  try {
    await stopChild(dshChild);
  } catch (err) {
    console.error('[dsh-app] stopChild failed', err);
  }
  dshChild = null;
  if (tray) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
  app.quit();
}

async function bootBackend() {
  await loadLocal('splash.html');
  try {
    const runtime = await startDshWeb({
      host: '127.0.0.1',
      readyTimeoutMs: Number(process.env.DSH_APP_READY_TIMEOUT_MS || 90_000),
    });
    dshChild = runtime.child;
    origin = runtime.origin;
    console.log(`DSH_APP_ORIGIN=${origin}`);
    writeReadyFile({
      ok: true,
      origin,
      port: runtime.port,
      host: runtime.host,
      pid: process.pid,
      childPid: runtime.child.pid,
      command: runtime.command,
    });
    if (harnessView && !harnessView.webContents.isDestroyed()) {
      await harnessView.webContents.loadURL(origin);
      watchHarnessTheme();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(PRODUCT_NAME);
    }
  } catch (err) {
    await showMissingDsh(err);
  }
  await captureHostIfRequested();
}

async function captureHostIfRequested() {
  const dir = parseArg('capture-dir') || process.env.DSH_APP_CAPTURE_DIR;
  if (!dir || !mainWindow || mainWindow.isDestroyed()) return;
  fs.mkdirSync(dir, { recursive: true });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (view, name) => {
    if (!view || view.webContents.isDestroyed()) return;
    const image = await view.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name), image.toPNG());
  };
  await pause(800);
  const { width, height } = mainWindow.getContentBounds();
  fs.writeFileSync(path.join(dir, 'layout.json'), `${JSON.stringify({
    surface,
    bounds: { width, height },
    layout: hostChromeLayout(width, height),
    barText: barView && !barView.webContents.isDestroyed()
      ? await barView.webContents.executeJavaScript('document.body.innerText')
      : null,
  }, null, 2)}\n`);
  await shot(barView, 'bar.png');
  await shot(harnessView, 'content.png');
  const windowImage = await mainWindow.capturePage();
  fs.writeFileSync(path.join(dir, 'window.png'), windowImage.toPNG());
  await showMainSurface('plaza');
  await pause(800);
  await shot(plazaView, 'plaza.png');
  const plazaWindow = await mainWindow.capturePage();
  fs.writeFileSync(path.join(dir, 'window-plaza.png'), plazaWindow.toPNG());
  await showMainSurface('harness');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow(mainWindow);
  });

  ipcMain.handle('dsh:install', async () => installUserDsh());
  ipcMain.handle('dsh:retry-boot', async () => {
    await bootBackend();
    return { ok: true };
  });
  ipcMain.handle('market:snapshot', async () => loadSnapshot());
  ipcMain.handle('market:install', async (_event, pluginId) => marketplaceInstall(String(pluginId || ''), 'install'));
  ipcMain.handle('market:uninstall', async (_event, pluginId) => marketplaceInstall(String(pluginId || ''), 'uninstall'));
  ipcMain.handle('market:repair', async (_event, pluginId) => marketplaceInstall(String(pluginId || ''), 'repair'));
  ipcMain.handle('market:open-url', async (_event, url) => {
    if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('plaza:show', async (_event, which) => {
    await showMainSurface(which);
    return { ok: true, surface };
  });
  ipcMain.on('theme:report', (event, theme) => {
    if (!harnessView || event.sender !== harnessView.webContents) return;
    if (!isHarnessOrigin()) return;
    if (theme === 'dark' || theme === 'light') applyHostTheme(theme);
  });

  app.whenReady().then(async () => {
    app.setName(PRODUCT_NAME);
    createWindow();
    tray = setupTray(require('electron'), {
      icon: resolveIcon(),
      tooltip: PRODUCT_NAME,
      getWindow: () => mainWindow,
      onQuit: quitApp,
      onMarketplace: openMarketplace,
    });
    await bootBackend();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    void quitApp();
  });

  app.on('window-all-closed', () => {
    // Tray keeps the process alive until Quit.
  });
}

module.exports = {
  quitApp,
  showMissingDsh,
};
