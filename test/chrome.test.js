'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  DARK_CHROME,
  HOST_BAR_HEIGHT,
  LIGHT_CHROME,
  OVERLAY_BUTTONS_WIDTH,
  readThemePreferenceFromYaml,
  resolveHostTheme,
  attachCloseHidesToTray,
  hideToTray,
  hostChromeLayout,
  iconAssetPaths,
  resolveIconPath,
  showMainWindow,
  windowChromeOptions,
} = require('../src/chrome');

function fakeWindow() {
  const win = new EventEmitter();
  win.hidden = false;
  win.focused = false;
  win.destroyed = false;
  win.minimized = false;
  win.isDestroyed = () => win.destroyed;
  win.isMinimized = () => win.minimized;
  win.hide = () => { win.hidden = true; };
  win.show = () => { win.hidden = false; };
  win.restore = () => { win.minimized = false; };
  win.focus = () => { win.focused = true; };
  return win;
}

test('close hides to tray and does not destroy the window', () => {
  const win = fakeWindow();
  let quitting = false;
  attachCloseHidesToTray(win, { isQuitting: () => quitting });
  const event = {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  win.emit('close', event);
  assert.equal(event.prevented, true);
  assert.equal(win.hidden, true);
  assert.equal(win.destroyed, false);
});

test('close while quitting does not hide (real exit path)', () => {
  const win = fakeWindow();
  attachCloseHidesToTray(win, { isQuitting: () => true });
  const event = {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  win.emit('close', event);
  assert.equal(event.prevented, false);
  assert.equal(win.hidden, false);
});

test('showMainWindow restores a hidden window', () => {
  const win = fakeWindow();
  hideToTray(win);
  assert.equal(win.hidden, true);
  showMainWindow(win);
  assert.equal(win.hidden, false);
  assert.equal(win.focused, true);
});

test('windowChromeOptions uses light overlay instead of a black title strip', () => {
  const opts = windowChromeOptions();
  assert.equal(opts.backgroundColor.toLowerCase(), LIGHT_CHROME);
  assert.notEqual(opts.backgroundColor.toLowerCase(), '#0b1220');
  assert.equal(opts.titleBarStyle, 'hidden');
  assert.ok(opts.titleBarOverlay);
  assert.equal(opts.titleBarOverlay.height, HOST_BAR_HEIGHT);
  assert.equal(opts.titleBarOverlay.color.toLowerCase(), '#ffffff');
  assert.notEqual(opts.titleBarOverlay.color.toLowerCase(), '#000000');
  assert.notEqual(opts.titleBarOverlay.color.toLowerCase(), '#0b1220');
});

test('windowChromeOptions follows the Harness dark palette', () => {
  const opts = windowChromeOptions('dark');
  assert.equal(opts.backgroundColor.toLowerCase(), DARK_CHROME);
  assert.equal(opts.titleBarOverlay.color.toLowerCase(), DARK_CHROME);
  assert.equal(opts.titleBarOverlay.symbolColor.toLowerCase(), '#f5f5f5');
  assert.notEqual(opts.titleBarOverlay.color.toLowerCase(), '#0b1220');
});

test('resolveHostTheme maps ui-theme preference and system appearance', () => {
  assert.equal(resolveHostTheme('dark', false), 'dark');
  assert.equal(resolveHostTheme('light', true), 'light');
  assert.equal(resolveHostTheme('system', true), 'dark');
  assert.equal(resolveHostTheme('system', false), 'light');
  assert.equal(resolveHostTheme('unknown', true), 'dark');
});

test('readThemePreferenceFromYaml reads the ui-theme block', () => {
  assert.equal(readThemePreferenceFromYaml('ui-theme:\n  preference: dark\n'), 'dark');
  assert.equal(readThemePreferenceFromYaml('# comment\nagent: x\nui-theme:\n  preference: light\n'), 'light');
  assert.equal(readThemePreferenceFromYaml(''), 'system');
});

test('hostChromeLayout puts the plaza bar above the harness surface', () => {
  const layout = hostChromeLayout(1280, 800);
  assert.equal(layout.bar.y, 0);
  assert.equal(layout.bar.height, HOST_BAR_HEIGHT);
  assert.equal(layout.bar.width, 1280 - OVERLAY_BUTTONS_WIDTH);
  assert.equal(layout.content.y, HOST_BAR_HEIGHT);
  assert.equal(layout.content.height, 800 - HOST_BAR_HEIGHT);
  assert.equal(layout.content.width, 1280);
});

test('resolveIconPath points at the official whale mark', () => {
  const assets = iconAssetPaths();
  assert.match(assets.whaleSvg, /whale\.svg$/);
  const svg = fs.readFileSync(assets.whaleSvg, 'utf8');
  assert.match(svg, /M48\.8354 10\.0479/);
  assert.match(svg, /fill="#000000"|fill="#000"/);
  assert.doesNotMatch(svg, /linear-gradient|#38bdf8|#6366f1/);
  const resolved = resolveIconPath();
  assert.ok(resolved);
  assert.ok(
    resolved === assets.png || resolved === assets.ico || resolved === assets.whaleSvg,
  );
  const bytes = fs.readFileSync(resolved);
  assert.ok(bytes.length > 0);
});
