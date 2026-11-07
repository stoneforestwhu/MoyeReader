import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { normalizeSettings, flattenToc, chapterForHref, excerptParts } from '../src/core.mjs';
import { makeDemo, chapters } from '../scripts/demo.mjs';

test('invalid saved preferences cannot break the reader', () => {
  assert.deepEqual(normalizeSettings({ fontSize: 100, lineHeight: -3, font: 'bad', theme: '__proto__', spread: 'bad' }), { fontSize: 32, lineHeight: 1.4, font: 'serif', theme: 'paper', spread: 'double' });
});
test('nested EPUB navigation preserves depth and resolves encoded chapter links', () => {
  const toc = flattenToc([{ label: '第一卷', href: 'text/目录.xhtml', subitems: [{ label: ' 第一章 ', href: 'text/第一章.xhtml#start' }] }]);
  assert.equal(toc[1].depth, 1); assert.equal(toc[1].label, '第一章');
  assert.equal(chapterForHref(toc, '/OEBPS/text/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml').label, '第一章');
});
test('search snippets preserve literal markup and highlight every occurrence', () => {
  const parts = excerptParts('<script>Light LIGHT 灯塔</script>', 'light');
  assert.equal(parts.filter(p => p.match).length, 2);
  assert.equal(parts.map(p => p.text).join(''), '<script>Light LIGHT 灯塔</script>');
  assert.equal(excerptParts('海上的灯塔与另一座灯塔', '灯塔').filter(p => p.match).length, 2);
});
for (const version of [2, 3]) test(`EPUB ${version} fixture has a valid container, spine and real searchable text`, async () => {
  const data = await makeDemo(version), zip = await JSZip.loadAsync(data);
  assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
  assert.match(await zip.file('META-INF/container.xml').async('string'), /OEBPS\/content.opf/);
  const opf = await zip.file('OEBPS/content.opf').async('string');
  assert.equal((opf.match(/<itemref /g) || []).length, chapters.length);
  assert.match(await zip.file('OEBPS/ch6.xhtml').async('string'), /灯塔/);
  assert.match(opf, new RegExp(`version="${version}.0"`));
  assert.ok(zip.file(version === 3 ? 'OEBPS/nav.xhtml' : 'OEBPS/toc.ncx'));
});
