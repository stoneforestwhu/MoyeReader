import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDemo } from './demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await Promise.all(['dist', 'assets', 'test-output'].map(dir => mkdir(path.join(root, dir), { recursive: true })));
await build({ entryPoints: [path.join(root, 'src/renderer.js')], bundle: true, outfile: path.join(root, 'dist/renderer.js'), platform: 'browser', target: 'chrome140', sourcemap: false, minify: true, legalComments: 'eof', define: { global: 'globalThis' } });
await Promise.all(['index.html', 'styles.css'].map(file => copyFile(path.join(root, 'src', file), path.join(root, 'dist', file))));
await writeFile(path.join(root, 'assets/山海之间.epub'), await makeDemo());
await writeFile(path.join(root, 'test-output/epub2-fixture.epub'), await makeDemo(2));

function inside(x, y, points) {
  let yes = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}
function iconBitmap(size) {
  const maskStride = Math.ceil(size / 32) * 4, pixels = Buffer.alloc(size * size * 4), mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / size * 100, py = (y + .5) / size * 100;
    const cx = Math.max(18, Math.min(82, px)), cy = Math.max(18, Math.min(82, py));
    const visible = (px - cx) ** 2 + (py - cy) ** 2 < 17 ** 2;
    let color = [65, 105, 81];
    if (inside(px, py, [[20, 26], [39, 26], [50, 33], [50, 78], [39, 70], [20, 70]])) color = [197, 215, 190];
    if (inside(px, py, [[53, 33], [65, 24], [82, 24], [82, 69], [66, 69], [53, 78]])) color = [246, 247, 234];
    if (px > 27 && px < 40 && ((py > 39 && py < 41) || (py > 48 && py < 50))) color = [65, 105, 81];
    const i = ((size - 1 - y) * size + x) * 4; pixels[i] = color[2]; pixels[i + 1] = color[1]; pixels[i + 2] = color[0]; pixels[i + 3] = visible ? 255 : 0;
    if (!visible) mask[(size - 1 - y) * maskStride + Math.floor(x / 8)] |= 0x80 >> (x % 8);
  }
  const header = Buffer.alloc(40); header.writeUInt32LE(40); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(pixels.length + mask.length, 20);
  return Buffer.concat([header, pixels, mask]);
}
const sizes = [32, 48, 256], bitmaps = sizes.map(iconBitmap), header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4); let offset = header.length;
sizes.forEach((size, i) => { const p = 6 + i * 16; header[p] = size === 256 ? 0 : size; header[p + 1] = header[p]; header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6); header.writeUInt32LE(bitmaps[i].length, p + 8); header.writeUInt32LE(offset, p + 12); offset += bitmaps[i].length; });
await writeFile(path.join(root, 'assets/icon.ico'), Buffer.concat([header, ...bitmaps]));
console.log('Built reader, icon, EPUB 3 demo, and EPUB 2 fixture.');
