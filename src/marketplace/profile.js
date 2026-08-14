'use strict';

const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findOnPath, resolveDsh, runCommandSync } = require('../lifecycle');
const {
  catalogUrl,
  installSpec,
  isDshPluginManifest,
  matchInstalledName,
  parseMarketplaceCatalog,
  recommendedSpecFromReadme,
} = require('./catalog');

function dshHome(env = process.env) {
  const override = env.DSH_HOME && String(env.DSH_HOME).trim();
  return override || path.join(os.homedir(), '.dsh');
}

function settingsFile(env = process.env) {
  return path.join(dshHome(env), 'settings.yaml');
}

function profileDir(profile = 'web', env = process.env) {
  return path.join(dshHome(env), 'profiles', profile);
}

function readInstalledIds(dir) {
  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return Object.keys(manifest.dependencies || {});
}

function fetchText(url, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'user-agent': 'dsh-app-marketplace' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`GET ${url} timed out`));
    });
  });
}

function fetchJson(url, timeoutMs = 20_000) {
  return fetchText(url, timeoutMs).then((body) => JSON.parse(body));
}

function packageDir(dir, depName) {
  return path.join(dir, 'node_modules', ...String(depName).split('/'));
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function inspectInstalled(dir, depName) {
  const root = packageDir(dir, depName);
  const pkg = readJsonSafe(path.join(root, 'package.json'));
  const mountable = isDshPluginManifest(pkg);
  let recommendedSpec = null;
  if (!mountable && fs.existsSync(root)) {
    for (const name of ['README.md', 'README.zh.md', 'README.en.md']) {
      const file = path.join(root, name);
      if (!fs.existsSync(file)) continue;
      recommendedSpec = recommendedSpecFromReadme(fs.readFileSync(file, 'utf8'));
      if (recommendedSpec) break;
    }
  }
  return {
    mountable,
    recommendedSpec,
    packageName: (pkg && pkg.name) || depName,
  };
}

async function fetchGithubFile(repository, file) {
  const urls = [
    `https://raw.githubusercontent.com/${repository}/HEAD/${file}`,
    `https://raw.githubusercontent.com/${repository}/main/${file}`,
    `https://raw.githubusercontent.com/${repository}/master/${file}`,
  ];
  for (const url of urls) {
    try {
      return await fetchText(url);
    } catch {
      /* try next default branch */
    }
  }
  return null;
}

function inspectAfterInstall(dir, plugin) {
  const installed = readInstalledIds(dir);
  const name = matchInstalledName(plugin, installed);
  if (!name) return { installedName: null, mountable: false, recommendedSpec: null };
  return { installedName: name, ...inspectInstalled(dir, name) };
}

async function resolveInstallableSpec(plugin) {
  if (plugin.npm) return { spec: plugin.npm, source: 'catalog-npm' };
  const fallback = installSpec(plugin);
  if (!plugin.repository) return { spec: fallback, source: 'fallback' };
  const pkgText = await fetchGithubFile(plugin.repository, 'package.json');
  let pkg = null;
  try {
    pkg = pkgText ? JSON.parse(pkgText) : null;
  } catch {
    pkg = null;
  }
  if (isDshPluginManifest(pkg)) {
    return { spec: `github:${plugin.repository}`, source: 'github-plugin' };
  }
  const readme = await fetchGithubFile(plugin.repository, 'README.md');
  const recommended = recommendedSpecFromReadme(readme);
  if (recommended) return { spec: recommended, source: 'readme' };
  return { spec: fallback, source: 'github-fallback' };
}

async function loadSnapshot(opts = {}) {
  const env = opts.env ?? process.env;
  const profile = opts.profile ?? 'web';
  const dir = profileDir(profile, env);
  const installed = readInstalledIds(dir);
  const raw = opts.catalogJson ?? await fetchJson(opts.catalogUrl ?? catalogUrl(env));
  const catalog = parseMarketplaceCatalog(raw, installed);
  const plugins = catalog.plugins.map((plugin) => {
    if (!plugin.installedName) {
      return { ...plugin, mountable: false, recommendedSpec: null };
    }
    return { ...plugin, ...inspectInstalled(dir, plugin.installedName) };
  });
  return {
    profile,
    profileDir: dir,
    generatedAt: catalog.generatedAt,
    installed,
    plugins,
  };
}

function pluginArgs(action, spec) {
  if (action === 'install') return ['add', spec];
  if (action === 'uninstall') return ['remove', spec];
  throw new Error(`unsupported plugin action: ${action}`);
}

function ignoredBuildNames(text) {
  const match = /ERR_PNPM_IGNORED_BUILDS[\s\S]*?Ignored build scripts:\s*([^\n]+)/i.exec(String(text || ''));
  if (!match) return [];
  return match[1].split(',').flatMap((part) => {
    const name = part.trim().replace(/@\d[\w.-]*$/, '');
    return name ? [name] : [];
  });
}

function approveIgnoredBuilds(dir, text) {
  const names = ignoredBuildNames(text);
  if (names.length === 0) return false;
  const file = path.join(dir, 'pnpm-workspace.yaml');
  let yaml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'packages:\n  - .\n';
  if (!/^allowBuilds:\s*$/m.test(yaml) && !/^allowBuilds:/m.test(yaml)) {
    yaml = `${yaml.replace(/\s*$/, '')}\nallowBuilds:\n`;
  }
  let changed = false;
  for (const name of names) {
    const line = `  ${name}: true`;
    const existing = new RegExp(`^  ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm');
    if (existing.test(yaml)) {
      const next = yaml.replace(existing, line);
      if (next !== yaml) {
        yaml = next;
        changed = true;
      }
    } else {
      yaml = yaml.replace(/^(allowBuilds:\s*)$/m, `$1\n${line}`);
      if (!yaml.includes(line)) yaml = `${yaml.replace(/\s*$/, '')}\n${line}\n`;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(file, yaml, 'utf8');
  return changed;
}

function runProfilePlugin(opts) {
  const env = opts.env ?? process.env;
  const profile = opts.profile ?? 'web';
  const dir = opts.profileDirectory ?? profileDir(profile, env);
  const dshBin = opts.dshBin ?? resolveDsh({ env });
  const args = ['plugin', '--profile', profile, ...pluginArgs(opts.action, opts.spec)];
  const runOnce = () => runCommandSync(dshBin, args, {
    env,
    cwd: opts.cwd ?? process.cwd(),
    timeoutMs: opts.timeoutMs ?? 180_000,
  });
  let ran = runOnce();
  const stderr = String(ran.stderr || ran.error?.message || '');
  if ((ran.status !== 0 || ran.error) && /ERR_PNPM_IGNORED_BUILDS/i.test(stderr) && approveIgnoredBuilds(dir, stderr)) {
    ran = runOnce();
  }
  return {
    ok: ran.status === 0 && !ran.error,
    status: ran.status,
    stdout: String(ran.stdout || ''),
    stderr: String(ran.stderr || ran.error?.message || ''),
    command: [dshBin, ...args],
  };
}

function ensurePnpm(env = process.env) {
  const search = env.PATH;
  const found = findOnPath(search, ['pnpm.cmd', 'pnpm'], env);
  return found;
}

module.exports = {
  dshHome,
  ensurePnpm,
  approveIgnoredBuilds,
  inspectAfterInstall,
  inspectInstalled,
  ignoredBuildNames,
  loadSnapshot,
  pluginArgs,
  profileDir,
  readInstalledIds,
  settingsFile,
  resolveInstallableSpec,
  runProfilePlugin,
};
