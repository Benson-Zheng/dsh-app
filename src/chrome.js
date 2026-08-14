'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * grok-app-style desktop chrome helpers.
 * Kept as named functions so tray / close-to-tray / quit can be read in source
 * and reused by the Electron main process.
 */

/** Light page chrome — matches DeepSeek Harness, not the old #0b1220 caption. */
const LIGHT_CHROME = '#ffffff';
const LIGHT_SYMBOL = '#171717';
/** Same near-black as Harness dark, not the old navy caption. */
const DARK_CHROME = '#171717';
const DARK_SYMBOL = '#f5f5f5';
const HOST_BAR_HEIGHT = 40;
/** Win11 caption buttons at 40px overlay height — keep BrowserView off them. */
const OVERLAY_BUTTONS_WIDTH = 138;

/**
 * BrowserWindow options that remove the solid black title strip.
 * Hidden native caption + light Windows overlay buttons sit on the white page.
 * @returns {object}
 */
function resolveHostTheme(preference, systemDark) {
  const pref = preference === 'dark' || preference === 'light' || preference === 'system'
    ? preference
    : 'system';
  return pref === 'dark' || (pref === 'system' && systemDark === true) ? 'dark' : 'light';
}

function readThemePreferenceFromYaml(text) {
  const block = /(?:^|\n)ui-theme:\s*\n((?:[ \t].*\n?)*)/.exec(String(text || ''));
  if (!block) return 'system';
  const pref = /(?:^|\n)[ \t]+preference:\s*['"]?([A-Za-z]+)['"]?/.exec(block[1]);
  const value = pref ? pref[1].toLowerCase() : '';
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
}

function hostThemeOverlay(theme = 'light') {
  const dark = theme === 'dark';
  return {
    color: dark ? DARK_CHROME : LIGHT_CHROME,
    symbolColor: dark ? DARK_SYMBOL : LIGHT_SYMBOL,
    height: HOST_BAR_HEIGHT,
  };
}

function windowChromeOptions(theme = 'light') {
  const dark = theme === 'dark';
  return {
    backgroundColor: dark ? DARK_CHROME : LIGHT_CHROME,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: hostThemeOverlay(theme),
  };
}

/**
 * Main window split: host bar on top (plugin plaza entry), harness below.
 * @param {number} width
 * @param {number} height
 * @param {number} [barHeight]
 */
function hostChromeLayout(width, height, barHeight = HOST_BAR_HEIGHT) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const bar = Math.max(0, Math.min(barHeight, safeHeight));
  const overlay = Math.min(OVERLAY_BUTTONS_WIDTH, safeWidth);
  return {
    bar: { x: 0, y: 0, width: Math.max(0, safeWidth - overlay), height: bar },
    content: { x: 0, y: bar, width: safeWidth, height: Math.max(0, safeHeight - bar) },
  };
}

/**
 * Official DeepSeek whale mark (harness favicon path), plus raster fallbacks.
 * @param {string} [assetsDir]
 */
function iconAssetPaths(assetsDir = path.join(__dirname, '..', 'assets')) {
  return {
    whaleSvg: path.join(assetsDir, 'whale.svg'),
    png: path.join(assetsDir, 'icon.png'),
    ico: path.join(assetsDir, 'icon.ico'),
  };
}

/**
 * First existing identity file: raster icon, then official whale SVG.
 * @param {string} [assetsDir]
 * @returns {string | null}
 */
function resolveIconPath(assetsDir) {
  const paths = iconAssetPaths(assetsDir);
  for (const file of [paths.png, paths.ico, paths.whaleSvg]) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Closing the main window hides it and leaves the backend running.
 * @param {import('electron').BrowserWindow} win
 * @param {{ isQuitting: () => boolean }} appState
 */
function attachCloseHidesToTray(win, appState) {
  win.on('close', (event) => {
    if (appState.isQuitting()) return;
    event.preventDefault();
    hideToTray(win);
  });
}

/**
 * @param {import('electron').BrowserWindow | null | undefined} win
 */
function hideToTray(win) {
  if (!win || win.isDestroyed()) return;
  win.hide();
}

/**
 * @param {import('electron').BrowserWindow | null | undefined} win
 */
function showMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * Tray menu: Show window + Quit. Left-click also shows the window (Windows).
 *
 * @param {import('electron')} electron
 * @param {{
 *   icon: import('electron').NativeImage | string,
 *   tooltip?: string,
 *   getWindow: () => import('electron').BrowserWindow | null | undefined,
 *   onQuit: () => void | Promise<void>,
 * }} opts
 */
function setupTray(electron, opts) {
  const { Tray, Menu } = electron;
  const tray = new Tray(opts.icon);
  tray.setToolTip(opts.tooltip || 'dsh app');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => showMainWindow(opts.getWindow()),
    },
    {
      label: '插件广场',
      click: () => {
        if (typeof opts.onMarketplace === 'function') opts.onMarketplace();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        void opts.onQuit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow(opts.getWindow()));
  tray.on('double-click', () => showMainWindow(opts.getWindow()));
  return tray;
}

module.exports = {
  DARK_CHROME,
  DARK_SYMBOL,
  HOST_BAR_HEIGHT,
  LIGHT_CHROME,
  LIGHT_SYMBOL,
  OVERLAY_BUTTONS_WIDTH,
  hostChromeLayout,
  hostThemeOverlay,
  readThemePreferenceFromYaml,
  resolveHostTheme,
  attachCloseHidesToTray,
  hideToTray,
  iconAssetPaths,
  resolveIconPath,
  setupTray,
  showMainWindow,
  windowChromeOptions,
};
