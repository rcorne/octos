// Pruebas del motor: robots, píxeles, simhash y un rastreo completo
// contra el sitio de prueba. Uso: npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseRobots, isAllowed } = require('../lib/robots.js');
const { textWidth } = require('../lib/pixels.js');
const { simhash, hamming } = require('../lib/simhash.js');
const { Crawler } = require('../lib/crawler.js');
const { analyze } = require('../lib/analysis.js');
const fixture = require('./fixture-server.js');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.message);
    process.exitCode = 1;
  }
};

console.log('Octos · pruebas del motor');

await test('robots.txt: coincidencia más larga y comodines', () => {
  const r = parseRobots('User-agent: *\nDisallow: /privado\nAllow: /privado/publico\nDisallow: /*.pdf$\n\nUser-agent: OctosSEO\nDisallow: /solo-octos');
  assert.equal(isAllowed(r, 'https://x.cl/privado/a', 'Mozilla Googlebot'), false);
  assert.equal(isAllowed(r, 'https://x.cl/privado/publico/a', 'Mozilla Googlebot'), true);
  assert.equal(isAllowed(r, 'https://x.cl/doc.pdf', 'Googlebot'), false);
  assert.equal(isAllowed(r, 'https://x.cl/doc.pdf?x=1', 'Googlebot'), true);
  assert.equal(isAllowed(r, 'https://x.cl/solo-octos', 'Mozilla OctosSEO/1.0'), false);
  assert.equal(isAllowed(r, 'https://x.cl/privado', 'Mozilla OctosSEO/1.0'), true, 'el grupo específico reemplaza a *');
});

await test('ancho en píxeles parecido al de Google', () => {
  const w = textWidth('Agencia SEO en Santiago | Ejemplo de título', 20);
  assert.ok(w > 350 && w < 450, `ancho ${w}`);
});

await test('simhash: textos casi iguales quedan cerca', () => {
  const base = Array.from({ length: 200 }, (_, i) => 'palabra' + (i % 50)).join(' ');
  const a = simhash(base + ' final uno');
  const b = simhash(base + ' final dos');
  const c = simhash(Array.from({ length: 200 }, (_, i) => 'otra' + i).join(' '));
  assert.ok(hamming(a, b) <= 3, 'casi iguales');
  assert.ok(hamming(a, c) > 10, 'distintos');
});

const server = await fixture.start(0);
const base = `http://127.0.0.1:${server.address().port}`;
let result;
let crawler;

await test('rastreo completo del sitio de prueba', async () => {
  crawler = new Crawler({ startUrl: base + '/', concurrency: 4, checkExternal: false, timeoutMs: 5000 });
  await crawler.start();
  const snap = crawler.snapshot();
  result = analyze(snap);
  assert.ok(snap.rows.length >= 15, `filas: ${snap.rows.length}`);
});

const row = (path) => result.rows.find((r) => r.url === base + path);
const issue = (id) => result.issues.find((i) => i.id === id);
const flagged = (id, path) => {
  const it = issue(id);
  assert.ok(it, `falta el problema ${id}`);
  assert.ok(it.ids.includes(row(path).id), `${path} no está en ${id}`);
};

await test('estados, redirecciones y cadenas', () => {
  assert.equal(row('/no-existe').status, 404);
  assert.equal(row('/viejo').status, 301);
  assert.equal(row('/viejo').hops, 2);
  flagged('cadenas', '/viejo');
  flagged('redireccion-temporal', '/intermedio');
  flagged('4xx', '/no-existe');
  flagged('enlaces-rotos', '/');
});

await test('robots.txt bloquea /privado', () => {
  assert.equal(row('/privado/x').blockedByRobots, true);
  flagged('robots-bloqueada', '/privado/x');
});

await test('indexabilidad, sitemap y huérfanas', () => {
  assert.equal(row('/noindex').indexable, false);
  flagged('noindex', '/noindex');
  flagged('sitemap-no-indexable', '/noindex');
  flagged('sitemap-no-indexable', '/viejo');
  assert.equal(row('/huerfana').orphan, true);
  flagged('huerfanas', '/huerfana');
  assert.equal(row('/servicios').orphan, false);
});

await test('contenido: títulos, descripciones, H1, duplicados', () => {
  flagged('title-falta', '/sin-titulo');
  flagged('title-dup', '/duplicada-b');
  flagged('desc-dup', '/Duplicada-A');
  flagged('duplicado-exacto', '/duplicada-b');
  flagged('h1-falta', '/sin-titulo');
  flagged('lang', '/sin-titulo');
  flagged('viewport', '/sin-titulo');
  flagged('url-mayusculas', '/Duplicada-A');
  flagged('encabezados-saltos', '/blog');
  flagged('img-alt', '/');
});

await test('profundidad en clics y rendimiento', () => {
  assert.equal(row('/').clickDepth, 0);
  assert.equal(row('/servicios/seo/auditoria/profunda').clickDepth, 4);
  flagged('profundas', '/servicios/seo/auditoria/profunda');
  assert.ok(row('/lenta').time >= 1000, `tiempo ${row('/lenta').time}`);
  flagged('lenta', '/lenta');
});

await test('conversión: CTA, formularios y contacto', () => {
  assert.ok(row('/').ctas.includes('Agenda una llamada'), JSON.stringify(row('/').ctas));
  assert.equal(row('/').hasTel, true);
  flagged('form-sin-label', '/servicios');
  assert.equal(issue('sin-contacto'), undefined, 'el sitio sí tiene teléfono');
  flagged('sin-cta', '/blog');
});

await test('datos estructurados y puntaje', () => {
  assert.deepEqual(row('/').jsonldTypes, ['Organization']);
  flagged('schema-falta', '/servicios');
  assert.ok(result.score > 0 && result.score < 100, `puntaje ${result.score}`);
  assert.ok(result.issues[0].priority >= result.issues[result.issues.length - 1].priority, 'ordenado por prioridad');
});

await test('sin render JS no se ve la página hija', () => {
  assert.equal(row('/js-hija'), undefined);
  assert.equal(row('/js').title, 'Cargando…');
});

server.close();
console.log(`\n${passed} pruebas OK · ${result ? result.issues.length : 0} tipos de problema · puntaje ${result ? result.score : '-'}`);
