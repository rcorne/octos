// Pruebas de exportes: plan de acción, PowerPoint y Excel.
// Uso: node test/exportes.test.mjs   (genera test/out/octos-ejemplo.pptx y .xlsx)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'out');
const { Crawler } = require('../lib/crawler.js');
const { analyze } = require('../lib/analysis.js');
const { buildActionPlan, horizonFor } = require('../lib/plan.js');
const { buildPptx, _internals } = require('../lib/export-pptx.js');
const { buildXlsx } = require('../lib/export-xlsx.js');
const ExcelJS = require('exceljs');
const fixture = require('./fixture-server.js');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.stack || err.message);
    process.exitCode = 1;
  }
};

fs.mkdirSync(OUT, { recursive: true });
console.log('Octos · pruebas de exportes');

// ---- Datos: rastreo real del sitio de prueba
const server = await fixture.start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const crawler = new Crawler({ startUrl: base + '/', concurrency: 4, checkExternal: false, timeoutMs: 5000 });
await crawler.start();
const snap = crawler.snapshot();
server.close();
const meta = { ...snap.meta, startHost: 'www.ejemplo-octos.cl' };

// Datos de ejemplo de Google y Lighthouse con la forma del contrato
const range = { startDate: '2026-09-15', endDate: '2026-10-12' };
const pages = snap.rows.filter((r) => r.internal && r.status === 200 && (r.contentType || '').includes('html')).sort((a, b) => a.id - b.id);
pages.forEach((r, i) => {
  const impressions = 4000 - i * 230;
  const clicks = Math.round(impressions * (0.08 - i * 0.004));
  r.gsc = { clicks: Math.max(0, clicks), impressions, ctr: Math.max(0, clicks) / impressions, position: 1.5 + i * 1.3, range };
  r.ga = { views: 900 - i * 40, sessions: 700 - i * 35, engagementRate: 0.62 - i * 0.02, keyEvents: Math.max(0, 12 - i), avgEngagementTime: 48 + i, range };
  if (i < 8) {
    r.lighthouse = {
      mobile: {
        source: 'psi', strategy: 'mobile', fetchedAt: '2026-10-12T10:00:00Z', lighthouseVersion: '13.5.0',
        scores: { performance: 92 - i * 9, accessibility: 88, bestPractices: 96, seo: 90 + (i % 3) },
        metrics: { lcp: 1800 + i * 650, cls: 0.02 + i * 0.03, tbt: 120 + i * 40, fcp: 1200, si: 2000, ttfb: 300 + i * 50, inp: null },
        field: null,
        opportunities: [{ id: 'render-blocking-resources', title: 'Elimina recursos que bloquean el renderizado', savingsMs: 400 + i * 30, savingsBytes: 0 }],
        diagnostics: [],
      },
    };
  }
});
// El análisis corre después de agregar los datos, como en la app (activa las reglas de Google y Lighthouse)
const result = analyze(snap);
const plan = buildActionPlan(result);

// ---- Plan
await test('plan: tres horizontes con la forma del contrato', () => {
  assert.deepEqual(plan.map((p) => p.horizonte), ['Esta semana', 'Este mes', 'Este trimestre']);
  const all = plan.flatMap((p) => p.acciones);
  assert.equal(all.length, result.issues.length, 'cada problema queda en un horizonte');
  for (const a of all) {
    for (const k of ['issueId', 'titulo', 'urls', 'severidad', 'esfuerzo', 'porque', 'como']) assert.ok(k in a, `falta ${k}`);
    assert.ok(Array.isArray(a.urls) && a.urls.length <= 10);
  }
  const byId = new Map(result.issues.map((i) => [i.id, i]));
  for (const p of plan) {
    const pr = p.acciones.map((a) => byId.get(a.issueId).priority);
    assert.deepEqual(pr, [...pr].sort((x, y) => y - x), `orden por prioridad en ${p.horizonte}`);
    const id = { 'Esta semana': 'semana', 'Este mes': 'mes', 'Este trimestre': 'trimestre' }[p.horizonte];
    for (const a of p.acciones) assert.equal(horizonFor(byId.get(a.issueId)), id);
  }
  const broken = all.find((a) => a.issueId === 'enlaces-rotos');
  assert.ok(broken.urls[0].startsWith(base), 'las URLs salen de las filas');
});

await test('plan: regla de severidad y esfuerzo', () => {
  const mk = (id, severity, effort, extra = {}) => ({ id, severity, effort, title: id, why: 'w', fix: 'f', ids: [], count: 0, priority: 1, ...extra });
  const p = buildActionPlan({
    rows: [],
    issues: [
      mk('c3', 'critico', 3), mk('a1', 'alto', 1), mk('a2', 'alto', 2), mk('a3', 'alto', 3),
      mk('m1', 'medio', 1), mk('m2', 'medio', 2), mk('m3', 'medio', 3), mk('b1', 'bajo', 1),
      mk('sa', 'alto', 3, { site: true }), mk('sm', 'medio', 3, { site: true }), mk('sb', 'bajo', 1, { site: true }),
    ],
  });
  const ids = (h) => p.find((g) => g.horizonte === h).acciones.map((a) => a.issueId).sort();
  assert.deepEqual(ids('Esta semana'), ['a1', 'c3', 'sa']);
  assert.deepEqual(ids('Este mes'), ['a2', 'a3', 'm1', 'm2', 'sm']);
  assert.deepEqual(ids('Este trimestre'), ['b1', 'm3', 'sb']);
});

// ---- Ayudas de la presentación
await test('pptx: el texto que no cabe se achica y luego se recorta con elipsis', () => {
  const short = _internals.fit('Hola', { w: 3, h: 0.5, size: 20, min: 10 });
  assert.equal(short.size, 20);
  const long = 'Palabra '.repeat(200);
  const f = _internals.fit(long, { w: 3, h: 1, size: 20, min: 10 });
  assert.equal(f.size, 10);
  assert.ok(f.cut && f.text.endsWith('…'));
  assert.ok(_internals.wrap(f.text, 10, 3, {}).length <= Math.floor(1 / ((10 * 1.25) / 72)));
  const e = _internals.ellipsize('/una/ruta/muy/larga/que/no/cabe/en/la/columna/de/la/tabla', 10, 1.5);
  assert.ok(e.endsWith('…') && _internals.measure(e, 10) <= 1.5);
});

await test('pptx: el loto oficial se rasteriza a PNG desde el SVG', () => {
  const svg = fs.readFileSync(path.join(ROOT, 'assets/brand/octos-loto.svg'), 'utf8');
  const png = _internals.rasterizeLoto(svg, 128);
  assert.deepEqual(_internals.pngSize(png), { w: 128, h: 128 });
  fs.writeFileSync(path.join(OUT, 'loto-rasterizado.png'), png);
});

// ---- PowerPoint
const unzipList = (file) => execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
// unzip trata [ ] * ? como comodines: se escapan para leer [Content_Types].xml
const unzipRead = (file, entry) => execFileSync('unzip', ['-p', file, entry.replace(/[[\]*?]/g, '\\$&')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const slideTexts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ');

const pptxFile = path.join(OUT, 'octos-ejemplo.pptx');
await test('pptx: 11 diapositivas con XML válido, firma y notas', async () => {
  const ai = { resumen: 'Tu sitio responde rápido, pero pierde visitas por enlaces rotos y títulos duplicados. Corrige primero los 404 enlazados desde la portada.' };
  const buf = await buildPptx({ result, meta, rows: result.rows, plan, ai, brandDir: path.join(ROOT, 'assets', 'brand') });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 20000, `tamaño ${buf.length}`);
  fs.writeFileSync(pptxFile, buf);
  const entries = unzipList(pptxFile);
  const slides = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  assert.equal(slides.length, 11, `diapositivas: ${slides.length}`);
  assert.equal(entries.filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e)).length, 11, 'notas del orador');
  // El estado por área son barras dibujadas con formas (no un gráfico nativo, que Quick Look y Keynote no dibujan igual)
  assert.ok(!entries.some((e) => /^ppt\/charts\/chart\d+\.xml$/.test(e)), 'sin gráficos nativos');
  const area = unzipRead(pptxFile, 'ppt/slides/slide3.xml').toString();
  assert.ok((area.match(/prst="roundRect"/g) || []).length >= 14, 'barras del estado por área (pista y relleno por cada área)');
  assert.ok(entries.some((e) => /^ppt\/media\/.+\.png$/.test(e)), 'imágenes PNG');
  assert.ok(!entries.some((e) => /\.svg$/.test(e)), 'sin SVG (PowerPoint en Node no genera su vista previa)');
  for (const e of entries.filter((x) => /\.(xml|rels)$/.test(x))) execFileSync('xmllint', ['--noout', '-'], { input: unzipRead(pptxFile, e) });
  const texts = [];
  for (const s of slides) {
    const xml = unzipRead(pptxFile, s);
    execFileSync('xmllint', ['--noout', '-'], { input: xml });
    const t = slideTexts(xml);
    texts.push(t);
    assert.ok(/Una creación de/.test(t), `${s} sin firma`); // el logotipo de Mamífero va como imagen a su derecha
    assert.ok(!/[!¡]/.test(t), `${s} tiene signos de exclamación`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${s} tiene emoji`);
    assert.ok(/IBM Plex Sans/.test(xml), `${s} sin IBM Plex Sans`);
  }
  assert.ok(texts[0].includes('www.ejemplo-octos.cl') && texts[0].includes('ESTADO DEL SEO'), 'portada');
  assert.ok(texts[1].includes('Tu sitio responde rápido'), 'resumen con IA');
  assert.ok(/Respuesta mediana/.test(texts[1]) && /llamada a la acción/.test(texts[1]));
  assert.ok(texts[3].includes(result.issues[0].title), 'tabla de prioridades');
  assert.ok(texts[4].includes('Por qué importa') && texts[4].includes('Cómo arreglarlo'));
  assert.ok(texts[7].includes('Esta semana') && texts[7].includes('Este mes') && texts[7].includes('Este trimestre'));
  assert.ok(texts[8].includes('Impresiones') && texts[8].includes('Oportunidades'), 'Google');
  assert.ok(texts[9].includes('LCP') && texts[9].includes('CLS'), 'Lighthouse');
  assert.ok(texts[10].includes('PRÓXIMOS PASOS'), 'cierre');
  assert.ok(/typeface="Manrope ExtraBold"/.test(unzipRead(pptxFile, slides[0])), 'títulos en Manrope ExtraBold (peso 800 de la marca)');
  assert.ok(/typeface="IBM Plex Sans"/.test(unzipRead(pptxFile, slides[1])), 'textos en IBM Plex Sans');
  const pres = unzipRead(pptxFile, 'ppt/presentation.xml');
  assert.ok(/<p:sldSz cx="12192000" cy="6858000"/.test(pres), '16:9');
  const areas = unzipRead(pptxFile, 'ppt/slides/slide3.xml');
  for (const c of ['2E8CFF', '8E7BFF', '4FB0FF']) assert.ok(areas.toUpperCase().includes(c), `color petal ${c} en las barras de áreas`);
  const notes = unzipRead(pptxFile, 'ppt/notesSlides/notesSlide5.xml');
  assert.ok(/Por qué importa/.test(notes), 'notas con detalle');
});

await test('pptx: sin datos de Google ni Lighthouse quedan 9 diapositivas', async () => {
  const rows = result.rows.map(({ gsc, ga, lighthouse, ...r }) => r);
  const buf = await buildPptx({ result: { ...result, rows }, meta, rows, brandDir: path.join(ROOT, 'assets', 'brand') });
  const file = path.join(OUT, 'octos-sin-google.pptx');
  fs.writeFileSync(file, buf);
  assert.equal(unzipList(file).filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e)).length, 9);
});

await test('pptx: usa los PNG del logotipo cuando existen en brandDir', async () => {
  const dir = path.join(OUT, 'brand-png');
  fs.rmSync(dir, { recursive: true, force: true }); // sin restos de corridas anteriores
  fs.mkdirSync(dir, { recursive: true });
  for (const v of ['', '-blanco']) {
    const png = _internals.rasterizeLoto(fs.readFileSync(path.join(ROOT, `assets/brand/octos-loto${v}.svg`), 'utf8'), 256);
    fs.writeFileSync(path.join(dir, `octos-loto${v}.png`), png);
    fs.writeFileSync(path.join(dir, `octos-logotipo${v}.png`), _internals.atmospherePng(5, 1, 0.1, [{ color: '0B6BFF', x: 0.5, y: 0, r: 1 }], 40));
  }
  const brand = _internals.loadBrand(dir);
  assert.ok(brand.color.logotipo && Math.abs(brand.color.logotipo.ratio - 5) < 0.01, 'proporción del PNG');
  assert.equal(brand.color.lotoSource, 'png');
  assert.deepEqual(brand.notes, ['Falta mamifero-logo.png: la firma lleva «Mamífero» en texto plano.'], 'solo avisa del logo de Mamífero que no está en esa carpeta');
  fs.copyFileSync(path.join(ROOT, 'assets/brand/mamifero-logo.png'), path.join(dir, 'mamifero-logo.png'));
  assert.equal(_internals.loadBrand(dir).notes.length, 0);
  assert.ok(_internals.loadBrand(dir).mamifero.ratio > 5, 'proporción del logotipo de Mamífero');
  const svgBrand = _internals.loadBrand(path.join(ROOT, 'assets', 'brand'));
  assert.equal(svgBrand.color.lotoSource, fs.existsSync(path.join(ROOT, 'assets/brand/octos-loto.png')) ? 'png' : 'svg');
  const buf = await buildPptx({ result, meta, plan, brandDir: dir });
  assert.ok(buf.length > 20000);
});

await test('pptx y xlsx: un rastreo sin páginas y un plan de IA no rompen', async () => {
  const empty = analyze({ rows: [], edges: [], meta: {} });
  const buf = await buildPptx({ result: empty, meta: { startUrl: 'https://vacio.cl/' }, brandDir: path.join(ROOT, 'assets', 'brand') });
  const file = path.join(OUT, 'octos-vacio.pptx');
  fs.writeFileSync(file, buf);
  assert.equal(unzipList(file).filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e)).length, 6, 'portada, resumen, áreas, prioridades, plan y cierre');
  const xbuf = await buildXlsx({ result: empty, meta: {} });
  assert.ok(xbuf.length > 5000);
  const ai = { plan: [{ horizonte: 'Esta semana', acciones: ['Corrige los 404 de la portada'] }, { horizonte: 'Este mes', acciones: [{ titulo: 'Reescribe los títulos duplicados' }] }] };
  const pbuf = await buildPptx({ result, meta, ai, brandDir: path.join(ROOT, 'assets', 'brand') });
  const pfile = path.join(OUT, 'octos-plan-ia.pptx');
  fs.writeFileSync(pfile, pbuf);
  const t = slideTexts(unzipRead(pfile, 'ppt/slides/slide8.xml'));
  assert.ok(t.includes('Corrige los 404 de la portada') && t.includes('Reescribe los títulos duplicados'));
});

await test('pptx: rechaza un resultado vacío con un mensaje claro', async () => {
  await assert.rejects(() => buildPptx({}), /Falta el resultado/);
});

// ---- Excel
const xlsxFile = path.join(OUT, 'octos-ejemplo.xlsx');
await test('xlsx: hojas, estilos, filtros, formatos y vínculos', async () => {
  const buf = await buildXlsx({ result, meta, rows: result.rows, plan });
  fs.writeFileSync(xlsxFile, buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(xlsxFile));
  const names = wb.worksheets.map((w) => w.name);
  assert.deepEqual(names, ['Resumen', 'Prioridades', 'Plan de acción', 'URLs', 'Títulos y metas', 'Enlaces', 'Rendimiento', 'Google']);
  const res = wb.getWorksheet('Resumen');
  assert.equal(res.getCell('A1').value, 'Octos · Estado del SEO');
  assert.equal(res.getCell('A1').fill.fgColor.argb, 'FF0B6BFF');
  assert.equal(res.getCell('A1').font.color.argb, 'FFFFFFFF');
  assert.equal(res.getCell('A3').value, 'Una creación de');
  assert.ok(res.getImages().length >= 1, 'logotipo de Mamífero en el Resumen');
  assert.equal(res.getCell('B6').value, result.score);
  const pri = wb.getWorksheet('Prioridades');
  assert.equal(pri.rowCount, result.issues.length + 1);
  assert.equal(pri.getCell('B2').value, result.issues[0].title);
  assert.ok(pri.autoFilter, 'filtro automático');
  assert.equal(pri.views[0].state, 'frozen');
  assert.equal(pri.getCell('G2').numFmt, '0.0%');
  assert.equal(pri.getRow(1).getCell(1).font.name, 'IBM Plex Sans');
  const urls = wb.getWorksheet('URLs');
  assert.equal(urls.rowCount, result.rows.filter((r) => r.internal).length + 1);
  const a2 = urls.getCell('A2').value;
  assert.ok(a2 && a2.hyperlink && a2.hyperlink.startsWith(base), 'vínculo en la URL');
  assert.equal(urls.getCell('M2').numFmt, '#,##0" ms"');
  const plan_ = wb.getWorksheet('Plan de acción');
  assert.equal(plan_.rowCount, plan.flatMap((p) => p.acciones).length + 1);
  const perf = wb.getWorksheet('Rendimiento');
  const headers = perf.getRow(1).values.filter(Boolean);
  assert.ok(headers.includes('LCP') && headers.includes('Rendimiento'), 'columnas de Lighthouse');
  const goo = wb.getWorksheet('Google');
  assert.equal(goo.getCell('D1').value, 'CTR');
  assert.equal(goo.getCell('D2').numFmt, '0.0%');
  assert.ok(goo.getCell('B2').value >= goo.getCell('B3').value, 'orden por clics');
});

await test('xlsx: sin datos de Google no crea la hoja Google', async () => {
  const rows = result.rows.map(({ gsc, ga, lighthouse, ...r }) => r);
  const buf = await buildXlsx({ result: { ...result, rows }, meta, rows });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.equal(wb.getWorksheet('Google'), undefined);
  assert.ok(!wb.getWorksheet('Rendimiento').getRow(1).values.includes('LCP'));
});

// ---- Miniatura con Quick Look (solo macOS)
if (process.platform === 'darwin' && !process.env.OCTOS_SIN_MINIATURA) {
  await test('pptx: Quick Look genera la miniatura de la portada', () => {
    execFileSync('qlmanage', ['-t', '-s', '1600', '-o', OUT, pptxFile], { stdio: 'ignore', timeout: 60000 });
    assert.ok(fs.existsSync(pptxFile + '.png') || fs.existsSync(path.join(OUT, 'octos-ejemplo.pptx.png')));
  });
}

console.log(`\n${passed} pruebas OK · ${result.issues.length} problemas · salidas en test/out`);
