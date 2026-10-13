// Proceso hijo de lib/lighthouse.js: abre Chrome sin ventana, corre Lighthouse y
// devuelve por IPC solo el resultado normalizado. Chrome se cierra siempre, también
// si llega una cancelación o se cae el proceso principal mientras Chrome abre.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { normalize } = require('./lighthouse.js');

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const CHROME_FLAGS = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-sync',
  '--mute-audio',
];
const NO_CHROME = 'No encontramos Chrome en este Mac. Instala Google Chrome o usa PageSpeed Insights.';

// Instancia de Launcher: existe desde antes de abrir Chrome, así que siempre se puede cerrar.
let launcher = null;
let stopping = false;

function send(msg) {
  return new Promise((resolve) => {
    try {
      if (!process.connected) return resolve();
      process.send(msg, () => resolve());
    } catch {
      resolve(); // el proceso principal ya no escucha
    }
  });
}

// Mata Chrome (todo su grupo de procesos) y espera a que cierre.
async function closeChrome() {
  const l = launcher;
  launcher = null;
  if (!l) return;
  const proc = l.chromeProcess;
  const alive = proc && proc.pid && proc.exitCode === null && !proc.signalCode;
  const closed = new Promise((resolve) => {
    if (!alive) return resolve();
    proc.once('close', resolve);
    setTimeout(resolve, 5000);
  });
  try {
    l.kill();
  } catch {
    // ya cerrado
  }
  await closed;
  await send({ type: 'chrome-closed' });
}

// Cancelación, desconexión o error inesperado: cierra Chrome y sale.
async function stop(exitCode, message) {
  if (stopping) return;
  stopping = true;
  await closeChrome();
  if (message) await send(message);
  process.exit(exitCode);
}

// Sin ruta del proceso principal: búsqueda lenta (lsregister) acá, no en la ventana.
function resolveChrome(chromePath, Launcher) {
  if (chromePath) return chromePath;
  try {
    return Launcher.getInstallations().find((p) => p && fs.existsSync(p)) || null;
  } catch {
    return null;
  }
}

async function run({ url, strategy, chromePath, userDataDir, locale }) {
  let message;
  try {
    const { Launcher } = await import('chrome-launcher');
    const { default: lighthouse } = await import('lighthouse');
    if (stopping) return;
    const exe = resolveChrome(chromePath, Launcher);
    if (!exe) {
      message = { type: 'error', code: 'config', message: NO_CHROME };
      return;
    }
    if (!chromePath) send({ type: 'chrome-path', path: exe });
    launcher = new Launcher({ chromePath: exe, chromeFlags: CHROME_FLAGS, userDataDir, logLevel: 'silent' });
    // launch() lanza Chrome de forma síncrona antes de esperar el puerto de depuración.
    const launching = launcher.launch();
    launching.catch(() => {}); // si gana el error de spawn, este rechazo no importa
    const proc = launcher.chromeProcess;
    if (proc && proc.pid) send({ type: 'chrome', pid: proc.pid });
    // Una ruta que no existe emite 'error' en el proceso de Chrome: se corta sin esperar el puerto.
    const spawnFailed = new Promise((resolve, reject) => {
      if (proc) proc.once('error', reject);
    });
    spawnFailed.catch(() => {});
    await Promise.race([launching, spawnFailed]);
    if (stopping) return;
    const flags = { port: launcher.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES, locale: locale || 'es' };
    let config;
    if (strategy === 'desktop') config = (await import('lighthouse/core/config/desktop-config.js')).default;
    const runner = await lighthouse(url, flags, config);
    if (!runner || !runner.lhr) throw new Error('Lighthouse no devolvió un resultado.');
    message = { type: 'result', result: normalize(runner.lhr, { source: 'local', strategy }) };
  } catch (err) {
    const text = String((err && err.message) || err);
    if (err && err.code === 'ENOENT') {
      message = { type: 'error', code: 'config', message: 'No encontramos Chrome en la ruta indicada. Revisa la ruta o usa PageSpeed Insights.' };
    } else {
      const human = launcher && !launcher.port ? 'No se pudo abrir Chrome para la auditoría.' : 'Lighthouse no pudo auditar la página.';
      message = { type: 'error', code: 'lighthouse', message: `${human} (${text.slice(0, 200)})` };
    }
  } finally {
    if (!stopping) {
      await closeChrome();
      await send(message);
      process.exit(0);
    }
  }
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'run') run(msg);
  else if (msg.type === 'cancel') stop(1);
});

// Si el proceso principal desaparece, no se deja Chrome abierto.
process.on('disconnect', () => stop(1));

process.on('uncaughtException', (err) => {
  stop(1, { type: 'error', code: 'lighthouse', message: `Lighthouse falló de forma inesperada. (${String((err && err.message) || err).slice(0, 200)})` });
});
process.on('unhandledRejection', (err) => {
  stop(1, { type: 'error', code: 'lighthouse', message: `Lighthouse falló de forma inesperada. (${String((err && err.message) || err).slice(0, 200)})` });
});
