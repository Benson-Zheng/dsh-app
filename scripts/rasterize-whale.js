'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(root, 'whale.svg'));

function pngAt(size) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  }).render().asPng();
}

function writeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  const chunks = [header];
  pngs.forEach((png, i) => {
    const size = [16, 32, 48, 256][i];
    const entry = 6 + i * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    chunks.push(png);
    offset += png.length;
  });
  return Buffer.concat(chunks);
}

const png256 = pngAt(256);
fs.writeFileSync(path.join(root, 'icon.png'), png256);
const ico = writeIco([pngAt(16), pngAt(32), pngAt(48), png256]);
fs.writeFileSync(path.join(root, 'icon.ico'), ico);
process.stdout.write(`wrote icon.png ${png256.length} icon.ico ${ico.length}\n`);
