// Interfaz de Octos.
(function () {
  const api = window.octos;
  // En Windows y Linux el atajo principal es Ctrl (se guarda como «Meta», igual que ⌘ en Mac)
  const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl';
  document.documentElement.dataset.platform = IS_MAC ? 'darwin' : 'other';
  if (!IS_MAC) {
    document.querySelectorAll('[title]').forEach((el) => {
      el.title = el.title.replace('⇧⌘', 'Ctrl+Mayús+').replace('⌘', 'Ctrl+').replace('⇧', 'Mayús+');
    });
  }
  const { icon, appTile, hydrate } = window.OctosIcons;
  const A = window.OctosAnalysis;
  const PX = window.OctosPixels;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('es-CL'));
  const kb = (b) => (b ? (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB') : '–');
  const pathOf = (url) => {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  };

  const USER_AGENTS = {
    octos: { label: 'Octos (escritorio)', ua: null },
    'googlebot-smartphone': { label: 'Googlebot smartphone', ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    googlebot: { label: 'Googlebot escritorio', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    bingbot: { label: 'Bingbot', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' },
    chrome: { label: 'Chrome en Mac', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' },
  };

  const SHORTCUTS = [
    { id: 'palette', label: 'Abrir la paleta de comandos', def: 'Meta+K' },
    { id: 'startPause', label: 'Pausar o reanudar el rastreo', def: 'Meta+Enter' },
    { id: 'search', label: 'Buscar en la tabla', def: 'Meta+F' },
    { id: 'overview', label: 'Ir al resumen', def: 'Meta+1' },
    { id: 'issues', label: 'Ir a prioridades', def: 'Meta+2' },
    { id: 'all', label: 'Ir a todas las URLs', def: 'Meta+3' },
    { id: 'toggleDetail', label: 'Mostrar u ocultar el detalle', def: 'Meta+I' },
    { id: 'back', label: 'Volver a la vista anterior', def: 'Meta+[' },
    { id: 'forward', label: 'Ir a la vista siguiente', def: 'Meta+]' },
    { id: 'home', label: 'Ir al inicio', def: 'Meta+Shift+H' },
    { id: 'nextRow', label: 'Fila siguiente', def: 'J' },
    { id: 'prevRow', label: 'Fila anterior', def: 'K' },
  ];

  const state = {
    prefs: null,
    defaults: null,
    history: [],
    settings: {},
    shortcuts: {},
    view: 'home',
    rows: [],
    byUrl: new Map(),
    byId: new Map(),
    edges: [],
    meta: null,
    crawlState: 'idle',
    progress: null,
    logs: [],
    result: null,
    issuesByRow: new Map(),
    selectedId: null,
    drawerTab: 'resumen',
    issueId: null,
    issueCat: 'todas',
    tables: {},
    prevSummary: null,
    crawlId: null,
    capture: false,
    google: { guideOpen: false, loaded: false, loading: false, connecting: false, busy: false, status: null, sites: [], properties: [], range: null, error: '' },
    ai: { loaded: false, status: null, models: [], modelsFor: '', loadingModels: false, modelsError: '', summary: null, reply: '', error: '', busy: false },
    lighthouse: { loaded: false, status: null, progress: null, error: '', busy: false },
  };

  // ======================================================================
  // Vistas de tabla
  const C = {
    url: { flex: 200, key: 'url', label: 'URL', w: 420, get: (r) => r.url, render: (r) => `<span title="${esc(r.url)}">${esc(r.internal ? pathOf(r.url) : r.url)}</span>`, cls: 'url' },
    status: { key: 'status', label: 'Estado', w: 86, get: (r) => r.status, render: (r) => statusPill(r) },
    indexable: { key: 'indexable', label: 'Indexable', w: 150, get: (r) => (r.indexable ? 'Sí' : r.indexReason || 'No'), render: (r) => (r.indexable ? '<span class="pill ok">Indexable</span>' : `<span class="pill gris">${esc(r.indexReason || 'No')}</span>`) },
    title: { flex: 160, key: 'title', label: 'Título', w: 320, get: (r) => r.title || '', cls: 'muted' },
    titleLen: { key: 'titleLen', label: 'Caract.', w: 80, get: (r) => r.titleLen },
    titlePx: { key: 'titlePx', label: 'Píxeles', w: 160, get: (r) => r.titlePx, render: (r) => pxBar(r.titlePx, 580, r.titleLen < 30) },
    dupTitle: { key: 'dupTitle', label: 'Repetido', w: 90, get: (r) => r.dupTitle || 0, render: (r) => (r.dupTitle ? `<span class="pill alto">×${r.dupTitle}</span>` : '') },
    desc: { flex: 180, key: 'metaDesc', label: 'Meta descripción', w: 380, get: (r) => r.metaDesc || '', cls: 'muted' },
    descLen: { key: 'descLen', label: 'Caract.', w: 80, get: (r) => r.descLen },
    descPx: { key: 'descPx', label: 'Píxeles', w: 160, get: (r) => r.descPx, render: (r) => pxBar(r.descPx, 920, r.descLen && r.descLen < 70) },
    dupDesc: { key: 'dupDesc', label: 'Repetida', w: 90, get: (r) => r.dupDesc || 0, render: (r) => (r.dupDesc ? `<span class="pill medio">×${r.dupDesc}</span>` : '') },
    h1: { flex: 160, key: 'h1', label: 'H1', w: 320, get: (r) => (r.h1 || [])[0] || '', cls: 'muted' },
    h1Count: { key: 'h1Count', label: 'Nº H1', w: 70, get: (r) => (r.h1 || []).length },
    h2Count: { key: 'h2Count', label: 'Nº H2', w: 70, get: (r) => r.h2Count },
    skips: { key: 'headingSkips', label: 'Saltos', w: 70, get: (r) => r.headingSkips || 0 },
    words: { key: 'wordCount', label: 'Palabras', w: 90, get: (r) => r.wordCount },
    ratio: { key: 'textRatio', label: 'Texto/HTML', w: 100, get: (r) => r.textRatio, render: (r) => (r.textRatio === undefined ? '' : r.textRatio + ' %') },
    nearDup: { key: 'nearDup', label: 'Casi duplicadas', w: 130, get: (r) => (r.nearDup || []).length, render: (r) => ((r.nearDup || []).length ? `<span class="pill medio">${r.nearDup.length} · ${Math.max(...r.nearDup.map((d) => d.sim))} %</span>` : '') },
    lang: { key: 'lang', label: 'Idioma', w: 80, get: (r) => r.lang || '' },
    time: { key: 'time', label: 'Respuesta', w: 100, get: (r) => r.time, render: (r) => (r.time ? `<span class="${r.time > 1000 ? 'no' : ''}">${fmt(r.time)} ms</span>` : '–') },
    size: { key: 'size', label: 'Tamaño', w: 90, get: (r) => r.size, render: (r) => kb(r.size) },
    depth: { key: 'clickDepth', label: 'Clics', w: 70, get: (r) => r.clickDepth ?? null, render: (r) => (r.clickDepth === null || r.clickDepth === undefined ? '–' : r.clickDepth) },
    inlinks: { key: 'inlinkSources', label: 'Entrantes', w: 110, get: (r) => r.inlinkSources || 0 },
    outInt: { key: 'outlinksInternal', label: 'Salientes int.', w: 120, get: (r) => r.outlinksInternal },
    outExt: { key: 'outlinksExternal', label: 'Salientes ext.', w: 120, get: (r) => r.outlinksExternal },
    orphan: { key: 'orphan', label: 'Huérfana', w: 90, get: (r) => (r.orphan ? 'Sí' : ''), render: (r) => (r.orphan ? '<span class="pill alto">Sí</span>' : '') },
    contentType: { key: 'contentType', label: 'Tipo', w: 170, get: (r) => r.contentType || '', cls: 'muted' },
    redirectTo: { flex: 180, key: 'redirectTo', label: 'Redirige a', w: 360, get: (r) => r.redirectTo || '', cls: 'muted' },
    hops: { key: 'hops', label: 'Saltos', w: 70, get: (r) => r.hops },
    finalStatus: { key: 'finalStatus', label: 'Estado final', w: 110, get: (r) => r.finalStatus, render: (r) => (r.redirectLoop ? '<span class="pill critico">Bucle</span>' : r.finalStatus ? statusPill({ status: r.finalStatus }) : '–') },
    reason: { key: 'indexReason', label: 'Motivo', w: 150, get: (r) => r.indexReason || '' },
    canonical: { flex: 160, key: 'canonical', label: 'Canonical', w: 320, get: (r) => r.canonical || '', render: (r) => (r.canonical ? (r.canonical === r.url ? '<span class="muted">Autorreferente</span>' : esc(pathOf(r.canonical))) : '<span class="no">Falta</span>') },
    robots: { key: 'metaRobots', label: 'Meta robots', w: 150, get: (r) => [r.metaRobots, r.xRobots].filter(Boolean).join(' · ') },
    sitemap: { key: 'inSitemap', label: 'En sitemap', w: 100, get: (r) => (r.inSitemap ? 'Sí' : 'No'), render: (r) => (r.inSitemap ? '<span class="yes">Sí</span>' : '<span class="muted">No</span>') },
    imgs: { key: 'imagesTotal', label: 'Imágenes', w: 90, get: (r) => r.imagesTotal },
    imgsNoAlt: { key: 'imagesNoAlt', label: 'Sin alt', w: 90, get: (r) => r.imagesNoAlt, render: (r) => (r.imagesNoAlt ? `<span class="no">${r.imagesNoAlt}</span>` : '0') },
    imgsEmpty: { key: 'imagesEmptyAlt', label: 'Alt vacío', w: 90, get: (r) => r.imagesEmptyAlt },
    imgsNoDims: { key: 'imagesNoDims', label: 'Sin medidas', w: 110, get: (r) => r.imagesNoDims },
    schema: { flex: 150, key: 'jsonldTypes', label: 'Datos estructurados', w: 260, get: (r) => (r.jsonldTypes || []).join(', '), render: (r) => ((r.jsonldTypes || []).length ? r.jsonldTypes.slice(0, 4).map((t) => `<span class="pill gris">${esc(t)}</span>`).join(' ') : '<span class="muted">—</span>') },
    og: { key: 'og', label: 'Open Graph', w: 110, get: (r) => (r.og && r.og.title && r.og.image ? 'Completo' : 'Incompleto'), render: (r) => (r.og && r.og.title && r.og.image ? '<span class="yes">Completo</span>' : '<span class="no">Incompleto</span>') },
    twitter: { key: 'twitterCard', label: 'Twitter card', w: 120, get: (r) => r.twitterCard || '' },
    cta: { flex: 160, key: 'ctas', label: 'Llamadas a la acción', w: 260, get: (r) => (r.ctas || []).join(' · '), render: (r) => ((r.ctas || []).length ? r.ctas.slice(0, 3).map((t) => `<span class="pill ok">${esc(t)}</span>`).join(' ') : '<span class="no">Ninguna</span>') },
    forms: { key: 'forms', label: 'Formularios', w: 100, get: (r) => (r.forms || []).length },
    fields: { key: 'fields', label: 'Campos (máx.)', w: 120, get: (r) => Math.max(0, ...(r.forms || []).map((f) => f.fields)) },
    contact: { key: 'contact', label: 'Contacto directo', w: 150, get: (r) => [r.hasTel && 'Tel', r.hasMailto && 'Email', r.hasWhatsapp && 'WhatsApp'].filter(Boolean).join(', '), render: (r) => [r.hasTel && 'Tel', r.hasMailto && 'Email', r.hasWhatsapp && 'WhatsApp'].filter(Boolean).map((x) => `<span class="pill gris">${x}</span>`).join(' ') || '<span class="muted">—</span>' },
    compression: { key: 'compression', label: 'Compresión', w: 110, get: (r) => r.compression || 'ninguna', render: (r) => (r.compression ? `<span class="yes">${esc(r.compression)}</span>` : '<span class="no">Ninguna</span>') },
    blocking: { key: 'blockingScripts', label: 'Scripts bloqueantes', w: 150, get: (r) => r.blockingScripts },
    scripts: { key: 'scripts', label: 'Scripts', w: 80, get: (r) => r.scripts },
    third: { key: 'third', label: 'Dominios terceros', w: 140, get: (r) => (r.thirdPartyHosts || []).length },
    jsTitle: { key: 'jsTitle', label: 'Título cambia', w: 120, get: (r) => (r.jsDiff && r.jsDiff.titleChanged ? 'Sí' : 'No'), render: (r) => (r.jsDiff && r.jsDiff.titleChanged ? '<span class="pill alto">Sí</span>' : 'No') },
    jsWords: { key: 'jsWords', label: 'Palabras por JS', w: 130, get: (r) => (r.jsDiff ? r.jsDiff.wordsAdded : null) },
    jsLinks: { key: 'jsLinks', label: 'Enlaces por JS', w: 130, get: (r) => (r.jsDiff ? r.jsDiff.linksAdded : null) },
    jsH1: { key: 'jsH1', label: 'H1 cambia', w: 100, get: (r) => (r.jsDiff && r.jsDiff.h1Changed ? 'Sí' : 'No') },
    gscClicks: { key: 'gscClicks', label: 'Clics orgánicos', w: 120, get: (r) => r.gsc ? r.gsc.clicks : null },
    gscImpressions: { key: 'gscImpressions', label: 'Impresiones', w: 120, get: (r) => r.gsc ? r.gsc.impressions : null },
    gscCtr: { key: 'gscCtr', label: 'CTR', w: 80, get: (r) => r.gsc ? r.gsc.ctr : null, render: (r) => r.gsc ? `${(r.gsc.ctr * 100).toFixed(1)} %` : '–' },
    gscPosition: { key: 'gscPosition', label: 'Posición', w: 90, get: (r) => r.gsc ? r.gsc.position : null },
    gaViews: { key: 'gaViews', label: 'Vistas GA4', w: 100, get: (r) => r.ga ? r.ga.views : null },
    gaSessions: { key: 'gaSessions', label: 'Sesiones GA4', w: 110, get: (r) => r.ga ? r.ga.sessions : null },
    gaEvents: { key: 'gaEvents', label: 'Eventos clave', w: 110, get: (r) => r.ga ? r.ga.keyEvents : null },
    googleIndex: { key: 'googleIndex', label: 'Cobertura Google', w: 200, get: (r) => r.inspection?.coverageState || r.inspection?.verdict || '' },
    lhPerformance: { key: 'lhPerformance', label: 'Lighthouse', w: 100, get: (r) => (r.lighthouse?.mobile || r.lighthouse?.desktop)?.scores?.performance ?? null },
    lhLcp: { key: 'lhLcp', label: 'LCP', w: 90, get: (r) => (r.lighthouse?.mobile || r.lighthouse?.desktop)?.metrics?.lcp ?? null, render: (r) => { const n = (r.lighthouse?.mobile || r.lighthouse?.desktop)?.metrics?.lcp; return n == null ? '–' : (n / 1000).toFixed(1) + ' s'; } },
  };

  const isHtml = (r) => r.contentType && r.contentType.includes('html');
  const VIEWS = {
    all: { label: 'Todas las URLs', icon: 'list', tone: 'azul', rows: (r) => r.internal, cols: ['url', 'status', 'indexable', 'title', 'time', 'size', 'depth', 'inlinks'], filters: [{ label: '2xx', fn: (r) => r.status >= 200 && r.status < 300 }, { label: '3xx', fn: (r) => r.status >= 300 && r.status < 400 }, { label: '4xx', fn: (r) => r.status >= 400 && r.status < 500 }, { label: '5xx', fn: (r) => r.status >= 500 }, { label: 'Sin respuesta', fn: (r) => r.status === 0 }] },
    pages: { label: 'Páginas HTML', icon: 'file', tone: 'azul', rows: (r) => A.isPage(r), cols: ['url', 'indexable', 'title', 'words', 'time', 'depth', 'inlinks'], filters: [{ label: 'Indexables', fn: (r) => r.indexable }, { label: 'No indexables', fn: (r) => !r.indexable }] },
    resources: { label: 'Recursos', icon: 'box', tone: 'gris', rows: (r) => r.internal && r.status && !isHtml(r) && !(r.status >= 300 && r.status < 400), cols: ['url', 'status', 'contentType', 'size', 'time'], filters: [] },
    external: { label: 'Externas', icon: 'globe', tone: 'gris', rows: (r) => !r.internal, cols: ['url', 'status', 'contentType', 'time', 'inlinks'], filters: [{ label: 'Rotas', issue: 'externos-rotos' }], empty: 'Activa «Revisar enlaces externos» en Ajustes para comprobar su estado.' },
    titles: { label: 'Títulos', icon: 'type', tone: 'lavanda', rows: (r) => A.isPage(r), cols: ['url', 'title', 'titleLen', 'titlePx', 'dupTitle'], filters: [{ label: 'Falta', issue: 'title-falta' }, { label: 'Duplicados', issue: 'title-dup' }, { label: 'Largos', issue: 'title-largo' }, { label: 'Cortos', issue: 'title-corto' }] },
    descriptions: { label: 'Meta descripciones', icon: 'text', tone: 'lavanda', rows: (r) => A.isPage(r), cols: ['url', 'desc', 'descLen', 'descPx', 'dupDesc'], filters: [{ label: 'Falta', issue: 'desc-falta' }, { label: 'Duplicadas', issue: 'desc-dup' }, { label: 'Largas', issue: 'desc-larga' }] },
    headings: { label: 'Encabezados', icon: 'heading', tone: 'lavanda', rows: (r) => A.isPage(r), cols: ['url', 'h1', 'h1Count', 'h2Count', 'skips'], filters: [{ label: 'Sin H1', issue: 'h1-falta' }, { label: 'Varios H1', issue: 'h1-multiple' }, { label: 'H1 duplicados', issue: 'h1-dup' }, { label: 'Saltos', issue: 'encabezados-saltos' }] },
    content: { label: 'Contenido', icon: 'layers', tone: 'lavanda', rows: (r) => A.isPage(r), cols: ['url', 'words', 'ratio', 'nearDup', 'lang', 'indexable'], filters: [{ label: 'Poco contenido', issue: 'contenido-pobre' }, { label: 'Duplicado exacto', issue: 'duplicado-exacto' }, { label: 'Casi duplicado', issue: 'casi-duplicado' }, { label: 'Sin lang', issue: 'lang' }] },
    images: { label: 'Imágenes', icon: 'image', tone: 'cielo', rows: (r) => A.isPage(r) && r.imagesTotal > 0, cols: ['url', 'imgs', 'imgsNoAlt', 'imgsEmpty', 'imgsNoDims'], filters: [{ label: 'Sin alt', issue: 'img-alt' }, { label: 'Sin medidas', issue: 'img-dimensiones' }] },
    links: { label: 'Enlaces', icon: 'link', tone: 'cielo', rows: (r) => A.isPage(r), cols: ['url', 'inlinks', 'outInt', 'outExt', 'depth', 'orphan', 'sitemap'], filters: [{ label: 'Huérfanas', issue: 'huerfanas' }, { label: 'Profundas', issue: 'profundas' }, { label: 'Con enlaces rotos', issue: 'enlaces-rotos' }, { label: 'Sin salientes', issue: 'sin-enlaces-salientes' }, { label: 'Enlazan a redirección', issue: 'enlaces-a-redireccion' }] },
    redirects: { label: 'Redirecciones', icon: 'redirect', tone: 'cielo', rows: (r) => r.internal && r.status >= 300 && r.status < 400, cols: ['url', 'status', 'redirectTo', 'hops', 'finalStatus', 'inlinks'], filters: [{ label: 'Cadenas', issue: 'cadenas' }, { label: 'Temporales', issue: 'redireccion-temporal' }, { label: 'Bucles', issue: 'bucles' }] },
    indexing: { label: 'Indexación', icon: 'shield', tone: 'azul', rows: (r) => r.internal && (isHtml(r) || r.blockedByRobots), cols: ['url', 'status', 'indexable', 'canonical', 'robots', 'sitemap'], filters: [{ label: 'No indexables', fn: (r) => !r.indexable }, { label: 'noindex', issue: 'noindex' }, { label: 'Bloqueadas', issue: 'robots-bloqueada' }, { label: 'Sin canonical', issue: 'canonical-falta' }, { label: 'Canonical roto', issue: 'canonical-roto' }, { label: 'En sitemap y no indexables', issue: 'sitemap-no-indexable' }] },
    sitemaps: { label: 'Sitemaps', icon: 'sitemap', tone: 'azul', special: true },
    schema: { label: 'Datos estructurados', icon: 'code', tone: 'durazno', rows: (r) => A.isPage(r), cols: ['url', 'schema', 'og', 'twitter', 'indexable'], filters: [{ label: 'Sin datos estructurados', issue: 'schema-falta' }, { label: 'JSON-LD con errores', issue: 'schema-error' }, { label: 'Sin Open Graph', issue: 'og-falta' }] },
    conversion: { label: 'Conversión', icon: 'cart', tone: 'rosa', rows: (r) => A.isPage(r), cols: ['url', 'cta', 'forms', 'fields', 'contact', 'depth'], filters: [{ label: 'Clave sin CTA', issue: 'sin-cta' }, { label: 'Campos sin etiqueta', issue: 'form-sin-label' }, { label: 'Formularios largos', issue: 'form-largo' }] },
    performance: { label: 'Rendimiento', icon: 'zap', tone: 'menta', rows: (r) => A.isPage(r), cols: ['url', 'time', 'lhPerformance', 'lhLcp', 'size', 'compression', 'blocking', 'scripts', 'third'], filters: [{ label: 'Lentas', issue: 'lenta' }, { label: 'Pesadas', issue: 'pesada' }, { label: 'Sin compresión', issue: 'sin-compresion' }, { label: 'Scripts bloqueantes', issue: 'scripts-bloqueantes' }, { label: 'Contenido mixto', issue: 'contenido-mixto' }, { label: 'LCP lento', issue: 'lcp-lento' }, { label: 'CLS alto', issue: 'cls-alto' }, { label: 'INP o TBT alto', issue: 'inp-tbt-alto' }, { label: 'Puntaje bajo', issue: 'lh-rendimiento' }] },
    js: { label: 'JavaScript', icon: 'code', tone: 'menta', rows: (r) => !!r.jsDiff, cols: ['url', 'jsTitle', 'jsH1', 'jsWords', 'jsLinks'], filters: [{ label: 'Dependen de JS', issue: 'js-dependiente' }], hideIfEmpty: true },
    organic: { label: 'Tráfico orgánico', icon: 'globe', tone: 'azul', rows: (r) => A.isPage(r), cols: ['url', 'gscClicks', 'gscImpressions', 'gscCtr', 'gscPosition', 'gaViews', 'gaSessions', 'gaEvents', 'googleIndex'], filters: [{ label: 'CTR bajo', issue: 'ctr-bajo' }, { label: 'Oportunidad 4–15', issue: 'oportunidad-4-15' }, { label: 'Sin impresiones', issue: 'sin-impresiones' }, { label: 'Google no indexó', issue: 'no-indexada' }, { label: 'Canonical distinto', issue: 'canonical-google' }] },
    google: { label: 'Google Analytics y Search Console', icon: 'globe', tone: 'azul', special: true },
    lighthouse: { label: 'Lighthouse', icon: 'zap', tone: 'menta', special: true },
    assistant: { label: 'Asistente de IA', icon: 'sparkles', tone: 'lavanda', special: true },
    plan: { label: 'Plan de acción', icon: 'target', tone: 'cielo', special: true },
  };

  const NAV = [
    { section: null, items: ['overview', 'issues'] },
    { section: 'Datos', items: ['all', 'pages', 'resources', 'external'] },
    { section: 'Revisión SEO', items: ['titles', 'descriptions', 'headings', 'content', 'images', 'links', 'redirects', 'indexing', 'sitemaps', 'schema'] },
    { section: 'Negocio', items: ['conversion', 'organic', 'performance', 'js'] },
    { section: 'Conexiones', items: ['google', 'lighthouse', 'assistant', 'plan'] },
  ];
  const TOOL_VIEWS = new Set(['google', 'lighthouse', 'assistant', 'plan']);

  // ======================================================================
  // Utilidades de presentación
  function statusPill(r) {
    if (r.blockedByRobots) return '<span class="pill gris">robots</span>';
    const s = r.status;
    if (!s) return `<span class="pill s5" title="${esc(r.error || '')}">Error</span>`;
    const cls = s >= 500 ? 's5' : s >= 400 ? 's4' : s >= 300 ? 's3' : 's2';
    return `<span class="pill ${cls}">${s}</span>`;
  }
  function pxBar(px, limit, short) {
    if (!px) return '<span class="no">Falta</span>';
    const pct = Math.min(100, (px / limit) * 100);
    const cls = px > limit ? 'over' : short ? 'short' : '';
    const word = px > limit ? 'Largo' : short ? 'Corto' : 'Correcto';
    return `<span class="pxbar"><span class="bar"><i class="${cls}" style="width:${pct}%"></i></span>${px} px · ${word}</span>`;
  }
  // Anillo de puntaje: degradé de petal-celeste a octos-blue. El estado se
  // dice con palabras (healthTag), nunca solo con color.
  let ringSeq = 0;
  function ring(score, size = 108, stroke = 11, fontSize = 30) {
    const r = size / 2 - stroke / 2 - 1;
    const c = 2 * Math.PI * r;
    const off = c * (1 - (score || 0) / 100);
    const id = 'rg' + ++ringSeq;
    return `<div class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}"><defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="ring-stop-a"/><stop offset="1" class="ring-stop-b"/></linearGradient></defs>
      <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      ${score === null || score === undefined ? '' : `<circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>`}</svg>
      <span class="ring-val" style="font-size:${fontSize}px">${score ?? '–'}</span></div>`;
  }
  const healthTag = (score) => {
    if (score === null || score === undefined) return '';
    const [cls, label] = score >= 80 ? ['buena', 'Buena'] : score >= 55 ? ['mejorable', 'Mejorable'] : ['critica', 'Crítica'];
    return `<span class="pill salud ${cls}">${icon(cls === 'buena' ? 'checkCircle' : cls === 'mejorable' ? 'info' : 'alert')}${label}</span>`;
  }
  // Firma de la marca: «Una creación de Mamífero», en estilo nota y
  // ink-muted. «Mamífero» va en texto plano (no hay logo que dibujar).
  const MAMIFERO_URL = 'https://mamiferolab.com/';
  const firma = () => `<button class="firma" data-ext="${MAMIFERO_URL}" title="Abrir mamiferolab.com"><span class="firma-texto">Una creación de</span><img class="firma-logo" src="${window.MAMIFERO_LOGO || ''}" alt="Mamífero"></button>`;
  const sevPill = (sev) => `<span class="pill ${sev}">${A.SEV[sev].label}</span>`;
  const effortLabel = (e) => ['', 'Esfuerzo bajo', 'Esfuerzo medio', 'Esfuerzo alto'][e];
  const catOf = (id) => A.CATEGORIES.find((c) => c.id === id) || { label: id, tone: 'gris' };

  function toast(msg, err = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.innerHTML = `${icon(err ? 'alert' : 'checkCircle')}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), err ? 6000 : 3200);
  }

  // ======================================================================
  // Datos del rastreo
  function resetData() {
    state.rows = [];
    state.byUrl = new Map();
    state.byId = new Map();
    state.edges = [];
    state.meta = null;
    state.result = null;
    state.issuesByRow = new Map();
    state.selectedId = null;
    state.issueId = null;
    state.logs = [];
    state.progress = null;
    state.prevSummary = null;
    state.crawlId = null;
    state.ai.summary = null;
    state.ai.reply = '';
    state.lighthouse.progress = null;
    state.lighthouse.error = '';
    for (const k of Object.keys(state.tables)) state.tables[k].filter = null;
    closeDrawer();
  }

  function addRows(rows) {
    for (const r of rows) {
      const prev = state.byUrl.get(r.url);
      if (prev) {
        const i = state.rows.indexOf(prev);
        if (i >= 0) state.rows[i] = r;
      } else state.rows.push(r);
      state.byUrl.set(r.url, r);
      state.byId.set(r.id, r);
    }
  }

  let analysisTimer = null;
  let lastAnalysis = 0;
  function scheduleAnalysis(force = false) {
    if (force) {
      clearTimeout(analysisTimer);
      analysisTimer = null;
      return runAnalysis();
    }
    if (analysisTimer) return;
    const wait = Math.max(300, 1500 - (Date.now() - lastAnalysis));
    analysisTimer = setTimeout(() => {
      analysisTimer = null;
      runAnalysis();
    }, wait);
  }
  function runAnalysis() {
    lastAnalysis = Date.now();
    if (!state.rows.length) return;
    state.result = A.analyze({ rows: state.rows, edges: state.edges, meta: state.meta || {} });
    state.issuesByRow = new Map();
    for (const it of state.result.issues) for (const id of it.ids) {
      if (!state.issuesByRow.has(id)) state.issuesByRow.set(id, []);
      state.issuesByRow.get(id).push(it);
    }
    refresh();
  }
  const issueById = (id) => (state.result ? state.result.issues.find((i) => i.id === id) : null);

  // ======================================================================
  // Barra superior y navegación
  function renderChrome() {
    const has = state.rows.length > 0 || state.crawlState === 'running' || state.crawlState === 'paused';
    const inWorkspace = (has && state.view !== 'home') || TOOL_VIEWS.has(state.view);
    $('#sidebar').hidden = !inWorkspace;
    $('#crawlbar').hidden = !has;
    const running = state.crawlState === 'running' || state.crawlState === 'paused';
    $('#btn-pause').hidden = !running;
    $('#btn-stop').hidden = !running;
    $('#btn-export').disabled = !state.rows.length;
    $('#btn-pause').innerHTML = icon(state.crawlState === 'paused' ? 'play' : 'pause');
    $('#btn-pause').title = state.crawlState === 'paused' ? 'Reanudar' : 'Pausar';

    if (has) {
      const p = state.progress || { crawled: state.rows.length, total: state.rows.length };
      const dot = $('#crawlbar-dot');
      dot.className = 'crawlbar-dot ' + (state.crawlState === 'running' ? 'running' : state.crawlState === 'paused' ? 'paused' : 'done');
      $('#crawlbar-url').textContent = (state.meta && state.meta.startHost) || '';
      const labels = { running: 'Rastreando', paused: 'En pausa', done: 'Completo', stopped: 'Detenido', idle: 'Abierto' };
      $('#crawlbar-meta').textContent = `${labels[state.crawlState] || ''} · ${fmt(state.rows.length)} URLs${state.crawlState === 'running' && p.rate ? ` · ${p.rate}/s` : ''}`;
      const pct = running ? Math.min(99, (p.crawled / Math.max(1, p.total)) * 100) : 100;
      $('#crawlbar-progress').style.width = pct + '%';
    }
    renderNav();
  }

  function viewCount(id) {
    if (!state.rows.length) return null;
    if (id === 'overview') return null;
    if (id === 'issues') return state.result ? state.result.issues.length : null;
    const v = VIEWS[id];
    if (!v || v.special) return id === 'sitemaps' && state.meta ? state.meta.sitemapUrlCount || null : null;
    const issueFilters = v.filters.filter((f) => f.issue);
    const isReview = issueFilters.length && !['all', 'pages', 'resources', 'external'].includes(id);
    if (isReview && state.result) {
      const ids = new Set();
      for (const f of issueFilters) {
        const it = issueById(f.issue);
        if (it) it.ids.forEach((x) => ids.add(x));
      }
      return { n: ids.size, bad: ids.size > 0 };
    }
    return { n: state.rows.filter(v.rows).length };
  }

  function renderNav() {
    if ($('#sidebar').hidden) return;
    const items = {
      overview: { label: 'Resumen', icon: 'home', tone: 'azul' },
      issues: { label: 'Prioridades', icon: 'target', tone: 'rosa' },
      ...VIEWS,
    };
    let html = '';
    for (const group of NAV) {
      if (group.section) html += `<div class="nav-section">${group.section}</div>`;
      for (const id of group.items) {
        const it = items[id];
        if (it.hideIfEmpty && !state.rows.some(it.rows)) continue;
        const c = viewCount(id);
        let badge = '';
        if (typeof c === 'number') badge = `<span class="count${id === 'issues' && state.result && state.result.stats.issueCounts.critico ? ' bad' : ''}">${fmt(c)}</span>`;
        else if (c && typeof c === 'object') badge = `<span class="count${c.bad ? ' bad' : ''}">${fmt(c.n)}</span>`;
        html += `<button class="nav-item${state.view === id ? ' active' : ''}" data-view="${id}">
          <span class="nav-ico tone-${it.tone}">${icon(it.icon)}</span><span class="nav-label">${it.label}</span>${badge}</button>`;
      }
    }
    $('#nav').innerHTML = html;
    const h = state.meta && state.meta.startedAt ? new Date(state.meta.startedAt).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    $('#sidebar-foot').innerHTML = `${h ? `<div class="foot-date">${icon('clock')} ${esc(h)}</div>` : ''}${firma()}`;
  }

  function go(view) {
    state.view = view;
    if (view !== 'home' && !TOOL_VIEWS.has(view) && !state.rows.length && state.crawlState !== 'running') state.view = 'home';
    refresh(true);
  }

  // ======================================================================
  // Render principal
  let currentTable = null;
  // Historial de vistas para Atrás / Adelante
  const nav = { stack: [], index: -1, lock: false };
  function trackNav() {
    if (!nav.lock && state.view !== nav.stack[nav.index]) {
      nav.stack = nav.stack.slice(0, nav.index + 1);
      nav.stack.push(state.view);
      if (nav.stack.length > 80) nav.stack.shift();
      nav.index = nav.stack.length - 1;
    }
    const back = $('#nav-back');
    const fwd = $('#nav-forward');
    if (back) back.disabled = nav.index <= 0;
    if (fwd) fwd.disabled = nav.index >= nav.stack.length - 1;
  }
  function navStep(delta) {
    const next = nav.index + delta;
    if (next < 0 || next >= nav.stack.length) return;
    nav.index = next;
    nav.lock = true;
    go(nav.stack[next]);
    nav.lock = false;
    trackNav();
  }

  function refresh(full = false) {
    trackNav();
    renderChrome();
    const main = $('#main');
    const v = state.view;
    if (v === 'home') {
      currentTable = null;
      main.className = 'main';
      if (full || !main.dataset.view || main.dataset.view !== 'home') renderHome(main);
    } else if (v === 'overview') {
      currentTable = null;
      main.className = 'main';
      renderOverview(main);
    } else if (v === 'issues') {
      main.className = 'main fill';
      renderIssues(main, full);
    } else if (v === 'sitemaps') {
      currentTable = null;
      main.className = 'main';
      renderSitemaps(main);
    } else if (v === 'google') {
      currentTable = null;
      main.className = 'main';
      renderGoogle(main);
    } else if (v === 'assistant') {
      currentTable = null;
      main.className = 'main';
      renderAssistant(main);
    } else if (v === 'lighthouse') {
      currentTable = null;
      main.className = 'main';
      renderLighthouse(main);
    } else if (v === 'plan') {
      currentTable = null;
      main.className = 'main';
      renderPlan(main);
    } else if (VIEWS[v]) {
      main.className = 'main fill';
      renderTableView(main, v, full);
    }
    main.dataset.view = v;
    if (state.selectedId && $('#drawer').classList.contains('open')) renderDrawer();
  }

  // ---------- Inicio
  function renderHome(main) {
    const s = state.settings;
    const chip = (key, label, title) => `<button class="chip${s[key] ? ' on' : ''}" data-toggle="${key}" title="${esc(title)}"><span class="chip-dot"></span>${label}</button>`;
    const recents = state.history
      .slice(0, 9)
      .map(
        (h) => `<div class="card recent" role="button" tabindex="0" data-history="${esc(h.id)}">
        ${ring(h.score, 58, 7, 17)}
        <div class="recent-info"><div class="recent-host">${esc(h.host)}</div>
        <div class="recent-meta">${fmt(h.pages)} páginas · ${new Date(h.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
        <button class="icon-btn recent-del" data-remove="${esc(h.id)}" title="Quitar del historial">${icon('trash')}</button></div>`
      )
      .join('');
    main.innerHTML = `<div class="home">
      <section class="card hero grad g-blue">
        <div class="hero-top">${appTile(84)}
          <div><h1>Rastrea tu sitio</h1><p>Octos lo recorre como lo haría Google y te entrega un plan de acción claro. Después, conecta Analytics, Search Console, Lighthouse y tu asistente de IA.</p></div></div>
        <form class="url-form" id="url-form" autocomplete="off">
          <div class="url-wrap">${icon('globe')}<input class="url-input" id="url-input" placeholder="https://tusitio.cl" value="${esc(s.lastUrl || '')}" spellcheck="false" aria-label="URL del sitio"></div>
          <button class="btn" type="submit">${icon('play')}Rastrear</button>
        </form>
        <div class="url-error" id="url-error"></div>
        <div class="options-row">
          ${chip('renderJs', 'Renderizar JavaScript', 'Ejecuta la página en Chromium y compara con el HTML original')}
          ${chip('respectRobots', 'Respetar robots.txt', 'No visita URLs bloqueadas por robots.txt')}
          ${chip('includeSubdomains', 'Incluir subdominios', 'blog.tusitio.cl, tienda.tusitio.cl, etc.')}
          ${chip('checkExternal', 'Revisar enlaces externos', 'Comprueba el estado de los enlaces a otros sitios')}
          <span class="sep"></span>
          <select class="select-inline" id="max-urls" aria-label="Límite de URLs">
            ${[500, 1000, 5000, 10000, 25000, 50000].map((n) => `<option value="${n}"${Number(s.maxUrls) === n ? ' selected' : ''}>Hasta ${fmt(n)} URLs</option>`).join('')}
          </select>
          <button class="chip" id="open-settings">${icon('sliders')}Abrir ajustes</button>
        </div>
        <div class="home-connections"><span>Conecta datos y herramientas:</span><button class="link-btn" data-go="google">Google Analytics y Search Console</button><button class="link-btn" data-go="assistant">Asistente de IA</button><button class="link-btn" data-go="lighthouse">Lighthouse</button></div>
      </section>
      ${state.history.length ? `<div class="section-head"><h2>Rastreos recientes</h2><button class="link-btn" id="open-file">Abrir archivo .octos…</button></div><div class="recents">${recents}</div>` : ''}
      <div class="features">
        <div class="card feature grad g-pink"><div class="tile sm">${icon('target')}</div><h3>Prioridades, no listas eternas</h3><p>Cada problema trae por qué importa, cómo arreglarlo y cuánto esfuerzo toma. Empieza por arriba.</p></div>
        <div class="card feature grad g-mint"><div class="keycaps"><div class="tile sm">${MOD}</div><div class="tile sm">K</div></div><h3>Atajos a tu medida</h3><p>Todo está a un atajo de distancia en la paleta de comandos, y puedes cambiar cada combinación en Ajustes.</p></div>
        <div class="card feature grad g-sky"><div class="tile sm">${icon('cart')}</div><h3>SEO que también vende</h3><p>Además de lo técnico, revisa llamadas a la acción, formularios y contacto directo en las páginas clave.</p></div>
      </div>
      <div class="home-foot">${firma()}</div>
    </div>`;
    const input = $('#url-input');
    if (!state.capture) setTimeout(() => input.focus(), 50);
  }

  function normalizeInput(v) {
    let s = String(v || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  async function startCrawl(url) {
    const startUrl = normalizeInput(url);
    if (!startUrl) {
      const err = $('#url-error');
      if (err) err.textContent = 'Escribe una dirección válida, por ejemplo tusitio.cl';
      return;
    }
    state.settings.lastUrl = startUrl;
    saveSettings();
    resetData();
    const host = new URL(startUrl).hostname;
    state.prevSummary = (state.history.find((h) => h.host === host) || {}).summary || null;
    state.meta = { startUrl, startHost: host, startedAt: Date.now() };
    state.crawlState = 'running';
    state.view = 'overview';
    refresh(true);
    const s = state.settings;
    const ua = (USER_AGENTS[s.uaKey] || USER_AGENTS.octos).ua || state.defaults.userAgent;
    await api.start({
      startUrl,
      maxUrls: Number(s.maxUrls) || 5000,
      maxDepth: Number(s.maxDepth) || 12,
      concurrency: Number(s.concurrency) || 6,
      delayMs: Number(s.delayMs) || 0,
      timeoutMs: (Number(s.timeoutSec) || 20) * 1000,
      userAgent: ua,
      respectRobots: !!s.respectRobots,
      includeSubdomains: !!s.includeSubdomains,
      checkExternal: !!s.checkExternal,
      crawlSitemaps: !!s.crawlSitemaps,
      renderJs: !!s.renderJs,
      renderWaitMs: Number(s.renderWaitMs) || 1200,
      includePatterns: String(s.include || '').split('\n'),
      excludePatterns: String(s.exclude || '').split('\n'),
    });
  }

  // ---------- Resumen
  function renderOverview(main) {
    const r = state.result;
    const running = state.crawlState === 'running' || state.crawlState === 'paused';
    if (!r) {
      main.innerHTML = `<div class="view"><div class="view-head"><div><h1>Rastreando ${esc(state.meta ? state.meta.startHost : '')}…</h1><div class="sub">Leyendo robots.txt y sitemaps. Los resultados aparecen en vivo.</div></div></div>
        <div class="card card-pad grad g-blue" style="min-height:260px">${appTile(84)}<div class="log" id="log">${state.logs.map(esc).join('<br>')}</div></div></div>`;
      return;
    }
    const s = r.stats;
    const prev = state.prevSummary;
    let delta = '';
    if (prev && prev.score !== null && r.score !== null && !running) {
      const d = r.score - prev.score;
      delta = `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'same'}">${icon(d > 0 ? 'arrowUp' : d < 0 ? 'arrowDown' : 'chevron')}${d > 0 ? '+' : ''}${d} vs. rastreo anterior</span>`;
    }
    const scoreNote = r.score === null ? 'Aún no hay páginas HTML.' : r.score >= 80 ? 'Buena base. Pule los detalles de la lista.' : r.score >= 55 ? 'Hay mejoras claras con impacto. Empieza por las 5 de abajo.' : 'Hay problemas que frenan el posicionamiento. Prioriza los críticos.';
    const gclass = r.score >= 80 ? 'g-mint' : r.score >= 55 ? 'g-blue' : 'g-pink';
    const top = r.issues.slice(0, 6);
    const fixes = top.length
      ? top
          .map(
            (it, i) => `<button class="fix" data-issue="${it.id}"><span class="fix-n">${i + 1}</span>
          <span><span class="fix-title">${esc(it.title)}</span><span class="fix-meta">${sevPill(it.severity)}<span>${catOf(it.category).label}</span>·<span>${effortLabel(it.effort)}</span></span></span>
          <span class="count">${it.site ? 'Sitio' : fmt(it.count)}</span></button>`
          )
          .join('')
      : '<div class="empty-hint">Sin problemas detectados por ahora.</div>';
    const cats = A.CATEGORIES.map((c) => {
      const n = r.issues.filter((i) => i.category === c.id).length;
      return `<button class="cat" data-cat="${c.id}">${ring(r.categoryScores[c.id], 44, 5, 13)}<span><span class="cat-name">${c.label}</span><br><span class="cat-sub">${r.categoryScores[c.id] === null ? 'Sin datos: conecta Google' : n ? n + ' tipo' + (n === 1 ? '' : 's') + ' de problema' : 'Sin problemas'}</span></span></button>`;
    }).join('');
    const total = Math.max(1, s.internal);
    const statusColors = { '2xx': 'var(--petal-menta)', '3xx': 'var(--petal-celeste)', '4xx': 'var(--petal-lila)', '5xx': 'var(--petal-violeta)', 'Sin respuesta': 'var(--hairline)' };
    const statusBars = Object.entries(s.buckets)
      .filter(([, n]) => n)
      .map(([k, n]) => `<div class="bar-row"><span>${k}</span><span class="bar"><i style="width:${(n / total) * 100}%;background:${statusColors[k]}"></i></span><span class="num">${fmt(n)}</span></div>`)
      .join('');
    const depthKeys = ['0', '1', '2', '3', '4', '5+', '?'].filter((k) => s.depth[k]);
    const maxDepth = Math.max(1, ...depthKeys.map((k) => s.depth[k]));
    const depthColors = ['var(--petal-celeste)', 'var(--petal-cielo)', 'var(--petal-azul)', 'var(--petal-indigo)', 'var(--petal-violeta)', 'var(--petal-lila)', 'var(--hairline)'];
    const depthBars = depthKeys
      .map((k, i) => `<div class="bar-row"><span>${k === '?' ? 'Sin enlace' : k === '0' ? 'Portada' : k + (k === '1' ? ' clic' : ' clics')}</span><span class="bar"><i style="width:${(s.depth[k] / maxDepth) * 100}%;background:${depthColors[i]}"></i></span><span class="num">${fmt(s.depth[k])}</span></div>`)
      .join('');

    main.innerHTML = `<div class="view">
      <div class="view-head"><div><h1>${running ? 'Rastreando' : 'Resumen de'} ${esc(state.meta.startHost)}</h1>
        <div class="sub">${running ? 'Los números se actualizan mientras Octos avanza.' : `${fmt(s.total)} URLs analizadas en ${Math.max(1, Math.round(((state.meta.finishedAt || Date.now()) - state.meta.startedAt) / 1000))} s`}</div></div>
        ${running ? '' : `<button class="btn sm" id="ov-report">${icon('download')}Exportar informe</button>`}</div>
      <div class="grid-kpi">
        <div class="card score-card grad ${gclass}">${ring(r.score, 112, 12, 34)}<div><div class="score-title"><h2>Salud SEO</h2>${healthTag(r.score)}</div><div class="big-note">${scoreNote}</div>${delta}</div></div>
        <div class="card kpi"><span class="kpi-label">${icon('file')}Páginas HTML</span><span class="kpi-value">${fmt(s.pages)}</span><span class="kpi-foot">${fmt(s.internal - s.pages)} redirecciones, errores y recursos</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('shield')}Indexables</span><span class="kpi-value">${fmt(s.indexable)}</span><span class="kpi-foot">${s.pages ? Math.round((s.indexable / s.pages) * 100) : 0} % de las páginas</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('clock')}Respuesta mediana</span><span class="kpi-value">${fmt(s.medianTime)}<small style="font-size:14px;font-weight:600"> ms</small></span><span class="kpi-foot">El 10 % más lento: ${fmt(s.p90Time)} ms</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('cart')}Con llamada a la acción</span><span class="kpi-value">${s.pages ? Math.round((s.withCta / s.pages) * 100) : 0}<small style="font-size:14px;font-weight:600"> %</small></span><span class="kpi-foot">${fmt(s.withCta)} de ${fmt(s.pages)} páginas</span></div>
      </div>
      <div class="grid-2">
        <div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Arregla primero</h2><button class="link-btn" data-go="issues">Revisar las ${r.issues.length}</button></div>
          <div class="sub">Ordenado por impacto y esfuerzo.</div><div class="fix-list">${fixes}</div></div>
        <div class="card card-pad"><h2>Por área</h2><div class="sub">Puntaje de 0 a 100 en cada frente.</div><div class="cat-grid">${cats}</div></div>
      </div>
      <div class="grid-3">
        <div class="card card-pad"><h3>Códigos de estado</h3><div class="bars">${statusBars || '<span class="sub">—</span>'}</div></div>
        <div class="card card-pad"><h3>Profundidad en clics</h3><div class="bars">${depthBars || '<span class="sub">—</span>'}</div></div>
        <div class="card card-pad"><h3>Datos estructurados</h3><div class="sub" style="margin-top:4px">${fmt(s.withSchema)} de ${fmt(s.pages)} páginas tienen JSON-LD.</div>
          <div class="types">${s.schemaTypes.map(([t, n]) => `<span class="pill gris">${esc(t)} · ${n}</span>`).join('') || '<span class="sub">Ninguno encontrado.</span>'}</div>
          ${running ? `<div class="log" id="log">${state.logs.slice(-8).map(esc).join('<br>')}</div>` : ''}</div>
      </div>
    </div>`;
  }

  // ---------- Prioridades
  function renderIssues(main, full) {
    const r = state.result;
    if (!r) {
      main.innerHTML = '<div class="card vt-empty">Esperando los primeros resultados…</div>';
      return;
    }
    const list = r.issues.filter((i) => state.issueCat === 'todas' || i.category === state.issueCat);
    if (!state.issueId || !list.some((i) => i.id === state.issueId)) state.issueId = list[0] ? list[0].id : null;
    const prevScroll = $('.issues-list', main) ? $('.issues-list', main).scrollTop : 0;
    const chips = [{ id: 'todas', label: 'Todas' }, ...A.CATEGORIES]
      .map((c) => {
        const n = c.id === 'todas' ? r.issues.length : r.issues.filter((i) => i.category === c.id).length;
        return `<button class="chip${state.issueCat === c.id ? ' on' : ''}" data-cat-filter="${c.id}">${c.label.replace(' y datos estructurados', '')}<span class="count">${n}</span></button>`;
      })
      .join('');
    const items = list
      .map(
        (it) => `<button class="issue-item${it.id === state.issueId ? ' active' : ''}" data-issue-pick="${it.id}">
        <span class="t">${esc(it.title)}</span><span class="count">${it.site ? 'Sitio' : fmt(it.count)}</span>
        <span class="m">${sevPill(it.severity)}<span>${catOf(it.category).label}</span>·<span>${effortLabel(it.effort)}</span></span></button>`
      )
      .join('');
    const it = issueById(state.issueId);
    const tone = it ? { critico: 'g-pink', alto: 'g-lila', medio: 'g-blue', bajo: 'g-sky' }[it.severity] : 'g-blue';
    main.innerHTML = `<div class="issues-layout">
      <div class="card issues-list"><div class="issues-filters">${chips}</div>${items || '<div class="empty-hint">Nada en esta categoría.</div>'}</div>
      <div class="card issue-detail">${
        it
          ? `<div class="issue-hero grad ${tone}"><div style="display:flex;gap:6px">${sevPill(it.severity)}<span class="pill gris">${catOf(it.category).label}</span><span class="pill gris">${effortLabel(it.effort)}</span></div>
            <h2>${esc(it.title)}</h2><div class="sub">${it.site ? 'Afecta a todo el sitio' : `${fmt(it.count)} URL${it.count === 1 ? '' : 's'} afectada${it.count === 1 ? '' : 's'} · ${Math.round(it.share * 100)} % de las páginas`}</div>
            <div class="explain"><div><b>${icon('info')}Por qué importa</b>${esc(it.why)}</div><div><b>${icon('wrench')}Cómo arreglarlo</b>${esc(it.fix)}</div></div></div>
            <div class="issue-urls">${it.site ? '<div class="vt-empty">Es un ajuste general del sitio, no de una URL concreta.</div>' : `<div class="toolbar"><h1 style="font-size:14px">URLs afectadas</h1><span class="spacer"></span><button class="btn sm secondary" id="issue-csv">${icon('download')}Exportar CSV</button></div><div class="vt" id="issue-table"></div>`}</div>`
          : '<div class="vt-empty"><div class="tile">' + icon('checkCircle') + '</div>Sin problemas.</div>'
      }</div></div>`;
    $('.issues-list', main).scrollTop = prevScroll;
    if (it && !it.site) {
      const rows = it.ids.map((id) => state.byId.get(id)).filter(Boolean);
      const cols = issueColumns(it);
      currentTable = new VTable($('#issue-table'), { columns: cols, key: 'issue:' + it.id });
      currentTable.setRows(rows);
    } else currentTable = null;
  }

  function issueColumns(it) {
    const map = {
      contenido: { 'title-falta': ['url', 'title'], 'title-dup': ['url', 'title', 'dupTitle'], 'title-largo': ['url', 'title', 'titlePx'], 'title-corto': ['url', 'title', 'titleLen'], 'desc-falta': ['url', 'desc'], 'desc-dup': ['url', 'desc', 'dupDesc'], 'desc-larga': ['url', 'desc', 'descPx'], 'img-alt': ['url', 'imgs', 'imgsNoAlt'], 'contenido-pobre': ['url', 'words', 'title'], 'casi-duplicado': ['url', 'nearDup', 'title'] },
      enlaces: { cadenas: ['url', 'redirectTo', 'hops', 'finalStatus'], 'redireccion-temporal': ['url', 'status', 'redirectTo'], bucles: ['url', 'redirectTo', 'finalStatus'], 'enlaces-rotos': ['url', 'title', 'outInt'] },
      rendimiento: { lenta: ['url', 'time', 'size'], pesada: ['url', 'size'], 'sin-compresion': ['url', 'compression', 'size'], 'scripts-bloqueantes': ['url', 'blocking', 'scripts'], terceros: ['url', 'third'] },
      conversion: { 'sin-cta': ['url', 'title', 'depth', 'forms'], 'form-sin-label': ['url', 'forms', 'fields'], 'form-largo': ['url', 'forms', 'fields'] },
      indexacion: { huerfanas: ['url', 'title', 'sitemap', 'inlinks'], profundas: ['url', 'depth', 'inlinks'], 'canonical-roto': ['url', 'canonical'], noindex: ['url', 'robots', 'inlinks'], 'sitemap-no-indexable': ['url', 'status', 'indexable'] },
    };
    const keys = (map[it.category] && map[it.category][it.id]) || ['url', 'status', 'indexable', 'title', 'inlinks'];
    return keys.map((k) => C[k]);
  }

  // ---------- Sitemaps
  function renderSitemaps(main) {
    const m = state.meta || {};
    const files = m.sitemapFiles || [];
    const r = state.result;
    const pages = r ? state.rows.filter(A.isPage) : [];
    const inMap = pages.filter((p) => p.inSitemap);
    const missing = pages.filter((p) => p.indexable && !p.inSitemap);
    const bad = issueById('sitemap-no-indexable');
    const orphans = issueById('huerfanas');
    main.innerHTML = `<div class="view">
      <div class="view-head"><div><h1>Sitemaps</h1><div class="sub">Lo que le dices a Google que existe, comparado con lo que Octos encontró.</div></div>
        <button class="btn sm" id="gen-sitemap">${icon('sitemap')}Generar sitemap limpio</button></div>
      <div class="grid-kpi" style="grid-template-columns:repeat(4,1fr)">
        <div class="card kpi"><span class="kpi-label">${icon('sitemap')}URLs en sitemaps</span><span class="kpi-value">${fmt(m.sitemapUrlCount || 0)}</span><span class="kpi-foot">${files.filter((f) => f.status === 200).length} archivo(s) leído(s)</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('alert')}En sitemap y no indexables</span><span class="kpi-value">${fmt(bad ? bad.count : 0)}</span><span class="kpi-foot">Deberían salir del sitemap</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('link')}Huérfanas</span><span class="kpi-value">${fmt(orphans ? orphans.count : 0)}</span><span class="kpi-foot">En el sitemap, sin enlaces internos</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('eye')}Indexables fuera del sitemap</span><span class="kpi-value">${fmt(missing.length)}</span><span class="kpi-foot">${fmt(inMap.length)} de ${fmt(pages.length)} páginas sí están</span></div>
      </div>
      <div class="card card-pad"><h2>Archivos</h2>
        ${files.length ? `<div class="link-list" style="margin-top:10px">${files.map((f) => `<div class="link-row"><span class="u">${esc(f.url)}</span><span>${f.status === 200 ? (f.index ? `<span class="pill gris">Índice · ${f.children}</span>` : `<span class="pill ok">${fmt(f.urls)} URLs</span>`) : statusPill({ status: f.status, error: f.error })}</span></div>`).join('')}</div>` : '<div class="empty-hint">No se encontró ningún sitemap en robots.txt ni en /sitemap.xml. Genera uno con el botón de arriba y decláralo en robots.txt.</div>'}
      </div>
      ${m.robotsTxt ? `<div class="card card-pad"><h2>robots.txt</h2><pre class="log selectable" style="max-height:260px">${esc(m.robotsTxt)}</pre></div>` : ''}
    </div>`;
  }

  function renderPlan(main) {
    if (!state.result) {
      main.innerHTML = `<div class="view"><div class="view-head"><div><h1>Plan de acción</h1><div class="sub">Rastrea un sitio para ordenar sus mejoras por plazo.</div></div></div><div class="card card-pad">${firma()}</div></div>`;
      return;
    }
    const groups = window.OctosPlan.buildActionPlan(state.result, { rows: state.rows });
    const content = groups.map((group) => `<section class="card card-pad plan-group"><div class="plan-head"><div><span class="eyebrow">${esc(group.horizonte)}</span><h2>${esc(group.titulo)}</h2></div><span class="count">${fmt(group.acciones.length)} acciones</span></div>
      ${group.acciones.length ? `<div class="plan-list">${group.acciones.map((action) => `<article class="plan-action"><div class="plan-action-title">${A.SEV[action.severidad] ? sevPill(action.severidad) : `<span class="pill gris">${esc(action.severidad)}</span>`}<b>${esc(action.titulo)}</b><span class="pill gris">${effortLabel(action.esfuerzo)}</span></div><p>${esc(action.como || action.porque || '')}</p>${action.urls.length ? `<div class="plan-urls">${action.urls.map((url) => `<button class="link-btn" data-select-url="${esc(url)}">${esc(pathOf(url))}</button>`).join('')}</div>` : ''}</article>`).join('')}</div>` : '<div class="empty-hint">No hay acciones en este plazo.</div>'}</section>`).join('');
    main.innerHTML = `<div class="view"><div class="view-head"><div><h1>Plan de acción</h1><div class="sub">Ordena ${fmt(state.result.issues.length)} problemas por impacto, esfuerzo y plazo.</div></div><button class="btn sm secondary" data-integration="export-pptx">${icon('download')}Exportar PowerPoint</button></div>${content}</div>`;
  }

  function loadGoogleCatalog() {
    if (state.google.loading || state.google.loaded) return;
    state.google.loading = true;
    state.google.error = '';
    return api.googleCatalog().then((data) => {
      state.google.status = data.status;
      state.google.sites = data.sites || [];
      state.google.properties = data.properties || [];
      state.google.range = data.range;
      state.google.suggestedSite = data.suggestedSite;
      if (!state.settings.googleSiteUrl && data.suggestedSite) state.settings.googleSiteUrl = data.suggestedSite.siteUrl;
      if (!state.settings.googleProperty && state.google.properties.length === 1) state.settings.googleProperty = state.google.properties[0].property;
      state.google.loaded = true;
    }).catch((err) => {
      state.google.error = err.message || String(err);
      state.google.loaded = true;
    }).finally(() => {
      state.google.loading = false;
      if (state.view === 'google') refresh(true);
    });
  }

  // Paso a paso para crear el cliente OAuth de escritorio en Google Cloud
  function googleGuide(connected) {
    const C = 'https://console.cloud.google.com/';
    const link = (label, url) => `<button class="btn sm secondary" type="button" data-ext="${C}${url}">${icon('external')}${label}</button>`;
    return `<details class="card guide"${state.google.guideOpen ? ' open' : ''}>
      <summary><span class="nav-ico tone-lavanda">${icon('map')}</span><div><h2>Cómo conseguir tu ID de cliente y tu secreto</h2><div class="sub">Paso a paso en Google Cloud. Se hace una sola vez y toma unos 10 minutos.</div></div><span class="chev">${icon('chevron')}</span></summary>
      <div class="guide-body">
        <p class="field-help">Google pide que cada aplicación tenga su propio acceso. Octos nunca ve tu contraseña: solo recibe un permiso de lectura que puedes revocar cuando quieras. Los nombres de los menús pueden variar un poco según el idioma de tu consola.</p>
        <ol class="guide-steps">
          <li><div><h3>Crea un proyecto</h3><p>Entra a Google Cloud con la cuenta que tiene acceso a Search Console y a Analytics. Pulsa el selector de proyectos, elige <b>Proyecto nuevo</b>, escribe <b>Octos</b> como nombre y pulsa <b>Crear</b>.</p><div class="guide-links">${link('Crear proyecto', 'projectcreate')}</div></div></li>
          <li><div><h3>Activa las tres APIs</h3><p>Abre cada enlace, comprueba que arriba esté seleccionado el proyecto <b>Octos</b> y pulsa <b>Habilitar</b>: Google Search Console API, Google Analytics Data API y Google Analytics Admin API.</p><div class="guide-links">${link('Search Console API', 'apis/library/searchconsole.googleapis.com')}${link('Analytics Data API', 'apis/library/analyticsdata.googleapis.com')}${link('Analytics Admin API', 'apis/library/analyticsadmin.googleapis.com')}</div></div></li>
          <li><div><h3>Configura la pantalla de consentimiento</h3><p>Abre el menú <b>Google Auth platform</b>. Si dice que aún no está configurada, pulsa <b>Comenzar</b> y rellena:</p><p><b>Información de la aplicación:</b> nombre <b>Octos</b> y tu correo como correo de asistencia. Pulsa Siguiente.<br><b>Público:</b> elige <b>Externo</b> (elige <b>Interno</b> solo si tu cuenta es de Google Workspace y la usará únicamente tu organización). Pulsa Siguiente.<br><b>Información de contacto:</b> tu correo. Pulsa Siguiente.<br><b>Finalizar:</b> acepta la política de datos de usuario de los servicios de API de Google, pulsa Continuar y luego Crear.</p><div class="guide-links">${link('Abrir Google Auth platform', 'auth/overview')}</div></div></li>
          <li><div><h3>Agrega tu correo como usuario de prueba</h3><p>Si elegiste Externo, ve a <b>Público</b>, busca <b>Usuarios de prueba</b>, pulsa <b>Agregar usuarios</b>, escribe tu correo de Google y pulsa <b>Guardar</b>.</p><div class="guide-links">${link('Abrir Público', 'auth/audience')}</div></div></li>
          <li><div><h3>Autoriza los permisos de solo lectura</h3><p>Ve a <b>Acceso a los datos</b> y pulsa <b>Agregar o quitar permisos</b>. Marca <b>.../auth/webmasters.readonly</b> (Search Console) y <b>.../auth/analytics.readonly</b> (Analytics). Pulsa Actualizar y luego Guardar. Octos solo lee datos: nunca modifica nada en tus cuentas.</p><div class="guide-links">${link('Abrir Acceso a los datos', 'auth/scopes')}</div></div></li>
          <li><div><h3>Crea el cliente OAuth</h3><p>Ve a <b>Clientes</b> y pulsa <b>Crear cliente</b>. En <b>Tipo de aplicación</b> elige <b>Aplicación de escritorio</b> (Desktop app), escribe <b>Octos</b> como nombre y pulsa <b>Crear</b>. Google muestra el <b>ID de cliente</b> y el <b>Secreto del cliente</b>: cópialos.</p><div class="guide-links">${link('Abrir Clientes', 'auth/clients')}</div></div></li>
          <li><div><h3>Pega los datos aquí y conecta</h3><p>Pega el ID y el secreto en los campos de abajo, pulsa <b>Guardar cliente</b> y luego <b>Conectar Google</b>. Se abrirá tu navegador: elige tu cuenta y acepta los permisos. Después elige tu propiedad de Search Console y de Analytics y pulsa <b>Sincronizar con el rastreo</b>.</p></div></li>
        </ol>
        <div class="guide-notes">
          <h3>Antes de empezar, ten en cuenta</h3>
          <p><b>Aviso «Google no verificó esta aplicación».</b> Es normal en una app propia. Pulsa <b>Avanzado</b> y luego <b>Ir a Octos (no seguro)</b>.</p>
          <p><b>Conexión que vence cada 7 días.</b> Si dejas la app en estado <b>Prueba</b>, Google cierra la sesión cada 7 días. Para evitarlo, entra a <b>Público</b> y pulsa <b>Publicar la app</b>. Como solo la usas tú, no necesita verificación.</p>
          <p><b>Permisos en tus cuentas.</b> Tu cuenta debe ser propietaria o usuaria de la propiedad en Search Console y tener al menos el rol Lector en Analytics 4.</p>
        </div>
      </div>
    </details>`;
  }

  function renderGoogle(main) {
    if (!state.google.loaded) loadGoogleCatalog();
    const g = state.google;
    const connected = !!(g.status && g.status.connected);
    const stat = state.result?.stats || {};
    const siteValue = state.settings.googleSiteUrl || g.suggestedSite?.siteUrl || '';
    const propertyValue = state.settings.googleProperty || '';
    const sites = g.sites.map((x) => `<option value="${esc(x.siteUrl)}"${x.siteUrl === siteValue ? ' selected' : ''}>${esc(x.siteUrl)} · ${esc(x.permissionLevel || 'acceso')}</option>`).join('');
    const properties = g.properties.map((x) => `<option value="${esc(x.property)}"${x.property === propertyValue ? ' selected' : ''}>${esc(x.displayName)} · ${esc(x.property)}</option>`).join('');
    const range = g.range || {};
    main.innerHTML = `<div class="view integrations-view">
      <div class="view-head"><div><h1>Google Analytics y Search Console</h1><div class="sub">Cruza clics, impresiones, consultas, sesiones e indexación con las URLs rastreadas.</div></div>${connected ? `<span class="pill ok">Conectado${g.status.email ? ` · ${esc(g.status.email)}` : ''}</span>` : g.loading ? '<span class="pill gris">Consultando…</span>' : ''}</div>
      ${connected ? '' : `<div class="callout"><span>Rellena la información de abajo para sumar datos de Google a tus rastreos: clics, impresiones, posición y visitas por página. Si no tienes un ID de cliente, sigue el paso a paso.</span><button class="btn sm" type="button" data-guide-open>${icon('map')}Ver el paso a paso</button></div>`}
      ${g.status?.storage === 'local' ? '<div class="notice">Octos guarda tus credenciales cifradas en este equipo.</div>' : ''}
      ${googleGuide(connected)}
      <div class="integration-grid">
        <section class="card card-pad integration-card grad g-blue"><div class="integration-title"><span class="nav-ico tone-azul">${icon('globe')}</span><div><h2>Conecta Google</h2><div class="sub">Tus credenciales se guardan cifradas en este equipo.</div></div></div>
          ${connected ? `<div class="connected-line"><span class="pill ok">Acceso autorizado</span><span class="sub">Search Console y Analytics de lectura</span></div><div class="integration-actions"><button class="btn sm secondary" data-integration="google-refresh">${icon('refresh')}Actualizar propiedades</button><button class="btn sm secondary" data-integration="google-disconnect">Desconectar cuenta</button></div>` : `<p>Usa tu cliente OAuth de tipo aplicación de escritorio. Puedes descargar el JSON completo o pegar sus credenciales.</p><div class="form-grid integration-form"><div class="field full"><label for="google-client-id">ID de cliente OAuth</label><input id="google-client-id" autocomplete="off" placeholder="…apps.googleusercontent.com"></div><div class="field full"><label for="google-client-secret">Secreto de cliente OAuth</label><input id="google-client-secret" type="password" autocomplete="new-password" placeholder="Se guarda cifrado en este equipo"></div></div><div class="integration-actions"><button class="btn sm" data-integration="google-save-client">Guardar cliente</button>${g.status?.hasOAuthClient ? `<button class="btn sm secondary" data-integration="google-connect"${g.connecting ? ' disabled' : ''}>${g.connecting ? 'Esperando autorización…' : 'Conectar Google'}</button>` : ''}</div><div class="hint">En Google Cloud activa Search Console API y Google Analytics Data API; crea una pantalla de consentimiento y un cliente OAuth de escritorio.</div><button class="link-btn" data-ext="https://console.cloud.google.com/apis/credentials">Abrir credenciales de Google Cloud</button>`}
          ${g.error ? `<div class="inline-error">${esc(g.error)}</div>` : ''}
        </section>
        <section class="card card-pad integration-card"><div class="integration-title"><span class="nav-ico tone-cielo">${icon('gauge')}</span><div><h2>Elige las propiedades</h2><div class="sub">Octos propone Search Console según el dominio rastreado.</div></div></div>
          ${connected ? `<div class="form-grid integration-form"><div class="field full"><label for="google-site">Propiedad de Search Console</label><select id="google-site"><option value="">No sincronizar Search Console</option>${sites}</select></div><div class="field full"><label for="google-property">Propiedad de Analytics 4</label><select id="google-property"><option value="">No sincronizar Analytics</option>${properties}</select></div><div class="field"><label for="google-start">Desde</label><input id="google-start" type="date" value="${esc(range.startDate || '')}"></div><div class="field"><label for="google-end">Hasta</label><input id="google-end" type="date" value="${esc(range.endDate || '')}"></div></div><div class="integration-actions"><button class="btn sm" data-integration="google-sync"${state.rows.length && !g.busy ? '' : ' disabled'}>${icon('refresh')}${g.busy ? 'Sincronizando…' : 'Sincronizar con el rastreo'}</button><span class="hint">Search Console usa datos disponibles hasta hace dos días.</span></div>` : `<div class="empty-hint">Conecta una cuenta para elegir sus propiedades.</div>`}
        </section>
      </div>
      <div class="grid-kpi integration-kpis"><div class="card kpi"><span class="kpi-label">Clics orgánicos</span><span class="kpi-value">${fmt(stat.gsc?.clicks)}</span><span class="kpi-foot">${fmt(stat.gsc?.pages)} páginas con datos</span></div><div class="card kpi"><span class="kpi-label">Impresiones</span><span class="kpi-value">${fmt(stat.gsc?.impressions)}</span><span class="kpi-foot">CTR ${stat.gsc?.ctr == null ? '–' : (stat.gsc.ctr * 100).toFixed(1) + ' %'}</span></div><div class="card kpi"><span class="kpi-label">Sesiones GA4</span><span class="kpi-value">${fmt(stat.ga?.sessions)}</span><span class="kpi-foot">${fmt(stat.ga?.views)} vistas · ${fmt(stat.ga?.keyEvents)} eventos clave</span></div><div class="card kpi"><span class="kpi-label">Cobertura revisada</span><span class="kpi-value">${fmt(stat.inspection?.pages)}</span><span class="kpi-foot">URLs inspeccionadas en Google</span></div></div>
      <div class="card card-pad"><div class="integration-title"><div><h2>Inspección de URL bajo demanda</h2><div class="sub">Abre el detalle de una página y pulsa «Inspeccionar en Google» para revisar su cobertura e indexación.</div></div><button class="btn sm secondary" data-go="all"${state.rows.length ? '' : ' disabled'}>Ver URLs</button></div></div>
      ${firma()}</div>`;
  }

  function aiConfig() {
    return {
      provider: $('#ai-provider')?.value || state.settings.aiProvider || 'anthropic',
      model: $('#ai-model')?.value || state.settings.aiModel || '',
      baseURL: $('#ai-base-url')?.value || state.settings.aiBaseURL || '',
      effort: state.settings.aiEffort,
    };
  }

  const ANTHROPIC_MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  ];

  function aiConfigured(provider) {
    return provider === 'compatible' ? !!(state.settings.aiBaseURL || state.ai.status?.baseURL) : !!state.ai.status?.[provider];
  }

  // Carga los modelos del proveedor elegido en cuanto hay clave (o URL, en un endpoint compatible)
  function ensureAiModels(force = false) {
    const cfg = aiConfig();
    if (!state.ai.status || !aiConfigured(cfg.provider)) return;
    if (!force && (state.ai.modelsFor === cfg.provider || state.ai.loadingModels)) return;
    state.ai.loadingModels = true;
    state.ai.modelsError = '';
    Promise.resolve(cfg.provider === 'compatible' && cfg.baseURL ? api.aiSetBaseURL(cfg.baseURL) : null)
      .then(() => api.aiModels(cfg))
      .then((list) => { state.ai.models = Array.isArray(list) ? list : []; })
      .catch((err) => { state.ai.models = []; state.ai.modelsError = err.message || String(err); })
      .finally(() => {
        state.ai.modelsFor = cfg.provider;
        state.ai.loadingModels = false;
        if (state.view === 'assistant') refresh(true);
      });
  }

  function loadAiStatus() {
    if (state.ai.loaded) return;
    state.ai.loaded = true;
    api.aiStatus().then((status) => { state.ai.status = status; if (state.view === 'assistant') refresh(true); }).catch((err) => { state.ai.error = err.message || String(err); if (state.view === 'assistant') refresh(true); });
  }

  function renderAssistant(main) {
    loadAiStatus();
    const provider = state.settings.aiProvider || 'anthropic';
    const model = state.settings.aiModel || (provider === 'anthropic' ? 'claude-opus-5-5' : '');
    const configured = provider === 'compatible' ? !!(state.settings.aiBaseURL || state.ai.status?.baseURL) : !!state.ai.status?.[provider];
    const summary = state.ai.summary || state.meta?.aiSummary;
    const summaryHtml = summary ? `<section class="card card-pad ai-output"><span class="eyebrow">Resumen ejecutivo</span><p class="ai-lead">${esc(summary.resumen)}</p><div class="ai-findings">${(summary.hallazgos || []).map((h) => `<article><span class="pill ${h.impacto === 'alto' ? 'alto' : h.impacto === 'medio' ? 'medio' : 'gris'}">${esc(h.impacto)}</span><div><b>${esc(h.titulo)}</b><p>${esc(h.detalle)}</p></div></article>`).join('')}</div></section>` : '';
    const reply = state.ai.reply ? `<div class="ai-reply"><b>Respuesta</b><p>${esc(state.ai.reply)}</p></div>` : '';
    const known = state.ai.modelsFor === provider && state.ai.models.length ? state.ai.models : provider === 'anthropic' ? ANTHROPIC_MODELS : [];
    const knownIds = new Set(known.map((x) => x.id));
    const modelList = [...(model && !knownIds.has(model) ? [{ id: model, label: model }] : []), ...known];
    const modelOptions = modelList.length
      ? modelList.map((x) => `<option value="${esc(x.id)}"${x.id === model ? ' selected' : ''}>${esc(x.label || x.id)}</option>`).join('')
      : `<option value="">${state.ai.loadingModels ? 'Buscando modelos…' : 'Guarda tu clave para ver los modelos'}</option>`;
    const modelHint = state.ai.loadingModels ? 'Buscando los modelos de tu cuenta…' : state.ai.modelsError ? `No pudimos cargar la lista: ${state.ai.modelsError}` : state.ai.modelsFor === provider && state.ai.models.length ? `${fmt(state.ai.models.length)} modelos disponibles en tu cuenta.` : configured ? 'Pulsa «Actualizar modelos» para ver la lista de tu cuenta.' : provider === 'anthropic' ? 'Lista de ejemplo. Guarda tu clave para ver todos los modelos de tu cuenta.' : 'Guarda tu clave para ver los modelos de este proveedor.';
    main.innerHTML = `<div class="view integrations-view"><div class="view-head"><div><h1>Asistente de IA</h1><div class="sub">Analiza problemas, prioriza oportunidades y redacta un resumen a partir de los datos del rastreo.</div></div>${configured ? '<span class="pill ok">Clave guardada</span>' : ''}</div>${configured ? '' : '<div class="callout">Elige un proveedor y pega tu clave de API para que Octos analice problemas, priorice oportunidades y redacte un resumen de tu rastreo.</div>'}
      <section class="card card-pad integration-card grad g-lila"><div class="integration-title"><span class="nav-ico tone-lavanda">${icon('sparkles')}</span><div><h2>Conecta tu proveedor</h2><div class="sub">Tu clave se guarda cifrada en este equipo y nunca llega a la interfaz.</div></div></div>
        <div class="form-grid integration-form"><div class="field"><label for="ai-provider">Proveedor</label><select id="ai-provider"><option value="anthropic"${provider === 'anthropic' ? ' selected' : ''}>Claude · Anthropic</option><option value="openai"${provider === 'openai' ? ' selected' : ''}>OpenAI</option><option value="compatible"${provider === 'compatible' ? ' selected' : ''}>Compatible con OpenAI</option></select></div>
          <div class="field"><label for="ai-model">Modelo</label><select id="ai-model"${modelList.length ? '' : ' disabled'}>${modelOptions}</select><div class="hint">${esc(modelHint)}</div></div>
          <div class="field full"><label for="ai-key">Clave de API</label><div class="inline-field"><input id="ai-key" type="password" autocomplete="new-password" placeholder="${configured ? 'Ya hay una clave guardada; deja vacío para conservarla' : 'Pega tu clave de API'}"><button class="btn sm" data-integration="ai-save-key">Guardar clave</button>${configured ? '<button class="btn sm secondary" data-integration="ai-clear-key">Borrar</button>' : ''}</div></div>
          ${provider === 'compatible' ? `<div class="field full"><label for="ai-base-url">URL compatible con OpenAI</label><input id="ai-base-url" value="${esc(state.settings.aiBaseURL || state.ai.status?.baseURL || '')}" placeholder="http://127.0.0.1:11434/v1"><div class="hint">Admite Ollama, Gemini, Groq, Mistral, OpenRouter, DeepSeek y otros.</div></div>` : ''}
        </div><div class="integration-actions"><button class="btn sm secondary" data-integration="ai-models"${configured ? '' : ' disabled'}>Actualizar modelos</button><button class="btn sm secondary" data-integration="ai-test">Probar conexión</button>${state.rows.length ? `<button class="btn sm" data-integration="ai-summary"${state.ai.busy ? ' disabled' : ''}>${icon('sparkles')}${state.ai.busy ? 'Generando…' : 'Crear resumen ejecutivo'}</button>` : ''}</div>
        ${state.ai.error ? `<div class="inline-error">${esc(state.ai.error)}</div>` : ''}</section>
      ${summaryHtml}
      ${state.rows.length ? `<section class="card card-pad"><h2>Pregunta sobre este rastreo</h2><div class="sub">La respuesta se basa en los problemas, las métricas conectadas y el plan actual.</div><form id="ai-question-form" class="ai-question"><textarea id="ai-question" rows="2" placeholder="¿Qué tres cambios podrían mejorar más el tráfico orgánico?" required></textarea><button class="btn sm" type="submit"${state.ai.busy ? ' disabled' : ''}>Preguntar</button></form>${reply}</section>` : '<section class="card card-pad"><h2>Analiza una página</h2><div class="sub">Cuando abras un rastreo, selecciona una URL y usa la pestaña IA de su panel para revisar título, contenido, conversión y datos estructurados.</div></section>'}
      <div class="notice">Octos envía los datos del rastreo al proveedor de IA que elijas para responder. El uso de la API puede generar cargos según tu proveedor y modelo.</div>${firma()}</div>`;
    ensureAiModels();
  }

  function renderLighthouse(main) {
    if (!state.lighthouse.loaded) {
      state.lighthouse.loaded = true;
      api.lighthouseStatus().then((status) => { state.lighthouse.status = status; if (state.view === 'lighthouse') refresh(true); }).catch((err) => { state.lighthouse.error = err.message || String(err); if (state.view === 'lighthouse') refresh(true); });
    }
    const source = state.settings.lighthouseSource || 'local';
    const strategy = state.settings.lighthouseStrategy || 'mobile';
    const limit = state.settings.lighthouseLimit || 10;
    const pages = state.rows.filter((row) => A.isPage(row));
    const audited = pages.filter((row) => row.lighthouse?.mobile || row.lighthouse?.desktop);
    const rows = audited.slice(0, 60).map((row) => {
      const item = row.lighthouse?.[strategy] || row.lighthouse?.mobile || row.lighthouse?.desktop;
      return `<button class="lh-row" data-select="${row.id}"><span class="lh-score">${item?.scores?.performance ?? '–'}</span><span class="lh-url"><b>${esc(row.title || pathOf(row.url))}</b><small>${esc(pathOf(row.url))}</small></span><span class="lh-metric">LCP ${item?.metrics?.lcp == null ? '–' : (item.metrics.lcp / 1000).toFixed(1) + ' s'}</span><span class="pill ${item?.source === 'psi' ? 'gris' : 'borde'}">${item?.source === 'psi' ? 'PageSpeed' : 'Local'}</span></button>`;
    }).join('');
    const progress = state.lighthouse.progress;
    main.innerHTML = `<div class="view integrations-view"><div class="view-head"><div><h1>Lighthouse</h1><div class="sub">Revisa rendimiento, accesibilidad, buenas prácticas y SEO por página. Ejecuta auditorías cuando las necesites.</div></div><span class="pill ${state.lighthouse.status?.chromePath ? 'ok' : 'gris'}">${state.lighthouse.status?.chromePath ? 'Chrome disponible' : 'Chrome no encontrado'}</span></div>
      <section class="card card-pad integration-card grad g-mint"><div class="integration-title"><span class="nav-ico tone-menta">${icon('zap')}</span><div><h2>Audita páginas del rastreo</h2><div class="sub">Puedes usar Lighthouse local o PageSpeed Insights con datos de campo de CrUX.</div></div></div>
        <div class="form-grid integration-form"><div class="field"><label for="lh-source">Motor</label><select id="lh-source"><option value="local"${source === 'local' ? ' selected' : ''}>Lighthouse local · Chrome</option><option value="psi"${source === 'psi' ? ' selected' : ''}>PageSpeed Insights · Google</option></select></div><div class="field"><label for="lh-strategy">Dispositivo</label><select id="lh-strategy"><option value="mobile"${strategy === 'mobile' ? ' selected' : ''}>Móvil</option><option value="desktop"${strategy === 'desktop' ? ' selected' : ''}>Escritorio</option></select></div><div class="field"><label for="lh-limit">Páginas</label><input id="lh-limit" type="number" min="1" max="100" value="${esc(limit)}"><div class="hint">Audita hasta 100 páginas, en el orden del rastreo.</div></div><div class="field full"><label for="lh-key">Clave PageSpeed Insights (opcional)</label><div class="inline-field"><input id="lh-key" type="password" autocomplete="new-password" placeholder="${state.lighthouse.status?.hasPageSpeedKey ? 'Ya hay una clave guardada' : 'Añádela para ampliar la cuota gratuita'}"><button class="btn sm secondary" data-integration="lh-save-key">Guardar clave</button>${state.lighthouse.status?.hasPageSpeedKey ? '<button class="btn sm secondary" data-integration="lh-clear-key">Borrar</button>' : ''}</div><div class="hint">La auditoría local no necesita clave. PageSpeed Insights requiere conexión a internet.</div></div></div>
        <div class="integration-actions"><button class="btn sm" data-integration="lh-run-many"${!pages.length || state.lighthouse.busy ? ' disabled' : ''}>${icon('zap')}${state.lighthouse.busy ? 'Auditando…' : `Auditar hasta ${Math.min(Number(limit) || 1, pages.length)} páginas`}</button><span class="hint">${fmt(pages.length)} páginas HTML disponibles</span></div>
        ${progress ? `<div class="progress-copy">${fmt(progress.done)} de ${fmt(progress.total)} · ${esc(pathOf(progress.url))}</div><div class="progress-track"><i style="width:${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%"></i></div>` : ''}${state.lighthouse.error ? `<div class="inline-error">${esc(state.lighthouse.error)}</div>` : ''}</section>
      <section class="card card-pad"><div class="integration-title"><div><h2>Resultados</h2><div class="sub">${fmt(audited.length)} páginas tienen una auditoría guardada.</div></div></div>${rows ? `<div class="lh-list">${rows}</div>` : '<div class="empty-hint">Los resultados Lighthouse aparecerán aquí.</div>'}</section>
      ${firma()}</div>`;
  }

  function mergeIntegrationRows(rows) {
    for (const update of rows || []) {
      const current = state.byUrl.get(update.url);
      if (current) Object.assign(current, update);
    }
    if (rows?.length) {
      state.ai.summary = null;
      if (state.meta) delete state.meta.aiSummary;
    }
    if (state.rows.length) scheduleAnalysis();
  }

  // ---------- Vistas de tabla
  function tableState(view) {
    if (!state.tables[view]) state.tables[view] = { q: '', filter: null, sort: null };
    return state.tables[view];
  }

  function rowsForView(view) {
    const v = VIEWS[view];
    const ts = tableState(view);
    let rows = state.rows.filter(v.rows);
    if (ts.filter !== null) {
      const f = v.filters[ts.filter];
      if (f && f.issue) {
        const it = issueById(f.issue);
        const ids = new Set(it ? it.ids : []);
        rows = rows.filter((r) => ids.has(r.id));
      } else if (f && f.fn) rows = rows.filter(f.fn);
    }
    if (ts.q) {
      const q = ts.q.toLowerCase();
      rows = rows.filter((r) => r.url.toLowerCase().includes(q) || (r.title || '').toLowerCase().includes(q) || ((r.h1 || [])[0] || '').toLowerCase().includes(q));
    }
    return rows;
  }

  function renderTableView(main, view, full) {
    const v = VIEWS[view];
    const ts = tableState(view);
    const base = state.rows.filter(v.rows);
    const chipCount = (f) => {
      if (f.issue) {
        const it = issueById(f.issue);
        if (!it) return 0;
        const ids = new Set(it.ids);
        return base.filter((r) => ids.has(r.id)).length;
      }
      return base.filter(f.fn).length;
    };
    const chips = v.filters.map((f, i) => {
      const n = chipCount(f);
      return `<button class="chip${ts.filter === i ? ' on' : ''}" data-filter="${i}"${!n && ts.filter !== i ? ' style="opacity:.55"' : ''}>${f.label}<span class="count${f.issue && n ? ' bad' : ''}">${fmt(n)}</span></button>`;
    }).join('');

    const existing = main.dataset.view === view && $('#vt', main) && !full;
    if (existing && currentTable) {
      $('#chips', main).innerHTML = `<button class="chip${ts.filter === null ? ' on' : ''}" data-filter="">Todas<span class="count">${fmt(base.length)}</span></button>${chips}`;
      currentTable.setRows(rowsForView(view));
      return;
    }
    main.innerHTML = `<div class="card table-card">
      <div class="toolbar"><h1>${v.label}</h1>
        <div class="search">${icon('search')}<input id="table-search" placeholder="Buscar URL, título o H1" value="${esc(ts.q)}" spellcheck="false"></div>
        <span class="spacer"></span><button class="btn sm secondary" id="table-csv">${icon('download')}Exportar CSV</button></div>
      <div class="toolbar" id="chips" style="padding-top:8px;padding-bottom:8px"><button class="chip${ts.filter === null ? ' on' : ''}" data-filter="">Todas<span class="count">${fmt(base.length)}</span></button>${chips}</div>
      <div class="vt" id="vt"></div></div>`;
    currentTable = new VTable($('#vt', main), { columns: v.cols.map((k) => C[k]), key: view, empty: v.empty });
    currentTable.setRows(rowsForView(view));
  }

  // Tabla virtualizada: solo dibuja las filas visibles
  class VTable {
    constructor(el, { columns, key, empty }) {
      this.el = el;
      this.columns = columns;
      this.key = key;
      this.empty = empty;
      this.rows = [];
      this.sort = (state.tables[key] && state.tables[key].sort) || null;
      this.H = 40;
      el.innerHTML = '<div class="vt-head"></div><div class="vt-body"></div>';
      this.head = el.firstChild;
      this.body = el.lastChild;
      this.layout();
      this.renderHead();
      el.addEventListener('scroll', () => this.draw(), { passive: true });
      this.body.addEventListener('click', (e) => {
        const row = e.target.closest('.vt-row');
        if (row) selectRow(Number(row.dataset.id));
      });
      this.body.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.vt-row');
        if (row) api.openExternal(state.byId.get(Number(row.dataset.id)).url);
      });
      this.head.addEventListener('click', (e) => {
        const th = e.target.closest('.vt-th');
        if (!th) return;
        const k = th.dataset.k;
        this.sort = this.sort && this.sort.k === k ? (this.sort.dir === 1 ? { k, dir: -1 } : null) : { k, dir: k === 'url' || k === 'title' ? 1 : -1 };
        if (!state.tables[key]) state.tables[key] = { q: '', filter: null };
        state.tables[key].sort = this.sort;
        this.renderHead();
        this.setRows(this.source);
      });
      this.ro = new ResizeObserver(() => {
        // En el siguiente cuadro, para no redimensionar dentro del propio aviso
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(() => {
          if (!this.el.isConnected) return this.ro.disconnect();
          if (this.layout()) {
            this.renderHead();
            this.body.style.minWidth = this.width + 'px';
            this.draw(true);
          } else this.draw();
        });
      });
      this.ro.observe(el);
    }
    // Las columnas de texto (flex) absorben el ancho disponible: crecen en
    // pantallas anchas y se encogen hasta su mínimo cuando se abre el detalle.
    layout() {
      const avail = Math.max(0, this.el.clientWidth - 12); // margen para la barra de desplazamiento
      const fixed = this.columns.reduce((s, c) => s + (c.flex ? 0 : c.w), 0);
      const flexBase = this.columns.reduce((s, c) => s + (c.flex ? c.w : 0), 0);
      const ratio = flexBase ? Math.max(0, avail - fixed) / flexBase : 1;
      const widths = this.columns.map((c) => (c.flex ? Math.max(c.flex, Math.floor(c.w * ratio)) : c.w));
      const changed = !this.widths || widths.some((w, i) => w !== this.widths[i]);
      this.widths = widths;
      this.width = widths.reduce((s, w) => s + w, 0);
      return changed;
    }
    renderHead() {
      this.head.innerHTML = this.columns
        .map((c, i) => {
          const on = this.sort && this.sort.k === c.key;
          return `<button class="vt-th${on ? ' sorted' : ''}" data-k="${c.key}" style="width:${this.widths[i]}px">${c.label}${on ? icon(this.sort.dir === 1 ? 'arrowUp' : 'arrowDown') : ''}</button>`;
        })
        .join('');
    }
    setRows(rows) {
      this.source = rows;
      let out = rows;
      if (this.sort) {
        const col = this.columns.find((c) => c.key === this.sort.k);
        if (col) {
          const dir = this.sort.dir;
          out = [...rows].sort((a, b) => {
            const x = col.get(a);
            const y = col.get(b);
            if (x === y) return 0;
            if (x === null || x === undefined || x === '') return 1;
            if (y === null || y === undefined || y === '') return -1;
            return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')) * dir;
          });
        }
      }
      this.rows = out;
      this.body.style.height = Math.max(1, out.length) * this.H + 'px';
      this.body.style.minWidth = this.width + 'px';
      this.last = null;
      this.draw(true);
    }
    draw(force) {
      if (!this.rows.length) {
        this.body.style.height = 'auto';
        this.body.innerHTML = `<div class="vt-empty"><div class="tile sm">${icon('checkCircle')}</div>${esc(this.empty || (state.crawlState === 'running' ? 'Aún no hay filas aquí.' : 'Nada por aquí. Todo en orden.'))}</div>`;
        return;
      }
      const top = this.el.scrollTop;
      const h = this.el.clientHeight || 600;
      const start = Math.max(0, Math.floor(top / this.H) - 6);
      const end = Math.min(this.rows.length, Math.ceil((top + h) / this.H) + 6);
      const sig = start + ':' + end + ':' + state.selectedId;
      if (!force && sig === this.last) return;
      this.last = sig;
      let html = '';
      for (let i = start; i < end; i++) {
        const r = this.rows[i];
        html += `<div class="vt-row${r.id === state.selectedId ? ' sel' : ''}" data-id="${r.id}" style="top:${i * this.H}px;width:${this.width}px">`;
        this.columns.forEach((c, j) => {
          const val = c.render ? c.render(r) : esc(c.get(r) ?? '');
          html += `<div class="vt-td ${c.cls || ''}" style="width:${this.widths[j]}px">${val}</div>`;
        });
        html += '</div>';
      }
      this.body.innerHTML = html;
    }
    move(step) {
      if (!this.rows.length) return;
      let i = this.rows.findIndex((r) => r.id === state.selectedId);
      i = Math.max(0, Math.min(this.rows.length - 1, i + step));
      selectRow(this.rows[i].id);
      const y = i * this.H;
      const headH = 36;
      if (y < this.el.scrollTop) this.el.scrollTop = y;
      else if (y + this.H + headH > this.el.scrollTop + this.el.clientHeight) this.el.scrollTop = y + this.H + headH - this.el.clientHeight;
    }
    csv() {
      const sep = ';';
      const q = (v) => {
        const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [this.columns.map((c) => q(c.label)).join(sep)];
      for (const r of this.rows) lines.push(this.columns.map((c) => q(c.get(r))).join(sep));
      return '\ufeff' + lines.join('\r\n');
    }
  }

  // ======================================================================
  // Panel de detalle
  function selectRow(id) {
    state.selectedId = id;
    if (currentTable) currentTable.draw(true);
    openDrawer();
  }
  function openDrawer() {
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    renderDrawer();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }

  function renderDrawer() {
    const r = state.byId.get(state.selectedId);
    const d = $('#drawer');
    if (!r) return closeDrawer();
    const tabs = [['resumen', 'Resumen'], ['enlaces', 'Enlaces'], ['contenido', 'Contenido'], ['tecnico', 'Técnico'], ...(A.isPage(r) ? [['google', 'Google'], ['lighthouse', 'Lighthouse'], ['ia', 'IA']] : [])];
    let body = '';
    if (state.drawerTab === 'resumen') body = drawerSummary(r);
    else if (state.drawerTab === 'enlaces') body = drawerLinks(r);
    else if (state.drawerTab === 'contenido') body = drawerContent(r);
    else if (state.drawerTab === 'google') body = drawerGoogle(r);
    else if (state.drawerTab === 'lighthouse') body = drawerLighthouse(r);
    else if (state.drawerTab === 'ia') body = drawerAi(r);
    else body = drawerTech(r);
    const scroll = $('.drawer-body', d) ? $('.drawer-body', d).scrollTop : 0;
    d.innerHTML = `<div class="drawer-head">
      <div style="display:flex;gap:10px;align-items:flex-start"><div class="drawer-url selectable" style="flex:1">${esc(r.url)}</div><button class="icon-btn" id="drawer-close" title="Cerrar">${icon('x')}</button></div>
      <div class="drawer-actions">${statusPill(r)} ${r.indexable ? '<span class="pill ok">Indexable</span>' : `<span class="pill gris">${esc(r.indexReason || 'No indexable')}</span>`}
        <span style="flex:1"></span><button class="btn sm secondary" id="drawer-open">${icon('external')}Abrir</button><button class="btn sm secondary" id="drawer-copy">${icon('copy')}Copiar</button></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab${state.drawerTab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div></div>
      <div class="drawer-body">${body}</div>`;
    $('.drawer-body', d).scrollTop = scroll;
  }

  function drawerGoogle(r) {
    const inspection = r.inspection;
    const gsc = r.gsc;
    const ga = r.ga;
    return `<div class="block"><div class="block-title">Datos de Search Console y Analytics</div>
      ${gsc || ga ? `<dl class="kv">${gsc ? `<dt>Clics · impresiones</dt><dd>${fmt(gsc.clicks)} · ${fmt(gsc.impressions)}</dd><dt>CTR · posición media</dt><dd>${gsc.ctr == null ? '–' : (gsc.ctr * 100).toFixed(1) + ' %'} · ${gsc.position == null ? '–' : gsc.position.toFixed(1)}</dd>` : ''}${ga ? `<dt>Vistas · sesiones</dt><dd>${fmt(ga.views)} · ${fmt(ga.sessions)}</dd><dt>Eventos clave</dt><dd>${fmt(ga.keyEvents)}</dd>` : ''}</dl>` : '<div class="empty-hint">Todavía no hay datos para esta URL. Sincroniza sus propiedades desde la sección Google.</div>'}
      <div class="integration-actions"><button class="btn sm secondary" data-integration="google-inspect" data-url="${esc(r.url)}"${state.google.busy ? ' disabled' : ''}>${icon('search')}Inspeccionar en Google</button><button class="btn sm secondary" data-integration="google-queries" data-url="${esc(r.url)}"${state.google.busy ? ' disabled' : ''}>${icon('list')}Ver consultas</button></div>
      ${(gsc?.queries || []).length ? `<div class="query-list"><div class="block-title">Consultas de esta URL · últimas 28 jornadas disponibles</div>${gsc.queries.slice(0, 20).map((q) => `<div class="query-row"><span>${esc(q.query)}</span><span>${fmt(q.clicks)} clics</span><span>${fmt(q.impressions)} impresiones</span><span>${(q.ctr * 100).toFixed(1)} %</span></div>`).join('')}</div>` : ''}
      ${inspection ? `<dl class="kv integration-detail"><dt>Veredicto</dt><dd>${esc(inspection.verdict || 'Sin veredicto')}</dd><dt>Estado de cobertura</dt><dd>${esc(inspection.coverageState || '—')}</dd><dt>Indexación</dt><dd>${esc(inspection.indexingState || '—')}</dd><dt>Canonical de Google</dt><dd>${esc(inspection.googleCanonical || '—')}</dd><dt>Último rastreo</dt><dd>${inspection.lastCrawlTime ? esc(new Date(inspection.lastCrawlTime).toLocaleString('es-CL')) : '—'}</dd></dl>` : ''}</div>`;
  }

  function drawerLighthouse(r) {
    const item = r.lighthouse?.mobile || r.lighthouse?.desktop;
    const metrics = item?.metrics || {};
    const score = item?.scores || {};
    return `<div class="block"><div class="block-title">Auditoría Lighthouse</div>
      ${item ? `<div class="score-row">${[['Rendimiento', score.performance], ['Accesibilidad', score.accessibility], ['Buenas prácticas', score.bestPractices], ['SEO', score.seo]].map(([name, value]) => `<div class="score-chip"><b>${value ?? '–'}</b><span>${name}</span></div>`).join('')}</div><dl class="kv integration-detail"><dt>Dispositivo</dt><dd>${item.strategy === 'desktop' ? 'Escritorio' : 'Móvil'} · ${item.source === 'psi' ? 'PageSpeed Insights' : 'Lighthouse local'}</dd><dt>LCP · INP</dt><dd>${metrics.lcp == null ? '–' : (metrics.lcp / 1000).toFixed(1) + ' s'} · ${metrics.inp == null ? '–' : metrics.inp + ' ms'}</dd><dt>CLS · TBT</dt><dd>${metrics.cls ?? '–'} · ${metrics.tbt == null ? '–' : metrics.tbt + ' ms'}</dd></dl>${item.error ? `<div class="inline-error">${esc(item.error)}</div>` : ''}${(item.opportunities || []).length ? `<div class="block-title">Oportunidades</div>${item.opportunities.slice(0, 5).map((x) => `<div class="mini-issue"><b>${esc(x.title)}</b><span class="sub">${x.savingsMs ? `${fmt(x.savingsMs)} ms` : ''}</span></div>`).join('')}` : ''}` : '<div class="empty-hint">Aún no hay una auditoría para esta URL.</div>'}
      <button class="btn sm secondary" data-integration="lighthouse-one" data-url="${esc(r.url)}"${state.lighthouse.busy ? ' disabled' : ''}>${icon('zap')}Auditar esta URL</button></div>`;
  }

  function drawerAi(r) {
    const output = r.ai?.result;
    return `<div class="block"><div class="block-title">Revisión asistida por IA</div>
      ${output ? `<p class="ai-lead">${esc(output.resumen)}</p>${(output.prioridades || []).map((x) => `<article class="mini-issue"><span class="pill ${x.impacto === 'alto' ? 'alto' : x.impacto === 'medio' ? 'medio' : 'gris'}">${esc(x.impacto)}</span><div><b>${esc(x.titulo)}</b><div class="sub">${esc(x.detalle)}</div></div></article>`).join('')}${(output.titulos || []).length ? `<div class="block-title">Títulos propuestos</div>${output.titulos.map((x) => `<p class="suggestion">${esc(x)}</p>`).join('')}` : ''}${(output.metaDescripciones || []).length ? `<div class="block-title">Meta descripciones</div>${output.metaDescripciones.map((x) => `<p class="suggestion">${esc(x)}</p>`).join('')}` : ''}<div class="hint">${esc(r.ai.provider)} · ${esc(r.ai.model)} · ${esc(new Date(r.ai.createdAt).toLocaleString('es-CL'))}</div>` : '<div class="empty-hint">Pide una revisión de esta página con el proveedor que configuraste.</div>'}
      <button class="btn sm secondary" data-integration="ai-page" data-url="${esc(r.url)}"${state.ai.busy ? ' disabled' : ''}>${icon('sparkles')}${state.ai.busy ? 'Analizando…' : 'Analizar esta URL'}</button></div>`;
  }

  function drawerSummary(r) {
    const issues = state.issuesByRow.get(r.id) || [];
    let serp = '';
    if (A.isPage(r)) {
      const host = new URL(r.url).hostname.replace(/^www\./, '');
      const crumbs = pathOf(r.url).split('?')[0].split('/').filter(Boolean).slice(0, 3).join(' › ');
      const t = r.title ? PX.truncateToWidth(r.title, PX.LIMITS.titlePx, PX.LIMITS.titleSize) : '(Google inventará un título)';
      const ds = r.metaDesc ? PX.truncateToWidth(r.metaDesc, PX.LIMITS.descPx, PX.LIMITS.descSize) : 'Sin meta descripción: Google tomará un fragmento del contenido de la página.';
      serp = `<div class="block"><div class="block-title">Así se vería en Google</div><div class="serp">
        <div class="serp-site"><span class="serp-fav">${esc(host[0] || '?').toUpperCase()}</span><span><b style="color:inherit;font-weight:500">${esc(host)}</b><br>${esc(r.url.split('://')[0] + '://' + host)}${crumbs ? ' › ' + esc(crumbs) : ''}</span></div>
        <div class="serp-title">${esc(t)}</div><div class="serp-desc">${esc(ds)}</div></div>
        <div class="serp-note">Título ${r.titlePx || 0} / 580 px · Descripción ${r.descPx || 0} / 920 px</div></div>`;
    }
    const iss = issues.length
      ? issues.map((it) => `<div class="mini-issue">${sevPill(it.severity)}<div><div class="fix-title">${esc(it.title)}</div><div class="sub" style="font-size:12px">${esc(it.fix)}</div></div></div>`).join('')
      : '<div class="sub">Sin problemas detectados en esta URL.</div>';
    const kv = [
      ['Tiempo de respuesta', r.time ? fmt(r.time) + ' ms' : '–'],
      ['Tamaño', kb(r.size)],
      ['Profundidad', r.clickDepth ?? '–'],
      ['Enlaces entrantes', fmt(r.inlinkSources || 0) + ' páginas'],
      ['Palabras', fmt(r.wordCount)],
      ['En sitemap', r.inSitemap ? 'Sí' : 'No'],
    ];
    return `${serp}<div class="block"><div class="block-title">Problemas en esta URL (${issues.length})</div>${iss}</div>
      <div class="block"><div class="block-title">Datos clave</div><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
  }

  function drawerLinks(r) {
    const inl = [];
    const outl = [];
    for (const [from, to, anchor, nofollow] of state.edges) {
      if (to === r.url && from !== r.id) inl.push({ row: state.byId.get(from), anchor, nofollow });
      if (from === r.id) outl.push({ url: to, row: state.byUrl.get(to), anchor, nofollow });
    }
    const row = (url, anchor, extra = '', id = '') => `<button class="link-row" ${id ? `data-select="${id}"` : `data-ext="${esc(url)}"`}><span><div class="u">${esc(pathOf(url))}</div><div class="a">${anchor ? '“' + esc(anchor) + '”' : '<i>sin texto ancla</i>'}</div></span><span>${extra}</span></button>`;
    const inHtml = inl.slice(0, 300).map((l) => (l.row ? row(l.row.url, l.anchor, l.nofollow ? '<span class="pill gris">nofollow</span>' : '', l.row.id) : '')).join('');
    const outHtml = outl
      .slice(0, 300)
      .map((l) => row(l.url, l.anchor, (l.row ? statusPill(l.row) : '<span class="pill gris">sin revisar</span>') + (l.nofollow ? ' <span class="pill gris">nofollow</span>' : ''), l.row ? l.row.id : ''))
      .join('');
    return `<div class="block"><div class="block-title">Enlaces entrantes (${fmt(inl.length)})</div><div class="link-list">${inHtml || '<div class="sub">Ninguna página rastreada enlaza aquí.</div>'}</div></div>
      <div class="block"><div class="block-title">Enlaces salientes (${fmt(outl.length)})</div><div class="link-list">${outHtml || '<div class="sub">Sin enlaces salientes.</div>'}</div></div>`;
  }

  function drawerContent(r) {
    if (!A.isPage(r)) return '<div class="sub">Solo disponible para páginas HTML.</div>';
    const imgs = (r.images || []).slice(0, 60);
    return `<div class="block"><div class="block-title">Encabezados</div><dl class="kv">
        <dt>H1 (${(r.h1 || []).length})</dt><dd>${(r.h1 || []).map(esc).join('<br>') || '<span class="no">Falta</span>'}</dd>
        <dt>H2 (${r.h2Count || 0})</dt><dd>${(r.h2First || []).map(esc).join('<br>') || '—'}</dd></dl></div>
      <div class="block"><div class="block-title">Texto</div><dl class="kv"><dt>Palabras</dt><dd>${fmt(r.wordCount)}</dd><dt>Texto / HTML</dt><dd>${r.textRatio} %</dd><dt>Idioma</dt><dd>${esc(r.lang || '—')}</dd></dl></div>
      ${(r.nearDup || []).length ? `<div class="block"><div class="block-title">Casi duplicadas</div><div class="link-list">${r.nearDup.map((x) => `<button class="link-row" data-select="${x.id}"><span class="u">${esc(pathOf(x.url))}</span><span class="pill medio">${x.sim} %</span></button>`).join('')}</div></div>` : ''}
      <div class="block"><div class="block-title">Conversión</div><dl class="kv">
        <dt>Llamadas a la acción</dt><dd>${(r.ctas || []).map((c) => `<span class="pill ok">${esc(c)}</span>`).join(' ') || '<span class="no">Ninguna detectada</span>'}</dd>
        <dt>Formularios</dt><dd>${(r.forms || []).map((f, i) => `#${i + 1}: ${f.fields} campos${f.unlabeled ? `, <span class="no">${f.unlabeled} sin etiqueta</span>` : ''}`).join('<br>') || '—'}</dd>
        <dt>Contacto directo</dt><dd>${[r.hasTel && 'Teléfono', r.hasMailto && 'Email', r.hasWhatsapp && 'WhatsApp'].filter(Boolean).join(', ') || '—'}</dd></dl></div>
      <div class="block"><div class="block-title">Imágenes (${fmt(r.imagesTotal)})</div><div class="link-list">${imgs.map((im) => `<div class="link-row"><span><div class="u">${esc(im.src.split('/').pop() || im.src)}</div><div class="a">${im.alt === undefined ? '<span class="no">sin alt</span>' : im.alt ? '“' + esc(im.alt) + '”' : 'alt vacío (decorativa)'}</div></span><span>${im.hasDims ? '' : '<span class="pill gris">sin medidas</span>'}</span></div>`).join('') || '<div class="sub">Sin imágenes.</div>'}</div></div>`;
  }

  function drawerTech(r) {
    const kv = [
      ['Estado', r.status ? `${r.status} ${r.statusText || ''}` : r.error || (r.blockedByRobots ? 'No rastreada (robots.txt)' : '—')],
      ['Tipo de contenido', r.contentType || '—'],
      ['Origen', r.source || '—'],
      ['Canonical', r.canonical ? (r.canonical === r.url ? 'Autorreferente' : r.canonical) : 'Falta'],
      ['Meta robots', r.metaRobots || '—'],
      ['X-Robots-Tag', r.xRobots || '—'],
      ['Viewport', r.viewport || 'Falta'],
      ['Compresión', r.compression || 'Ninguna'],
      ['Cache-Control', r.cacheControl || '—'],
      ['Last-Modified', r.lastModified || '—'],
      ['HSTS', r.hsts ? 'Sí' : 'No'],
      ['Servidor', r.server || '—'],
      ['Scripts', r.scripts !== undefined ? `${r.scripts} (${r.blockingScripts} bloqueantes)` : '—'],
      ['Terceros', (r.thirdPartyHosts || []).join(', ') || '—'],
    ];
    const chain = r.chain ? `<div class="block"><div class="block-title">Cadena de redirección (${r.hops} salto${r.hops === 1 ? '' : 's'})</div><div class="chain">${r.chain.map((u, i) => {
      const t = state.byUrl.get(u);
      return `<div class="chain-step">${t ? statusPill(t) : '<span class="pill gris">?</span>'}<span>${esc(u)}</span></div>${i < r.chain.length - 1 ? `<div style="padding-left:12px;color:var(--ink-muted)">${icon('arrowDown')}</div>` : ''}`;
    }).join('')}</div></div>` : '';
    const js = r.jsDiff ? `<div class="block"><div class="block-title">HTML original vs. renderizado</div><dl class="kv">
      <dt>Título original</dt><dd>${esc(r.jsDiff.rawTitle || '—')}</dd><dt>Título cambia</dt><dd>${r.jsDiff.titleChanged ? '<span class="no">Sí</span>' : 'No'}</dd>
      <dt>H1 cambia</dt><dd>${r.jsDiff.h1Changed ? '<span class="no">Sí</span>' : 'No'}</dd><dt>Palabras añadidas</dt><dd>${fmt(r.jsDiff.wordsAdded)} (de ${fmt(r.jsDiff.rawWords)})</dd>
      <dt>Enlaces añadidos</dt><dd>${fmt(r.jsDiff.linksAdded)}</dd></dl></div>` : r.renderError ? `<div class="block"><div class="block-title">Renderizado</div><span class="no">${esc(r.renderError)}</span></div>` : '';
    const hl = (r.hreflang || []).length ? `<div class="block"><div class="block-title">hreflang</div><dl class="kv">${r.hreflang.map((h) => `<dt>${esc(h.lang)}</dt><dd>${esc(h.href)}</dd>`).join('')}</dl></div>` : '';
    return `${chain}<div class="block"><div class="block-title">Respuesta</div><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>${js}${hl}`;
  }

  // ======================================================================
  // Superposiciones: introducción, ajustes, paleta, menú de exportar
  function closeOverlay() {
    const o = $('#overlay');
    o.hidden = true;
    o.innerHTML = '';
    o.onclick = null;
  }

  const ONB = [
    { g: 'g-blue', art: () => appTile(96), t: 'Te damos la bienvenida a Octos', p: 'Octos rastrea tu sitio como lo haría Google y te dice qué arreglar primero, con explicaciones claras y sin jerga innecesaria.' },
    {
      g: 'g-pink',
      art: () => `<div class="mini-lists">${[['target', 'rosa', 'Críticos', 2], ['alert', 'lavanda', 'Altos', 7], ['info', 'cielo', 'Medios', 12], ['checkCircle', 'gris', 'Bajos', 9]].map(([i, t, l, n], k) => `<div class="nav-item${k === 1 ? ' active' : ''}"><span class="nav-ico tone-${t}">${icon(i)}</span><span class="nav-label">${l}</span><span class="count">${n}</span></div>`).join('')}</div>`,
      t: 'Prioridades claras',
      p: 'Cada problema llega ordenado por impacto y esfuerzo, con el porqué y el cómo. Además de SEO técnico, revisa conversión y rendimiento.',
    },
    { g: 'g-mint', art: () => `<div class="keycaps"><div class="tile">${MOD}</div><div class="tile">K</div></div>`, t: 'Atajos a tu medida', p: `Abre la paleta de comandos con ${MOD}${IS_MAC ? '' : '+'}K para saltar a cualquier vista, problema o URL. Puedes cambiar cada atajo en Ajustes.` },
    { g: 'g-sky', art: () => `<div class="tile">${icon('check')}</div>`, t: 'Todo listo', p: 'Escribe la dirección de tu sitio y presiona Rastrear. Activa «Renderizar JavaScript» si tu sitio está hecho con React, Vue o similar.' },
  ];
  function showOnboarding(step = 0) {
    const o = $('#overlay');
    const s = ONB[step];
    o.hidden = false;
    o.innerHTML = `<div class="onb" role="dialog" aria-modal="true" aria-label="${esc(s.t)}">
      <div class="onb-art grad ${s.g}">${s.art()}</div>
      <div class="onb-body"><h2>${s.t}</h2><p>${s.p}</p>
        <button class="btn" id="onb-next">${step === ONB.length - 1 ? 'Empezar' : 'Continuar'}</button>
        ${step < ONB.length - 1 ? '<button class="link-btn onb-skip" id="onb-skip">Saltar</button>' : ''}
        <div class="dots">${ONB.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div></div></div>`;
    const done = () => {
      closeOverlay();
      state.prefs.onboarded = true;
      api.savePrefs({ onboarded: true });
      if (state.view === 'home' && !state.capture) setTimeout(() => $('#url-input') && $('#url-input').focus(), 30);
    };
    $('#onb-next').onclick = () => (step === ONB.length - 1 ? done() : showOnboarding(step + 1));
    if ($('#onb-skip')) $('#onb-skip').onclick = done;
    $('#onb-next').focus();
  }

  function showSettings(tab = 'rastreo') {
    const s = state.settings;
    const o = $('#overlay');
    const sw = (key, title, desc) => `<div class="switch-row"><div><b>${title}</b><span>${desc}</span></div><label class="switch"><input type="checkbox" data-set="${key}"${s[key] ? ' checked' : ''}><i></i></label></div>`;
    const num = (key, label, min, max, hint) => `<div class="field"><label>${label}</label><input type="number" data-set="${key}" min="${min}" max="${max}" value="${esc(s[key])}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    let body = '';
    if (tab === 'rastreo') {
      body = `<div class="form-grid">
        ${num('maxUrls', 'Límite de URLs', 10, 200000, 'Páginas internas como máximo.')}
        ${num('maxDepth', 'Profundidad máxima', 1, 50, 'Clics desde la URL de inicio.')}
        ${num('concurrency', 'Solicitudes en paralelo', 1, 32, 'Bájalo si el servidor es pequeño.')}
        ${num('delayMs', 'Pausa entre solicitudes (ms)', 0, 10000, '0 = lo más rápido posible.')}
        ${num('timeoutSec', 'Tiempo de espera (s)', 3, 120, '')}
        <div class="field"><label>Identificarse como</label><select data-set="uaKey">${Object.entries(USER_AGENTS).map(([k, v]) => `<option value="${k}"${s.uaKey === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select><div class="hint">Algunos sitios muestran contenido distinto según el robot.</div></div>
        <div class="field full">${sw('respectRobots', 'Respetar robots.txt', 'No visita URLs bloqueadas; las lista igual como «bloqueadas».')}
          ${sw('crawlSitemaps', 'Rastrear URLs de los sitemaps', 'Necesario para detectar páginas huérfanas.')}
          ${sw('includeSubdomains', 'Incluir subdominios', 'Trata blog.tusitio.cl como parte del mismo sitio.')}
          ${sw('checkExternal', 'Revisar enlaces externos', 'Comprueba si los enlaces a otros sitios funcionan.')}
          ${sw('renderJs', 'Renderizar JavaScript', 'Usa Chromium para ver la página como un navegador. Más lento, más fiel.')}</div>
        ${num('renderWaitMs', 'Espera tras cargar (ms)', 0, 15000, 'Para sitios que cargan contenido tarde.')}
        <div></div>
        <div class="field"><label>Incluir solo URLs que coincidan</label><textarea data-set="include" placeholder="/blog/\n/productos/">${esc(s.include || '')}</textarea><div class="hint">Una expresión regular por línea.</div></div>
        <div class="field"><label>Excluir URLs que coincidan</label><textarea data-set="exclude" placeholder="\\?orderby=\n/carrito">${esc(s.exclude || '')}</textarea><div class="hint">Útil para filtros y carritos.</div></div>
      </div>`;
    } else if (tab === 'atajos') {
      body = `<div class="sub" style="margin-bottom:8px">Haz clic en un atajo y presiona la nueva combinación. Esc cancela.</div>
        ${SHORTCUTS.map((sc) => `<div class="shortcut-row"><span>${sc.label}</span><button class="shortcut-rec" data-rec="${sc.id}">${kbdHtml(state.shortcuts[sc.id])}</button></div>`).join('')}
        <div style="margin-top:14px"><button class="link-btn" id="reset-shortcuts">Restaurar atajos originales</button></div>`;
    } else {
      body = `<div class="switch-row"><div><b>Tema</b><span>Claro, oscuro o según el sistema.</span></div>
        <div class="seg" id="theme-seg">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button data-theme-set="${k}" class="${(state.prefs.theme || 'system') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="switch-row"><div><b>Tipografías de la marca</b><span id="fonts-note">${state.fonts && state.fonts.installed ? 'Manrope e IBM Plex Sans están instaladas. El PowerPoint y el Excel se verán con la marca completa.' : 'Instala Manrope e IBM Plex Sans para que el PowerPoint y el Excel se vean con la marca completa.'}</span></div><button class="btn sm secondary" id="fonts-install"${state.fonts && state.fonts.installed ? ' disabled' : ''}>${state.fonts && state.fonts.installed ? 'Instaladas' : IS_MAC ? 'Instalar' : 'Abrir carpeta'}</button></div>
        <div class="switch-row"><div><b>Ver la introducción otra vez</b><span>Las cuatro tarjetas del inicio.</span></div><button class="btn sm secondary" id="replay-onb">Mostrar</button></div>`;
    }
    o.hidden = false;
    o.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Ajustes">
      <div class="modal-head"><h2>Ajustes</h2><div class="tabs">${[['rastreo', 'Rastreo'], ['atajos', 'Atajos'], ['apariencia', 'Apariencia']].map(([k, l]) => `<button class="tab${tab === k ? ' on' : ''}" data-settings-tab="${k}">${l}</button>`).join('')}</div></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"><span class="firma-wrap">${firma()}</span><button class="btn sm" id="settings-done">Cerrar</button></div></div>`;
    o.onclick = (e) => {
      if (e.target === o) closeOverlay();
    };
    $$('[data-set]', o).forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.set;
        s[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        saveSettings();
      });
    });
    $$('[data-settings-tab]', o).forEach((b) => (b.onclick = () => showSettings(b.dataset.settingsTab)));
    $$('[data-ext]', o).forEach((b) => (b.onclick = () => api.openExternal(b.dataset.ext)));
    $('#settings-done').onclick = () => {
      closeOverlay();
      if (state.view === 'home') refresh(true);
    };
    if ($('#reset-shortcuts')) $('#reset-shortcuts').onclick = () => {
      state.shortcuts = Object.fromEntries(SHORTCUTS.map((x) => [x.id, x.def]));
      api.savePrefs({ shortcuts: state.shortcuts });
      showSettings('atajos');
    };
    $$('[data-rec]', o).forEach((b) => (b.onclick = () => recordShortcut(b)));
    $$('[data-theme-set]', o).forEach((b) => (b.onclick = () => {
      setTheme(b.dataset.themeSet);
      showSettings('apariencia');
    }));
    if ($('#replay-onb')) $('#replay-onb').onclick = () => showOnboarding(0);
    if ($('#fonts-install')) $('#fonts-install').onclick = async () => {
      try {
        state.fonts = await api.fontsInstall();
        toast(state.fonts.opened ? 'Se abrió la carpeta con las tipografías. Selecciónalas, haz clic derecho y elige Instalar.' : 'Tipografías instaladas. Reinicia PowerPoint o Excel si ya estaban abiertos.');
        showSettings('apariencia');
      } catch (err) {
        toast(err.message || String(err), true);
      }
    };
  }

  let recording = null;
  function recordShortcut(btn) {
    if (recording) recording.classList.remove('recording');
    recording = btn;
    btn.classList.add('recording');
    btn.innerHTML = '<span class="sub">Presiona…</span>';
  }
  function finishRecording(e) {
    const btn = recording;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      recording = null;
      btn.classList.remove('recording');
      btn.innerHTML = kbdHtml(state.shortcuts[btn.dataset.rec]);
      return;
    }
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    const combo = comboFromEvent(e);
    const clash = Object.entries(state.shortcuts).find(([id, c]) => c === combo && id !== btn.dataset.rec);
    if (clash) {
      toast(`${prettyCombo(combo)} ya se usa para «${SHORTCUTS.find((x) => x.id === clash[0]).label}».`, true);
      return;
    }
    state.shortcuts[btn.dataset.rec] = combo;
    api.savePrefs({ shortcuts: state.shortcuts });
    recording = null;
    btn.classList.remove('recording');
    btn.innerHTML = kbdHtml(combo);
  }

  function comboFromEvent(e) {
    const parts = [];
    if (e.metaKey || (!IS_MAC && e.ctrlKey)) parts.push('Meta');
    if (IS_MAC && e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key;
    if (e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join('+');
  }
  const SYMBOLS = { Meta: MOD, Ctrl: IS_MAC ? '⌃' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Shift: IS_MAC ? '⇧' : 'Mayús', Enter: '↩', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'esc', Backspace: '⌫', ' ': 'Espacio' };
  const prettyCombo = (c) => String(c || '').split('+').map((p) => SYMBOLS[p] || p).join(IS_MAC ? '' : '+');
  const kbdHtml = (c) => `<span class="kbd">${String(c || '—').split('+').map((p) => `<kbd>${esc(SYMBOLS[p] || p)}</kbd>`).join('')}</span>`;

  function showPalette() {
    const o = $('#overlay');
    o.hidden = false;
    o.style.placeItems = 'center';
    o.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos"><div class="palette-search">${icon('search')}<input id="pal-input" placeholder="Busca una acción, vista, problema o URL…" spellcheck="false"></div><div class="palette-list" id="pal-list"></div></div>`;
    o.onclick = (e) => {
      if (e.target === o) closeOverlay();
    };
    let sel = 0;
    let items = [];
    const draw = () => {
      const q = $('#pal-input').value.trim().toLowerCase();
      const has = state.rows.length > 0;
      const running = state.crawlState === 'running' || state.crawlState === 'paused';
      const actions = [
        { g: 'Acciones', label: 'Rastrear otro sitio', ic: 'plus', k: 'Meta+N', run: () => go('home') },
        { g: 'Acciones', label: 'Abrir rastreo guardado…', ic: 'folder', k: 'Meta+O', run: () => menuAction('open') },
        has && { g: 'Acciones', label: 'Guardar rastreo…', ic: 'save', k: 'Meta+S', run: () => menuAction('save') },
        has && { g: 'Acciones', label: 'Exportar esta vista a CSV', ic: 'download', k: 'Meta+E', run: () => menuAction('export-csv') },
        has && { g: 'Acciones', label: 'Exportar informe HTML', ic: 'sparkles', k: 'Meta+Shift+E', run: () => menuAction('export-report') },
        has && { g: 'Acciones', label: 'Exportar presentación PowerPoint', ic: 'file', run: () => menuAction('export-pptx') },
        has && { g: 'Acciones', label: 'Exportar libro de Excel', ic: 'file', run: () => menuAction('export-xlsx') },
        has && { g: 'Acciones', label: 'Generar sitemap XML', ic: 'sitemap', run: () => menuAction('export-sitemap') },
        running && { g: 'Acciones', label: state.crawlState === 'paused' ? 'Reanudar rastreo' : 'Pausar rastreo', ic: state.crawlState === 'paused' ? 'play' : 'pause', k: state.shortcuts.startPause, run: () => togglePause() },
        running && { g: 'Acciones', label: 'Detener rastreo', ic: 'stop', run: () => api.stop() },
        { g: 'Acciones', label: 'Abrir ajustes', ic: 'sliders', k: 'Meta+,', run: () => showSettings() },
        { g: 'Acciones', label: 'Cambiar atajos de teclado', ic: 'command', run: () => showSettings('atajos') },
        { g: 'Acciones', label: 'Cambiar entre tema claro y oscuro', ic: 'eye', run: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
      ].filter(Boolean);
      const views = [...(has ? [{ id: 'overview', label: 'Resumen', icon: 'home' }, { id: 'issues', label: 'Prioridades', icon: 'target' }, ...Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label, icon: v.icon }))] : Object.entries(VIEWS).filter(([id]) => TOOL_VIEWS.has(id)).map(([id, v]) => ({ id, label: v.label, icon: v.icon })))].map((v) => ({ g: 'Ir a', label: v.label, ic: v.icon, run: () => go(v.id) }));
      const issues = state.result ? state.result.issues.map((it) => ({ g: 'Problemas', label: it.title, ic: 'alert', hint: it.site ? 'Sitio' : fmt(it.count), run: () => openIssue(it.id) })) : [];
      let urls = [];
      if (q.length >= 2 && has) {
        urls = state.rows
          .filter((r) => r.url.toLowerCase().includes(q) || (r.title || '').toLowerCase().includes(q))
          .slice(0, 8)
          .map((r) => ({ g: 'URLs', label: r.internal ? pathOf(r.url) : r.url, ic: 'link', hint: String(r.status || ''), run: () => { if (!VIEWS[state.view]) go('all'); selectRow(r.id); } }));
      }
      const match = (x) => !q || x.label.toLowerCase().includes(q);
      items = [...actions.filter(match), ...views.filter(match), ...issues.filter(match).slice(0, 8), ...urls];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      let g = '';
      $('#pal-list').innerHTML =
        items
          .map((it, i) => {
            const head = it.g !== g ? `<div class="palette-group">${(g = it.g)}</div>` : '';
            return `${head}<button class="palette-item${i === sel ? ' on' : ''}" data-i="${i}">${icon(it.ic)}<span class="label">${esc(it.label)}</span>${it.k ? kbdHtml(it.k) : it.hint ? `<span class="count">${esc(it.hint)}</span>` : ''}</button>`;
          })
          .join('') || '<div class="empty-hint" style="padding:16px">Sin resultados.</div>';
      const on = $('.palette-item.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const run = (i) => {
      const it = items[i];
      if (!it) return;
      closeOverlay();
      it.run();
    };
    $('#pal-input').addEventListener('input', () => {
      sel = 0;
      draw();
    });
    $('#pal-input').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { run(sel); e.preventDefault(); }
    });
    $('#pal-list').addEventListener('click', (e) => {
      const b = e.target.closest('.palette-item');
      if (b) run(Number(b.dataset.i));
    });
    draw();
    $('#pal-input').focus();
  }

  function showExportMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'menu-pop';
    pop.style.top = rect.bottom + 8 + 'px';
    pop.style.right = window.innerWidth - rect.right + 'px';
    const tableView = !!currentTable;
    pop.innerHTML = `
      <button data-a="export-report">${icon('sparkles')}<span>Informe HTML<small>Compártelo con clientes o tu equipo</small></span></button>
      <button data-a="export-pptx">${icon('file')}<span>Presentación PowerPoint<small>Estado, prioridades y plan de acción</small></span></button>
      <button data-a="export-xlsx">${icon('file')}<span>Libro de Excel<small>Resumen, prioridades, URLs y métricas</small></span></button>
      <button data-a="export-csv"${tableView ? '' : ' disabled style="opacity:.45"'}>${icon('download')}<span>CSV de esta vista<small>Se abre en Excel</small></span></button>
      <button data-a="export-sitemap">${icon('sitemap')}<span>Sitemap XML<small>Solo URLs 200 indexables</small></span></button>
      <button data-a="save">${icon('save')}<span>Guardar rastreo<small>Archivo .octos para abrirlo después</small></span></button>`;
    document.body.appendChild(pop);
    const close = (e) => {
      if (e && pop.contains(e.target) && !e.target.closest('button')) return;
      pop.remove();
      document.removeEventListener('mousedown', close, true);
    };
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (b && !b.disabled) {
        menuAction(b.dataset.a);
        close();
      }
    });
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  }

  // ======================================================================
  // Acciones
  function openIssue(id) {
    const it = issueById(id);
    if (!it) return;
    state.issueId = id;
    state.issueCat = 'todas';
    go('issues');
  }

  function togglePause() {
    if (state.crawlState === 'running') api.pause();
    else if (state.crawlState === 'paused') api.resume();
  }

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function rememberAiConfig(cfg = aiConfig()) {
    state.settings.aiProvider = cfg.provider;
    state.settings.aiModel = cfg.model || '';
    state.settings.aiBaseURL = cfg.baseURL || '';
    saveSettings();
  }

  async function handleIntegration(action, target) {
    const url = target?.dataset.url || state.byId.get(state.selectedId)?.url;
    try {
      if (action === 'google-save-client') {
        const clientId = $('#google-client-id')?.value.trim();
        const clientSecret = $('#google-client-secret')?.value.trim();
        if (!clientId || !clientSecret) throw new Error('Pega el ID y el secreto de tu cliente OAuth.');
        await api.googleSetOAuthClient({ clientId, clientSecret });
        state.google.loaded = false;
        await loadGoogleCatalog();
        toast('Cliente OAuth guardado.');
      } else if (action === 'google-refresh') {
        state.google.loaded = false;
        await loadGoogleCatalog();
        toast('Propiedades de Google actualizadas.');
      } else if (action === 'google-connect') {
        state.google.connecting = true;
        state.google.error = '';
        refresh(true);
        await api.googleConnect();
        state.google.connecting = false;
        state.google.loaded = false;
        await loadGoogleCatalog();
        toast('Google quedó conectado.');
      } else if (action === 'google-disconnect') {
        await api.googleDisconnect();
        state.google.loaded = false;
        await loadGoogleCatalog();
        toast('Cuenta de Google desconectada.');
      } else if (action === 'google-sync') {
        state.google.busy = true;
        state.google.error = '';
        const result = await api.googleSync({
          siteUrl: $('#google-site') ? $('#google-site').value : state.settings.googleSiteUrl || '',
          property: $('#google-property') ? $('#google-property').value : state.settings.googleProperty || '',
          startDate: $('#google-start')?.value,
          endDate: $('#google-end')?.value,
        });
        mergeIntegrationRows(result.rows);
        toast(`Google sincronizado: ${fmt(result.gscPages)} páginas de Search Console y ${fmt(result.gaPages)} de Analytics.`);
      } else if (action === 'google-inspect') {
        state.google.busy = true;
        state.google.error = '';
        const result = await api.googleInspect({ url, siteUrl: state.settings.googleSiteUrl || '' });
        mergeIntegrationRows(result.rows);
        toast('Inspección de Google guardada.');
      } else if (action === 'google-queries') {
        state.google.busy = true;
        state.google.error = '';
        const result = await api.googleQueries({ url, siteUrl: state.settings.googleSiteUrl || '' });
        mergeIntegrationRows(result.rows);
        toast('Consultas de Search Console guardadas.');
      } else if (action === 'ai-save-key' || action === 'ai-clear-key') {
        const cfg = aiConfig();
        rememberAiConfig(cfg);
        if (action === 'ai-save-key' && !$('#ai-key')?.value.trim()) throw new Error('Pega una clave para guardarla.');
        await api.aiSetKey(cfg.provider, action === 'ai-clear-key' ? '' : $('#ai-key').value.trim());
        if (cfg.provider === 'compatible') await api.aiSetBaseURL(cfg.baseURL);
        state.ai.status = await api.aiStatus();
        state.ai.models = [];
        state.ai.modelsFor = '';
        if ($('#ai-key')) $('#ai-key').value = '';
        toast(action === 'ai-clear-key' ? 'Clave borrada.' : 'Clave guardada y cifrada en este equipo.');
      } else if (action === 'ai-models') {
        const cfg = aiConfig();
        rememberAiConfig(cfg);
        state.ai.models = await api.aiModels(cfg);
        state.ai.modelsFor = cfg.provider;
        state.ai.modelsError = '';
        state.ai.error = '';
        refresh(true);
        toast(`${fmt(state.ai.models.length)} modelos disponibles.`);
      } else if (action === 'ai-test') {
        const cfg = aiConfig();
        rememberAiConfig(cfg);
        state.ai.error = '';
        if (cfg.provider === 'compatible') await api.aiSetBaseURL(cfg.baseURL);
        const result = await api.aiTest(cfg);
        toast(`Conexión lista · ${result.model} · ${fmt(result.latencyMs)} ms.`);
      } else if (action === 'ai-summary') {
        const cfg = aiConfig();
        rememberAiConfig(cfg);
        if (cfg.provider === 'compatible') await api.aiSetBaseURL(cfg.baseURL);
        state.ai.busy = true;
        state.ai.error = '';
        refresh(true);
        state.ai.summary = await api.aiSummary(cfg);
        toast('Resumen ejecutivo creado.');
      } else if (action === 'ai-ask') {
        const cfg = aiConfig();
        rememberAiConfig(cfg);
        if (cfg.provider === 'compatible') await api.aiSetBaseURL(cfg.baseURL);
        state.ai.busy = true;
        state.ai.error = '';
        state.ai.reply = await api.aiAsk({ cfg, question: $('#ai-question')?.value || '' });
        refresh(true);
      } else if (action === 'ai-page') {
        if (!url) throw new Error('Selecciona una URL del rastreo.');
        const cfg = aiConfig();
        rememberAiConfig(cfg);
        if (cfg.provider === 'compatible') await api.aiSetBaseURL(cfg.baseURL);
        state.ai.busy = true;
        state.ai.error = '';
        refreshDrawer();
        const result = await api.aiAnalyzePage({ url, cfg });
        mergeIntegrationRows(result.rows);
        state.drawerTab = 'ia';
        toast('Análisis de página guardado.');
      } else if (action === 'lh-save-key' || action === 'lh-clear-key') {
        await api.lighthouseSetKey(action === 'lh-clear-key' ? '' : $('#lh-key')?.value.trim() || '');
        state.lighthouse.status = await api.lighthouseStatus();
        if ($('#lh-key')) $('#lh-key').value = '';
        toast(action === 'lh-clear-key' ? 'Clave PageSpeed borrada.' : 'Clave PageSpeed guardada.');
      } else if (action === 'lh-run-many') {
        state.lighthouse.busy = true;
        state.lighthouse.error = '';
        state.settings.lighthouseSource = $('#lh-source')?.value || 'local';
        state.settings.lighthouseStrategy = $('#lh-strategy')?.value || 'mobile';
        state.settings.lighthouseLimit = Math.max(1, Math.min(100, Number($('#lh-limit')?.value) || 10));
        saveSettings();
        refresh(true);
        const result = await api.lighthouseRunMany({ source: state.settings.lighthouseSource, strategy: state.settings.lighthouseStrategy, limit: state.settings.lighthouseLimit });
        const failed = result.results.filter((x) => !x.ok).length;
        if (failed) state.lighthouse.error = result.results.find((x) => !x.ok)?.error || `${fmt(failed)} páginas no se pudieron auditar.`;
        toast(`Auditoría completa: ${fmt(result.total - failed)} páginas listas${failed ? ` · ${fmt(failed)} con error` : ''}.`);
      } else if (action === 'lighthouse-one') {
        if (!url) throw new Error('Selecciona una URL del rastreo.');
        state.lighthouse.busy = true;
        state.lighthouse.error = '';
        const result = await api.lighthouseRunOne({ url, source: state.settings.lighthouseSource || 'local', strategy: state.settings.lighthouseStrategy || 'mobile' });
        mergeIntegrationRows(result.rows);
        state.drawerTab = 'lighthouse';
        toast('Auditoría Lighthouse guardada.');
      } else if (action === 'export-xlsx') {
        const result = await api.exportXlsx();
        if (result?.ok) toast('Libro de Excel exportado.');
        await warnMissingFonts(result);
      } else if (action === 'export-pptx') {
        const result = await api.exportPptx();
        if (result?.ok) toast('Presentación PowerPoint exportada.');
        await warnMissingFonts(result);
      }
    } catch (err) {
      const message = err.message || String(err);
      if (action.startsWith('google-')) state.google.error = message;
      else if (action.startsWith('ai-')) state.ai.error = message;
      else if (action.startsWith('lh-') || action.startsWith('lighthouse-')) state.lighthouse.error = message;
      toast(message, true);
    } finally {
      if (action.startsWith('google-')) state.google.busy = false;
      if (action === 'google-connect') state.google.connecting = false;
      if (action.startsWith('ai-')) state.ai.busy = false;
      if (action.startsWith('lh-') || action.startsWith('lighthouse-')) state.lighthouse.busy = false;
      if (action === 'lh-run-many') state.lighthouse.progress = null;
      if (TOOL_VIEWS.has(state.view)) refresh(true);
      refreshDrawer();
    }
  }

  function refreshDrawer() {
    if ($('#drawer').classList.contains('open')) renderDrawer();
  }

  async function menuAction(a) {
    const host = (state.meta && state.meta.startHost) || 'sitio';
    try {
      if (a === 'new' || a === 'home') go('home');
      else if (a === 'back') navStep(-1);
      else if (a === 'forward') navStep(1);
      else if (a === 'settings') showSettings();
      else if (a === 'onboarding') showOnboarding(0);
      else if (a === 'palette') showPalette();
      else if (a === 'shortcuts') showSettings('atajos');
      else if (a === 'open') {
        const p = await api.openProject();
        if (p) loadProject(p);
      } else if (a === 'save') {
        if (!state.rows.length) return toast('Primero rastrea un sitio.', true);
        const r = await api.saveProject();
        if (r && r.ok) toast('Rastreo guardado.');
      } else if (a === 'export-csv') {
        if (!currentTable) return toast('Abre una vista con tabla para exportarla.', true);
        const name = state.view === 'issues' ? `problema-${state.issueId}` : state.view;
        const r = await api.exportFile({ defaultName: `${host}-${name}-${stamp()}.csv`, content: currentTable.csv(), kind: 'csv' });
        if (r && r.ok) toast('CSV exportado.');
      } else if (a === 'export-report') {
        if (!state.result) return toast('Primero rastrea un sitio.', true);
        const html = window.OctosReport.build({ result: state.result, meta: { ...state.meta, finishedAt: state.meta.finishedAt || Date.now() }, byId: state.byId });
        const r = await api.exportFile({ defaultName: `informe-seo-${host}-${stamp()}.html`, content: html, kind: 'html' });
        if (r && r.ok) toast('Informe creado.');
      } else if (a === 'export-sitemap') {
        const list = state.rows.filter((r) => A.isPage(r) && r.indexable).sort((x, y) => (x.clickDepth ?? 99) - (y.clickDepth ?? 99));
        if (!list.length) return toast('No hay páginas indexables para el sitemap.', true);
        const esc2 = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const toDate = (s) => {
          const d = s ? new Date(s) : null;
          return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
        };
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list.map((r) => `  <url>\n    <loc>${esc2(r.url)}</loc>${toDate(r.lastModified) ? `\n    <lastmod>${toDate(r.lastModified)}</lastmod>` : ''}\n  </url>`).join('\n')}\n</urlset>\n`;
        const r = await api.exportFile({ defaultName: 'sitemap.xml', content: xml, kind: 'xml' });
        if (r && r.ok) toast(`Sitemap con ${fmt(list.length)} URLs creado.`);
      } else if (a === 'export-xlsx' || a === 'export-pptx') await handleIntegration(a, null);
    } catch (err) {
      toast(err.message || String(err), true);
    }
  }

  // Sin Manrope ni IBM Plex en el equipo, Office usa fuentes sustitutas: avisa y lleva a Ajustes
  async function warnMissingFonts(result) {
    if (!result || !result.ok) return;
    state.fonts = await api.fontsStatus();
    if (!state.fonts.installed) setTimeout(() => toast('Para ver la marca completa en el archivo, instala las tipografías en Ajustes → Apariencia.'), 3400);
  }

  function loadProject(p, historyEntry) {
    resetData();
    state.meta = p.meta || {};
    state.edges = p.edges || [];
    addRows(p.rows || []);
    state.crawlState = 'idle';
    const host = state.meta.startHost;
    const older = state.history.filter((h) => h.host === host && (!historyEntry || h.date < historyEntry.date));
    state.prevSummary = historyEntry ? (older[0] || {}).summary || null : null;
    state.view = 'overview';
    runAnalysis();
    refresh(true);
  }

  function saveSettings() {
    api.savePrefs({ settings: state.settings });
  }

  function setTheme(t) {
    state.prefs.theme = t;
    api.savePrefs({ theme: t });
    applyTheme();
  }
  function applyTheme() {
    const t = state.prefs.theme || 'system';
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // ======================================================================
  // Eventos
  function bindEvents() {
    $('#btn-new').onclick = () => go('home');
    $('#nav-back').onclick = () => navStep(-1);
    $('#nav-forward').onclick = () => navStep(1);
    $('#nav-home').onclick = () => go('home');
    $('#btn-settings').onclick = () => showSettings();
    $('#btn-palette').onclick = () => showPalette();
    $('#btn-export').onclick = (e) => showExportMenu(e.currentTarget);
    $('#btn-pause').onclick = togglePause;
    $('#btn-stop').onclick = () => api.stop();
    $('#crawlbar').onclick = () => state.rows.length && go('overview');

    $('#sidebar-foot').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ext]');
      if (b) api.openExternal(b.dataset.ext);
    });
    $('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) go(b.dataset.view);
    });

    const main = $('#main');
    main.addEventListener('submit', (e) => {
      if (e.target.id === 'url-form') {
        e.preventDefault();
        startCrawl($('#url-input').value);
      } else if (e.target.id === 'ai-question-form') {
        e.preventDefault();
        handleIntegration('ai-ask', e.target);
      }
    });
    main.addEventListener('input', (e) => {
      if (e.target.id === 'url-input') $('#url-error').textContent = '';
      if (e.target.id === 'table-search') {
        tableState(state.view).q = e.target.value;
        if (currentTable) currentTable.setRows(rowsForView(state.view));
      }
    });
    main.addEventListener('change', (e) => {
      if (e.target.id === 'max-urls') {
        state.settings.maxUrls = Number(e.target.value);
        saveSettings();
      } else if (e.target.id === 'google-site') {
        state.settings.googleSiteUrl = e.target.value;
        saveSettings();
      } else if (e.target.id === 'google-property') {
        state.settings.googleProperty = e.target.value;
        saveSettings();
      } else if (e.target.id === 'google-start' || e.target.id === 'google-end') {
        state.google.range = { ...(state.google.range || {}), startDate: $('#google-start')?.value, endDate: $('#google-end')?.value };
      } else if (e.target.id === 'ai-provider') {
        state.settings.aiProvider = e.target.value;
        if (!state.settings.aiModel || state.settings.aiModel === 'claude-opus-5-5') state.settings.aiModel = e.target.value === 'anthropic' ? 'claude-opus-5-5' : '';
        state.ai.models = [];
        state.ai.modelsFor = '';
        state.ai.modelsError = '';
        saveSettings();
        refresh(true);
      } else if (e.target.id === 'ai-model') {
        state.settings.aiModel = e.target.value;
        saveSettings();
      } else if (e.target.id === 'ai-base-url') {
        state.settings.aiBaseURL = e.target.value;
        state.ai.models = [];
        state.ai.modelsFor = '';
        saveSettings();
        ensureAiModels();
      } else if (e.target.id === 'lh-source') {
        state.settings.lighthouseSource = e.target.value;
        saveSettings();
        refresh(true);
      } else if (e.target.id === 'lh-strategy') {
        state.settings.lighthouseStrategy = e.target.value;
        saveSettings();
        refresh(true);
      } else if (e.target.id === 'lh-limit') {
        state.settings.lighthouseLimit = Math.max(1, Math.min(100, Number(e.target.value) || 10));
        saveSettings();
      }
    });
    main.addEventListener('click', async (e) => {
      const t = e.target;
      const integration = t.closest('[data-integration]');
      if (integration) return handleIntegration(integration.dataset.integration, integration);
      const tog = t.closest('[data-toggle]');
      if (tog) {
        const k = tog.dataset.toggle;
        state.settings[k] = !state.settings[k];
        tog.classList.toggle('on', state.settings[k]);
        saveSettings();
        return;
      }
      if (t.closest('[data-guide-open]')) {
        state.google.guideOpen = true;
        refresh(true);
        const guide = $('.guide');
        if (guide) guide.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const extLink = t.closest('[data-ext]');
      if (extLink) return api.openExternal(extLink.dataset.ext);
      if (t.closest('#open-settings')) return showSettings();
      if (t.closest('#open-file')) return menuAction('open');
      const rem = t.closest('[data-remove]');
      if (rem) {
        e.stopPropagation();
        state.history = await api.removeHistory(rem.dataset.remove);
        return refresh(true);
      }
      const hist = t.closest('[data-history]');
      if (hist) {
        const entry = state.history.find((h) => h.id === hist.dataset.history);
        const p = await api.openHistory(hist.dataset.history);
        if (p) loadProject(p, entry);
        else toast('No se encontró el archivo de ese rastreo.', true);
        return;
      }
      const iss = t.closest('[data-issue]');
      if (iss) return openIssue(iss.dataset.issue);
      const g = t.closest('[data-go]');
      if (g) return go(g.dataset.go);
      const selectUrl = t.closest('[data-select-url]');
      if (selectUrl) {
        const row = state.byUrl.get(selectUrl.dataset.selectUrl);
        if (row) { if (!VIEWS[state.view] && !TOOL_VIEWS.has(state.view)) go('all'); selectRow(row.id); }
        return;
      }
      const select = t.closest('[data-select]');
      if (select && select.dataset.select) return selectRow(Number(select.dataset.select));
      const cat = t.closest('[data-cat]');
      if (cat) {
        state.issueCat = cat.dataset.cat;
        state.issueId = null;
        return go('issues');
      }
      const cf = t.closest('[data-cat-filter]');
      if (cf) {
        state.issueCat = cf.dataset.catFilter;
        state.issueId = null;
        return refresh(true);
      }
      const pick = t.closest('[data-issue-pick]');
      if (pick) {
        state.issueId = pick.dataset.issuePick;
        return refresh(true);
      }
      const f = t.closest('[data-filter]');
      if (f) {
        const ts = tableState(state.view);
        ts.filter = f.dataset.filter === '' ? null : Number(f.dataset.filter);
        return refresh(true);
      }
      if (t.closest('#table-csv') || t.closest('#issue-csv')) return menuAction('export-csv');
      if (t.closest('#ov-report')) return menuAction('export-report');
      if (t.closest('#gen-sitemap')) return menuAction('export-sitemap');
    });
    // Recuerda si la guía de Google está abierta, para que no se cierre al actualizar la vista
    main.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('guide')) state.google.guideOpen = e.target.open; }, true);
    main.addEventListener('keydown', (e) => {
      const hist = e.target.closest && e.target.closest('[data-history]');
      if (hist && e.key === 'Enter') hist.click();
    });

    $('#drawer').addEventListener('click', (e) => {
      const t = e.target;
      const integration = t.closest('[data-integration]');
      if (integration) return handleIntegration(integration.dataset.integration, integration);
      if (t.closest('#drawer-close')) {
        closeDrawer();
        state.selectedId = null;
        if (currentTable) currentTable.draw(true);
        return;
      }
      const r = state.byId.get(state.selectedId);
      if (t.closest('#drawer-open') && r) return api.openExternal(r.url);
      if (t.closest('#drawer-copy') && r) {
        navigator.clipboard.writeText(r.url);
        return toast('URL copiada.');
      }
      const tab = t.closest('[data-tab]');
      if (tab) {
        state.drawerTab = tab.dataset.tab;
        return renderDrawer();
      }
      const s = t.closest('[data-select]');
      if (s && s.dataset.select) return selectRow(Number(s.dataset.select));
      const ext = t.closest('[data-ext]');
      if (ext) api.openExternal(ext.dataset.ext);
    });

    document.addEventListener('keydown', (e) => {
      if (recording) return finishRecording(e);
      const overlayOpen = !$('#overlay').hidden;
      if (e.key === 'Escape') {
        if (overlayOpen && !$('.onb')) return closeOverlay();
        if ($('#drawer').classList.contains('open')) {
          closeDrawer();
          return;
        }
      }
      if (overlayOpen) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      const combo = comboFromEvent(e);
      const action = Object.entries(state.shortcuts).find(([, c]) => c === combo);
      if (!action) return;
      const [id] = action;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (typing && plain) return;
      e.preventDefault();
      if (id === 'palette') showPalette();
      else if (id === 'startPause') {
        if (state.view === 'home') startCrawl($('#url-input') ? $('#url-input').value : '');
        else togglePause();
      } else if (id === 'search') {
        const s = $('#table-search');
        if (s) s.focus();
        else showPalette();
      } else if (id === 'overview') go('overview');
      else if (id === 'issues') go('issues');
      else if (id === 'all') go('all');
      else if (id === 'back') navStep(-1);
      else if (id === 'forward') navStep(1);
      else if (id === 'home') go('home');
      else if (id === 'toggleDetail') {
        if ($('#drawer').classList.contains('open')) closeDrawer();
        else if (state.selectedId) openDrawer();
      } else if (id === 'nextRow' && currentTable) currentTable.move(1);
      else if (id === 'prevRow' && currentTable) currentTable.move(-1);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

    api.onRows((rows) => {
      addRows(rows);
      scheduleAnalysis();
      renderChrome();
    });
    api.onEdges((edges) => {
      for (const e of edges) state.edges.push(e);
    });
    api.onProgress((p) => {
      state.progress = p;
      renderChrome();
    });
    api.onState((s) => {
      state.crawlState = s;
      renderChrome();
    });
    api.onLog((m) => {
      state.logs.push(m);
      const log = $('#log');
      if (log) log.innerHTML = state.logs.slice(-8).map(esc).join('<br>');
    });
    api.onMeta((m) => {
      state.meta = { ...state.meta, ...m };
    });
    api.onError((msg) => {
      toast(msg, true);
      state.crawlState = 'idle';
      if (!state.rows.length) go('home');
    });
    api.onDone(async ({ id, state: final }) => {
      state.crawlId = id;
      state.crawlState = final === 'stopped' ? 'stopped' : 'done';
      scheduleAnalysis(true);
      const r = state.result;
      if (r) {
        const entry = { id, host: state.meta.startHost, startUrl: state.meta.startUrl, date: state.meta.startedAt, score: r.score, pages: r.stats.pages, summary: A.summarize(r) };
        state.history = await api.recordHistory(entry);
        toast(`Rastreo ${final === 'stopped' ? 'detenido' : 'completo'}: ${fmt(state.rows.length)} URLs · salud ${r.score ?? '–'}`);
      } else toast('El rastreo terminó sin resultados. Revisa la dirección.', true);
      refresh(true);
      if (window.__octosCaptureDone) window.__octosCaptureDone();
    });
    api.onMenu(menuAction);
    api.onIntegrationRows((rows) => mergeIntegrationRows(rows));
    api.onLighthouseProgress((progress) => {
      state.lighthouse.progress = progress;
      if (state.view === 'lighthouse') refresh(true);
    });
    api.onOpenFile(async (file) => {
      try {
        const p = await api.openProject(file);
        if (p) loadProject(p);
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ======================================================================
  // Modo capturas (npm run shots): recorre la app y guarda PNG
  async function runCaptures() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shot = async (name) => {
      await wait(700);
      await frame();
      await api.capture(name);
    };
    showOnboarding(0);
    await shot('01-introduccion');
    showOnboarding(2);
    await shot('02-introduccion-atajos');
    closeOverlay();
    state.settings.renderJs = true;
    refresh(true);
    await shot('03-inicio');
    const url = await api.captureFixture();
    const done = new Promise((r) => (window.__octosCaptureDone = r));
    state.settings.concurrency = 4;
    await startCrawl(url);
    await done;
    await wait(500);
    await shot('04-resumen');
    $('#toasts').innerHTML = '';
    go('issues');
    await shot('05-prioridades');
    go('titles');
    const firstWithIssue = state.rows.find((r) => A.isPage(r) && r.dupTitle);
    if (firstWithIssue) selectRow(firstWithIssue.id);
    await shot('06-titulos-detalle');
    go('js');
    const js = state.rows.find((r) => r.jsDiff && r.jsDiff.titleChanged) || state.rows.find((r) => r.jsDiff);
    if (js) {
      selectRow(js.id);
      state.drawerTab = 'tecnico';
      renderDrawer();
    }
    await shot('07-javascript');
    state.drawerTab = 'resumen';
    closeDrawer();
    go('conversion');
    await shot('08-conversion');
    showPalette();
    $('#pal-input').value = 'tít';
    $('#pal-input').dispatchEvent(new Event('input'));
    await shot('09-paleta');
    closeOverlay();
    showSettings('atajos');
    await shot('10-ajustes-atajos');
    closeOverlay();
    setTheme('dark');
    go('overview');
    await shot('11-resumen-oscuro');
    setTheme('system');
    await api.captureQuit();
  }

  // ======================================================================
  async function init() {
    hydrate();
    const data = await api.init();
    state.prefs = data.prefs;
    state.defaults = data.defaults;
    state.history = data.history || [];
    state.capture = data.capture;
    state.settings = {
      maxUrls: 5000,
      maxDepth: 12,
      concurrency: 6,
      delayMs: 0,
      timeoutSec: 20,
      uaKey: 'octos',
      respectRobots: true,
      includeSubdomains: false,
      checkExternal: false,
      crawlSitemaps: true,
      renderJs: false,
      renderWaitMs: 1200,
      googleSiteUrl: '',
      googleProperty: '',
      aiProvider: 'anthropic',
      aiModel: 'claude-opus-5-5',
      aiBaseURL: '',
      lighthouseSource: 'local',
      lighthouseStrategy: 'mobile',
      lighthouseLimit: 10,
      include: '',
      exclude: '',
      lastUrl: '',
      ...(data.prefs.settings || {}),
    };
    state.shortcuts = { ...Object.fromEntries(SHORTCUTS.map((x) => [x.id, x.def])), ...(data.prefs.shortcuts || {}) };
    applyTheme();
    api.fontsStatus().then((f) => { state.fonts = f; }).catch(() => {});
    bindEvents();
    refresh(true);
    if (state.capture) return runCaptures();
    if (!state.prefs.onboarded) showOnboarding(0);
  }

  init();
})();
