// Pruebas de las reglas con datos de Google y Lighthouse en lib/analysis.js.
// Uso: node test/analisis-v2.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const A = require('../lib/analysis.js');
const { Crawler } = require('../lib/crawler.js');
const fixture = require('./fixture-server.js');

let passed = 0;
let skipped = 0;
const test = async (name, fn) => {
  try {
    const r = await fn();
    if (r === 'skip') {
      skipped++;
      console.log('  -', name, '(omitida)');
      return;
    }
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.stack || err.message);
    process.exitCode = 1;
  }
};

console.log('Octos · reglas con datos de Google y Lighthouse');

// ---- Filas sintéticas
const BASE = 'https://ejemplo.cl';
let nextId = 1;
const mk = (path, extra = {}) => ({
  id: nextId++,
  url: BASE + path,
  internal: true,
  status: 200,
  contentType: 'text/html; charset=utf-8',
  indexable: true,
  indexReason: '',
  title: 'Título de prueba ' + path,
  titleLen: 40,
  titlePx: 300,
  metaDesc: 'Descripción de prueba para ' + path,
  descPx: 400,
  h1: ['H1 ' + path],
  canonical: BASE + path,
  canonicalCount: 1,
  lang: 'es',
  viewport: true,
  favicon: true,
  wordCount: 500,
  ctas: ['Cotiza'],
  forms: [],
  outlinksInternal: 5,
  time: 200,
  size: 20000,
  compression: 'gzip',
  og: { title: 'x', image: 'x' },
  jsonldTypes: ['WebPage'],
  hasTel: true,
  simhash: null,
  ...extra,
});
const lhOf = ({ lcp = 1500, cls = 0.02, tbt = 50, inp = null, performance = 90, accessibility = 95, field = null } = {}) => ({
  source: 'psi',
  strategy: 'mobile',
  scores: { performance, accessibility, bestPractices: 90, seo: 90 },
  metrics: { lcp, cls, tbt, fcp: 1000, si: 1500, ttfb: 300, inp },
  field,
  opportunities: [],
  diagnostics: [],
});
const gsc = (impressions, clicks, position) => ({ impressions, clicks, ctr: impressions ? clicks / impressions : 0, position, range: { startDate: '2026-09-15', endDate: '2026-10-12' } });
const ga = (views, keyEvents) => ({ views, sessions: Math.round(views * 0.8), engagementRate: 0.5, keyEvents, avgEngagementTime: 40, range: { startDate: '2026-09-15', endDate: '2026-10-12' } });

function build(list) {
  nextId = 1;
  const home = mk('/', { gsc: gsc(5000, 900, 1.5), ga: ga(3000, 40) });
  const rows = [home, ...list.map(([p, e]) => mk(p, e))];
  const edges = rows.slice(1).map((r) => [home.id, r.url, 'enlace', false]);
  for (const r of rows.slice(1)) edges.push([r.id, home.url, 'Inicio', false]);
  return { rows, edges, meta: { startUrl: home.url } };
}

const withData = build([
  ['/ctr-bajo', { gsc: gsc(1000, 5, 2) }],
  ['/ctr-ok', { gsc: gsc(1000, 150, 2) }],
  ['/oportunidad', { gsc: gsc(500, 15, 7.5) }],
  ['/sin-fila-gsc', {}],
  ['/cero-impresiones', { gsc: gsc(0, 0, 0) }],
  ['/falla-404', { status: 404, contentType: 'text/html', indexable: false, indexReason: 'Error del cliente', gsc: gsc(300, 12, 6) }],
  ['/falla-noindex', { indexable: false, indexReason: 'noindex', ga: ga(50, 0), gsc: gsc(10, 0, 30) }],
  ['/sin-cta', { ctas: [], forms: [], gsc: gsc(400, 30, 3) }],
  ['/sin-eventos', { ga: ga(400, 0), gsc: gsc(50, 2, 8) }],
  ['/no-indexada', { gsc: gsc(5, 0, 40), inspection: { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' } }],
  ['/parcial', { gsc: gsc(50, 2, 5), inspection: { verdict: 'PARTIAL', coverageState: 'Submitted and indexed', googleCanonical: BASE + '/parcial', userCanonical: BASE + '/parcial' } }],
  ['/canonical', { gsc: gsc(50, 2, 5), inspection: { verdict: 'PASS', coverageState: 'Duplicate, Google chose different canonical than user', googleCanonical: BASE + '/otra', userCanonical: BASE + '/canonical' } }],
  ['/lcp', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ lcp: 4000 }) } }],
  ['/lcp-field-ok', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ lcp: 4000, field: { lcp: 1800, cls: 0.01, inp: 100, origin: false } }) } }],
  ['/lcp-field-origen', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ lcp: 4000, field: { lcp: 1800, cls: 0.01, inp: 100, origin: true } }) } }],
  ['/cls', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ cls: 0.3 }) } }],
  ['/inp', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ field: { lcp: 1000, cls: 0.01, inp: 350, origin: false } }) } }],
  ['/tbt', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ tbt: 600 }) } }],
  ['/inp-ok-tbt-alto', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ tbt: 900, field: { lcp: 1000, cls: 0.01, inp: 100, origin: false } }) } }],
  ['/perf', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ performance: 30 }) } }],
  ['/a11y', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf({ accessibility: 60 }) } }],
  ['/escritorio', { gsc: gsc(50, 2, 5), lighthouse: { mobile: { error: 'PSI falló' }, desktop: { ...lhOf({ lcp: 5000 }), strategy: 'desktop' } } }],
  ['/lh-ok', { gsc: gsc(50, 2, 5), lighthouse: { mobile: lhOf() } }],
]);
const res = A.analyze(withData);
const idOf = (p) => withData.rows.find((r) => r.url === BASE + p).id;
const issue = (id) => res.issues.find((i) => i.id === id);
const has = (id, p) => {
  const it = issue(id);
  assert.ok(it, `falta el problema ${id}`);
  assert.ok(it.ids.includes(idOf(p)), `${p} no está en ${id} (${it.ids.map((i) => withData.rows[i - 1].url).join(', ')})`);
};
const hasNot = (id, p) => {
  const it = issue(id);
  if (it) assert.ok(!it.ids.includes(idOf(p)), `${p} no debería estar en ${id}`);
};

await test('curva de CTR esperado por posición', () => {
  assert.equal(A.expectedCtr(1), 0.28);
  assert.equal(A.expectedCtr(0.5), 0.28);
  assert.ok(Math.abs(A.expectedCtr(2.5) - 0.135) < 1e-9);
  assert.equal(A.expectedCtr(10), 0.02);
  assert.ok(Math.abs(A.expectedCtr(15) - 0.0125) < 1e-9);
  assert.equal(A.expectedCtr(30), 0.005);
  assert.equal(A.expectedCtr(null), null);
  for (let p = 1; p < 25; p += 0.25) assert.ok(A.expectedCtr(p) >= A.expectedCtr(p + 0.25), `no decrece en ${p}`);
});

await test('categoría Tráfico orgánico al final de CATEGORIES', () => {
  const last = A.CATEGORIES[A.CATEGORIES.length - 1];
  assert.deepEqual(last, { id: 'organico', label: 'Tráfico orgánico', tone: 'azul' });
  assert.equal(A.CATEGORIES.length, 7);
});

await test('CTR bajo y oportunidades en posiciones 4 a 15', () => {
  has('ctr-bajo', '/ctr-bajo');
  hasNot('ctr-bajo', '/ctr-ok');
  hasNot('ctr-bajo', '/oportunidad');
  hasNot('ctr-bajo', '/');
  has('oportunidad-4-15', '/oportunidad');
  hasNot('oportunidad-4-15', '/ctr-bajo');
  hasNot('oportunidad-4-15', '/falla-404'); // no es página 200
  assert.equal(issue('ctr-bajo').category, 'organico');
});

await test('indexables sin impresiones (sin fila o con 0)', () => {
  has('sin-impresiones', '/sin-fila-gsc');
  has('sin-impresiones', '/cero-impresiones');
  hasNot('sin-impresiones', '/falla-noindex');
  hasNot('sin-impresiones', '/ctr-ok');
});

await test('páginas con tráfico que hoy fallan', () => {
  has('trafico-falla', '/falla-404');
  has('trafico-falla', '/falla-noindex');
  hasNot('trafico-falla', '/ctr-ok');
  assert.equal(issue('trafico-falla').severity, 'critico');
});

await test('tráfico sin llamada a la acción (Conversión)', () => {
  has('trafico-sin-cta', '/sin-cta');
  hasNot('trafico-sin-cta', '/ctr-ok');
  assert.equal(issue('trafico-sin-cta').category, 'conversion');
});

await test('visitas sin eventos clave', () => {
  has('sin-eventos-clave', '/sin-eventos');
  hasNot('sin-eventos-clave', '/');
  hasNot('sin-eventos-clave', '/falla-noindex'); // pocas visitas
  assert.match(issue('sin-eventos-clave').fix, /^Revisa/, 'el sitio sí tiene eventos clave');
});

await test('inspección: no indexada y canonical de Google', () => {
  has('no-indexada', '/no-indexada');
  hasNot('no-indexada', '/parcial');
  has('no-indexada', '/canonical'); // «Duplicate, Google chose…» no está indexada
  has('canonical-google', '/canonical');
  hasNot('canonical-google', '/parcial');
});

await test('Lighthouse: LCP, CLS, INP/TBT y puntajes', () => {
  has('lcp-lento', '/lcp');
  hasNot('lcp-lento', '/lcp-field-ok'); // el dato real gana al laboratorio
  has('lcp-lento', '/lcp-field-origen'); // el dato de origen no cuenta
  has('lcp-lento', '/escritorio'); // móvil falló: usa escritorio
  hasNot('lcp-lento', '/lh-ok');
  has('cls-alto', '/cls');
  hasNot('cls-alto', '/lh-ok');
  has('inp-tbt-alto', '/inp');
  has('inp-tbt-alto', '/tbt');
  hasNot('inp-tbt-alto', '/inp-ok-tbt-alto');
  has('lh-rendimiento', '/perf');
  has('lh-accesibilidad', '/a11y');
  hasNot('lh-rendimiento', '/lh-ok');
  for (const id of ['lcp-lento', 'cls-alto', 'inp-tbt-alto', 'lh-rendimiento', 'lh-accesibilidad']) {
    assert.equal(issue(id).category, 'rendimiento', id);
    assert.ok(issue(id).why && issue(id).fix, id);
  }
  assert.match(issue('lcp-lento').why, /CrUX/);
});

await test('textos sin exclamaciones y con verbo al inicio en la solución', () => {
  const nuevos = ['ctr-bajo', 'oportunidad-4-15', 'sin-impresiones', 'trafico-falla', 'trafico-sin-cta', 'sin-eventos-clave', 'no-indexada', 'canonical-google', 'lcp-lento', 'cls-alto', 'inp-tbt-alto', 'lh-rendimiento', 'lh-accesibilidad'];
  for (const id of nuevos) {
    const it = issue(id);
    assert.ok(it, id);
    assert.ok(!/[!¡]/.test(it.title + it.why + it.fix), id);
    assert.ok(A.SEV[it.severity] && it.effort >= 1 && it.effort <= 3, id);
  }
});

await test('estadísticas de Google y Lighthouse', () => {
  const g = res.stats.gsc;
  const rowsGsc = withData.rows.filter((r) => r.gsc);
  assert.equal(g.pages, rowsGsc.length);
  assert.equal(g.clicks, rowsGsc.reduce((s, r) => s + r.gsc.clicks, 0));
  assert.equal(g.impressions, rowsGsc.reduce((s, r) => s + r.gsc.impressions, 0));
  assert.ok(Math.abs(g.ctr - g.clicks / g.impressions) < 1e-12);
  const wp = rowsGsc.filter((r) => r.gsc.impressions > 0);
  const pos = wp.reduce((s, r) => s + r.gsc.position * r.gsc.impressions, 0) / wp.reduce((s, r) => s + r.gsc.impressions, 0);
  assert.ok(Math.abs(g.position - pos) < 1e-9, `posición ${g.position} vs ${pos}`);
  assert.deepEqual(g.range, { startDate: '2026-09-15', endDate: '2026-10-12' });
  assert.deepEqual({ views: res.stats.ga.views, keyEvents: res.stats.ga.keyEvents }, { views: 3000 + 50 + 400, keyEvents: 40 });
  const lh = res.stats.lighthouse;
  assert.equal(lh.pages, 11);
  assert.equal(lh.mobile, 10);
  assert.equal(lh.medianLcp, 1500);
  assert.equal(lh.medianCls, 0.02);
  assert.equal(lh.medianPerformance, 90);
  assert.deepEqual(res.stats.inspection, { pages: 3, notIndexed: 2 });
});

await test('puntaje por categoría con datos', () => {
  assert.equal(typeof res.categoryScores.organico, 'number');
  assert.ok(res.categoryScores.organico < 100);
  assert.ok(res.categoryScores.rendimiento < 100);
  const s = A.summarize(res);
  assert.equal(s.issues['trafico-falla'], 2);
  assert.equal(s.score, res.score);
});

await test('solo Analytics: sin reglas de Search Console y con puntaje orgánico', () => {
  const d = build([['/a', { ga: ga(500, 0) }], ['/b', {}]]);
  for (const r of d.rows) delete r.gsc;
  const r = A.analyze(d);
  assert.equal(r.issues.find((i) => i.id === 'sin-impresiones'), undefined);
  assert.equal(r.issues.find((i) => i.id === 'ctr-bajo'), undefined);
  assert.equal(r.stats.gsc, undefined);
  const ev = r.issues.find((i) => i.id === 'sin-eventos-clave');
  assert.ok(ev, 'falta sin-eventos-clave');
  assert.equal(typeof r.categoryScores.organico, 'number');
});

await test('sin eventos clave en todo el sitio: pide configurarlos', () => {
  const d = build([['/a', { ga: ga(500, 0) }]]);
  d.rows[0].ga.keyEvents = 0;
  const r = A.analyze(d);
  assert.match(r.issues.find((i) => i.id === 'sin-eventos-clave').fix, /^Ninguna página registra eventos clave/);
});

await test('filas sintéticas sin datos: nada nuevo y orgánico en null', () => {
  const d = build([['/a', {}], ['/b', {}]]);
  for (const r of d.rows) {
    delete r.gsc;
    delete r.ga;
  }
  const r = A.analyze(d);
  const nuevos = new Set(['ctr-bajo', 'oportunidad-4-15', 'sin-impresiones', 'trafico-falla', 'trafico-sin-cta', 'sin-eventos-clave', 'no-indexada', 'canonical-google', 'lcp-lento', 'cls-alto', 'inp-tbt-alto', 'lh-rendimiento', 'lh-accesibilidad']);
  assert.deepEqual(r.issues.filter((i) => nuevos.has(i.id)), []);
  assert.equal(r.categoryScores.organico, null);
  for (const k of ['gsc', 'ga', 'lighthouse', 'inspection']) assert.ok(!(k in r.stats), k);
});

// ---- Datos cruzados con mergeGoogleData (lib/google.js), como en la app
const { mergeGoogleData } = require('../lib/google.js');
const S = 'https://s.cl';
const pg = (id, path, x = {}) => ({ id, url: S + path, internal: true, status: 200, contentType: 'text/html', indexable: true, indexReason: '', title: 'T' + id, h1: ['h'], ctas: ['Cotiza'], forms: [], ...x });
const rd = (id, url, to, status = 301) => ({ id, url, internal: true, status, redirectTo: to, contentType: 'text/html', indexable: false, indexReason: 'Redirección' });
function site(extra = []) {
  const rows = [
    pg(1, '/'),
    rd(2, S + '/servicios', S + '/servicios/'), // solo cambia la barra final
    pg(3, '/servicios/'),
    pg(4, '/contacto'),
    rd(5, 'http://www.s.cl/contacto', 'https://www.s.cl/contacto'), // protocolo y www
    rd(6, 'https://www.s.cl/contacto', S + '/contacto'),
    ...extra,
  ];
  const edges = rows.slice(1).map((r) => [1, r.url, 'a', false]);
  for (const r of rows) if (r.redirectTo) edges.push([r.id, r.redirectTo, '(redirección)', false]);
  return { rows, edges, meta: { startUrl: S + '/' } };
}
const gscPages = [
  { url: S + '/servicios/', clicks: 50, impressions: 1000, ctr: 0.05, position: 3 },
  { url: S + '/', clicks: 10, impressions: 200, ctr: 0.05, position: 2 },
  { url: S + '/contacto', clicks: 5, impressions: 100, ctr: 0.05, position: 4 },
];
const gaPages = [
  { hostName: 's.cl', pagePath: '/servicios/', views: 400, sessions: 300, engagementRate: 0.5, keyEvents: 2, avgEngagementTime: 30 },
  { hostName: 's.cl', pagePath: '/contacto', views: 120, sessions: 100, engagementRate: 0.5, keyEvents: 3, avgEngagementTime: 30 },
];
const ids = (r, id) => (r.issues.find((i) => i.id === id) || { ids: [] }).ids;

await test('redirección 301 a una página 200: los datos quedan en el destino y no falla', () => {
  const d = site();
  mergeGoogleData(d.rows, { gscPages, gaPages, startHost: 's.cl' });
  assert.equal(d.rows[1].gsc, undefined, 'la 301 no recibe los datos de su destino');
  assert.equal(d.rows[2].gsc.clicks, 50, 'el destino sí los recibe, una sola vez');
  assert.equal(d.rows[4].ga, undefined, 'la variante http://www tampoco recibe visitas');
  assert.equal(d.rows[3].ga.views, 120, 'las visitas quedan en la página final');
  const r = A.analyze(d);
  assert.deepEqual(ids(r, 'trafico-falla'), []);
});

await test('redirecciones con tráfico que sí fallan: a 404, a noindex, en bucle', () => {
  const d = site([
    rd(7, S + '/vieja', S + '/borrada'),
    pg(8, '/borrada', { status: 404, indexable: false, indexReason: 'Error del cliente' }),
    rd(9, S + '/a-noindex', S + '/oculta'),
    pg(10, '/oculta', { indexable: false, indexReason: 'noindex' }),
    rd(11, S + '/bucle-a', S + '/bucle-b'),
    rd(12, S + '/bucle-b', S + '/bucle-a'),
    rd(13, S + '/afuera', 'https://otro.cl/'), // destino fuera del rastreo
    rd(14, S + '/migrada', S + '/servicios/'), // 301 correcta con clics residuales propios
  ]);
  const extraGsc = ['/vieja', '/a-noindex', '/bucle-a', '/afuera', '/migrada'].map((p) => ({ url: S + p, clicks: 7, impressions: 90, ctr: 7 / 90, position: 6 }));
  mergeGoogleData(d.rows, { gscPages: [...gscPages, ...extraGsc], gaPages, startHost: 's.cl' });
  const r = A.analyze(d);
  assert.deepEqual(ids(r, 'trafico-falla').sort((a, b) => a - b), [7, 9, 11]);
  // La 301 con datos propios sí suma: Search Console los reporta aparte
  assert.equal(r.stats.gsc.clicks, 50 + 10 + 5 + 7 * 5);
});

await test('totales de Search Console y Analytics sin contar dos veces las variantes', () => {
  const d = site();
  mergeGoogleData(d.rows, { gscPages, gaPages, startHost: 's.cl' });
  const r = A.analyze(d);
  assert.equal(r.stats.gsc.clicks, 65);
  assert.equal(r.stats.gsc.impressions, 1300);
  assert.equal(r.stats.gsc.pages, 3);
  const pos = (3 * 1000 + 2 * 200 + 4 * 100) / 1300;
  assert.ok(Math.abs(r.stats.gsc.position - pos) < 1e-9, `posición ${r.stats.gsc.position}`);
  assert.equal(r.stats.ga.views, 520);
  assert.equal(r.stats.ga.sessions, 400);
  assert.equal(r.stats.ga.keyEvents, 5);
  assert.equal(r.stats.ga.pages, 3); // portada (0), servicios y contacto
});

await test('Search Console y Analytics sin filas: se tratan como sin datos', () => {
  const d = site();
  mergeGoogleData(d.rows, { gscPages: [], gaPages: [], startHost: 's.cl' });
  assert.equal(d.rows[0].gsc.impressions, 0, 'mergeGoogleData deja ceros en las páginas');
  const r = A.analyze(d);
  for (const id of ['sin-impresiones', 'ctr-bajo', 'oportunidad-4-15', 'sin-eventos-clave', 'trafico-falla', 'trafico-sin-cta']) assert.deepEqual(ids(r, id), [], id);
  assert.equal(r.stats.gsc, undefined);
  assert.equal(r.stats.ga, undefined);
  assert.equal(r.categoryScores.organico, null);
  // Con Analytics vacío pero Search Console con datos, las reglas de Search Console siguen
  const d2 = site();
  mergeGoogleData(d2.rows, { gscPages, gaPages: [], startHost: 's.cl' });
  const r2 = A.analyze(d2);
  assert.ok(r2.stats.gsc && !r2.stats.ga);
  assert.equal(typeof r2.categoryScores.organico, 'number');
});

await test('cobertura «indexada, aunque bloqueada por robots.txt» cuenta como indexada', () => {
  const cases = [
    ['Indexed, though blocked by robots.txt', 'PASS', false],
    ['Indexada, aunque bloqueada por robots.txt', 'PASS', false],
    ['Indexed, though blocked by robots.txt', 'NEUTRAL', false],
    ['Indexed, not submitted in sitemap', 'PASS', false],
    ['Blocked by robots.txt', 'NEUTRAL', true],
    ['Bloqueada por robots.txt', 'NEUTRAL', true],
    ['Excluded by ‘noindex’ tag', 'NEUTRAL', true],
  ];
  for (const [coverageState, verdict, expected] of cases) {
    const d = site();
    d.rows[2].inspection = { verdict, coverageState };
    const r = A.analyze(d);
    assert.equal(ids(r, 'no-indexada').includes(3), expected, coverageState + ' / ' + verdict);
  }
});

// ---- Sin datos: igual que la versión anterior con un rastreo del sitio de prueba
await test('rastreo del fixture sin datos: resultado idéntico a la versión anterior', async () => {
  // Versión anterior de lib/analysis.js (commit que creó Octos)
  let oldSource;
  try {
    oldSource = execFileSync('git', ['-C', root, 'show', '93874e3:./lib/analysis.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    console.log('    (sin historial de git: no se puede cargar la versión anterior)');
    return 'skip';
  }
  const dir = mkdtempSync(join(tmpdir(), 'octos-analisis-v1-'));
  try {
    writeFileSync(join(dir, 'analysis.js'), oldSource);
    copyFileSync(join(root, 'lib', 'simhash.js'), join(dir, 'simhash.js'));
    const Old = require(join(dir, 'analysis.js'));
    assert.notEqual(Old.analyze, A.analyze);
    assert.equal(Old.CATEGORIES.length, 6);

    const server = await fixture.start(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const crawler = new Crawler({ startUrl: base + '/', concurrency: 4, checkExternal: false, timeoutMs: 5000 });
      await crawler.start();
      const snap = crawler.snapshot();
      const a = Old.analyze(structuredClone(snap));
      const b = A.analyze(structuredClone(snap));
      assert.ok(a.issues.length > 10, `problemas: ${a.issues.length}`);
      assert.deepEqual(b.issues, a.issues);
      assert.equal(b.score, a.score);
      assert.deepEqual(b.stats, a.stats);
      assert.deepEqual(b.rows, a.rows);
      assert.equal(b.nearPairs, a.nearPairs);
      const { organico, ...resto } = b.categoryScores;
      assert.equal(organico, null);
      assert.deepEqual(resto, a.categoryScores);
      assert.deepEqual(A.summarize(b), Old.summarize(a));
    } finally {
      server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} pruebas OK${skipped ? ` · ${skipped} omitidas` : ''}`);
