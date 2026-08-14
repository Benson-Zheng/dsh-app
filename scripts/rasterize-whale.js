'use strict';

/**
 * Rasterize the official black-whale mark onto a white field so Windows
 * taskbar / tray / installer icons read as a whale, not a black square.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..', 'assets');

function extractWhalePath(svgText) {
  const match = /<path\b[^>]*\sd="([^"]+)"/.exec(String(svgText));
  if (!match) throw new Error('whale.svg is missing a path');
  return match[1];
}

function composeWhaleMarkSvg(sourceSvg, size = 256, pad = 28) {
  const d = extractWhalePath(sourceSvg);
  const inner = size - pad * 2;
  const scale = inner / 50;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<g transform="translate(${pad} ${pad}) scale(${scale})">`,
    `<path fill="#000000" fill-rule="nonzero" d="${d}"/>`,
    `</g></svg>`,
    '',
  ].join('');
}

function pngAt(svgText, size) {
  return new Resvg(composeWhaleMarkSvg(svgText, size, Math.round(size * 28 / 256)), {
    fitTo: { mode: 'width', value: size },
    background: '#ffffff',
  }).render().asPng();
}

function toneCounts(pixels) {
  let light = 0;
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 16) continue;
    const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    if (luma > 200) light += 1;
    else if (luma < 40) dark += 1;
  }
  return { light, dark };
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

function writeAppIcons(assetsDir = root) {
  const svg = fs.readFileSync(path.join(assetsDir, 'whale.svg'), 'utf8');
  const png256 = pngAt(svg, 256);
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), png256);
  const ico = writeIco([pngAt(svg, 16), pngAt(svg, 32), pngAt(svg, 48), png256]);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), ico);
  return { pngBytes: png256.length, icoBytes: ico.length };
}

if (require.main === module) {
  const wrote = writeAppIcons();
  process.stdout.write(`wrote icon.png ${wrote.pngBytes} icon.ico ${wrote.icoBytes}\n`);
}

module.exports = {
  composeWhaleMarkSvg,
  extractWhalePath,
  pngAt,
  toneCounts,
  writeAppIcons,
};
