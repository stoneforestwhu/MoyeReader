import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import electron from 'electron';
import { makeDemo } from './demo.mjs';

const root = new URL('../', import.meta.url);
const output = new URL('test-output/pagination-regression/', root);
await mkdir(output, { recursive: true });
const zip = await JSZip.loadAsync(await makeDemo());
for (let chapter = 0; chapter < 3; chapter++) {
  const name = `OEBPS/ch${chapter}.xhtml`;
  const html = await zip.file(name).async('string');
  const paragraphs = Array.from({ length: 21 + chapter * 5 }, (_, i) =>
    `<p>第${chapter + 1}章第${i + 1}段：${'山与海之间，有一些不必赶路的日子。清晨的光落在窗沿，一本书在桌上展开。'.repeat(2 + i % 4)}段落结束${i + 1}。</p>`).join('');
  zip.file(name, html.replace(/<body>[\s\S]*<\/body>/, `<body><h1>第${chapter + 1}章分页测试</h1>${paragraphs}</body>`));
}
await writeFile(new URL('fixture.epub', output), await zip.generateAsync({ type: 'nodebuffer' }));
let source = await readFile(new URL('src/renderer.js', root), 'utf8');
source += '\nwindow.paginationProbe = {state: () => ({rendition, book, loading, location}), turn, display, changeSettings};';
await build({
  stdin: { contents: source, resolveDir: fileURLToPath(new URL('src/', root)), sourcefile: 'renderer.js' },
  bundle: true, outfile: fileURLToPath(new URL('renderer.js', output)),
  platform: 'browser', target: 'chrome140', define: { global: 'globalThis' }
});
for (const name of ['index.html', 'styles.css']) await copyFile(new URL(`src/${name}`, root), new URL(name, output));

await Promise.all([1.25, 1.5].map(scale => new Promise((resolve, reject) => {
  const child = spawn(electron, [fileURLToPath(new URL('tests/pagination-electron.cjs', root)), fileURLToPath(output), String(scale), `--force-device-scale-factor=${scale}`], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Pagination regression failed at scale ${scale} (exit ${code})`)));
})));
