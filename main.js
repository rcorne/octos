// Proceso principal de Octos: ventana, menú, historial de rastreos,
// guardado/exportación y renderizado JavaScript con el Chromium de Electron.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session, nativeTheme, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Crawler, DEFAULTS } = require('./lib/crawler');
const { createSecretStore, createHybridCipher } = require('./lib/secrets');
const { createGoogleClient, matchSiteForHost, mergeGoogleData, defaultRange } = require('./lib/google');
const { createAiClient } = require('./lib/ai');
const Lighthouse = require('./lib/lighthouse');
const Analysis = require('./lib/analysis');
const { buildActionPlan } = require('./lib/plan');
const { buildXlsx } = require('./lib/export-xlsx');
const { buildPptx } = require('./lib/export-pptx');

const CAPTURE = process.argv.includes('--capturas');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const DATA = () => app.getPath('userData');
const CRAWLS_DIR = () => path.join(DATA(), 'rastreos');

let win = null;
let crawler = null;
let currentProject = null; // proyecto abierto desde disco/historial
let renderPool = null;
let secretStore = null;
let cipher = null;
let google = null;
let ai = null;

// ---------- Almacenamiento simple en JSON
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
const prefsFile = () => path.join(DATA(), 'preferencias.json');
const historyFile = () => path.join(DATA(), 'historial.json');
const loadPrefs = () => readJson(prefsFile(), { onboarded: false, settings: {}, shortcuts: {}, theme: 'system' });
const savePrefs = (p) => writeJson(prefsFile(), p);
const loadHistory = () => readJson(historyFile(), []);
const saveHistory = (h) => writeJson(historyFile(), h.slice(0, 60));

// ---------- Renderizado JS: ventanas ocultas reutilizables
class RenderPool {
  constructor(size, { userAgent, waitMs }) {
    this.size = size;
    this.userAgent = userAgent;
    this.waitMs = waitMs;
    this.idle = [];
    this.all = [];
    this.waiters = [];
    this.ses = session.fromPartition('octos-render');
    this.ses.on('will-download', (e) => e.preventDefault());
    this.ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  }
  make() {
    const w = new BrowserWindow({
      show: false,
      width: 1366,
      height: 900,
      webPreferences: { session: this.ses, sandbox: true, images: false, backgroundThrottling: false, contextIsolation: true },
    });
    w.webContents.setAudioMuted(true);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.all.push(w);
    return w;
  }
  async acquire() {
    if (this.idle.length) return this.idle.pop();
    if (this.all.length < this.size) return this.make();
    return new Promise((r) => this.waiters.push(r));
  }
  release(w) {
    if (w.isDestroyed()) return;
    const next = this.waiters.shift();
    if (next) next(w);
    else this.idle.push(w);
  }
  async render(url) {
    const w = await this.acquire();
    try {
      const html = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El renderizado tardó más de 25 s')), 25000);
        w.webContents.once('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
          if (isMain) {
            clearTimeout(timer);
            reject(new Error(desc || 'Fallo de carga ' + code));
          }
        });
        w.webContents.once('did-finish-load', () => {
          setTimeout(async () => {
            try {
              const out = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true);
              clearTimeout(timer);
              resolve(out);
            } catch (err) {
              clearTimeout(timer);
              reject(err);
            }
          }, this.waitMs);
        });
        w.loadURL(url, { userAgent: this.userAgent }).catch(() => {});
      });
      return { html };
    } catch (err) {
      return { error: err.message };
    } finally {
      try {
        if (!w.isDestroyed()) await w.loadURL('about:blank');
      } catch { /* ignorar */ }
      this.release(w);
    }
  }
  destroy() {
    for (const w of this.all) if (!w.isDestroyed()) w.destroy();
    this.all = [];
    this.idle = [];
  }
}

// ---------- Ventana
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: 'Octos',
    // En Mac la barra de título se funde con la interfaz; en Windows y Linux se conserva la nativa
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } } : { autoHideMenuBar: false }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F1117' : '#E9EBF1',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !CAPTURE,
    },
    paintWhenInitiallyHidden: true,
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (CAPTURE) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[interfaz] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
  }
  win.once('ready-to-show', () => {
    if (!CAPTURE) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------- Menú nativo
function buildMenu() {
  const act = (action) => () => send('menu:action', action);
  const settingsItems = [
    { label: 'Ajustes…', accelerator: 'CmdOrCtrl+,', click: act('settings') },
    { label: 'Ver introducción', click: act('onboarding') },
  ];
  const template = [
    ...(IS_MAC
      ? [{
          label: 'Octos',
          submenu: [
            { role: 'about', label: 'Acerca de Octos' },
            { type: 'separator' },
            ...settingsItems,
            { type: 'separator' },
            { role: 'hide', label: 'Ocultar Octos' },
            { role: 'hideOthers', label: 'Ocultar otros' },
            { role: 'unhide', label: 'Mostrar todo' },
            { type: 'separator' },
            { role: 'quit', label: 'Salir de Octos' },
          ],
        }]
      : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo rastreo', accelerator: 'CmdOrCtrl+N', click: act('new') },
        { label: 'Abrir rastreo…', accelerator: 'CmdOrCtrl+O', click: act('open') },
        { label: 'Guardar rastreo…', accelerator: 'CmdOrCtrl+S', click: act('save') },
        { type: 'separator' },
        { label: 'Exportar vista a CSV…', accelerator: 'CmdOrCtrl+E', click: act('export-csv') },
        { label: 'Informe HTML para compartir…', accelerator: 'CmdOrCtrl+Shift+E', click: act('export-report') },
        { label: 'Presentación PowerPoint…', click: act('export-pptx') },
        { label: 'Libro de Excel…', click: act('export-xlsx') },
        { label: 'Generar sitemap XML…', click: act('export-sitemap') },
        ...(IS_MAC ? [] : [{ type: 'separator' }, ...settingsItems, { type: 'separator' }, { role: 'quit', label: 'Salir de Octos' }]),
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Visualización',
      submenu: [
        { label: 'Atrás', click: act('back') },
        { label: 'Adelante', click: act('forward') },
        { label: 'Inicio', click: act('home') },
        { type: 'separator' },
        { label: 'Paleta de comandos', click: act('palette') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Herramientas de desarrollo' }]),
      ],
    },
    { role: 'windowMenu', label: 'Ventana' },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado', click: act('shortcuts') },
        { label: 'Una creación de Mamífero · mamiferolab.com', click: () => shell.openExternal('https://mamiferolab.com/') },
        { type: 'separator' },
        { label: 'Guía de Google sobre rastreo e indexación', click: () => shell.openExternal('https://developers.google.com/search/docs/crawling-indexing') },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { label: 'Acerca de Octos', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Acerca de Octos', message: `Octos ${app.getVersion()}`, detail: 'Crawler y análisis de SEO para sitios web.\nUna creación de Mamífero · mamiferolab.com', buttons: ['Cerrar'] }) }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Rastreo
function startCrawl(options) {
  if (crawler && (crawler.state === 'running' || crawler.state === 'paused')) crawler.stop();
  if (renderPool) renderPool.destroy();
  currentProject = null;

  const opts = { ...DEFAULTS, ...options };
  renderPool = opts.renderJs ? new RenderPool(Math.min(4, Math.max(1, opts.concurrency)), { userAgent: opts.userAgent, waitMs: opts.renderWaitMs || 1200 }) : null;
  const c = new Crawler(opts, { render: renderPool ? (u) => renderPool.render(u) : null });
  crawler = c;

  // Las filas se envían en lotes para no saturar la interfaz
  let rowBuf = [];
  let edgeBuf = [];
  let timer = null;
  const flush = () => {
    timer = null;
    if (c !== crawler) return;
    if (rowBuf.length) send('crawl:rows', rowBuf);
    if (edgeBuf.length) send('crawl:edges', edgeBuf);
    send('crawl:progress', c.progress());
    rowBuf = [];
    edgeBuf = [];
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 250);
  };
  c.on('row', (r) => {
    rowBuf.push(r);
    schedule();
  });
  c.on('edges', (e) => {
    for (const x of e) edgeBuf.push(x);
    schedule();
  });
  c.on('progress', schedule);
  c.on('log', (m) => send('crawl:log', m));
  c.on('meta', (m) => send('crawl:meta', m));
  c.on('state', (s) => send('crawl:state', s));
  c.on('done', () => {
    clearTimeout(timer);
    flush();
    if (renderPool) {
      renderPool.destroy();
      renderPool = null;
    }
    const id = `${c.startHost}-${new Date(c.startedAt).toISOString().replace(/[:.]/g, '-')}`;
    try {
      writeJson(path.join(CRAWLS_DIR(), id + '.octos'), { format: 'octos', version: 1, ...c.snapshot() });
    } catch (err) {
      send('crawl:log', 'No se pudo guardar el rastreo en el historial: ' + err.message);
    }
    send('crawl:done', { id, state: c.state });
  });
  c.start().catch((err) => {
    send('crawl:error', err.message);
    send('crawl:state', 'idle');
  });
  return true;
}

function projectSnapshot() {
  if (crawler && crawler.rows.size) return { format: 'octos', version: 1, ...crawler.snapshot() };
  return currentProject;
}

function readyProject() {
  if (crawler && (crawler.state === 'running' || crawler.state === 'paused')) {
    throw new Error('Espera a que termine el rastreo para usar esta conexión.');
  }
  const project = projectSnapshot();
  if (!project || !Array.isArray(project.rows) || !project.rows.length) throw new Error('Primero rastrea o abre un sitio.');
  return project;
}

function persistEnrichment(project, { keepAiSummary = false } = {}) {
  if (!keepAiSummary && project.meta) delete project.meta.aiSummary;
  if (currentProject) currentProject = project;
  if (crawler && crawler.rows.size) {
    for (const row of project.rows) if (crawler.rows.has(row.url)) crawler.rows.set(row.url, row);
  }
  const startedAt = project.meta && project.meta.startedAt;
  const host = project.meta && project.meta.startHost;
  if (startedAt && host) {
    const id = `${host}-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}`;
    const file = path.join(CRAWLS_DIR(), id + '.octos');
    if (fs.existsSync(file)) writeJson(file, project);
  }
  return project;
}

function makeAiConfig(cfg = {}) {
  return {
    provider: String(cfg.provider || 'anthropic'),
    model: String(cfg.model || '').trim() || undefined,
    baseURL: String(cfg.baseURL || '').trim() || undefined,
    effort: cfg.effort,
  };
}

function contextForAi(project) {
  const result = Analysis.analyze({ rows: project.rows, edges: project.edges || [], meta: project.meta || {} });
  const byId = new Map(project.rows.map((row) => [row.id, row]));
  const plan = buildActionPlan(result, { rows: project.rows });
  const issues = result.issues.slice(0, 30).map((it) => ({
    titulo: it.title,
    severidad: it.severity,
    categoria: it.category,
    urls: (it.ids || []).slice(0, 8).map((id) => byId.get(id)?.url).filter(Boolean),
  }));
  const topPages = project.rows
    .filter((row) => Analysis.isPage(row))
    .slice(0, 30)
    .map((row) => ({ url: row.url, title: row.title || '', status: row.status, palabras: row.wordCount || 0, gsc: row.gsc, ga: row.ga, lighthouse: row.lighthouse }));
  return {
    sitio: project.meta?.startHost || '',
    fecha: project.meta?.finishedAt || project.meta?.startedAt || Date.now(),
    paginas: result.stats.pages,
    salud: result.score,
    puntajes: result.categoryScores,
    problemas: issues,
    plan: plan.map((group) => ({ horizonte: group.horizonte, acciones: group.acciones.slice(0, 12).map((x) => ({ titulo: x.titulo, severidad: x.severidad, esfuerzo: x.esfuerzo, urls: x.urls.slice(0, 5) })) })),
    gsc: result.stats.gsc,
    ga: result.stats.ga,
    lighthouse: result.stats.lighthouse,
    paginasClave: topPages,
  };
}

async function saveBinary(kind) {
  const project = readyProject();
  const result = Analysis.analyze({ rows: project.rows, edges: project.edges || [], meta: project.meta || {} });
  const plan = buildActionPlan(result, { rows: project.rows });
  const host = project.meta?.startHost || 'sitio';
  const date = new Date().toISOString().slice(0, 10);
  const isPptx = kind === 'pptx';
  const content = isPptx
    ? await buildPptx({ result, meta: project.meta || {}, rows: project.rows, plan, ai: project.meta?.aiSummary || null, brandDir: path.join(__dirname, 'assets', 'brand') })
    : await buildXlsx({ result, meta: project.meta || {}, rows: project.rows, plan, brandDir: path.join(__dirname, 'assets', 'brand') });
  const ext = isPptx ? 'pptx' : 'xlsx';
  const filter = isPptx ? 'Presentación PowerPoint' : 'Libro de Excel';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: `Exportar ${filter}`,
    defaultPath: `informe-seo-${host}-${date}.${ext}`,
    filters: [{ name: filter, extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, content);
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
}

// ---------- IPC
function registerIpc() {
  ipcMain.handle('app:init', () => ({
    prefs: loadPrefs(),
    history: loadHistory(),
    defaults: DEFAULTS,
    version: app.getVersion(),
    capture: CAPTURE,
    dark: nativeTheme.shouldUseDarkColors,
  }));
  ipcMain.handle('prefs:save', (_e, patch) => {
    const p = { ...loadPrefs(), ...patch };
    savePrefs(p);
    if (patch.theme) nativeTheme.themeSource = patch.theme === 'system' ? 'system' : patch.theme;
    return p;
  });

  ipcMain.handle('crawl:start', (_e, options) => startCrawl(options));
  ipcMain.handle('crawl:pause', () => crawler && crawler.pause());
  ipcMain.handle('crawl:resume', () => crawler && crawler.resume());
  ipcMain.handle('crawl:stop', () => crawler && crawler.stop());

  ipcMain.handle('history:record', (_e, entry) => {
    const h = loadHistory().filter((x) => x.id !== entry.id);
    h.unshift(entry);
    saveHistory(h);
    return h;
  });
  ipcMain.handle('history:open', (_e, id) => {
    const file = path.join(CRAWLS_DIR(), path.basename(String(id)) + '.octos');
    const project = readJson(file, null);
    if (project) {
      if (crawler && (crawler.state === 'running' || crawler.state === 'paused')) crawler.stop();
      crawler = null;
      currentProject = project;
    }
    return project;
  });
  ipcMain.handle('history:remove', (_e, id) => {
    const safe = path.basename(String(id));
    try {
      fs.rmSync(path.join(CRAWLS_DIR(), safe + '.octos'), { force: true });
    } catch { /* ya no existe */ }
    const h = loadHistory().filter((x) => x.id !== safe);
    saveHistory(h);
    return h;
  });

  ipcMain.handle('project:save', async () => {
    const project = projectSnapshot();
    if (!project) return { ok: false, reason: 'No hay un rastreo para guardar.' };
    const host = (project.meta && project.meta.startHost) || 'rastreo';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Guardar rastreo',
      defaultPath: `${host}-${new Date().toISOString().slice(0, 10)}.octos`,
      filters: [{ name: 'Rastreo de Octos', extensions: ['octos'] }],
    });
    if (canceled || !filePath) return { ok: false };
    writeJson(filePath, project);
    return { ok: true, filePath };
  });
  ipcMain.handle('project:open', async (_e, filePath) => {
    let file = filePath;
    if (!file) {
      const r = await dialog.showOpenDialog(win, { title: 'Abrir rastreo', properties: ['openFile'], filters: [{ name: 'Rastreo de Octos', extensions: ['octos', 'json'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    const project = readJson(file, null);
    if (!project || !Array.isArray(project.rows)) throw new Error('El archivo no es un rastreo de Octos válido.');
    if (crawler && (crawler.state === 'running' || crawler.state === 'paused')) crawler.stop();
    crawler = null;
    currentProject = project;
    return project;
  });

  ipcMain.handle('export:save', async (_e, { defaultName, content, kind }) => {
    const filters = {
      csv: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
      html: [{ name: 'Informe HTML', extensions: ['html'] }],
      xml: [{ name: 'Sitemap XML', extensions: ['xml'] }],
    }[kind] || [];
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Exportar', defaultPath: defaultName, filters });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, content);
    if (kind === 'html') shell.openPath(filePath);
    else shell.showItemInFolder(filePath);
    return { ok: true, filePath };
  });

  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
  });

  // ---------- Google, IA y Lighthouse. Las claves permanecen en main y safeStorage.
  ipcMain.handle('google:status', async () => ({ ...await google.status(), storage: cipher.backend() }));
  ipcMain.handle('google:oauth-client', (_e, input) => google.setOAuthClient(input));
  ipcMain.handle('google:connect', async () => google.connectOAuth());
  ipcMain.handle('google:disconnect', async () => google.disconnect());
  ipcMain.handle('google:catalog', async () => {
    const project = projectSnapshot();
    const status = await google.status();
    if (!status.connected) return { status, sites: [], properties: [], suggestedSite: null, range: defaultRange() };
    const [sites, properties] = await Promise.all([google.listSearchConsoleSites(), google.listAnalyticsProperties()]);
    const suggestedSite = project?.meta?.startHost ? matchSiteForHost(sites, project.meta.startHost) : null;
    return { status, sites, properties, suggestedSite, range: defaultRange() };
  });
  ipcMain.handle('google:sync', async (_e, { siteUrl, property, startDate, endDate } = {}) => {
    const project = readyProject();
    const host = project.meta?.startHost || '';
    let site = String(siteUrl || '').trim();
    let gaProperty = String(property || '').trim();
    const [sites, properties] = await Promise.all([google.listSearchConsoleSites(), google.listAnalyticsProperties()]);
    if (!sites.some((item) => item.siteUrl === site)) site = matchSiteForHost(sites, host) || '';
    if (!properties.some((item) => item.property === gaProperty)) gaProperty = properties.length === 1 ? properties[0].property : '';
    const range = { startDate: String(startDate || defaultRange().startDate), endDate: String(endDate || defaultRange().endDate) };
    const [gscPages, gaPages] = await Promise.all([
      site ? google.fetchSearchConsolePages({ siteUrl: site, ...range }) : Promise.resolve([]),
      gaProperty ? google.fetchAnalyticsPages({ property: gaProperty, ...range }) : Promise.resolve([]),
    ]);
    if (!site && !gaProperty) throw new Error('Elige una propiedad de Google antes de sincronizar.');
    mergeGoogleData(project.rows, { gscPages, gaPages, startHost: host });
    persistEnrichment(project);
    return { rows: project.rows, range, gscPages: gscPages.length, gaPages: gaPages.length, siteUrl: site, property: gaProperty };
  });
  ipcMain.handle('google:inspect', async (_e, { url, siteUrl } = {}) => {
    const project = readyProject();
    const row = project.rows.find((item) => item.url === String(url));
    if (!row) throw new Error('No encontramos esa URL en el rastreo.');
    let site = String(siteUrl || '').trim();
    const sites = await google.listSearchConsoleSites();
    if (!sites.some((item) => item.siteUrl === site)) site = matchSiteForHost(sites, project.meta?.startHost || '') || '';
    if (!site) throw new Error('No encontramos una propiedad de Search Console para este dominio.');
    row.inspection = await google.inspectUrl({ siteUrl: site, url: row.url });
    persistEnrichment(project);
    return { rows: [row] };
  });
  ipcMain.handle('google:queries', async (_e, { url, siteUrl, startDate, endDate } = {}) => {
    const project = readyProject();
    const row = project.rows.find((item) => item.url === String(url));
    if (!row) throw new Error('No encontramos esa URL en el rastreo.');
    let site = String(siteUrl || '').trim();
    const sites = await google.listSearchConsoleSites();
    if (!sites.some((item) => item.siteUrl === site)) site = matchSiteForHost(sites, project.meta?.startHost || '') || '';
    if (!site) throw new Error('No encontramos una propiedad de Search Console para este dominio.');
    const range = { startDate: String(startDate || defaultRange().startDate), endDate: String(endDate || defaultRange().endDate) };
    const queries = await google.fetchSearchConsoleQueries({ siteUrl: site, url: row.url, ...range });
    row.gsc = { ...(row.gsc || {}), queries, range };
    persistEnrichment(project);
    return { rows: [row] };
  });

  ipcMain.handle('ai:status', () => ({
    anthropic: ai.hasKey('anthropic'),
    openai: ai.hasKey('openai'),
    compatible: ai.hasKey('compatible'),
    baseURL: secretStore.get('ai.baseURL') || '',
  }));
  ipcMain.handle('ai:key', (_e, { provider, key } = {}) => {
    ai.setKey(String(provider), key);
    return { configured: ai.hasKey(String(provider)) };
  });
  ipcMain.handle('ai:base-url', (_e, url) => {
    ai.setBaseURL(url);
    return { ok: true };
  });
  ipcMain.handle('ai:models', async (_e, cfg) => ai.listModels(makeAiConfig(cfg)));
  ipcMain.handle('ai:test', async (_e, cfg) => ai.test(makeAiConfig(cfg)));
  ipcMain.handle('ai:summary', async (_e, cfg) => {
    const project = readyProject();
    const summary = await ai.executiveSummary(makeAiConfig(cfg), contextForAi(project));
    project.meta.aiSummary = summary;
    persistEnrichment(project, { keepAiSummary: true });
    return summary;
  });
  ipcMain.handle('ai:ask', async (_e, { cfg, question } = {}) => ai.ask(makeAiConfig(cfg), question, contextForAi(readyProject())));
  ipcMain.handle('ai:analyze-page', async (_e, { url, cfg } = {}) => {
    const project = readyProject();
    const row = project.rows.find((item) => item.url === String(url));
    if (!row) throw new Error('No encontramos esa URL en el rastreo.');
    const issuesById = new Map();
    const result = Analysis.analyze({ rows: project.rows, edges: project.edges || [], meta: project.meta || {} });
    for (const issue of result.issues) for (const id of issue.ids || []) issuesById.set(id, [...(issuesById.get(id) || []), issue]);
    const analysis = await ai.analyzePage(makeAiConfig(cfg), {
      url: row.url, title: row.title, metaDesc: row.metaDesc, h1: (row.h1 || [])[0], h2: row.h2First,
      wordCount: row.wordCount, idioma: row.lang, textoExtracto: row.textExcerpt || row.textSnippet || '',
      gsc: row.gsc, ga: row.ga, lighthouse: row.lighthouse,
      issues: (issuesById.get(row.id) || []).map((it) => ({ titulo: it.title, severidad: it.severity })),
    });
    row.ai = { provider: String(cfg?.provider || ''), model: String(cfg?.model || ''), createdAt: new Date().toISOString(), result: analysis };
    persistEnrichment(project);
    return { rows: [row] };
  });

  ipcMain.handle('lighthouse:status', () => ({ chromePath: Lighthouse.findChrome(), hasPageSpeedKey: secretStore.has('lighthouse.psiKey') }));
  ipcMain.handle('lighthouse:key', (_e, key) => {
    secretStore.set('lighthouse.psiKey', String(key || '').trim() || null);
    return { configured: secretStore.has('lighthouse.psiKey') };
  });
  ipcMain.handle('lighthouse:run-one', async (_e, { url, strategy = 'mobile', source = 'local' } = {}) => {
    const project = readyProject();
    const row = project.rows.find((item) => item.url === String(url));
    if (!row || !Analysis.isPage(row)) throw new Error('Elige una página HTML del rastreo.');
    const result = source === 'psi'
      ? await Lighthouse.runPageSpeed({ url: row.url, strategy, apiKey: secretStore.get('lighthouse.psiKey') || undefined })
      : await Lighthouse.runLocal({ url: row.url, strategy });
    row.lighthouse = { ...(row.lighthouse || {}), [strategy]: result };
    persistEnrichment(project);
    return { rows: [row], result };
  });
  ipcMain.handle('lighthouse:run-many', async (e, { strategy = 'mobile', source = 'local', limit = 10 } = {}) => {
    const project = readyProject();
    const pages = project.rows.filter((row) => Analysis.isPage(row) && row.url.startsWith('http'));
    const total = Math.max(1, Math.min(100, Number(limit) || 10, pages.length));
    const targets = pages.slice(0, total);
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      try {
        const result = source === 'psi'
          ? await Lighthouse.runPageSpeed({ url: row.url, strategy, apiKey: secretStore.get('lighthouse.psiKey') || undefined })
          : await Lighthouse.runLocal({ url: row.url, strategy });
        row.lighthouse = { ...(row.lighthouse || {}), [strategy]: result };
        results.push({ url: row.url, ok: true, result });
      } catch (err) {
        results.push({ url: row.url, ok: false, error: err.message || String(err) });
      }
      persistEnrichment(project);
      if (!e.sender.isDestroyed()) e.sender.send('integrations:rows', [row]);
      if (!e.sender.isDestroyed()) e.sender.send('lighthouse:progress', { done: i + 1, total: targets.length, url: row.url });
    }
    return { results, total: targets.length };
  });

  // Tipografías de la marca (assets/fonts). En Mac y Linux se copian a la carpeta de tipografías del
  // usuario cuando él lo pide. Windows exige registrarlas, así que se abre la carpeta para que las instale.
  const BRAND_FONTS = ['Manrope-Bold.ttf', 'Manrope-ExtraBold.ttf', 'IBMPlexSans-Regular.ttf', 'IBMPlexSans-SemiBold.ttf', 'IBMPlexSans-Bold.ttf'];
  const fontDirs = () => (IS_MAC
    ? [path.join(app.getPath('home'), 'Library', 'Fonts'), '/Library/Fonts']
    : IS_WIN
      ? [path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'), path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')]
      : [path.join(app.getPath('home'), '.local', 'share', 'fonts'), '/usr/share/fonts']);
  const fontsStatus = () => {
    const missing = BRAND_FONTS.filter((f) => !fontDirs().some((d) => fs.existsSync(path.join(d, f))));
    return { installed: !missing.length, missing, manual: IS_WIN };
  };
  ipcMain.handle('fonts:status', () => fontsStatus());
  ipcMain.handle('fonts:install', () => {
    const src = path.join(__dirname, 'assets', 'fonts');
    if (IS_WIN) {
      shell.showItemInFolder(path.join(src, BRAND_FONTS[0]));
      return { ...fontsStatus(), opened: true };
    }
    const dest = fontDirs()[0];
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fontsStatus().missing) fs.copyFileSync(path.join(src, f), path.join(dest, f));
    return fontsStatus();
  });

  ipcMain.handle('export:xlsx', () => saveBinary('xlsx'));
  ipcMain.handle('export:pptx', () => saveBinary('pptx'));

  ipcMain.handle('capture:page', async (_e, name) => {
    if (!CAPTURE) return null;
    const img = await win.webContents.capturePage();
    const dir = path.join(__dirname, 'out', 'capturas');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    return file;
  });
  ipcMain.handle('capture:fixture', async () => {
    if (!CAPTURE) return null;
    const fixture = require('./test/fixture-server');
    const server = await fixture.start(0);
    return `http://127.0.0.1:${server.address().port}/`;
  });
  ipcMain.handle('capture:quit', () => {
    if (CAPTURE) setTimeout(() => app.quit(), 200);
  });
}

// Abrir archivos .octos con doble clic desde el Finder
let pendingOpen = !IS_MAC ? process.argv.slice(1).find((a) => /\.octos$/i.test(a)) || null : null;
if (!IS_MAC && !CAPTURE && !process.argv.includes('--diagnostico')) {
  // En Windows y Linux, abrir un .octos lanza otro proceso: se reenvía a la ventana ya abierta
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      const file = argv.slice(1).find((a) => /\.octos$/i.test(a));
      if (file) send('menu:open-file', file);
    }
  });
}
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (win) send('menu:open-file', file);
  else pendingOpen = file;
});

if (CAPTURE) app.setPath('userData', path.join(app.getPath('temp'), 'octos-capturas-' + Date.now()));

app.whenReady().then(() => {
  cipher = createHybridCipher({ safeStorage, keyFile: path.join(DATA(), 'llave-local.bin'), log: (m) => console.log(m) });
  secretStore = createSecretStore({ file: path.join(DATA(), 'credenciales.enc'), encrypt: cipher.encrypt, decrypt: cipher.decrypt });
  if (process.argv.includes('--diagnostico')) {
    // Uso: Octos --diagnostico [--salida=ruta.json]. Comprueba el cifrado de credenciales sin abrir ventana.
    secretStore.set('diagnostico', 'ok');
    const resultado = {
      plataforma: `${process.platform}-${process.arch}`,
      version: app.getVersion(),
      electron: process.versions.electron,
      almacenamiento: cipher.backend(),
      safeStorage: safeStorage.isEncryptionAvailable(),
      lecturaOk: secretStore.get('diagnostico') === 'ok',
      chrome: Lighthouse.findChrome({ deep: true }) || null,
    };
    secretStore.delete('diagnostico');
    console.log('DIAGNOSTICO', JSON.stringify(resultado));
    const salida = process.argv.find((a) => a.startsWith('--salida='));
    if (salida) fs.writeFileSync(salida.slice('--salida='.length), JSON.stringify(resultado));
    return app.quit();
  }
  google = createGoogleClient({ store: secretStore, openExternal: (url) => shell.openExternal(url) });
  ai = createAiClient({ store: secretStore });
  const prefs = loadPrefs();
  nativeTheme.themeSource = prefs.theme && prefs.theme !== 'system' ? prefs.theme : 'system';
  app.setAboutPanelOptions({
    applicationName: 'Octos',
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} Rodrigo Cornejo`,
    credits: 'Crawler y análisis de SEO para sitios web.\nUna creación de Mamífero · mamiferolab.com',
    website: 'https://mamiferolab.com/',
  });
  const devIcon = path.join(__dirname, 'assets', 'icon-1024.png');
  if (!app.isPackaged && app.dock && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  buildMenu();
  registerIpc();
  createWindow();
  if (CAPTURE) win.setSize(1440, 920);
  if (pendingOpen) win.webContents.once('did-finish-load', () => send('menu:open-file', pendingOpen));
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (crawler) crawler.stop();
  if (renderPool) renderPool.destroy();
  app.quit();
});
