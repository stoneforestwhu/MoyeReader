export const DEFAULT_SETTINGS = Object.freeze({ fontSize: 20, lineHeight: 1.95, font: 'serif', theme: 'paper', spread: 'double' });
export const THEMES = {
  paper: { name: '纸白', page: '#fffefa', ink: '#383e38', muted: '#93968d', background: '#eeeee7' },
  sepia: { name: '暖纸', page: '#f5ead5', ink: '#514532', muted: '#9f927a', background: '#e7ddc6' },
  night: { name: '夜读', page: '#262d2a', ink: '#c2c9c0', muted: '#7d8b81', background: '#1c2320' }
};
export function normalizeSettings(input = {}) {
  return {
    fontSize: Math.max(14, Math.min(32, Number(input.fontSize) || 20)),
    lineHeight: Math.max(1.4, Math.min(2.6, Number(input.lineHeight) || 1.95)),
    font: ['serif', 'sans'].includes(input.font) ? input.font : 'serif',
    theme: Object.hasOwn(THEMES, input.theme) ? input.theme : 'paper',
    spread: input.spread === 'single' ? 'single' : 'double'
  };
}
export function flattenToc(items, depth = 0) {
  return (items || []).flatMap(item => [{ label: String(item.label || '未命名章节').trim(), href: item.href, depth }, ...flattenToc(item.subitems, depth + 1)]);
}
export function cleanHref(href = '') {
  try { return decodeURIComponent(href.split('#')[0]).replace(/^\.\//, '').replace(/^\//, ''); } catch { return href.split('#')[0]; }
}
export function chapterForHref(items, href) {
  const normalized = cleanHref(href);
  return items.find(item => cleanHref(item.href) === normalized) || items.find(item => normalized.endsWith('/' + cleanHref(item.href))) || null;
}
export function excerptParts(text, query) {
  if (!query) return [{ text, match: false }];
  const lower = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let position = 0;
  const parts = [];
  while (position < text.length) {
    const found = lower.indexOf(needle, position);
    if (found < 0) { parts.push({ text: text.slice(position), match: false }); break; }
    if (found > position) parts.push({ text: text.slice(position, found), match: false });
    parts.push({ text: text.slice(found, found + query.length), match: true });
    position = found + query.length;
  }
  return parts;
}
export function sanitizeDocument(doc) {
  doc.querySelectorAll('script, iframe, object, embed, form, input, button, base, meta[http-equiv]').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || (['href', 'src', 'xlink:href', 'action'].includes(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) node.removeAttribute(attr.name);
    }
  });
}
