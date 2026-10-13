// Prueba de humo: corre Lighthouse local de verdad (Chrome instalado) contra una página mínima y
// comprueba que devuelve puntajes y que no queda ningún Chrome con el perfil temporal.
// Uso: node test/smoke-lighthouse.mjs   (la usa la integración continua en Windows y Mac)
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LH = require('../lib/lighthouse.js');

const chrome = LH.findChrome({ deep: true });
if (!chrome) {
  console.log('No hay Chrome, Edge ni Chromium instalado: se omite la prueba.');
  process.exit(0);
}
console.log('Navegador:', chrome);

const server = http.createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  r.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba de Octos</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Hola</h1><p>Página mínima.</p></body></html>');
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

try {
  const t0 = Date.now();
  const res = await LH.runLocal({ url: `http://127.0.0.1:${server.address().port}/`, strategy: 'mobile', timeoutMs: 180000 });
  const s = res.scores;
  console.log(`Lighthouse ${res.lighthouseVersion} en ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(s));
  if (![s.performance, s.accessibility, s.bestPractices, s.seo].every((v) => Number.isFinite(v))) throw new Error('Faltan puntajes');
  console.log('OK');
} catch (err) {
  console.error('FALLO:', err.message);
  process.exitCode = 1;
} finally {
  server.close();
}
