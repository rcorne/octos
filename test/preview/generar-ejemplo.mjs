// Genera test/preview/proyecto-ejemplo.json: rastrea el sitio de prueba
// (test/fixture-server.js) con el Crawler real y cambia 127.0.0.1 por un
// dominio de ejemplo. Uso: node test/preview/generar-ejemplo.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Crawler } = require('../../lib/crawler.js');
const { analyze } = require('../../lib/analysis.js');
const fixture = require('../fixture-server.js');

const HOST = 'www.agenciaejemplo.cl';
const dir = path.dirname(fileURLToPath(import.meta.url));

const server = await fixture.start(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const crawler = new Crawler({ startUrl: base + '/', concurrency: 4, checkExternal: false, timeoutMs: 5000 });
await crawler.start();
server.close();

const snap = { format: 'octos', version: 1, ...crawler.snapshot() };
// Fechas fijas para que las capturas no cambien entre ejecuciones
const started = Date.parse('2026-10-13T10:24:00-03:00');
const shift = started - snap.meta.startedAt;
snap.meta.startedAt += shift;
if (snap.meta.finishedAt) snap.meta.finishedAt += shift;
const json = JSON.stringify(snap)
  .split(base).join('https://' + HOST)
  .split('127.0.0.1:' + port).join(HOST)
  .split('"127.0.0.1"').join(`"${HOST}"`);
const out = JSON.parse(json);
// Tiempos de un servidor real (el de prueba responde en pocos milisegundos)
for (const r of out.rows) {
  if (typeof r.time === 'number' && r.time < 200) r.time = 140 + ((r.id * 97) % 380);
}
// Una página que depende de JavaScript, como si se hubiera renderizado
const js = out.rows.find((r) => r.url.endsWith('/js'));
if (js) js.jsDiff = { rawTitle: 'Cargando…', titleChanged: true, h1Changed: true, rawWords: 3, wordsAdded: 240, linksAdded: 2 };
const result = analyze(out);
writeFileSync(path.join(dir, 'proyecto-ejemplo.json'), JSON.stringify(out, null, 1));
console.log(`proyecto-ejemplo.json: ${out.rows.length} URLs · ${result.issues.length} tipos de problema · salud ${result.score}`);
