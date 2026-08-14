'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
fs.mkdirSync(build, { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'lifecycle.js'), path.join(build, 'lifecycle.js'));
fs.copyFileSync(path.join(root, 'scripts', 'detect-dsh.js'), path.join(build, 'detect-dsh.js'));
fs.copyFileSync(path.join(root, 'scripts', 'install-dsh.js'), path.join(build, 'install-dsh.js'));
process.stdout.write(`prepared detect-dsh.js, install-dsh.js, and lifecycle.js\n`);
