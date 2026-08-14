'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  installSpec,
  isDshPluginManifest,
  matchInstalledName,
  parseMarketplaceCatalog,
  recommendedSpecFromReadme,
  repositoryName,
} = require('../src/marketplace/catalog');
const {
  approveIgnoredBuilds,
  ignoredBuildNames,
  inspectInstalled,
  pluginArgs,
  profileDir,
  readInstalledIds,
} = require('../src/marketplace/profile');

test('parseMarketplaceCatalog accepts the public dsh-suite schema', () => {
  const catalog = parseMarketplaceCatalog({
    _meta: { schema_version: '1.0', generated_at: '2026-08-13T00:00:00Z' },
    plugins: [
      {
        id: 'dsh-better-sidebar',
        name: 'DSH-better-sidebar',
        repo: 'omdsh-dev/DSH-better-sidebar',
        url: 'https://github.com/omdsh-dev/DSH-better-sidebar',
        category: 'ui',
        description: { zh: '侧边栏工作台', en: 'sidebar' },
        featured: true,
        stars: 19,
        npm: null,
      },
    ],
  }, ['@omdsh/dsh-better-sidebar']);
  assert.equal(catalog.plugins.length, 1);
  assert.equal(catalog.plugins[0].repository, 'omdsh-dev/DSH-better-sidebar');
  assert.equal(catalog.plugins[0].spec, 'github:omdsh-dev/DSH-better-sidebar');
  assert.equal(catalog.plugins[0].installed, true);
  assert.equal(catalog.generatedAt, '2026-08-13T00:00:00Z');
});

test('parseMarketplaceCatalog rejects unknown payloads', () => {
  assert.throws(() => parseMarketplaceCatalog({ hello: true }), /unsupported plugin catalog/);
});

test('installSpec prefers npm then github repo', () => {
  assert.equal(installSpec({ npm: '@scope/pkg', repository: 'a/b' }), '@scope/pkg');
  assert.equal(installSpec({ repository: 'a/b' }), 'github:a/b');
});

test('repositoryName normalizes GitHub URLs', () => {
  assert.equal(repositoryName('https://github.com/Foo/Bar.git'), 'Foo/Bar');
  assert.equal(repositoryName('not a repo'), null);
});

test('isDshPluginManifest requires a cordis/dsh bundle or client entry', () => {
  assert.equal(isDshPluginManifest({ dsh: { bundle: { patch: './cordis.patch.yml' } } }), true);
  assert.equal(isDshPluginManifest({ dsh: { client: { platform: 'web' } } }), true);
  assert.equal(isDshPluginManifest({ name: 'dsh-web-ui', private: true, dsh: { profile: { bundles: [] } } }), false);
  assert.equal(isDshPluginManifest({ name: 'dsh-web-ui', private: true }), false);
});

test('recommendedSpecFromReadme prefers the aggregate npm package', () => {
  const spec = recommendedSpecFromReadme(`
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board
dsh plugin --profile web add @linxin666/dsh-web-ui-all
`);
  assert.equal(spec, '@linxin666/dsh-web-ui-all');
});

test('matchInstalledName treats scoped -all packages as the catalog plugin', () => {
  assert.equal(
    matchInstalledName({ id: 'dsh-web-ui', repository: 'zhu1090093659/dsh-web-ui' }, ['@linxin666/dsh-web-ui-all']),
    '@linxin666/dsh-web-ui-all',
  );
});

test('inspectInstalled marks a monorepo checkout as not mountable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-inspect-'));
  const pkgDir = path.join(dir, 'node_modules', 'dsh-web-ui');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'dsh-web-ui', private: true }));
  fs.writeFileSync(path.join(pkgDir, 'README.md'), 'dsh plugin --profile web add @linxin666/dsh-web-ui-all\n');
  const info = inspectInstalled(dir, 'dsh-web-ui');
  assert.equal(info.mountable, false);
  assert.equal(info.recommendedSpec, '@linxin666/dsh-web-ui-all');
});

test('approveIgnoredBuilds writes pnpm allowBuilds for blocked scripts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-builds-'));
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  const log = '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, ssh2@1.17.0';
  assert.deepEqual(ignoredBuildNames(log), ['cloudflared', 'cpu-features', 'ssh2']);
  assert.equal(approveIgnoredBuilds(dir, log), true);
  const yaml = fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(yaml, /cloudflared: true/);
  assert.match(yaml, /cpu-features: true/);
  assert.match(yaml, /ssh2: true/);
});

test('pluginArgs maps install/uninstall to dsh plugin pnpm verbs', () => {
  assert.deepEqual(pluginArgs('install', 'github:a/b'), ['add', 'github:a/b']);
  assert.deepEqual(pluginArgs('uninstall', '@scope/pkg'), ['remove', '@scope/pkg']);
});

test('readInstalledIds reads the web profile package.json dependencies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-profile-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    dependencies: { '@demo/plugin': '1.0.0' },
  }));
  assert.deepEqual(readInstalledIds(dir), ['@demo/plugin']);
  assert.match(profileDir('web', { DSH_HOME: 'C:\\tmp\\dsh-home' }), /profiles[\\/]web$/);
});

test('shell integrates 插件广场 into the main window top bar', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /openMarketplace/);
  assert.match(main, /plaza:show/);
  assert.match(main, /plaza-bar\.html/);
  assert.match(main, /marketplace\.html/);
  assert.match(main, /harnessView/);
  assert.match(main, /plazaView/);
  assert.match(main, /setTopBrowserView/);
  assert.match(main, /setBackgroundThrottling\(false\)/);
  assert.match(main, /market:repair/);
  assert.match(main, /restartHarness/);
  const market = fs.readFileSync(path.join(__dirname, '..', 'src', 'marketplace.html'), 'utf8');
  assert.match(market, /修复并启用/);
  assert.match(market, /未挂载/);
  const chrome = fs.readFileSync(path.join(__dirname, '..', 'src', 'chrome.js'), 'utf8');
  assert.match(chrome, /插件广场/);
  assert.match(chrome, /hostChromeLayout/);
  const bar = fs.readFileSync(path.join(__dirname, '..', 'src', 'plaza-bar.html'), 'utf8');
  assert.match(bar, /插件广场/);
  assert.match(bar, /api\.show\('plaza'\)/);
  assert.match(bar, /api\.onActive/);
  assert.match(bar, /overflow:\s*hidden/);
  assert.match(bar, /::-webkit-scrollbar/);
  assert.match(bar, /data-theme/);
  assert.match(bar, /theme\.onSet/);
  assert.match(market, /data-theme="dark"/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'marketplace.html')), true);
});
