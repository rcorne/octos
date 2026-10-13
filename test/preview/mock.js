// Banco de pruebas visual de Octos sin Electron.
// Define un window.octos falso con la misma API que expone preload.js y
// después monta renderer/index.html (estilos, marcado y scripts en orden).
//
// Parámetros de la URL:
//   vista   inicio (por defecto) | introduccion | rastreando | resumen | prioridades
//           | ajustes | paleta | informe | <id de una vista de tabla: all, titles, links…>
//   tema    light | dark | system
//   paso    paso de la introducción (0 a 3)
//   tab     pestaña de ajustes: rastreo | atajos | apariencia
//   detalle 1 para abrir el panel de detalle en una vista de tabla
//   q       texto que se escribe en la paleta de comandos
//   guia    1 abre el paso a paso de Google (vista=google)
//   conectado  1 para simular Google, IA y Lighthouse conectados, con datos de ejemplo en las filas
(function () {
  const params = new URLSearchParams(location.search);
  const vista = params.get('vista') || 'inicio';
  const tema = params.get('tema') || 'light';
  const RENDERER = new URL('../../renderer/', location.href);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let project = null;
  const conectado = params.get('conectado') === '1';
  // Datos de ejemplo de Search Console, Analytics, Lighthouse, inspección e IA (solo con ?conectado=1)
  function decorate(p) {
    const range = { startDate: '2026-09-13', endDate: '2026-10-10' };
    const pages = p.rows.filter((r) => r.internal && r.status === 200 && (r.contentType || '').includes('html'));
    pages.forEach((r, i) => {
      const imp = Math.round(4200 / (i + 1) + 40 * ((i * 7) % 5));
      const pos = Math.round((2.4 + i * 1.7) * 10) / 10;
      const ctr = Math.max(0.004, 0.31 / (1 + i * 0.9));
      r.gsc = { clicks: Math.round(imp * ctr), impressions: imp, ctr, position: pos, range };
      r.ga = { views: Math.round(imp * ctr * 1.8), sessions: Math.round(imp * ctr * 1.3), engagementRate: 0.42 + ((i * 3) % 5) / 20, keyEvents: i % 3 === 0 ? 0 : 2 + (i % 4), avgEngagementTime: 28 + i * 3, range };
      const lcp = 1400 + ((i * 613) % 3300);
      r.lighthouse = {
        mobile: {
          source: 'local', strategy: 'mobile', fetchedAt: '2026-10-13T08:12:00-03:00', lighthouseVersion: '13.5.0',
          scores: { performance: Math.max(34, 96 - i * 6), accessibility: 78 + ((i * 5) % 20), bestPractices: 92, seo: 90 - (i % 3) * 6 },
          metrics: { lcp, cls: Math.round(((i % 4) * 0.045) * 1000) / 1000, tbt: 80 + i * 55, fcp: 900 + i * 90, si: 1500 + i * 120, ttfb: 180 + i * 40, inp: null },
          field: null, opportunities: i > 1 ? [{ id: 'render-blocking-resources', title: 'Elimina los recursos que bloquean el renderizado', savingsMs: 450 + i * 20, savingsBytes: 0 }] : [], diagnostics: [],
        },
      };
      if (i === 1) r.inspection = { verdict: 'PASS', coverageState: 'Enviada e indexada', indexingState: 'INDEXING_ALLOWED', robotsTxtState: 'ALLOWED', pageFetchState: 'SUCCESSFUL', googleCanonical: r.url, userCanonical: r.url, lastCrawlTime: '2026-10-11T04:20:00Z', crawledAs: 'MOBILE', inspectedAt: '2026-10-13T08:30:00-03:00' };
    });
    p.meta = { ...p.meta, google: { siteUrl: 'sc-domain:' + (p.meta.startHost || '').replace(/^www\./, ''), range } };
    return p;
  }
  const loadProject = async () => {
    if (!project) {
      project = await (await fetch('proyecto-ejemplo.json')).json();
      if (conectado) project = decorate(project);
    }
    return clone(project);
  };
  const SITES = [{ siteUrl: 'sc-domain:agenciaejemplo.cl', permissionLevel: 'siteOwner' }, { siteUrl: 'https://www.tiendaverde.cl/', permissionLevel: 'siteFullUser' }];
  const PROPS = [{ property: 'properties/412233', displayName: 'Agencia Ejemplo · web', account: 'Agencia Ejemplo', accountId: 'accounts/101' }];
  const googleStatus = () => ({ connected: conectado, method: conectado ? 'oauth' : null, email: conectado ? 'equipo@agenciaejemplo.cl' : null, hasOAuthClient: conectado, storage: 'llavero' });
  const aiState = { anthropic: conectado, openai: false, compatible: false, baseURL: '' };
  const summary = {
    resumen: 'El sitio tiene una base técnica sana, pero pierde visitas por títulos repetidos, páginas sin llamada a la acción y tiempos de carga altos en móvil.',
    hallazgos: ['Dos páginas comparten el mismo título y compiten por la misma búsqueda.', 'Ocho páginas clave no piden nada al visitante.', 'La página de servicios carga el contenido principal en más de 3 segundos en móvil.'],
    plan: [
      { horizonte: 'Esta semana', acciones: ['Diferencia los títulos duplicados.', 'Agrega un botón «Cotiza» en las páginas de servicios.'] },
      { horizonte: 'Este mes', acciones: ['Comprime las imágenes de la portada.', 'Enlaza las páginas huérfanas desde el blog.'] },
      { horizonte: 'Este trimestre', acciones: ['Reescribe las descripciones con beneficio y llamada a la acción.'] },
    ],
  };

  const handlers = {};
  const emit = (ch, payload) => (handlers[ch] || []).forEach((fn) => fn(payload));
  const on = (ch) => (fn) => {
    (handlers[ch] = handlers[ch] || []).push(fn);
    return () => (handlers[ch] = handlers[ch].filter((f) => f !== fn));
  };

  let prefs = {
    onboarded: vista !== 'introduccion',
    theme: tema,
    settings: { renderJs: true, lastUrl: '' },
  };
  let history = [
    { id: 'tiendaverde', host: 'www.tiendaverde.cl', startUrl: 'https://www.tiendaverde.cl/', date: Date.parse('2026-10-09T16:10:00-03:00'), score: 78, pages: 412, summary: null },
    { id: 'clinicasur', host: 'clinicadentalsur.cl', startUrl: 'https://clinicadentalsur.cl/', date: Date.parse('2026-10-02T11:42:00-03:00'), score: 86, pages: 64, summary: null },
    { id: 'agencia', host: 'www.agenciaejemplo.cl', startUrl: 'https://www.agenciaejemplo.cl/', date: Date.parse('2026-09-24T09:05:00-03:00'), score: 52, pages: 14, summary: null },
  ];

  // Simula un rastreo: envía las filas del proyecto de ejemplo en lotes
  let crawlState = 'idle';
  let crawlTimer = null;
  async function simulateCrawl(options) {
    const p = await loadProject();
    const host = new URL(options.startUrl).hostname;
    const data = JSON.parse(JSON.stringify(p).split(p.meta.startHost).join(host));
    const slow = vista === 'rastreando';
    crawlState = 'running';
    emit('crawl:state', 'running');
    emit('crawl:log', `Leyendo https://${host}/robots.txt`);
    emit('crawl:log', `Sitemap: ${data.meta.sitemapUrlCount} URLs en ${data.meta.sitemapFiles.length} archivo(s)`);
    emit('crawl:meta', { ...data.meta, finishedAt: undefined });
    const rows = data.rows;
    const step = slow ? 2 : 6;
    let i = 0;
    const tick = () => {
      if (crawlState === 'paused') return (crawlTimer = setTimeout(tick, 200));
      if (crawlState === 'stopped') return finish('stopped');
      const batch = rows.slice(i, i + step);
      i += step;
      const ids = new Set(batch.map((r) => r.id));
      emit('crawl:rows', batch);
      emit('crawl:edges', data.edges.filter((e) => ids.has(e[0])));
      emit('crawl:progress', { crawled: Math.min(i, rows.length), total: rows.length, queued: Math.max(0, rows.length - i), rate: 6 });
      batch.forEach((r) => emit('crawl:log', `${r.status || '—'} ${r.url}`));
      if (i < rows.length && !(slow && i >= 8)) crawlTimer = setTimeout(tick, slow ? 150 : 120);
      else if (i < rows.length) crawlTimer = null; // en «rastreando» queda a medio camino
      else finish('done');
    };
    const finish = (final) => {
      crawlState = final;
      emit('crawl:meta', { finishedAt: (data.meta.startedAt || Date.now()) + 8000 });
      emit('crawl:state', final);
      emit('crawl:done', { id: host + '-ejemplo', state: final });
    };
    crawlTimer = setTimeout(tick, 200);
    return true;
  }

  let lastExport = null;
  window.octos = {
    init: async () => ({ prefs: clone(prefs), history: clone(history), defaults: { userAgent: 'Mozilla/5.0 (Macintosh) OctosSEO/1.0' }, version: '1.0.0', capture: false, dark: tema === 'dark' }),
    savePrefs: async (patch) => (prefs = { ...prefs, ...patch }),
    start: (options) => simulateCrawl(options),
    pause: async () => { crawlState = 'paused'; emit('crawl:state', 'paused'); },
    resume: async () => { crawlState = 'running'; emit('crawl:state', 'running'); },
    stop: async () => { crawlState = 'stopped'; clearTimeout(crawlTimer); emit('crawl:state', 'stopped'); },
    recordHistory: async (entry) => (history = [entry, ...history.filter((h) => h.id !== entry.id)]),
    openHistory: async () => loadProject(),
    removeHistory: async (id) => (history = history.filter((h) => h.id !== id)),
    saveProject: async () => ({ ok: true }),
    openProject: async () => loadProject(),
    exportFile: async (payload) => {
      lastExport = payload;
      return { ok: true };
    },
    openExternal: async (url) => console.log('[mock] abrir', url),
    capture: async () => true,
    captureFixture: async () => 'https://www.agenciaejemplo.cl/',
    captureQuit: async () => true,
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

    fontsStatus: async () => ({ installed: false, missing: ['Manrope-ExtraBold.ttf', 'IBMPlexSans-SemiBold.ttf'] }),
    fontsInstall: async () => ({ installed: true, missing: [] }),
    exportXlsx: async () => ({ ok: true, filePath: '/Users/ejemplo/informe-seo.xlsx' }),
    exportPptx: async () => ({ ok: true, filePath: '/Users/ejemplo/informe-seo.pptx' }),

    googleStatus: async () => googleStatus(),
    googleSetOAuthClient: async () => ({ ok: true }),
    googleConnect: async () => googleStatus(),
    googleDisconnect: async () => ({ ok: true }),
    googleCatalog: async () => ({ status: googleStatus(), sites: conectado ? SITES : [], properties: conectado ? PROPS : [], suggestedSite: conectado ? SITES[0].siteUrl : null, range: { startDate: '2026-09-13', endDate: '2026-10-10' } }),
    googleSync: async () => ({ rows: (await loadProject()).rows, range: { startDate: '2026-09-13', endDate: '2026-10-10' }, gscPages: 12, gaPages: 12, siteUrl: SITES[0].siteUrl, property: PROPS[0].property }),
    googleInspect: async () => ({ rows: [] }),
    googleQueries: async () => ({ rows: [] }),

    aiStatus: async () => ({ ...aiState }),
    aiSetKey: async () => ({ configured: true }),
    aiSetBaseURL: async () => ({ ok: true }),
    aiModels: async () => [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }],
    aiTest: async () => ({ ok: true, model: 'claude-opus-5-5', latencyMs: 820 }),
    aiSummary: async () => summary,
    aiAsk: async () => 'Empieza por los títulos duplicados: son un cambio rápido y evitan que dos páginas compitan por la misma búsqueda. Después agrega una llamada a la acción en las páginas de servicios.',
    aiAnalyzePage: async () => ({ rows: [] }),

    lighthouseStatus: async () => ({ chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', hasPageSpeedKey: false }),
    lighthouseSetKey: async () => ({ configured: true }),
    lighthouseRunOne: async () => ({ rows: [], result: null }),
    lighthouseRunMany: async () => ({ results: [], total: 0 }),
  };

  // Monta renderer/index.html en esta página
  async function mount() {
    const html = await (await fetch(new URL('index.html', RENDERER))).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const l of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(l.getAttribute('href'), RENDERER).href;
      document.head.appendChild(link);
      await new Promise((r) => (link.onload = link.onerror = r));
    }
    const scripts = [...doc.querySelectorAll('body script[src]')].map((s) => new URL(s.getAttribute('src'), RENDERER).href);
    doc.querySelectorAll('body script').forEach((s) => s.remove());
    document.body.insertAdjacentHTML('afterbegin', doc.body.innerHTML);
    for (const src of scripts) {
      const s = document.createElement('script');
      s.src = src;
      document.body.appendChild(s);
      await new Promise((r, j) => {
        s.onload = r;
        s.onerror = () => j(new Error('No se pudo cargar ' + src));
      });
    }
  }

  const $ = (sel) => document.querySelector(sel);
  const click = (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) throw new Error('No encontré ' + sel);
    el.click();
  };
  const until = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('Tiempo agotado esperando la vista');
      await wait(40);
    }
  };

  async function stage() {
    await until(() => handlers['menu:action'] && handlers['menu:action'].length);
    const openSample = async () => {
      emit('menu:action', 'open');
      await until(() => $('.grid-kpi'));
    };
    if (vista === 'introduccion') {
      const paso = Number(params.get('paso') || 0);
      for (let i = 0; i < paso; i++) click('#onb-next');
    } else if (vista === 'rastreando') {
      $('#url-input').value = 'www.agenciaejemplo.cl';
      $('#url-form').requestSubmit();
      await until(() => $('.grid-kpi'));
      await wait(900);
    } else if (vista === 'resumen') {
      await openSample();
    } else if (vista === 'prioridades') {
      await openSample();
      click('[data-view="issues"]');
    } else if (vista === 'ajustes') {
      emit('menu:action', 'settings');
      const tab = params.get('tab');
      if (tab) click(`[data-settings-tab="${tab}"]`);
    } else if (vista === 'paleta') {
      await openSample();
      emit('menu:action', 'palette');
      const input = $('#pal-input');
      input.value = params.get('q') || 'tít';
      input.dispatchEvent(new Event('input'));
    } else if (vista === 'informe') {
      await openSample();
      emit('menu:action', 'export-report');
      await until(() => lastExport);
      document.open();
      document.write(lastExport.content);
      document.close();
    } else if (vista !== 'inicio') {
      await openSample();
      click(`[data-view="${vista}"]`);
      await wait(100);
      if (params.get('guia') && $('[data-guide-open]')) {
        click('[data-guide-open]');
        await wait(300);
      }
      if (params.get('detalle')) {
        const rows = [...document.querySelectorAll('.vt-row')];
        const pick = rows[Math.min(rows.length - 1, Number(params.get('detalle')) || 0)] || rows[0];
        if (pick) click(pick);
      }
    }
    if (document.fonts) await document.fonts.ready;
    $('#toasts') && ($('#toasts').innerHTML = '');
    await wait(450); // transiciones del panel y del anillo
    window.__previewListo = true;
  }

  mount()
    .then(stage)
    .catch((err) => {
      console.error(err);
      window.__previewError = String(err && err.message ? err.message : err);
      window.__previewListo = true;
    });
})();
