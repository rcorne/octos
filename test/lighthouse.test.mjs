// Pruebas de lib/lighthouse.js: normalize, PageSpeed Insights contra un servidor
// falso y una corrida real de Lighthouse local contra el sitio de prueba.
// Uso: node test/lighthouse.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, fork, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { runPageSpeed, runLocal, findChrome, normalize, killByProfile } = require('../lib/lighthouse.js');
const fixture = require('./fixture-server.js');
const lhrEjemplo = require('./fixtures/lhr-ejemplo.json');
// lhr real de Lighthouse 13.5 (throttlingMethod 'provided') contra una página lenta local:
// 1 MB de JS sin usar, CSS que bloquea, 4 tareas largas y un desplazamiento de diseño.
const lhrLenta = require('./fixtures/lhr-lenta.json');
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'lighthouse-worker.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const clone = (o) => JSON.parse(JSON.stringify(o));
const isScore = (v) => Number.isInteger(v) && v >= 0 && v <= 100;

console.log('Octos · pruebas de Lighthouse');

// ---------- normalize ----------

await test('normalize: lhr real recortado', () => {
  const r = normalize(lhrEjemplo, { source: 'local', strategy: 'mobile' });
  assert.equal(r.source, 'local');
  assert.equal(r.strategy, 'mobile');
  assert.equal(r.lighthouseVersion, lhrEjemplo.lighthouseVersion);
  assert.equal(r.fetchedAt, lhrEjemplo.fetchTime);
  for (const k of ['performance', 'accessibility', 'bestPractices', 'seo']) assert.ok(isScore(r.scores[k]), `${k}: ${r.scores[k]}`);
  assert.deepEqual(Object.keys(r.metrics).sort(), ['cls', 'fcp', 'inp', 'lcp', 'si', 'tbt', 'ttfb']);
  for (const k of ['lcp', 'fcp', 'si', 'tbt', 'ttfb']) assert.ok(Number.isInteger(r.metrics[k]), `${k}: ${r.metrics[k]}`);
  assert.equal(typeof r.metrics.cls, 'number');
  assert.equal(r.metrics.inp, null, 'INP no aplica en una navegación');
  assert.equal(r.field, null);
  assert.ok(Array.isArray(r.opportunities) && Array.isArray(r.diagnostics));
  assert.equal(r.error, undefined);
});

await test('normalize: categoría faltante, orden de oportunidades, diagnósticos y error', () => {
  const lhr = clone(lhrEjemplo);
  delete lhr.categories.seo;
  lhr.categories.accessibility.score = null;
  lhr.audits['unused-javascript'] = { id: 'unused-javascript', title: 'Reduce el JavaScript sin usar', score: 0.3, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 150, LCP: 900 }, details: { type: 'opportunity', overallSavingsMs: 600, overallSavingsBytes: 250000 } };
  lhr.audits['render-blocking-insight'] = { id: 'render-blocking-insight', title: 'Solicitudes que bloquean el renderizado', score: 0, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 1200, LCP: 1200 }, displayValue: 'Ahorro estimado de 1.200 ms', details: { type: 'table' } };
  lhr.audits['cache-insight'] = { id: 'cache-insight', title: 'Usa ciclos de vida de caché eficientes', score: 0.5, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 0, LCP: 0 }, details: { type: 'table', debugData: { type: 'debugdata', wastedBytes: 80000 } } };
  lhr.audits['bootup-time'] = { ...lhr.audits['bootup-time'], score: 0.2, metricSavings: { TBT: 700 }, displayValue: '3,1 s' };
  lhr.runtimeError = { code: 'NO_FCP', message: 'x' };
  const r = normalize(lhr, { source: 'psi', strategy: 'desktop' });
  assert.equal(r.scores.seo, null);
  assert.equal(r.scores.accessibility, null);
  assert.deepEqual(r.opportunities.slice(0, 3).map((o) => o.id), ['render-blocking-insight', 'unused-javascript', 'cache-insight']);
  assert.deepEqual(r.opportunities[1], { id: 'unused-javascript', title: 'Reduce el JavaScript sin usar', savingsMs: 900, savingsBytes: 250000 });
  assert.equal(r.opportunities[2].savingsBytes, 80000);
  assert.ok(r.diagnostics.some((d) => d.id === 'bootup-time' && d.displayValue === '3,1 s'), JSON.stringify(r.diagnostics));
  assert.ok(!r.diagnostics.some((d) => d.id === 'render-blocking-insight'), 'no repite oportunidades');
  assert.ok(!r.opportunities.some((o) => o.id === 'bootup-time'), 'un ahorro solo de TBT no es oportunidad');
  assert.match(r.error, /no pintó contenido/);
});

await test('normalize: página lenta real trae diagnósticos y oportunidades de carga', () => {
  const r = normalize(lhrLenta, { source: 'local', strategy: 'mobile' });
  const opp = r.opportunities.map((o) => o.id);
  const diag = Object.fromEntries(r.diagnostics.map((d) => [d.id, d.displayValue]));
  assert.equal(opp[0], 'render-blocking-insight');
  assert.ok(opp.includes('unused-javascript') && opp.includes('cache-insight'), opp.join());
  for (let i = 1; i < r.opportunities.length; i++) assert.ok(r.opportunities[i - 1].savingsMs >= r.opportunities[i].savingsMs, 'orden por ahorro');
  // Ahorro solo de TBT: diagnóstico, no oportunidad.
  assert.ok(!opp.includes('bootup-time') && !opp.includes('mainthread-work-breakdown') && !opp.includes('long-tasks'), opp.join());
  assert.equal(diag['bootup-time'], lhrLenta.audits['bootup-time'].displayValue);
  // Informativa con valor visible.
  assert.match(diag['long-tasks'], /tareas largas/);
  // Insights que fallan sin displayValue.
  assert.equal(diag['cls-culprits-insight'], '');
  assert.equal(diag['network-dependency-tree-insight'], '');
  // Aprobadas, no aplicables o informativas sin valor quedan fuera.
  for (const id of ['mainthread-work-breakdown', 'total-byte-weight', 'lcp-breakdown-insight', 'inp-breakdown-insight', 'bf-cache']) assert.ok(!(id in diag), id);
  for (const d of r.diagnostics) assert.deepEqual(Object.keys(d), ['id', 'title', 'displayValue']);
  assert.equal(r.diagnostics[r.diagnostics.length - 1].id, 'long-tasks', 'las informativas van al final');
  assert.equal(r.metrics.cls, 0.333);
});

await test('normalize: datos de campo CrUX (CLS viene x100)', () => {
  const le = {
    id: 'https://ejemplo.cl/', overall_category: 'AVERAGE', origin_fallback: true,
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: 'AVERAGE' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' },
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 1500, category: 'FAST' },
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 700, category: 'FAST' },
    },
  };
  const r = normalize(lhrEjemplo, { source: 'psi', strategy: 'mobile', loadingExperience: le });
  assert.deepEqual(r.field, { lcp: 2900, cls: 0.12, inp: 180, fcp: 1500, ttfb: 700, category: 'AVERAGE', origin: true });
  assert.throws(() => normalize(null, {}), /no devolvió/);
});

// ---------- PageSpeed Insights con servidor falso ----------

const psiCalls = [];
let psiMode = 'ok';
const psiServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  psiCalls.push(u);
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (psiMode === '429') return json(429, { error: { code: 429, message: 'Quota exceeded for quota metric', status: 'RESOURCE_EXHAUSTED' } });
  if (psiMode === 'lh-error') return json(500, { error: { code: 500, message: 'Lighthouse returned error: NO_FCP. The page did not paint any content.' } });
  if (psiMode === 'bad-key') return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
  if (psiMode === 'slow') return setTimeout(() => json(200, {}), 2000);
  const body = {
    kind: 'pagespeedonline#result',
    id: u.searchParams.get('url'),
    lighthouseResult: lhrEjemplo,
    loadingExperience: psiMode === 'origin' ? { id: u.searchParams.get('url'), initial_url: u.searchParams.get('url') } : {
      id: u.searchParams.get('url'),
      overall_category: 'FAST',
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: 'FAST', distributions: [] },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' },
        INTERACTION_TO_NEXT_PAINT: { percentile: 150, category: 'FAST' },
        FIRST_CONTENTFUL_PAINT_MS: { percentile: 1200, category: 'FAST' },
        EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 500, category: 'FAST' },
      },
    },
    originLoadingExperience: {
      id: 'https://ejemplo.cl',
      overall_category: 'SLOW',
      metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4200, category: 'SLOW' }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 30, category: 'SLOW' } },
    },
  };
  json(200, body);
});
await new Promise((r) => psiServer.listen(0, '127.0.0.1', r));
const psiBase = `http://127.0.0.1:${psiServer.address().port}/pagespeedonline/v5/runPagespeed`;

await test('PSI: parámetros y forma de la respuesta', async () => {
  psiMode = 'ok';
  const r = await runPageSpeed({ url: 'https://ejemplo.cl/servicios', strategy: 'mobile', apiKey: 'clave-falsa-123', baseUrl: psiBase });
  const q = psiCalls.at(-1).searchParams;
  assert.equal(psiCalls.at(-1).pathname, '/pagespeedonline/v5/runPagespeed');
  assert.equal(q.get('url'), 'https://ejemplo.cl/servicios');
  assert.equal(q.get('strategy'), 'MOBILE');
  assert.deepEqual(q.getAll('category'), ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO']);
  assert.equal(q.get('locale'), 'es');
  assert.equal(q.get('key'), 'clave-falsa-123');
  assert.equal(r.source, 'psi');
  assert.equal(r.strategy, 'mobile');
  assert.ok(isScore(r.scores.performance));
  assert.deepEqual(r.field, { lcp: 2100, cls: 0.05, inp: 150, fcp: 1200, ttfb: 500, category: 'FAST', origin: false });
});

await test('PSI: sin clave no envía key; sin CrUX de la URL usa el origen', async () => {
  psiMode = 'origin';
  const r = await runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'desktop', baseUrl: psiBase });
  const q = psiCalls.at(-1).searchParams;
  assert.equal(q.has('key'), false);
  assert.equal(q.get('strategy'), 'DESKTOP');
  assert.equal(r.strategy, 'desktop');
  assert.equal(r.field.origin, true);
  assert.equal(r.field.lcp, 4200);
  assert.equal(r.field.cls, 0.3);
  assert.equal(r.field.inp, null);
  assert.equal(r.field.category, 'SLOW');
});

await test('PSI: 429 sin clave sugiere agregar una clave gratuita', async () => {
  psiMode = '429';
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'mobile', baseUrl: psiBase }), (err) => {
    assert.equal(err.code, 'quota');
    assert.equal(err.status, 429);
    assert.match(err.message, /clave de API gratuita/);
    return true;
  });
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'mobile', apiKey: 'secreta-xyz', baseUrl: psiBase }), (err) => {
    assert.equal(err.code, 'quota');
    assert.match(err.message, /cuota de tu clave/);
    assert.ok(!err.message.includes('secreta-xyz'), 'el mensaje no muestra la clave');
    return true;
  });
});

await test('PSI: clave inválida, error de Lighthouse, timeout, red y URL mala', async () => {
  psiMode = 'bad-key';
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'mobile', apiKey: 'x', baseUrl: psiBase }), (e) => e.code === 'auth');
  psiMode = 'lh-error';
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'mobile', baseUrl: psiBase }), (e) => e.code === 'lighthouse' && /no pintó/.test(e.message));
  psiMode = 'slow';
  const t0 = Date.now();
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'mobile', baseUrl: psiBase, timeoutMs: 300 }), (e) => e.code === 'timeout' && /no respondió/.test(e.message));
  assert.ok(Date.now() - t0 < 1500, 'corta al vencer el plazo');
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'mobile', baseUrl: 'http://127.0.0.1:1/x' }), (e) => e.code === 'network');
  await assert.rejects(runPageSpeed({ url: 'ejemplo.cl', strategy: 'mobile', baseUrl: psiBase }), (e) => e.code === 'config');
  await assert.rejects(runPageSpeed({ url: 'https://ejemplo.cl/', strategy: 'tablet', baseUrl: psiBase }), (e) => e.code === 'config');
});

psiServer.close();

// ---------- findChrome ----------

await test('findChrome: rutas conocidas sin bloquear y respaldo de chrome-launcher solo con deep', () => {
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const saved = process.env.CHROME_PATH;
  delete process.env.CHROME_PATH;
  let calls = 0;
  const launcher = (list) => ({ getInstallations: () => (calls++, list) });
  try {
    assert.equal(findChrome({ exists: (p) => p === edge, launcher: launcher([]) }), edge);
    assert.equal(findChrome({ exists: (p) => p === '/otro/Chrome', launcher: launcher(['/otro/Chrome']) }), null, 'sin deep no consulta lsregister');
    assert.equal(calls, 0);
    assert.equal(findChrome({ exists: (p) => p === '/otro/Chrome', launcher: launcher(['/otro/Chrome']), deep: true }), '/otro/Chrome');
    assert.equal(calls, 1);
    // Queda en caché: la próxima búsqueda rápida la encuentra sin preguntar.
    assert.equal(findChrome({ exists: (p) => p === '/otro/Chrome', launcher: launcher([]) }), '/otro/Chrome');
    assert.equal(calls, 1);
    assert.equal(findChrome({ exists: () => false, launcher: launcher(['/no/existe']), deep: true }), null);
  } finally {
    if (saved !== undefined) process.env.CHROME_PATH = saved;
  }
});

await test('killByProfile: mata solo los procesos con ese perfil temporal', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-lh-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-lh-'));
  const hold = (dir) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', '--', `--user-data-dir=${dir}`], { stdio: 'ignore' });
  const a = hold(dirA);
  const b = hold(dirB);
  try {
    await sleep(300);
    const aExit = new Promise((r) => a.once('exit', (code, signal) => r(signal)));
    assert.equal(await killByProfile(dirA), 1);
    assert.equal(await aExit, 'SIGKILL');
    assert.equal(b.exitCode, null, 'el otro perfil sigue vivo');
    assert.equal(b.signalCode, null);
    assert.equal(await killByProfile('/tmp/otra-carpeta'), 0, 'ignora carpetas que no son de Octos');
  } finally {
    a.kill('SIGKILL');
    b.kill('SIGKILL');
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

// ---------- Lighthouse local real ----------

// Procesos de Chrome lanzados por runLocal: llevan el perfil temporal octos-lh-.
const octosChromes = () => {
  try {
    return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.includes('octos-lh-') && !l.includes('ps -axo'));
  } catch {
    return [];
  }
};
const tmpProfiles = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('octos-lh-'));

const chromePath = findChrome();
if (!chromePath) {
  console.log('  · No hay Chrome instalado: se omite la corrida local de Lighthouse.');
} else {
  console.log('  · Chrome:', chromePath);
  const server = await fixture.start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = octosChromes();
  const profilesBefore = new Set(tmpProfiles());

  await test('runLocal: URL inválida se rechaza sin abrir Chrome', async () => {
    await assert.rejects(runLocal({ url: 'nada', strategy: 'mobile' }), (e) => e.code === 'config');
  });

  await test('runLocal: ruta de Chrome que no existe da config, sin proceso hijo', async () => {
    const t0 = Date.now();
    await assert.rejects(runLocal({ url: base + '/', chromePath: '/no/existe/chrome' }), (e) => e.code === 'config' && /ruta indicada/.test(e.message));
    assert.ok(Date.now() - t0 < 500);
  });

  await test('worker: ruta de Chrome que no existe responde config y no se cae', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-lh-'));
    const w = fork(WORKER, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    w.stderr.on('data', (d) => (stderr += d));
    const msgs = [];
    w.on('message', (m) => msgs.push(m));
    const t0 = Date.now();
    const code = await new Promise((r) => {
      w.on('exit', r);
      w.send({ type: 'run', url: base + '/', strategy: 'mobile', chromePath: '/no/existe/chrome', userDataDir: dir, locale: 'es' });
    });
    fs.rmSync(dir, { recursive: true, force: true });
    const err = msgs.find((m) => m.type === 'error');
    assert.ok(err, JSON.stringify(msgs) + stderr);
    assert.equal(err.code, 'config');
    assert.match(err.message, /ruta indicada/);
    assert.equal(code, 0);
    assert.ok(!/Unhandled/.test(stderr), stderr);
    assert.ok(Date.now() - t0 < 8000, 'no espera el puerto de depuración');
  });

  await test('runLocal: execPath inválido da config y no deja el perfil temporal', async () => {
    const pre = new Set(tmpProfiles());
    await assert.rejects(runLocal({ url: base + '/', chromePath, execPath: '/no/existe/node' }), (e) => e.code === 'config');
    await sleep(500);
    assert.deepEqual(tmpProfiles().filter((n) => !pre.has(n)), []);
  });

  await test('runLocal: corrida real en móvil contra el sitio de prueba', async () => {
    const t0 = Date.now();
    const r = await runLocal({ url: base + '/', strategy: 'mobile', chromePath, timeoutMs: 120000 });
    console.log(`    móvil en ${((Date.now() - t0) / 1000).toFixed(1)} s ·`, JSON.stringify(r.scores), JSON.stringify(r.metrics));
    assert.equal(r.source, 'local');
    assert.equal(r.strategy, 'mobile');
    for (const k of ['performance', 'accessibility', 'bestPractices', 'seo']) assert.ok(isScore(r.scores[k]), `${k}: ${r.scores[k]}`);
    assert.ok(r.metrics.lcp > 0 && r.metrics.fcp > 0, JSON.stringify(r.metrics));
    assert.match(r.lighthouseVersion, /^13\./);
    assert.equal(r.field, null);
    assert.equal(r.error, undefined);
    assert.deepEqual(octosChromes(), before, 'no queda Chrome abierto');
  });

  await test('runLocal: escritorio con el preset desktop', async () => {
    const r = await runLocal({ url: base + '/servicios', strategy: 'desktop', chromePath });
    console.log('    escritorio ·', JSON.stringify(r.scores));
    assert.equal(r.strategy, 'desktop');
    assert.ok(isScore(r.scores.performance) && isScore(r.scores.seo));
    assert.deepEqual(octosChromes(), before, 'no queda Chrome abierto');
  });

  await test('runLocal: al vencer el plazo cierra Chrome y avisa', async () => {
    await assert.rejects(runLocal({ url: base + '/lenta', strategy: 'mobile', chromePath, timeoutMs: 2500 }), (e) => e.code === 'timeout' && /tardó más de 3 s/.test(e.message));
    await new Promise((r) => setTimeout(r, 4500)); // margen del cierre forzado
    assert.deepEqual(octosChromes(), before, 'no queda Chrome abierto');
  });

  await test('runLocal: plazos que vencen mientras Chrome abre no dejan Chrome ni perfil', async () => {
    const pre = new Set(tmpProfiles());
    for (const ms of [150, 400, 700, 1000]) {
      await assert.rejects(runLocal({ url: base + '/lenta', strategy: 'mobile', chromePath, timeoutMs: ms }), (e) => e.code === 'timeout');
    }
    await sleep(4000); // cierre forzado y borrado del perfil
    assert.deepEqual(octosChromes(), before, 'no queda Chrome abierto');
    assert.deepEqual(tmpProfiles().filter((n) => !pre.has(n)), [], 'un Chrome rezagado no recrea el perfil');
  });

  await test('worker: si el proceso principal se desconecta mientras Chrome abre, lo cierra', async () => {
    for (const ms of [300, 500, 700, 900]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-lh-'));
      const w = fork(WORKER, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const exited = new Promise((r) => w.on('exit', r));
      w.send({ type: 'run', url: base + '/lenta', strategy: 'mobile', chromePath, userDataDir: dir, locale: 'es' });
      await sleep(ms);
      w.disconnect();
      assert.equal(await exited, 1, `a los ${ms} ms`);
      await sleep(800);
      const left = octosChromes().filter((l) => l.includes(dir));
      fs.rmSync(dir, { recursive: true, force: true });
      assert.deepEqual(left, [], `Chrome quedó abierto tras desconectar a los ${ms} ms`);
    }
  });

  await test('worker: sin ruta busca Chrome por su cuenta y lo informa', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-lh-'));
    const w = fork(WORKER, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise((r) => w.on('exit', r));
    const found = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 20000);
      w.on('message', (m) => {
        if (m.type === 'chrome-path' || (m.type === 'error' && m.code === 'config')) {
          clearTimeout(t);
          resolve(m);
        }
      });
      w.send({ type: 'run', url: base + '/lenta', strategy: 'mobile', chromePath: null, userDataDir: dir, locale: 'es' });
    });
    w.send({ type: 'cancel' });
    await exited;
    await sleep(500);
    const left = octosChromes().filter((l) => l.includes(dir));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(found, 'el worker respondió');
    if (found.type === 'chrome-path') assert.ok(fs.existsSync(found.path), found.path);
    else console.log('    chrome-launcher no encontró Chrome por lsregister:', found.message);
    assert.deepEqual(left, [], 'la cancelación cierra Chrome');
  });

  await test('runLocal: no deja perfiles temporales', async () => {
    const left = tmpProfiles().filter((n) => !profilesBefore.has(n));
    assert.deepEqual(left, []);
  });

  server.close();
}

console.log(`\n${passed} pruebas OK`);
