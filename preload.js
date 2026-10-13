// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('octos', {
  init: () => ipcRenderer.invoke('app:init'),
  savePrefs: (patch) => ipcRenderer.invoke('prefs:save', patch),

  start: (options) => ipcRenderer.invoke('crawl:start', options),
  pause: () => ipcRenderer.invoke('crawl:pause'),
  resume: () => ipcRenderer.invoke('crawl:resume'),
  stop: () => ipcRenderer.invoke('crawl:stop'),

  recordHistory: (entry) => ipcRenderer.invoke('history:record', entry),
  openHistory: (id) => ipcRenderer.invoke('history:open', id),
  removeHistory: (id) => ipcRenderer.invoke('history:remove', id),

  saveProject: () => ipcRenderer.invoke('project:save'),
  openProject: (filePath) => ipcRenderer.invoke('project:open', filePath),
  exportFile: (payload) => ipcRenderer.invoke('export:save', payload),
  fontsStatus: () => ipcRenderer.invoke('fonts:status'),
  fontsInstall: () => ipcRenderer.invoke('fonts:install'),
  exportXlsx: () => ipcRenderer.invoke('export:xlsx'),
  exportPptx: () => ipcRenderer.invoke('export:pptx'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),

  googleStatus: () => ipcRenderer.invoke('google:status'),
  googleSetOAuthClient: (input) => ipcRenderer.invoke('google:oauth-client', input),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),
  googleCatalog: () => ipcRenderer.invoke('google:catalog'),
  googleSync: (options) => ipcRenderer.invoke('google:sync', options),
  googleInspect: (options) => ipcRenderer.invoke('google:inspect', options),
  googleQueries: (options) => ipcRenderer.invoke('google:queries', options),

  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (provider, key) => ipcRenderer.invoke('ai:key', { provider, key }),
  aiSetBaseURL: (url) => ipcRenderer.invoke('ai:base-url', url),
  aiModels: (cfg) => ipcRenderer.invoke('ai:models', cfg),
  aiTest: (cfg) => ipcRenderer.invoke('ai:test', cfg),
  aiSummary: (cfg) => ipcRenderer.invoke('ai:summary', cfg),
  aiAsk: (payload) => ipcRenderer.invoke('ai:ask', payload),
  aiAnalyzePage: (payload) => ipcRenderer.invoke('ai:analyze-page', payload),

  lighthouseStatus: () => ipcRenderer.invoke('lighthouse:status'),
  lighthouseSetKey: (key) => ipcRenderer.invoke('lighthouse:key', key),
  lighthouseRunOne: (options) => ipcRenderer.invoke('lighthouse:run-one', options),
  lighthouseRunMany: (options) => ipcRenderer.invoke('lighthouse:run-many', options),

  capture: (name) => ipcRenderer.invoke('capture:page', name),
  captureFixture: () => ipcRenderer.invoke('capture:fixture'),
  captureQuit: () => ipcRenderer.invoke('capture:quit'),

  onRows: on('crawl:rows'),
  onEdges: on('crawl:edges'),
  onProgress: on('crawl:progress'),
  onState: on('crawl:state'),
  onLog: on('crawl:log'),
  onMeta: on('crawl:meta'),
  onDone: on('crawl:done'),
  onError: on('crawl:error'),
  onMenu: on('menu:action'),
  onOpenFile: on('menu:open-file'),
  onIntegrationRows: on('integrations:rows'),
  onLighthouseProgress: on('lighthouse:progress'),
});
