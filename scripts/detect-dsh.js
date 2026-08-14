'use strict';

/**
 * CLI used by the NSIS setup page and by tests.
 * Prints one line: FOUND|<path>  or  MISSING|<hint>
 */
const fs = require('node:fs');
const path = require('node:path');

function loadLifecycle() {
  const here = [
    path.join(__dirname, 'lifecycle.js'),
    path.join(__dirname, '..', 'src', 'lifecycle.js'),
  ];
  for (const file of here) {
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error('lifecycle.js not found next to detect-dsh.js');
}

const { detectInstalledDsh, DSH_INSTALL_HINT } = loadLifecycle();
const mergeWindowsPath = process.env.DSH_DETECT_MERGE_WINDOWS === '0' ? false : undefined;
const explicitPath = process.env.DSH_DETECT_PATH;
const explicitBin = process.env.DSH_BIN === '' ? null : undefined;
const result = detectInstalledDsh({
  bin: explicitBin,
  path: explicitPath,
  mergeWindowsPath,
});
const status = result.found ? 'FOUND' : 'MISSING';
const detail = result.found ? result.path : (result.install || DSH_INSTALL_HINT);
const line = `${status}|${detail}\n`;
process.stdout.write(line);
const outFile = process.env.DSH_DETECT_OUT;
if (outFile) {
  fs.writeFileSync(outFile, `${status}\n${detail}\n`, 'utf8');
}
process.exit(result.found ? 0 : 2);
