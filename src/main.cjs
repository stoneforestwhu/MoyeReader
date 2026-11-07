const { app, BrowserWindow, dialog, ipcMain, Menu, session, webContents } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

let win;
let store = { settings: {}, recent: [], books: {} };
let pendingFile = process.argv.find(arg => arg.toLowerCase().endsWith('.epub'));
let writeQueue = Promise.resolve();
const root = path.join(__dirname, '..');
const appUrl = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const demoPath = path.join(root, 'assets', '山海之间.epub');
const opened = new Map();

app.setName('墨页');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const file = argv.find(arg => arg.toLowerCase().endsWith('.epub'));
    if (file && win) win.webContents.send('book:external', file);
    win?.show();
    win?.focus();
  });
  app.whenReady().then(start);
}

function persist() {
  const snapshot = JSON.stringify(store);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const target = path.join(app.getPath('userData'), 'reader-state.json');
    const temp = target + '.tmp';
    await fs.writeFile(temp, snapshot, 'utf8');
    await fs.rename(temp, target);
  });
  return writeQueue;
}

function trusted(event) {
  if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== appUrl) {
    throw new Error('请求来源无效');
  }
}

function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    trusted(event);
    return fn(...args);
  });
}

async function loadBook(file) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.epub') throw new Error('请选择 .epub 格式的电子书');
  const stat = await fs.stat(file).catch(() => { throw new Error('文件已移动或无法访问，请重新打开'); });
  if (!stat.isFile()) throw new Error('这不是一个有效的 EPUB 文件');
  if (stat.size > 200 * 1024 * 1024) throw new Error('当前版本支持 200 MB 以内的 EPUB 文件');
  const data = await fs.readFile(file);
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) throw new Error('文件内容不是有效的 EPUB 压缩包');
  const id = crypto.createHash('sha256').update(data).digest('hex');
  opened.set(id, file);
  return { id, bytes: new Uint8Array(data), name: path.basename(file, '.epub'), isDemo: file === demoPath, state: store.books[id] || {} };
}

async function start() {
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'reader-state.json'), 'utf8'));
    if (saved && typeof saved === 'object') store = { settings: saved.settings || {}, recent: Array.isArray(saved.recent) ? saved.recent : [], books: saved.books || {} };
  } catch {}
  // EPUB files stay local. Documents cannot make network requests or run scripts.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const protocol = new URL(details.url).protocol;
    const local = ['file:', 'data:', 'blob:', 'devtools:'].includes(protocol);
    callback({ cancel: !local });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1500, height: 960, minWidth: 880, minHeight: 620,
    title: '墨页 · EPUB 阅读器', frame: false, backgroundColor: '#efeee8',
    icon: path.join(root, 'assets', 'icon.ico'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }
  });
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
  });
  win.webContents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });

  handle('app:init', async () => ({ settings: store.settings, recent: store.recent, initial: pendingFile || store.recent[0]?.path || demoPath }));
  handle('book:open-dialog', async () => {
    const result = await dialog.showOpenDialog(win, { title: '打开 EPUB 电子书', filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }], properties: ['openFile'] });
    return result.canceled ? null : loadBook(result.filePaths[0]);
  });
  handle('book:load', file => loadBook(file));
  handle('book:demo', () => loadBook(demoPath));
  handle('book:remember', async (id, metadata) => {
    if (!opened.has(id)) throw new Error('书籍尚未打开');
    const file = opened.get(id);
    const entry = { id, path: file, title: String(metadata.title || path.basename(file)).slice(0, 300), author: String(metadata.author || '').slice(0, 300), openedAt: Date.now(), isDemo: file === demoPath };
    store.recent = [entry, ...store.recent.filter(item => item.id !== id)].slice(0, 12);
    await persist();
    return store.recent;
  });
  handle('book:save', async (id, state) => {
    if (!opened.has(id) || !state || typeof state !== 'object') throw new Error('阅读状态无效');
    if (JSON.stringify(state).length > 200000) throw new Error('阅读状态过大');
    store.books[id] = state;
    await persist();
  });
  handle('settings:save', async settings => { store.settings = settings; await persist(); });
  handle('window:action', action => {
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    if (action === 'close') win.close();
  });
  win.loadURL(appUrl);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (writeQueue) {
    event.preventDefault();
    const queued = writeQueue;
    writeQueue = null;
    queued.finally(() => app.quit());
  }
});
