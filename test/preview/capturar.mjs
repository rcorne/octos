// Banco de pruebas visual de Octos: capturas sin Electron.
//
// Sirve el proyecto en 127.0.0.1, abre test/preview/index.html (que monta
// renderer/index.html con un window.octos falso y el proyecto de ejemplo) en
// el Chrome del sistema en modo headless y guarda PNG por CDP.
//
// Uso:
//   node test/preview/capturar.mjs                  todas las capturas en out/preview/
//   node test/preview/capturar.mjs resumen ajustes  solo las que contengan esos nombres
//   node test/preview/capturar.mjs --escala 2       capturas en retina (2x)
//   node test/preview/capturar.mjs --salida /ruta   otra carpeta de salida
//   node test/preview/capturar.mjs --servir         solo sirve el banco y muestra la URL
//
// Parámetros que entiende la vista (ver mock.js): ?vista=resumen&tema=dark,
// ?vista=introduccion&paso=1, ?vista=titles&detalle=1, ?vista=ajustes&tab=atajos.
// Para regenerar el proyecto de ejemplo: node test/preview/generar-ejemplo.mjs
// Chrome: /Applications/Google Chrome.app (o la ruta en la variable CHROME).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1440;
const HEIGHT = 920;

export const SHOTS = [
  ['01-inicio', 'vista=inicio'],
  ['02-introduccion', 'vista=introduccion'],
  ['03-introduccion-prioridades', 'vista=introduccion&paso=1'],
  ['04-rastreando', 'vista=rastreando'],
  ['05-resumen', 'vista=resumen'],
  ['06-prioridades', 'vista=prioridades'],
  ['07-titulos-detalle', 'vista=titles&detalle=1'],
  ['08-todas-detalle-tecnico', 'vista=all&detalle=5'],
  ['09-sitemaps', 'vista=sitemaps'],
  ['10-paleta', 'vista=paleta'],
  ['11-ajustes', 'vista=ajustes'],
  ['12-ajustes-apariencia', 'vista=ajustes&tab=apariencia'],
  ['13-inicio-oscuro', 'vista=inicio&tema=dark'],
  ['14-resumen-oscuro', 'vista=resumen&tema=dark'],
  ['15-prioridades-oscuro', 'vista=prioridades&tema=dark'],
  ['16-titulos-oscuro', 'vista=titles&detalle=1&tema=dark'],
  ['17-informe', 'vista=informe'],
  ['18-organico', 'vista=organic&conectado=1'],
  ['19-google-conectado', 'vista=google&conectado=1'],
  ['20-google-sin-conectar', 'vista=google'],
  ['21-lighthouse', 'vista=lighthouse&conectado=1'],
  ['22-asistente-ia', 'vista=assistant&conectado=1'],
  ['23-plan-de-accion', 'vista=plan&conectado=1'],
  ['24-google-guia', 'vista=google&guia=1'],
];

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('No existe');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

// Cliente CDP mínimo sobre el WebSocket nativo de Node 22
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  };
  const ready = new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new Error('No se pudo conectar con Chrome'));
  });
  return {
    ready,
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const msg = { id: ++id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        pending.set(msg.id, { resolve, reject });
        ws.send(JSON.stringify(msg));
      }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

async function launchChrome() {
  if (!existsSync(CHROME)) throw new Error(`No encontré Chrome en ${CHROME}. Define la variable CHROME.`);
  const profile = mkdtempSync(path.join(tmpdir(), 'octos-preview-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) {
    if (Date.now() - t0 > 15000) {
      proc.kill();
      rmSync(profile, { recursive: true, force: true });
      throw new Error('Chrome no abrió el puerto de depuración');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
  return { proc, profile, ws: `ws://127.0.0.1:${port}${wsPath}` };
}

export async function capture({ only = [], scale = 1, outDir = path.join(ROOT, 'out', 'preview') } = {}) {
  mkdirSync(outDir, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/test/preview/index.html`;
  let chrome;
  try {
    chrome = await launchChrome();
  } catch (err) {
    server.close();
    throw err;
  }
  const client = cdp(chrome.ws);
  const report = [];
  try {
    await client.ready;
    const shots = SHOTS.filter(([name]) => !only.length || only.some((o) => name.includes(o)));
    for (const [name, query] of shots) {
      const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
      const errors = [];
      client.on((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      });
      const s = (method, params) => client.send(method, params, sessionId);
      await s('Runtime.enable');
      await s('Page.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: scale, mobile: false });
      await s('Page.navigate', { url: `${base}?${query}` });
      const t0 = Date.now();
      let state = null;
      while (Date.now() - t0 < 15000) {
        const { result } = await s('Runtime.evaluate', {
          expression: `window.__previewListo ? JSON.stringify({ error: window.__previewError || null, fonts: document.fonts ? ['800 20px Manrope', '700 20px Manrope', '400 15px "IBM Plex Sans"', '600 13px "IBM Plex Sans"'].map((f) => [f, document.fonts.check(f)]) : [], theme: document.documentElement.dataset.theme || null }) : null`,
          returnByValue: true,
        });
        if (result.value) {
          state = JSON.parse(result.value);
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!state) errors.push('La vista no avisó que estaba lista (window.__previewListo)');
      else if (state.error) errors.push(state.error);
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      const file = path.join(outDir, name + '.png');
      writeFileSync(file, Buffer.from(data, 'base64'));
      await client.send('Target.closeTarget', { targetId });
      const missingFonts = state ? state.fonts.filter(([, ok]) => !ok).map(([f]) => f) : [];
      report.push({ name, file, theme: state && state.theme, missingFonts, errors });
      console.log(`${errors.length ? '✗' : '✓'} ${name}${missingFonts.length && name !== '17-informe' ? ` · fuentes sin cargar: ${missingFonts.join(', ')}` : ''}${errors.length ? '\n    ' + errors.join('\n    ') : ''}`);
    }
  } finally {
    client.close();
    chrome.proc.kill();
    server.close();
    setTimeout(() => rmSync(chrome.profile, { recursive: true, force: true }), 300);
  }
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => {
    const i = args.indexOf(k);
    if (i < 0) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  if (args.includes('--servir')) {
    const server = await serve(Number(opt('--puerto')) || 0);
    console.log(`Banco de pruebas: http://127.0.0.1:${server.address().port}/test/preview/index.html?vista=resumen`);
    console.log('Ctrl+C para detener.');
  } else {
    const scale = Number(opt('--escala')) || 1;
    const outDir = opt('--salida') || undefined;
    const report = await capture({ only: args.filter((a) => !a.startsWith('--')), scale, outDir });
    const bad = report.filter((r) => r.errors.length);
    console.log(`\n${report.length - bad.length}/${report.length} capturas en ${path.dirname(report[0] ? report[0].file : '.')}`);
    if (bad.length) process.exitCode = 1;
  }
}
