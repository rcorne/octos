// Auditorías Lighthouse por URL, bajo demanda. Dos fuentes:
// - PageSpeed Insights v5 (servidores de Google; trae datos reales de CrUX).
// - Lighthouse local con el Chrome instalado, en un proceso hijo de Node
//   (lib/lighthouse-worker.mjs) para no cargar Lighthouse en el proceso principal.
// normalize() deja ambos resultados con la forma LighthouseResult de docs/contratos.md.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, execFile } = require('child_process');

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
// Valores del enum de la referencia REST de PSI v5.
const PSI_CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];
const PSI_TIMEOUT_MS = 90000;
const LOCAL_TIMEOUT_MS = 120000;
const WORKER_PATH = path.join(__dirname, 'lighthouse-worker.mjs');

const METRIC_AUDITS = {
  lcp: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
  tbt: 'total-blocking-time',
  fcp: 'first-contentful-paint',
  si: 'speed-index',
  ttfb: 'server-response-time',
  inp: 'interaction-to-next-paint',
};
const METRIC_IDS = new Set(Object.values(METRIC_AUDITS).concat(['interactive', 'max-potential-fid']));
const LOAD_METRICS = ['LCP', 'FCP'];
const MAX_OPPORTUNITIES = 12;
const MAX_DIAGNOSTICS = 10;

const RUNTIME_ERRORS = {
  NO_FCP: 'La página no pintó contenido. Revisa que cargue en un navegador sin interacción.',
  FAILED_DOCUMENT_REQUEST: 'Lighthouse no pudo cargar la página. Revisa que la URL responda.',
  ERRORED_DOCUMENT_REQUEST: 'La página respondió con un error. Revisa el estado HTTP de la URL.',
  DNS_FAILURE: 'No se encontró el dominio. Revisa la URL.',
  INSECURE_DOCUMENT_REQUEST: 'El certificado HTTPS de la página no es válido.',
  PAGE_HUNG: 'La página no terminó de cargar. Revisa scripts que bloqueen la carga.',
  NOT_HTML: 'La URL no devuelve HTML. Audita una página web.',
  CHROME_INTERSTITIAL_ERROR: 'Chrome mostró una página de error en lugar del sitio.',
};

const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const round3 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

function makeError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function score(categories, id) {
  const c = categories && categories[id];
  if (!c || typeof c.score !== 'number') return null;
  return Math.round(c.score * 100);
}

function numeric(audits, id) {
  const a = audits[id];
  if (!a || a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'error') return null;
  return typeof a.numericValue === 'number' ? a.numericValue : null;
}

// Ahorro de carga en ms: el de la oportunidad clásica o el mayor ahorro de LCP/FCP.
// TBT e INP no cuentan: esas auditorías (bootup-time, long-tasks…) van como diagnósticos.
function savingsOf(audit) {
  const d = audit.details || {};
  let ms = typeof d.overallSavingsMs === 'number' ? d.overallSavingsMs : 0;
  const ms2 = audit.metricSavings || {};
  for (const k of LOAD_METRICS) {
    if (typeof ms2[k] === 'number' && ms2[k] > ms) ms = ms2[k];
  }
  let bytes = null;
  if (typeof d.overallSavingsBytes === 'number') bytes = d.overallSavingsBytes;
  else if (d.debugData && typeof d.debugData.wastedBytes === 'number') bytes = d.debugData.wastedBytes;
  return { ms: Math.round(ms), bytes: bytes == null ? null : Math.round(bytes) };
}

const skipped = (a) => a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'manual' || a.scoreDisplayMode === 'error';
// Igual que ReportUtils.showAsPassed del informe de Lighthouse.
const passed = (a) => {
  if (skipped(a)) return true;
  if (a.scoreDisplayMode === 'informative') return false;
  return Number(a.score) >= 0.9;
};

function opportunitiesOf(audits) {
  const out = [];
  for (const [id, a] of Object.entries(audits)) {
    if (!a || METRIC_IDS.has(id)) continue;
    const ms = a.metricSavings || {};
    const isOpp = (a.details && a.details.type === 'opportunity') || LOAD_METRICS.some((k) => k in ms);
    if (!isOpp || passed(a)) continue;
    const s = savingsOf(a);
    if (s.ms <= 0 && !(s.bytes > 0)) continue;
    out.push({ id, title: a.title || id, savingsMs: s.ms, savingsBytes: s.bytes });
  }
  out.sort((x, y) => y.savingsMs - x.savingsMs || (y.savingsBytes || 0) - (x.savingsBytes || 0));
  return out.slice(0, MAX_OPPORTUNITIES);
}

// Diagnósticos: auditorías e insights de rendimiento que el informe de Lighthouse
// muestra como no aprobados. Las informativas solo si traen un valor visible.
function diagnosticsOf(lhr, skip) {
  const perf = lhr.categories && lhr.categories.performance;
  const refs = perf && Array.isArray(perf.auditRefs) ? perf.auditRefs : [];
  const out = [];
  for (const ref of refs) {
    if (ref.group !== 'diagnostics' && ref.group !== 'insights') continue;
    if (skip.has(ref.id)) continue;
    const a = lhr.audits[ref.id];
    if (!a || passed(a)) continue;
    const informative = a.scoreDisplayMode === 'informative';
    if (informative && !a.displayValue) continue;
    // Primero las que fallan; las informativas al final.
    const rank = informative || typeof a.score !== 'number' ? 1 : a.score;
    out.push({ id: ref.id, title: a.title || ref.id, displayValue: a.displayValue ? String(a.displayValue) : '', rank });
  }
  out.sort((x, y) => x.rank - y.rank);
  return out.slice(0, MAX_DIAGNOSTICS).map(({ rank, ...d }) => d);
}

// CrUX de PSI. El percentil de CLS viene multiplicado por 100.
function fieldOf(le) {
  if (!le || !le.metrics || !Object.keys(le.metrics).length) return null;
  const p = (k) => {
    const m = le.metrics[k];
    return m && typeof m.percentile === 'number' ? m.percentile : null;
  };
  const cls = p('CUMULATIVE_LAYOUT_SHIFT_SCORE');
  return {
    lcp: p('LARGEST_CONTENTFUL_PAINT_MS'),
    cls: cls == null ? null : round3(cls / 100),
    inp: p('INTERACTION_TO_NEXT_PAINT'),
    fcp: p('FIRST_CONTENTFUL_PAINT_MS'),
    ttfb: p('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    category: le.overall_category || null,
    origin: Boolean(le.origin_fallback),
  };
}

function normalize(lhr, { source, strategy, loadingExperience } = {}) {
  if (!lhr || typeof lhr !== 'object') throw makeError('Lighthouse no devolvió un resultado.', 'lighthouse');
  const audits = lhr.audits || {};
  const metrics = {};
  for (const [k, id] of Object.entries(METRIC_AUDITS)) {
    const v = numeric(audits, id);
    metrics[k] = k === 'cls' ? round3(v) : round(v);
  }
  const opportunities = opportunitiesOf(audits);
  const result = {
    source: source || 'local',
    strategy: strategy || (lhr.configSettings && lhr.configSettings.formFactor) || 'mobile',
    fetchedAt: lhr.fetchTime || new Date().toISOString(),
    lighthouseVersion: lhr.lighthouseVersion || null,
    scores: {
      performance: score(lhr.categories, 'performance'),
      accessibility: score(lhr.categories, 'accessibility'),
      bestPractices: score(lhr.categories, 'best-practices'),
      seo: score(lhr.categories, 'seo'),
    },
    metrics,
    field: fieldOf(loadingExperience),
    opportunities,
    diagnostics: diagnosticsOf({ ...lhr, audits }, new Set(opportunities.map((o) => o.id))),
  };
  const rt = lhr.runtimeError;
  if (rt && rt.code && rt.code !== 'NO_ERROR') {
    result.error = RUNTIME_ERRORS[rt.code] || `Lighthouse no pudo auditar la página (${rt.code}).`;
  }
  return result;
}

function checkArgs(url, strategy) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw makeError('Escribe una URL completa, con http:// o https://.', 'config');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw makeError('Audita una URL que empiece con http:// o https://.', 'config');
  }
  if (strategy !== 'mobile' && strategy !== 'desktop') {
    throw makeError('Elige la estrategia: móvil o escritorio.', 'config');
  }
}

async function runPageSpeed({ url, strategy = 'mobile', apiKey, fetchImpl = fetch, locale = 'es', baseUrl = PSI_ENDPOINT, timeoutMs = PSI_TIMEOUT_MS } = {}) {
  checkArgs(url, strategy);
  const q = new URL(baseUrl);
  q.searchParams.set('url', url);
  q.searchParams.set('strategy', strategy.toUpperCase());
  for (const c of PSI_CATEGORIES) q.searchParams.append('category', c);
  if (locale) q.searchParams.set('locale', locale);
  if (apiKey) q.searchParams.set('key', apiKey);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  let body;
  try {
    res = await fetchImpl(q.toString(), { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
  } catch (err) {
    if (ctrl.signal.aborted || (err && err.name === 'AbortError')) {
      throw makeError(`PageSpeed Insights no respondió en ${Math.round(timeoutMs / 1000)} s. Intenta de nuevo o usa la auditoría local.`, 'timeout');
    }
    throw makeError('No se pudo conectar con PageSpeed Insights. Revisa tu conexión a internet.', 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const gmsg = (body && body.error && body.error.message) || '';
    if (res.status === 429) {
      throw makeError(
        apiKey
          ? 'Se agotó la cuota de tu clave de PageSpeed Insights. Espera unos minutos o revisa la cuota en Google Cloud.'
          : 'PageSpeed Insights alcanzó el límite de consultas sin clave. Agrega una clave de API gratuita de Google para tener más cuota, o espera unos minutos.',
        'quota',
        { status: 429 }
      );
    }
    if (res.status === 400 && /api key/i.test(gmsg)) {
      throw makeError('Google rechazó la clave de PageSpeed Insights. Revisa que esté bien copiada.', 'auth', { status: 400 });
    }
    if (res.status === 403) {
      throw makeError('Google rechazó la clave de PageSpeed Insights. Revisa que la API esté habilitada en tu proyecto.', 'auth', { status: 403 });
    }
    const lh = gmsg.match(/Lighthouse returned error: ([A-Z_]+)/);
    if (lh) {
      throw makeError(RUNTIME_ERRORS[lh[1]] || `Lighthouse no pudo auditar la página (${lh[1]}).`, 'lighthouse', { status: res.status });
    }
    if (res.status >= 500) {
      throw makeError('PageSpeed Insights tuvo un error. Intenta de nuevo en unos minutos.', 'network', { status: res.status });
    }
    throw makeError(`PageSpeed Insights rechazó la solicitud (${res.status}). Revisa la URL.`, 'config', { status: res.status });
  }

  if (!body || !body.lighthouseResult) throw makeError('PageSpeed Insights no devolvió resultados de Lighthouse.', 'lighthouse');
  const page = body.loadingExperience;
  const origin = body.originLoadingExperience;
  let le = null;
  if (page && page.metrics && Object.keys(page.metrics).length) le = page;
  else if (origin && origin.metrics && Object.keys(origin.metrics).length) le = { ...origin, origin_fallback: true };
  return normalize(body.lighthouseResult, { source: 'psi', strategy, loadingExperience: le });
}

// Chrome, Chromium, Edge o Brave instalados, solo por rutas conocidas (rápido y
// sin bloquear la ventana). La búsqueda lenta de chrome-launcher (lsregister, ~5 s
// síncronos) corre en el worker; lo que encuentra queda en caché acá.
let deepChrome = null;

function findChrome({ exists = fs.existsSync, launcher, deep = false } = {}) {
  const apps = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Microsoft Edge', 'Brave Browser'];
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
  const candidates = [process.env.CHROME_PATH, deepChrome];
  if (process.platform === 'darwin') {
    for (const root of roots) {
      for (const app of apps) candidates.push(path.join(root, `${app}.app`, 'Contents', 'MacOS', app));
    }
  } else if (process.platform === 'win32') {
    const bases = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
    const rel = [
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
      ['Chromium', 'Application', 'chrome.exe'],
    ];
    for (const b of bases) for (const r of rel) candidates.push(path.join(b, ...r));
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium');
  }
  for (const p of candidates) {
    if (p && exists(p)) return p;
  }
  if (!deep) return null;
  try {
    const L = launcher || require('chrome-launcher').Launcher;
    const found = L.getInstallations().find((p) => p && exists(p));
    if (found) {
      deepChrome = found;
      return found;
    }
  } catch {
    // chrome-launcher no disponible o sin instalaciones
  }
  return null;
}

function killGroup(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    // Windows no tiene grupos de procesos: taskkill /T cierra el árbol completo de Chrome
    try {
      require('child_process').spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    } catch {
      // ya cerrado
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ya cerrado
    }
  }
}

// Respaldo: mata cualquier proceso que use el perfil temporal de esta corrida
// (por ejemplo, un Chrome cuyo pid no alcanzó a llegar). Solo toca ese perfil.
function killByProfile(dir, execFileImpl = execFile) {
  return new Promise((resolve) => {
    if (!dir || !path.basename(dir).startsWith('octos-lh-')) return resolve(0);
    if (process.platform === 'win32') {
      // Mismo respaldo con PowerShell: cierra los procesos cuya línea de comando usa ese perfil
      const needle = `--user-data-dir=${dir}`.replace(/'/g, "''");
      const script = `$n='${needle}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($n) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
      return execFileImpl('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 }, (err, out) => {
        resolve(err || !out ? 0 : String(out).split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).length);
      });
    }
    execFileImpl('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      if (err || !out) return resolve(0);
      let n = 0;
      for (const line of String(out).split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(.*)$/);
        if (!m || !m[2].includes(`--user-data-dir=${dir}`)) continue;
        const pid = Number(m[1]);
        if (pid === process.pid) continue;
        try {
          process.kill(pid, 'SIGKILL');
          n++;
        } catch {
          // ya cerrado
        }
      }
      resolve(n);
    });
  });
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // se limpia en el próximo reinicio del sistema
  }
}

// Corre Lighthouse en un proceso hijo. En la app empaquetada: execPath = binario
// de Electron con ELECTRON_RUN_AS_NODE=1 (se agrega solo si corre dentro de Electron).
function runLocal({ url, strategy = 'mobile', chromePath, timeoutMs = LOCAL_TIMEOUT_MS, locale = 'es', execPath, env, workerPath = WORKER_PATH, log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    try {
      checkArgs(url, strategy);
    } catch (err) {
      return reject(err);
    }
    if (chromePath && !fs.existsSync(chromePath)) {
      return reject(makeError('No encontramos Chrome en la ruta indicada. Revisa la ruta o usa PageSpeed Insights.', 'config'));
    }
    // Sin ruta conocida, el worker hace la búsqueda lenta y avisa si no hay Chrome.
    const chrome = chromePath || findChrome() || null;
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-lh-'));
    const childEnv = { ...(env || process.env) };
    if (process.versions.electron && !childEnv.ELECTRON_RUN_AS_NODE) childEnv.ELECTRON_RUN_AS_NODE = '1';

    let child;
    try {
      child = fork(workerPath, [], {
        execPath: execPath || process.execPath,
        env: childEnv,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'json',
      });
    } catch (err) {
      removeDir(userDataDir);
      return reject(makeError('No se pudo iniciar el proceso de Lighthouse.', 'config', { cause: err }));
    }

    let chromePid = null;
    let settled = false;
    let cleaned = false;
    let stderr = '';
    let graceTimer = null;
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
    });

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    // Una sola vez: cierra Chrome (por pid y por perfil) y después borra el perfil,
    // para que un Chrome rezagado no lo vuelva a crear.
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(graceTimer);
      killGroup(chromePid);
      killByProfile(userDataDir).then(() => removeDir(userDataDir));
    };

    child.on('exit', (code, signal) => {
      cleanup();
      if (!settled) {
        if (stderr) log('lighthouse-worker', stderr);
        finish(makeError(`Lighthouse se cerró antes de terminar (${signal || code}).`, 'lighthouse'));
      }
    });
    // fork no pudo iniciar el proceso: Node no emite 'exit' en ese caso.
    child.on('error', (err) => {
      cleanup();
      finish(makeError('No se pudo iniciar el proceso de Lighthouse.', 'config', { cause: err }));
    });
    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'chrome') chromePid = msg.pid;
      else if (msg.type === 'chrome-closed') chromePid = null;
      else if (msg.type === 'chrome-path' && typeof msg.path === 'string') deepChrome = msg.path;
      else if (msg.type === 'result') finish(null, msg.result);
      else if (msg.type === 'error') finish(makeError(msg.message, msg.code || 'lighthouse'));
    });

    const timer = setTimeout(() => {
      finish(makeError(`Lighthouse tardó más de ${Math.round(timeoutMs / 1000)} s. Intenta de nuevo o usa PageSpeed Insights.`, 'timeout'));
      try {
        child.send({ type: 'cancel' });
      } catch {
        // canal cerrado
      }
      graceTimer = setTimeout(() => {
        killGroup(chromePid);
        child.kill('SIGKILL');
      }, 3000);
    }, timeoutMs);

    try {
      child.send({ type: 'run', url, strategy, chromePath: chrome, userDataDir, locale });
    } catch {
      // el proceso no arrancó; lo informa el evento 'error'
    }
  });
}

module.exports = { runPageSpeed, runLocal, findChrome, normalize, killByProfile, PSI_ENDPOINT };
