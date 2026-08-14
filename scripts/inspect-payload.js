'use strict';

/**
 * List packaged/unpacked payload and fail if a frozen dsh runtime is shipped.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const setup = path.join(root, 'dist', 'dsh-app-setup.exe');
const portable = path.join(root, 'dist', 'dsh-app.exe');
const asar = path.join(unpacked, 'resources', 'app.asar');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isFrozenDsh(file) {
  const rel = path.relative(unpacked, file).replace(/\\/g, '/').toLowerCase();
  const base = path.basename(file).toLowerCase();
  if (rel.includes('node_modules/@deepseek-ai/dsh')) return true;
  if (rel.includes('node_modules/@deepseek-ai\\dsh')) return true;
  if (base === 'dsh.exe' || base === 'dsh.cmd' || base === 'dsh') return true;
  return false;
}

const files = walk(unpacked);
const frozen = files.filter(isFrozenDsh);
const listing = files.map((f) => path.relative(unpacked, f).replace(/\\/g, '/'));

const report = {
  unpackedDir: unpacked,
  unpackedExists: fs.existsSync(unpacked),
  installer: setup,
  installerExists: fs.existsSync(setup),
  installerBytes: fs.existsSync(setup) ? fs.statSync(setup).size : 0,
  portable: portable,
  portableExists: fs.existsSync(portable),
  asarExists: fs.existsSync(asar),
  fileCount: listing.length,
  sample: listing.filter((n) => !n.includes('/locales/')).slice(0, 40),
  frozenDshMatches: frozen.map((f) => path.relative(unpacked, f)),
  shellOnly: frozen.length === 0,
};

const text = [
  'dsh-app installer / payload inspection',
  `unpacked: ${report.unpackedExists} ${unpacked}`,
  `installer: ${report.installerExists} ${setup} (${report.installerBytes} bytes)`,
  `portable: ${report.portableExists} ${portable}`,
  `asar: ${report.asarExists} ${asar}`,
  `files: ${report.fileCount}`,
  'payload (non-locale sample):',
  ...report.sample.map((n) => `  ${n}`),
  `frozen dsh runtime matches: ${report.frozenDshMatches.length}`,
  ...report.frozenDshMatches.map((n) => `  FROZEN ${n}`),
  report.shellOnly
    ? 'SHELL_ONLY_OK: installer/unpacked payload does not ship a dsh runtime'
    : 'SHELL_ONLY_FAIL: packaged dsh binary would block independent updates',
  '',
].join('\n');

process.stdout.write(text);
if (!report.shellOnly) process.exit(1);
