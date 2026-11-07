const { contextBridge } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = process.argv.find(arg => arg.startsWith('--pagination-output=')).slice('--pagination-output='.length);
const data = { bytes: new Uint8Array(fs.readFileSync(path.join(output, 'fixture.epub'))), id: 'pagination-test', name: '分页测试', state: {} };
contextBridge.exposeInMainWorld('reader', {
  init: async () => ({ settings: {}, recent: [], initial: 'fixture.epub' }),
  load: async () => data, demo: async () => data,
  saveBook: async () => {}, saveSettings: async () => {}, remember: async () => [],
  onExternal: () => {}, onMaximized: () => {}, window: () => {}
});
