'use strict';

/**
 * CLI used by the NSIS "install dsh" button and first-launch UI.
 * Prints FOUND|<path> or FAILED|<code>|<message>
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
  throw new Error('lifecycle.js not found next to install-dsh.js');
}

const { installUserDsh } = loadLifecycle();
const prefix = process.env.DSH_INSTALL_PREFIX || undefined;
const spec = process.env.DSH_INSTALL_SPEC || undefined;
const npmBin = process.env.DSH_INSTALL_NPM || undefined;
const result = installUserDsh({
  prefix,
  packageSpec: spec,
  npmBin,
  mergeWindowsPath: process.env.DSH_DETECT_MERGE_WINDOWS === '0' ? false : undefined,
  path: process.env.DSH_DETECT_PATH,
});
const line = result.found
  ? `FOUND|${result.path}\n`
  : `FAILED|${result.code}|${(result.message || '').replace(/\r?\n/g, ' ')}\n`;
process.stdout.write(line);
const outFile = process.env.DSH_INSTALL_OUT;
if (outFile) {
  fs.writeFileSync(
    outFile,
    result.found
      ? `FOUND\n${result.path}\n`
      : `FAILED\n${result.code}\n${result.message || ''}\n`,
    'utf8',
  );
}
process.exit(result.found ? 0 : 2);
