'use strict';

/**
 * Public catalog parser adapted from Oh-DSH-Desktop
 * `@oh-dsh/plugin-marketplace` (whyihaveyou/dsh-suite + legacy schemas).
 */

const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/whyihaveyou/dsh-suite/main/data/plugins.json';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function validRepositoryPart(value) {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value);
}

function repositoryName(value) {
  const text = cleanString(value);
  if (text === null) return null;
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(text);
  if (!match || !validRepositoryPart(match[1]) || !validRepositoryPart(match[2])) return null;
  return `${match[1]}/${match[2]}`;
}

function tags(value) {
  return Array.isArray(value)
    ? value.flatMap((tag) => (cleanString(tag) ? [cleanString(tag)] : [])).slice(0, 16)
    : [];
}

function communityRows(value) {
  if (!isRecord(value._meta) || value._meta.schema_version !== '1.0' || !Array.isArray(value.plugins)) {
    return null;
  }
  return value.plugins.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = cleanString(candidate.id);
    const repository = repositoryName(candidate.repo) ?? repositoryName(candidate.url);
    if (id === null || !validRepositoryPart(id) || repository === null) return [];
    const description = isRecord(candidate.description)
      ? cleanString(candidate.description.zh) ?? cleanString(candidate.description.en)
      : cleanString(candidate.description);
    const npm = cleanString(candidate.npm);
    return [{
      id,
      title: cleanString(candidate.name) ?? id,
      description: description ?? '暂无描述',
      category: cleanString(candidate.category) ?? 'other',
      repository,
      url: cleanString(candidate.url) ?? `https://github.com/${repository}`,
      npm,
      featured: candidate.featured === true,
      stars: typeof candidate.stars === 'number' ? candidate.stars : 0,
      tags: tags(candidate.tags),
    }];
  });
}

function legacyRows(value) {
  if (value.schema !== 'dsh-external-hub/v0.1' || !Array.isArray(value.repos)) return null;
  return value.repos.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = cleanString(candidate.name);
    if (id === null || !validRepositoryPart(id) || candidate.hide === true || candidate.empty === true) {
      return [];
    }
    const repository = repositoryName(candidate.repo) ?? repositoryName(candidate.url) ?? `dsh-external/${id}`;
    return [{
      id,
      title: id,
      description: cleanString(candidate.note) ?? cleanString(candidate.description) ?? '暂无描述',
      category: cleanString(candidate.category) ?? 'other',
      repository,
      url: `https://github.com/${repository}`,
      npm: null,
      featured: false,
      stars: 0,
      tags: tags(candidate.tags),
    }];
  });
}

/**
 * @param {unknown} value
 * @param {string[]} [installedIds]
 */
function parseMarketplaceCatalog(value, installedIds = []) {
  if (!isRecord(value)) throw new Error('unsupported plugin catalog');
  const rows = communityRows(value) ?? legacyRows(value);
  if (rows === null) throw new Error('unsupported plugin catalog');
  const plugins = rows.map((row) => {
    const installedName = matchInstalledName(row, installedIds);
    return {
      ...row,
      installed: Boolean(installedName),
      installedName,
      spec: installSpec(row),
    };
  });
  plugins.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.stars - a.stars) || a.title.localeCompare(b.title, 'zh');
  });
  const generatedAt = isRecord(value._meta) ? cleanString(value._meta.generated_at) : null;
  return { generatedAt, plugins };
}

function isDshPluginManifest(pkg) {
  if (!isRecord(pkg) || !isRecord(pkg.dsh)) return false;
  if (isRecord(pkg.dsh.bundle) && cleanString(pkg.dsh.bundle.patch)) return true;
  if (isRecord(pkg.dsh.client)) return true;
  return false;
}

function recommendedSpecFromReadme(text) {
  const matches = [];
  const re = /dsh plugin(?:\s+--profile\s+\S+)?\s+add\s+([^\s`"'<]+)/gi;
  let hit;
  while ((hit = re.exec(String(text || '')))) {
    const spec = hit[1].replace(/[。．，,]+$/u, '');
    if (!spec || spec.startsWith('link:') || spec.startsWith('github:') || spec.startsWith('.')) continue;
    if (!/^(@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(spec)) continue;
    matches.push(spec);
  }
  return matches.find((spec) => /-all$/.test(spec)) || matches[0] || null;
}

function packageBaseName(name) {
  const text = String(name || '');
  return (text.includes('/') ? text.slice(text.lastIndexOf('/') + 1) : text).toLowerCase();
}

function matchInstalledName(plugin, installedIds) {
  const names = installedIds || [];
  if (plugin.npm) {
    const exact = names.find((name) => String(name).toLowerCase() === plugin.npm.toLowerCase());
    if (exact) return exact;
  }
  const short = (plugin.repository ? plugin.repository.split('/')[1] : plugin.id).toLowerCase();
  const id = String(plugin.id || '').toLowerCase();
  return names.find((name) => {
    const n = String(name).toLowerCase();
    const base = packageBaseName(n);
    return n === id || n === short
      || n.endsWith(`/${short}`) || n.endsWith(`/${id}`)
      || base === short || base === id
      || base === `${short}-all` || base === `${id}-all`;
  }) || null;
}

function installSpec(plugin) {
  if (plugin.npm) return plugin.npm;
  if (plugin.repository) return `github:${plugin.repository}`;
  throw new Error(`plugin ${plugin.id} has no install spec`);
}

function catalogUrl(env = process.env) {
  return env.DSH_MARKETPLACE_CATALOG
    || env.OH_DSH_MARKETPLACE_CATALOG
    || DEFAULT_CATALOG_URL;
}

module.exports = {
  DEFAULT_CATALOG_URL,
  catalogUrl,
  installSpec,
  isDshPluginManifest,
  matchInstalledName,
  parseMarketplaceCatalog,
  recommendedSpecFromReadme,
  repositoryName,
};
