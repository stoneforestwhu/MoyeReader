import ePub from 'epubjs';
import PaginatedManager from './paginated-manager.js';
import { normalizeSettings, THEMES, flattenToc, chapterForHref, excerptParts, sanitizeDocument } from './core.mjs';

const $ = id => document.getElementById(id);
let settings = normalizeSettings(), recent = [], book, rendition, record, location, toc = [];
let generation = 0, searchGeneration = 0, saveTimer, toastTimer, resizeTimer, highlight, turning = false;
let locationsReady = false, loading = false, currentTitle = '', currentAuthor = '';
const fontFamilies = { serif: '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif', sans: '"Microsoft YaHei", sans-serif' };

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2600);
}
function closePopovers() {
  for (const name of ['typography', 'theme', 'recent']) {
    $(name + '-popover').hidden = true;
    $(name + '-btn').setAttribute('aria-expanded', 'false');
  }
}
function togglePopover(name) {
  const show = $(name + '-popover').hidden; closePopovers();
  $(name + '-popover').hidden = !show; $(name + '-btn').setAttribute('aria-expanded', String(show));
}
function switchTab(name) {
  $('sidebar').classList.remove('collapsed');
  for (const panel of ['toc', 'bookmarks', 'search']) {
    $(panel + '-panel').hidden = panel !== name;
    $('tab-' + panel).classList.toggle('active', panel === name);
    $('tab-' + panel).setAttribute('aria-selected', String(panel === name));
  }
  scheduleResize();
  if (name === 'search') { $('search-input').focus(); $('search-input').select(); }
}
function syncSettings() {
  document.body.dataset.theme = settings.theme;
  $('font-size').textContent = settings.fontSize;
  $('line-height').value = String(settings.lineHeight);
  $('font-serif').classList.toggle('selected', settings.font === 'serif');
  $('font-sans').classList.toggle('selected', settings.font === 'sans');
  document.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('selected', b.dataset.theme === settings.theme));
  $('spread-label').textContent = settings.spread === 'double' ? '双页' : '单页';
  $('spread-btn').querySelector('use').setAttribute('href', settings.spread === 'double' ? '#i-spread' : '#i-single');
  $('paper-center').hidden = settings.spread === 'single' || $('viewer').clientWidth < 850;
}
function applyBookStyle() {
  if (!rendition) return;
  const theme = THEMES[settings.theme];
  rendition.themes.default({
    'html': { background: `${theme.page} !important`, color: `${theme.ink} !important` },
    'body': { 'font-family': `${fontFamilies[settings.font]} !important`, 'font-size': `${settings.fontSize}px !important`, 'line-height': `${settings.lineHeight} !important`, color: `${theme.ink} !important`, background: `${theme.page} !important`, 'padding': '8px 38px 0 !important', 'box-sizing': 'border-box' },
    'p': { 'margin-top': '0 !important', 'margin-bottom': '.65em !important', 'text-align': 'justify', 'orphans': '2', 'widows': '2' },
    'h1': { 'font-size': '1.45em !important', 'line-height': '1.6 !important', 'margin': '.45em 0 1.2em !important', 'font-weight': '500' },
    'h2': { 'font-size': '1.2em !important', 'line-height': '1.6 !important', 'font-weight': '500' },
    'a': { color: `${theme.ink} !important` },
    'img, svg': { 'max-width': '100% !important', 'object-fit': 'contain' },
    '::selection': { background: '#bbd1bc' }
  });
}
async function changeSettings(patch) {
  const previousCfi = location?.start.cfi;
  settings = normalizeSettings({ ...settings, ...patch }); syncSettings();
  await window.reader.saveSettings(settings).catch(() => toast('排版设置暂未保存'));
  if (!rendition) return;
  applyBookStyle();
  rendition.spread(settings.spread === 'double' ? 'auto' : 'none', 850);
  rendition.resize($('viewer').clientWidth, $('viewer').clientHeight);
  if (previousCfi) await display(previousCfi);
}
function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    syncSettings();
    rendition?.resize($('viewer').clientWidth, $('viewer').clientHeight);
  }, 220);
}
function renderToc() {
  const filter = $('toc-filter').value.trim().toLocaleLowerCase();
  $('toc-list').replaceChildren();
  const items = toc.filter(item => !filter || item.label.toLocaleLowerCase().includes(filter));
  for (const item of items) {
    const row = document.createElement('button'); row.className = 'toc-item'; row.style.setProperty('--depth', item.depth);
    row.style.paddingLeft = `${11 + item.depth * 14}px`;
    const label = document.createElement('span'); label.className = 'toc-name'; label.textContent = item.label;
    const number = document.createElement('span'); number.className = 'toc-index';
    const section = book?.spine.get(item.href); number.textContent = section ? String(section.index + 1).padStart(2, '0') : '';
    row.append(label, number); row.dataset.href = item.href;
    row.addEventListener('click', () => display(item.href)); $('toc-list').append(row);
  }
  if (!items.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = filter ? '没有匹配的章节' : '本书没有目录，可使用底部进度条阅读'; $('toc-list').append(p); }
  updateActiveChapter();
}
function activeChapter() { return chapterForHref(toc, location?.start.href || '')?.label || currentTitle; }
function updateActiveChapter() {
  const active = chapterForHref(toc, location?.start.href || '');
  document.querySelectorAll('.toc-item').forEach(row => {
    row.classList.toggle('active', row.dataset.href === active?.href);
    if (row.dataset.href === active?.href) row.setAttribute('aria-current', 'location'); else row.removeAttribute('aria-current');
  });
}
function setProgress(pct) {
  pct = Math.max(0, Math.min(1, pct || 0));
  $('progress').value = String(Math.round(pct * 1000));
  $('progress').style.setProperty('--progress', `${pct * 100}%`);
  $('percentage').textContent = `${Math.round(pct * 100)}%`;
}
function updateLocation(next) {
  location = next;
  const chapter = activeChapter();
  $('chapter-label').textContent = chapter; $('page-chapter').textContent = chapter;
  const start = next.start.displayed, end = next.end.displayed;
  $('page-number').textContent = start.page === end.page ? `${start.page} / ${start.total}` : `${start.page} – ${end.page} / ${start.total}`;
  const spineIndex = book.spine.get(next.start.cfi)?.index || 0;
  $('section-progress').textContent = `第 ${spineIndex + 1} / ${book.spine.length} 章 · 本章 ${start.page} / ${start.total} 页`;
  $('prev-page').disabled = next.atStart; $('next-page').disabled = next.atEnd;
  $('chapter-prev').disabled = spineIndex <= 0; $('chapter-next').disabled = spineIndex >= book.spine.length - 1;
  const pct = locationsReady ? book.locations.percentageFromCfi(next.start.cfi) : spineIndex / Math.max(1, book.spine.length);
  setProgress(next.atEnd ? 1 : pct); updateActiveChapter(); updateBookmarkButton();
  if (record) { record.position = next.start.cfi; record.percentage = pct; queueSave(); }
}
function queueSave() {
  $('saved-status').textContent = '正在保存…'; clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (!record?.id) return;
  const { id, ...state } = record;
  try { await window.reader.saveBook(id, state); $('saved-status').textContent = '阅读进度已保存'; }
  catch { $('saved-status').textContent = '保存失败'; toast('阅读记录暂未保存，请检查磁盘空间'); }
}
function visibleBookmark(mark) {
  if (!location) return false;
  try { const compare = book.spine.epubcfi.compare.bind(book.spine.epubcfi); return compare(mark.cfi, location.start.cfi) >= 0 && compare(mark.cfi, location.end.cfi) <= 0; }
  catch { return mark.cfi === location.start.cfi; }
}
function updateBookmarkButton() {
  const marked = record?.bookmarks?.some(visibleBookmark);
  $('bookmark-btn').classList.toggle('marked', !!marked);
  $('bookmark-btn').setAttribute('aria-label', marked ? '移除当前书签' : '添加书签');
  $('bookmark-btn').title = `${marked ? '移除当前书签' : '添加书签'}（Ctrl+D）`;
}
function renderBookmarks() {
  const marks = record?.bookmarks || []; $('bookmark-list').replaceChildren(); $('bookmark-count').textContent = marks.length || '';
  if (!marks.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = '把喜欢的一页留在这里。\n点击页面右上角的书签，或按 Ctrl + D。'; $('bookmark-list').append(p); }
  marks.forEach(mark => {
    const row = document.createElement('div'); row.className = 'bookmark-row';
    const jump = document.createElement('button'); jump.className = 'bookmark-jump';
    const label = document.createElement('strong'); label.textContent = mark.label;
    const detail = document.createElement('span'); detail.textContent = `阅读至 ${Math.round((mark.percentage || 0) * 100)}% · ${new Date(mark.createdAt).toLocaleDateString('zh-CN')}`;
    jump.append(label, detail); jump.addEventListener('click', () => display(mark.cfi));
    const remove = document.createElement('button'); remove.className = 'bookmark-delete'; remove.textContent = '×'; remove.title = '删除此书签'; remove.setAttribute('aria-label', `删除书签：${mark.label}`);
    remove.addEventListener('click', () => { record.bookmarks = record.bookmarks.filter(m => m !== mark); renderBookmarks(); updateBookmarkButton(); queueSave(); });
    row.append(jump, remove); $('bookmark-list').append(row);
  });
}
function toggleBookmark() {
  if (!location || !record) return;
  const existing = record.bookmarks.find(visibleBookmark);
  if (existing) { record.bookmarks = record.bookmarks.filter(m => m !== existing); toast('已移除当前书签'); }
  else { record.bookmarks.push({ cfi: location.start.cfi, label: activeChapter(), percentage: record.percentage || 0, createdAt: Date.now() }); toast('已添加书签'); }
  renderBookmarks(); updateBookmarkButton(); queueSave();
}
async function display(target) {
  if (!rendition) return;
  try { await rendition.display(target); } catch (error) { console.error(error); toast('无法跳转到这个位置'); }
}
async function turn(direction) {
  if (!rendition || turning || loading) return;
  turning = true;
  try { await (direction > 0 ? rendition.next() : rendition.prev()); } catch (error) { console.error(error); toast('翻页失败，请尝试目录跳转'); }
  finally { turning = false; }
}
function chapterTurn(direction) {
  if (!book || !location) return;
  const section = book.spine.get(location.start.cfi); const next = book.spine.get(section.index + direction);
  if (next) display(next.href);
}
function renderRecent() {
  $('recent-list').replaceChildren();
  recent.forEach(item => {
    const b = document.createElement('button'); b.className = 'recent-item';
    const strong = document.createElement('strong'); strong.textContent = item.title;
    const small = document.createElement('span'); small.textContent = item.author || '未知作者'; b.append(strong, small);
    b.addEventListener('click', async () => { closePopovers(); await openPath(item.path); }); $('recent-list').append(b);
  });
}
async function openPath(path) {
  try { await openBook(await window.reader.load(path)); }
  catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
}
async function openDialog() {
  closePopovers();
  try { const data = await window.reader.open(); if (data) await openBook(data); } catch (error) { toast(error.message); }
}
async function openBook(data) {
  await flushSave(); const version = ++generation; ++searchGeneration; loading = true; locationsReady = false; location = null; highlight = null;
  $('loading').hidden = false; $('loading-label').textContent = '翻开新的一页…'; $('error-panel').hidden = true; $('progress').disabled = true;
  $('search-results').replaceChildren(); $('search-status').textContent = '输入文字，按 Enter 查找'; $('toc-filter').value = '';
  rendition?.destroy(); book?.destroy(); $('viewer').replaceChildren();
  record = { ...data.state, id: data.id, bookmarks: data.state.bookmarks || [] };
  const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
  book = ePub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { replacements: 'blobUrl' });
  const thisBook = book;
  book.spine.hooks.content.register(sanitizeDocument);
  try {
    await Promise.race([book.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('解析 EPUB 超时。请确认文件完整且未加密。')), 20000))]);
    if (version !== generation) return;
    const metadata = await book.loaded.metadata;
    currentTitle = metadata.title || data.name; currentAuthor = metadata.creator || '未知作者';
    $('book-title').textContent = currentTitle; $('toolbar-title').textContent = currentTitle; $('running-title').textContent = currentTitle;
    $('book-author').textContent = currentAuthor; $('book-badge').textContent = data.isDemo ? '内置示例 · EPUB' : '本地电子书 · EPUB'; document.title = `${currentTitle} — 墨页`;
    const navigation = await book.loaded.navigation;
    toc = flattenToc(navigation.toc).filter(item => item.href);
    if (!toc.length) toc = book.spine.spineItems.map((section, index) => ({ label: `第 ${index + 1} 章`, href: section.href, depth: 0 }));
    $('chapter-count').textContent = `${toc.length} 节`; renderToc(); renderBookmarks();
    rendition = book.renderTo('viewer', { manager: PaginatedManager, width: '100%', height: '100%', flow: 'paginated', spread: settings.spread === 'double' ? 'auto' : 'none', minSpreadWidth: 850, gap: 64, allowScriptedContent: false, allowPopups: false });
    const currentRendition = rendition;
    rendition.on('rendered', (_section, view) => currentRendition.manager.contentRendered(view));
    rendition.on('relocated', updateLocation);
    rendition.on('keydown', handleKey);
    rendition.on('layout', layout => $('paper-center').hidden = layout.divisor !== 2);
    rendition.on('displayError', error => console.error('EPUB display:', error));
    rendition.hooks.content.register(contents => {
      contents.document.addEventListener('click', closePopovers);
      contents.document.addEventListener('wheel', event => {
        if (event.ctrlKey || Math.abs(event.deltaY) < 20) return;
        event.preventDefault(); const now = Date.now();
        if (now - (contents.lastWheel || 0) > 350) { contents.lastWheel = now; turn(event.deltaY > 0 ? 1 : -1); }
      }, { passive: false });
    });
    applyBookStyle(); syncSettings();
    try { await rendition.display(record.position || undefined); }
    catch { await rendition.display(); toast('上次位置已失效，已从开头打开'); }
    if (version !== generation) return;
    loading = false; $('loading').hidden = true;
    recent = await window.reader.remember(data.id, { title: currentTitle, author: currentAuthor }); renderRecent();
    $('saved-status').textContent = '正在计算全书进度…';
    thisBook.locations.generate(900).then(() => {
      if (version !== generation) return;
      locationsReady = true; $('progress').disabled = false; if (location) updateLocation(location);
    }).catch(error => { console.error(error); if (version === generation) $('saved-status').textContent = '可通过目录跳转'; });
  } catch (error) {
    if (version !== generation) return;
    loading = false; $('loading').hidden = true; $('error-panel').hidden = false;
    $('error-message').textContent = error.message || '文件内容无法解析，请确认这是完整、未加密的 EPUB 文件。'; console.error(error);
  }
}

function sectionMatches(section, query, limit) {
  const doc = section.document, walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
  const nodes = []; let text = '', node;
  while ((node = walker.nextNode())) {
    if (['STYLE', 'SCRIPT', 'TITLE'].includes(node.parentElement?.tagName?.toUpperCase())) continue;
    nodes.push({ node, start: text.length, end: text.length + node.length }); text += node.textContent;
  }
  const lower = text.toLocaleLowerCase(), needle = query.toLocaleLowerCase(), matches = [];
  for (let index = lower.indexOf(needle); index >= 0 && matches.length < limit; index = lower.indexOf(needle, index + needle.length)) {
    const first = nodes.find(n => n.end > index), last = nodes.find(n => n.end >= index + query.length && n.end > n.start);
    if (!first || !last) continue;
    const range = doc.createRange(); range.setStart(first.node, index - first.start); range.setEnd(last.node, index + query.length - last.start);
    matches.push({ cfi: section.cfiFromRange(range), excerpt: `${index > 55 ? '…' : ''}${text.slice(Math.max(0, index - 55), index + query.length + 65).replace(/\s+/g, ' ')}${index + query.length + 65 < text.length ? '…' : ''}` });
  }
  return matches;
}
async function search() {
  const query = $('search-input').value.trim(), token = ++searchGeneration, searchBook = book;
  $('search-results').replaceChildren();
  if (!query || !book || loading) { $('search-status').textContent = '输入文字，按 Enter 查找'; return; }
  if (query.length > 200) { $('search-status').textContent = '请查找 200 字以内的文字'; return; }
  let count = 0; const sections = book.spine.spineItems;
  $('search-status').textContent = '正在查找全文…';
  for (const section of sections) {
    if (token !== searchGeneration) return;
    try {
      await section.load(searchBook.load.bind(searchBook));
      if (token !== searchGeneration) return;
      const matches = sectionMatches(section, query, 500 - count);
      const label = chapterForHref(toc, section.href)?.label || `第 ${section.index + 1} 章`;
      matches.forEach(match => {
        const row = document.createElement('button'); row.className = 'search-result';
        const heading = document.createElement('strong'); heading.textContent = label;
        const excerpt = document.createElement('span'); excerpt.className = 'result-excerpt';
        excerptParts(match.excerpt, query).forEach(part => { const el = document.createElement(part.match ? 'mark' : 'span'); el.textContent = part.text; excerpt.append(el); });
        row.append(heading, excerpt);
        row.addEventListener('click', async () => {
          document.querySelectorAll('.search-result').forEach(el => el.classList.remove('active')); row.classList.add('active');
          if (highlight) rendition.annotations.remove(highlight, 'highlight');
          await display(match.cfi); highlight = match.cfi;
          rendition.annotations.highlight(match.cfi, {}, null, 'search-highlight', { fill: '#dfbb60', 'fill-opacity': '0.45', 'mix-blend-mode': 'multiply' });
        }); $('search-results').append(row);
      });
      count += matches.length;
    } catch (error) { console.error('Search section:', error); }
    $('search-status').textContent = `正在查找 ${section.index + 1} / ${sections.length} 章 · ${count} 处匹配`;
    if (count >= 500) break;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (token === searchGeneration) $('search-status').textContent = count ? `找到 ${count}${count === 500 ? '+' : ''} 处匹配${count === 500 ? '，请缩小查找范围' : ''}` : '没有找到匹配文字';
}
function handleKey(event) {
  const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
  if (modifier && ['o', 'f', 'd', 'b'].includes(key)) {
    event.preventDefault();
    if (key === 'o') openDialog(); if (key === 'f') switchTab('search'); if (key === 'd') toggleBookmark(); if (key === 'b') { $('sidebar').classList.toggle('collapsed'); scheduleResize(); } return;
  }
  if (key === 'f11') { event.preventDefault(); window.reader.window('fullscreen'); return; }
  if (key === 'escape') { closePopovers(); if ($('help-dialog').open) $('help-dialog').close(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable || $('help-dialog').open) return;
  if (['arrowright', 'pagedown', ' ', 'arrowleft', 'pageup'].includes(key)) {
    event.preventDefault(); const direction = ['arrowleft', 'pageup'].includes(key) || (key === ' ' && event.shiftKey) ? -1 : 1;
    if (event.altKey) chapterTurn(direction); else turn(direction);
  }
  if (key === '/') { event.preventDefault(); switchTab('toc'); $('toc-filter').focus(); }
}

$('open-btn').onclick = $('retry-open').onclick = $('recent-open').onclick = openDialog;
$('open-demo').onclick = async () => openBook(await window.reader.demo());
$('prev-page').onclick = () => turn(-1); $('next-page').onclick = () => turn(1);
$('chapter-prev').onclick = () => chapterTurn(-1); $('chapter-next').onclick = () => chapterTurn(1);
$('bookmark-btn').onclick = toggleBookmark;
for (const name of ['toc', 'bookmarks', 'search']) $('tab-' + name).onclick = () => switchTab(name);
$('search-btn').onclick = () => switchTab('search'); $('search-form').onsubmit = event => { event.preventDefault(); search(); };
$('toc-filter').oninput = renderToc;
$('sidebar-toggle').onclick = () => { $('sidebar').classList.toggle('collapsed'); scheduleResize(); };
$('typography-btn').onclick = () => togglePopover('typography'); $('theme-btn').onclick = () => togglePopover('theme'); $('recent-btn').onclick = () => togglePopover('recent');
$('font-smaller').onclick = () => changeSettings({ fontSize: settings.fontSize - 1 }); $('font-larger').onclick = () => changeSettings({ fontSize: settings.fontSize + 1 });
$('font-serif').onclick = () => changeSettings({ font: 'serif' }); $('font-sans').onclick = () => changeSettings({ font: 'sans' });
$('line-height').onchange = event => changeSettings({ lineHeight: +event.target.value });
document.querySelectorAll('[data-theme]').forEach(button => button.onclick = () => changeSettings({ theme: button.dataset.theme }));
$('spread-btn').onclick = () => changeSettings({ spread: settings.spread === 'double' ? 'single' : 'double' });
$('progress').oninput = event => { $('percentage').textContent = `${Math.round(event.target.value / 10)}%`; event.target.style.setProperty('--progress', `${event.target.value / 10}%`); };
$('progress').onchange = event => { if (locationsReady) display(book.locations.cfiFromPercentage(Math.min(.9999, event.target.value / 1000))); };
$('minimize').onclick = () => window.reader.window('minimize'); $('maximize').onclick = () => window.reader.window('maximize');
$('fullscreen-btn').onclick = () => window.reader.window('fullscreen');
$('close-window').onclick = async () => { await flushSave(); window.reader.window('close'); };
$('help-btn').onclick = () => { closePopovers(); $('help-dialog').showModal(); }; $('help-close').onclick = () => $('help-dialog').close();
document.addEventListener('click', event => { if (!event.target.closest('.popover, #typography-btn, #theme-btn, #recent-btn')) closePopovers(); });
document.addEventListener('keydown', handleKey); window.addEventListener('resize', scheduleResize);
window.reader.onExternal(openPath); window.reader.onMaximized(maximized => { $('maximize').textContent = maximized ? '❐' : '□'; });
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) $('drop-overlay').hidden = true; });
document.addEventListener('drop', async event => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  const file = [...event.dataTransfer.files].find(file => /\.epub$/i.test(file.name));
  if (!file) return toast('请拖入 .epub 文件');
  try { await openBook(await window.reader.drop(file)); } catch (error) { toast(error.message); }
});
window.addEventListener('error', event => console.error('Reader:', event.error));
(async () => {
  const initial = await window.reader.init(); settings = normalizeSettings(initial.settings); recent = initial.recent; syncSettings(); renderRecent();
  try { await openBook(await window.reader.load(initial.initial)); }
  catch (error) { console.error(error); toast('上次的书籍已移动，已打开示例读物'); await openBook(await window.reader.demo()); }
})();
