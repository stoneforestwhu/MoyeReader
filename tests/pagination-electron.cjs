const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = process.argv[2], scale = process.argv[3];
app.setPath('userData', path.join(output, `profile-${scale}`));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const deadline = setTimeout(() => { console.error(`Scale ${scale}: timed out`); app.exit(1); }, 240000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 960, show: false, webPreferences: {
    preload: path.join(__dirname, 'pagination-preload.cjs'), sandbox: false,
    backgroundThrottling: false, additionalArguments: [`--pagination-output=${output}`]
  } });
  win.webContents.on('console-message', event => { if (event.message.startsWith('PAGINATION')) console.log(`Scale ${scale}: ${event.message}`); });
  try {
    await win.loadFile(path.join(output, 'index.html'));
    let ready = false;
    for (let i = 0; i < 150; i++) {
      ready = await win.webContents.executeJavaScript('!!window.paginationProbe && !paginationProbe.state().loading && !!paginationProbe.state().location');
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error('Reader did not load');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const snapshot = () => {
        const { rendition } = paginationProbe.state(), manager = rendition.manager;
        const view = manager.views.first(), container = manager.container;
        const doc = view.contents.document, viewport = container.getBoundingClientRect();
        const frame = view.iframe.getBoundingClientRect();
        const glyphVisible = (element, last) => {
          const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const nodes = []; let node;
          while ((node = walker.nextNode())) if (node.length) nodes.push(node);
          node = last ? nodes.at(-1) : nodes[0];
          const range = doc.createRange(), start = last ? node.length - 1 : 0;
          range.setStart(node, start); range.setEnd(node, start + 1);
          const rect = range.getBoundingClientRect();
          return rect.left + frame.left >= viewport.left - 1 && rect.right + frame.left <= viewport.right + 1 &&
            rect.top + frame.top >= viewport.top - 1 && rect.bottom + frame.top <= viewport.bottom + 1;
        };
        return { section: view.section.index, position: container.scrollLeft,
          width: container.scrollWidth, viewport: container.clientWidth, step: manager.layout.delta,
          lastVisible: glyphVisible(doc.body.lastElementChild, true), firstVisible: glyphVisible(doc.body.firstElementChild, false) };
      };
      const cases = [];
      for (const settings of [{ fontSize: 20, spread: 'double' }, { fontSize: 28, spread: 'double' }, { fontSize: 16, spread: 'single' }]) {
        console.log('PAGINATION ' + JSON.stringify(settings));
        await paginationProbe.changeSettings(settings);
        await pause(300);
        await paginationProbe.display('ch0.xhtml');
        await pause(300);
        const forward = [];
        for (let i = 0; i < 100; i++) {
          const page = snapshot();
          if (page.section !== 0) break;
          forward.push(page);
          await paginationProbe.turn(1); await pause(30);
        }
        assert(snapshot().section === 1, 'Forward paging did not reach the next chapter');
        assert(forward.at(-1).lastVisible, 'Forward paging skipped the last character: ' + JSON.stringify(forward.at(-1)));
        await paginationProbe.turn(-1); await pause(100);
        const returned = snapshot();
        assert(returned.section === 0 && returned.lastVisible, 'Reverse chapter transition skipped the ending: ' + JSON.stringify(returned));
        const reverse = [returned];
        for (let i = 0; snapshot().position > 1 && i < 100; i++) {
          const before = snapshot();
          await paginationProbe.turn(-1); await pause(30);
          const after = snapshot(); reverse.push(after);
          assert(after.section === 0 && after.position < before.position - 1, 'Reverse paging did not move to the previous page');
        }
        assert(snapshot().firstVisible, 'Reverse paging did not reach the chapter heading');
        cases.push({ settings, forward, reverse });
        console.log('PAGINATION passed: ' + forward.length + ' forward pages, ' + reverse.length + ' reverse pages');
      }
      return { devicePixelRatio, cases };
    })()`);
    fs.writeFileSync(path.join(output, `result-${scale}.json`), JSON.stringify(result, null, 2));
    console.log(`Scale ${scale}: all chapter endings and reverse transitions passed`);
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    console.error(`Scale ${scale}:`, error); clearTimeout(deadline); app.exit(1);
  }
});
