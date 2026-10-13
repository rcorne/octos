// Conexión a Google Search Console y Google Analytics 4 desde el proceso principal.
// Dos formas de autenticarse: OAuth para apps de escritorio (cliente del usuario,
// redirección loopback, PKCE + state) o cuenta de servicio (JWT RS256 firmado aquí).
// Los tokens viven solo en el almacén inyectado; hacia fuera solo salen estados.
const crypto = require('crypto');
const http = require('http');
const { jsonSecret } = require('./secrets');
const { siteRoot } = require('./urls');

const DEFAULT_ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  webmasters: 'https://www.googleapis.com/webmasters/v3',
  searchConsole: 'https://searchconsole.googleapis.com/v1',
  analyticsAdmin: 'https://analyticsadmin.googleapis.com/v1beta',
  analyticsData: 'https://analyticsdata.googleapis.com/v1beta',
};

// El aud del JWT es fijo según la documentación, aunque el endpoint se reemplace en pruebas
const JWT_AUDIENCE = 'https://oauth2.googleapis.com/token';
const SCOPE_GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
const SCOPE_GA = 'https://www.googleapis.com/auth/analytics.readonly';
const OAUTH_SCOPES = [SCOPE_GSC, SCOPE_GA, 'openid', 'email'];
const SA_SCOPES = [SCOPE_GSC, SCOPE_GA];

const KEY_CLIENT = 'google.oauthClient';
const KEY_TOKENS = 'google.tokens';
const KEY_SA = 'google.serviceAccount';

const GSC_PAGE = 25000; // máximo de filas por solicitud en Search Analytics
const GA_PAGE = 100000;

function googleError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

function decodeJwtPayload(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Últimos 28 días que terminan hace 2 días (Search Console publica con 2-3 días de retraso)
function defaultRange(now = new Date()) {
  const end = new Date(now);
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  return { startDate: ymd(start), endDate: ymd(end) };
}

function serviceAccountHelp(email) {
  const who = email || 'el correo de la cuenta de servicio';
  return `Para dar acceso, agrega ${who} como usuario en Search Console (Configuración > Usuarios y permisos) y como Lector en Google Analytics (Administrar > Gestión de acceso a la propiedad).`;
}

const PAGE_OK = 'Listo. Vuelve a Octos.';
function callbackPage(title, detail) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Octos</title><style>
:root{color-scheme:light dark;--bg:#f6f6f4;--fg:#1d1d1b;--muted:#6b6b66}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#f1f1ee;--muted:#a3a39d}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{padding:24px;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 6px}p{margin:0;color:var(--muted)}
</style></head><body><main><h1>${esc(title)}</h1><p>${esc(detail)}</p></main></body></html>`;
}

function createGoogleClient({
  store,
  openExternal,
  fetchImpl = (...args) => fetch(...args),
  log = () => {},
  endpoints = {},
  oauthTimeoutMs = 5 * 60 * 1000,
  retryBaseMs = 1000,
  now = () => Date.now(),
} = {}) {
  if (!store) throw new Error('createGoogleClient necesita store');
  const ep = { ...DEFAULT_ENDPOINTS, ...endpoints };
  const clientBox = jsonSecret(store, KEY_CLIENT);
  const tokensBox = jsonSecret(store, KEY_TOKENS);
  const saBox = jsonSecret(store, KEY_SA);

  let memToken = null; // { token, expiresAt } de la cuenta de servicio
  let refreshing = null;
  let pendingOAuth = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function method() {
    if (tokensBox.get()?.refreshToken) return 'oauth';
    if (saBox.get()?.client_email) return 'service-account';
    return null;
  }

  async function status() {
    const m = method();
    const client = clientBox.get();
    let email = null;
    if (m === 'oauth') email = tokensBox.get().email || null;
    if (m === 'service-account') email = saBox.get().client_email;
    return { connected: !!m, method: m, email, hasOAuthClient: !!(client && client.clientId) };
  }

  // Acepta { clientId, clientSecret } o el JSON que descarga Google Cloud ({ installed: {...} })
  function setOAuthClient(input) {
    let obj = input;
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch {
        throw googleError('El archivo del cliente OAuth no es un JSON válido.', 'config');
      }
    }
    const inner = obj && (obj.installed || obj.web || obj);
    const clientId = String(inner?.clientId || inner?.client_id || '').trim();
    const clientSecret = String(inner?.clientSecret || inner?.client_secret || '').trim();
    if (!clientId) throw googleError('Pega el ID de cliente OAuth (termina en .apps.googleusercontent.com).', 'config');
    // Google pide el secreto al canjear el código, también en clientes de escritorio
    if (!clientSecret) throw googleError('Pega también el secreto del cliente OAuth (está junto al ID en Google Cloud > Credenciales).', 'config');
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) log('google: el ID de cliente no tiene la forma habitual');
    const prev = clientBox.get();
    // Un refresh token pertenece al cliente que lo emitió: si cambia el cliente, se descarta
    if (prev && prev.clientId !== clientId && tokensBox.get()) tokensBox.set(null);
    clientBox.set({ clientId, clientSecret });
    return { hasOAuthClient: true };
  }

  async function postForm(url, params) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
    } catch (e) {
      throw googleError('No pudimos conectar con Google. Revisa tu conexión a internet.', 'network', { cause: e });
    }
    let text;
    try {
      text = await res.text();
    } catch (e) {
      throw googleError('Se cortó la conexión con Google. Revisa tu conexión a internet.', 'network', { cause: e });
    }
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    return { res, data };
  }

  function tokenEndpointError(data, res, context) {
    const code = data.error || '';
    const desc = data.error_description ? ` (${data.error_description})` : '';
    if (res.status >= 500) return googleError('Google no respondió al pedir el token. Vuelve a intentarlo en unos minutos.', 'network', { status: res.status });
    if (context === 'refresh' && code === 'invalid_grant') {
      return googleError('Google rechazó la sesión guardada: venció o quitaste el acceso. Conecta tu cuenta de nuevo. Si tu app de Google Cloud está en modo de prueba, el acceso vence a los 7 días.', 'auth', { status: res.status });
    }
    if (code === 'invalid_client' || code === 'unauthorized_client' || code === 'deleted_client' || code === 'disabled_client') {
      const what = context === 'service-account' ? 'la clave de la cuenta de servicio' : 'el cliente OAuth';
      return googleError(`Google rechazó ${what}${desc}. Revisa que esté activo en Google Cloud.`, 'config', { status: res.status });
    }
    if (code === 'invalid_request' && /client_secret/i.test(data.error_description || '')) {
      return googleError('Google pidió el secreto del cliente OAuth. Pega el ID y el secreto de nuevo y conecta otra vez.', 'config', { status: res.status });
    }
    if (context === 'service-account') {
      return googleError(`Google rechazó la clave de la cuenta de servicio${desc}. Descarga una clave nueva o revisa la hora del Mac.`, 'auth', { status: res.status });
    }
    return googleError(`Google rechazó la autorización${desc}. Conecta de nuevo.`, 'auth', { status: res.status });
  }

  // ---------- OAuth (app de escritorio, loopback) ----------

  function cancelPending(reason) {
    if (pendingOAuth) pendingOAuth.cancel(reason);
  }

  async function connectOAuth() {
    const client = clientBox.get();
    if (!client || !client.clientId) {
      throw googleError('Agrega primero el ID y el secreto de tu cliente OAuth (tipo «App de escritorio»).', 'config');
    }
    if (typeof openExternal !== 'function') throw googleError('Falta openExternal para abrir el navegador.', 'config');
    cancelPending('Se inició otra conexión con Google.');

    const verifier = b64url(crypto.randomBytes(48)); // 64 caracteres sin reservar
    const challenge = b64url(sha256(verifier));
    const state = b64url(crypto.randomBytes(24));

    const { code, redirectUri } = await waitForCode({ client, challenge, state });

    const { res, data } = await postForm(ep.token, {
      code,
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    if (!res.ok || !data.access_token) throw tokenEndpointError(data, res, 'exchange');
    if (!data.refresh_token) {
      throw googleError('Google no entregó un token de renovación. Quita el acceso de Octos en tu cuenta de Google (Seguridad > Apps de terceros) y conecta de nuevo.', 'auth');
    }
    const granted = String(data.scope || '').split(/\s+/);
    if (data.scope && !granted.includes(SCOPE_GSC) && !granted.includes(SCOPE_GA)) {
      // No se guarda nada: se revoca el permiso para no dejarlo activo en la cuenta
      await revoke(data.refresh_token);
      throw googleError('No diste permiso para leer Search Console ni Analytics. Conecta de nuevo y marca las casillas de permisos.', 'auth');
    }
    const email = decodeJwtPayload(data.id_token)?.email || null;
    tokensBox.set({
      refreshToken: data.refresh_token,
      accessToken: data.access_token,
      expiresAt: now() + (Number(data.expires_in) || 3600) * 1000,
      scope: data.scope || OAUTH_SCOPES.join(' '),
      email,
    });
    saBox.set(null);
    memToken = null;
    log(`google: conectado por OAuth${email ? ' como ' + email : ''}`);
    return status();
  }

  function waitForCode({ client, challenge, state }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const server = http.createServer();

      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pendingOAuth && pendingOAuth.server === server) pendingOAuth = null;
        // Cierra el servidor después de enviar la respuesta
        setImmediate(() => {
          server.close();
          if (server.closeAllConnections) server.closeAllConnections();
        });
        if (err) reject(err);
        else resolve(value);
      };

      const reply = (res, status, title, detail) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
        res.end(callbackPage(title, detail));
      };

      server.on('request', (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const q = u.searchParams;
        if (u.pathname !== '/' || (!q.has('code') && !q.has('error') && !q.has('state'))) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
          res.end('No encontrado');
          return;
        }
        // Un state ajeno no corta el flujo: se rechaza y se sigue esperando la respuesta real
        if (q.get('state') !== state) {
          log('google: respuesta al loopback con state que no coincide, se ignora');
          reply(res, 400, 'No se pudo conectar.', 'La respuesta no coincide con la solicitud de Octos. Vuelve a Octos.');
          return;
        }
        if (q.has('error')) {
          reply(res, 200, 'No se completó la conexión.', 'Vuelve a Octos.');
          const denied = q.get('error') === 'access_denied';
          finish(googleError(denied ? 'Cancelaste el acceso en Google. Conecta de nuevo cuando quieras.' : `Google devolvió un error (${q.get('error')}). Conecta de nuevo.`, 'auth'));
          return;
        }
        reply(res, 200, PAGE_OK, 'Ya puedes cerrar esta pestaña.');
        finish(null, { code: q.get('code'), redirectUri: server.redirectUri });
      });

      server.on('error', (e) => finish(googleError('No pudimos abrir el puerto local para recibir la respuesta de Google.', 'network', { cause: e })));

      // Se registra antes de listen para que una segunda llamada inmediata pueda cancelarla
      pendingOAuth = { server, cancel: (reason) => finish(googleError(reason || 'Se canceló la conexión con Google.', 'auth')) };

      server.listen(0, '127.0.0.1', async () => {
        if (settled) {
          server.close();
          return;
        }
        const { port } = server.address();
        server.redirectUri = `http://127.0.0.1:${port}`;
        timer = setTimeout(() => finish(googleError('Se acabó el tiempo para autorizar en Google (5 minutos). Conecta de nuevo.', 'auth')), oauthTimeoutMs);
        const url = new URL(ep.auth);
        const params = {
          client_id: client.clientId,
          redirect_uri: server.redirectUri,
          response_type: 'code',
          scope: OAUTH_SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        };
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        try {
          await openExternal(url.toString());
        } catch (e) {
          finish(googleError('No pudimos abrir el navegador para conectar con Google.', 'config', { cause: e }));
        }
      });
    });
  }

  // ---------- Cuenta de servicio ----------

  function signJwt(sa) {
    const iat = Math.floor(now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) };
    const claims = { iss: sa.client_email, scope: SA_SCOPES.join(' '), aud: JWT_AUDIENCE, iat, exp: iat + 3600 };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const sig = crypto.sign('sha256', Buffer.from(input), sa.private_key);
    return `${input}.${b64url(sig)}`;
  }

  async function serviceAccountToken(sa) {
    let assertion;
    try {
      assertion = signJwt(sa);
    } catch (e) {
      throw googleError('La clave privada de la cuenta de servicio no es válida. Descarga una clave nueva en formato JSON.', 'config', { cause: e });
    }
    const { res, data } = await postForm(ep.token, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    if (!res.ok || !data.access_token) throw tokenEndpointError(data, res, 'service-account');
    return { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
  }

  async function setServiceAccount(jsonString) {
    let sa;
    try {
      sa = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    } catch {
      throw googleError('El archivo no es un JSON válido. Descarga la clave de la cuenta de servicio en formato JSON.', 'config');
    }
    if (!sa || !sa.client_email || !sa.private_key) {
      throw googleError('La clave no tiene client_email ni private_key. Descárgala de nuevo en Google Cloud (IAM > Cuentas de servicio > Claves > Agregar clave > JSON).', 'config');
    }
    if (sa.type && sa.type !== 'service_account') {
      throw googleError('El archivo no es la clave de una cuenta de servicio. Si es un cliente OAuth, pégalo en la otra opción.', 'config');
    }
    try {
      crypto.createPrivateKey(sa.private_key);
    } catch {
      throw googleError('La clave privada de la cuenta de servicio no es válida. Descarga una clave nueva en formato JSON.', 'config');
    }
    const clean = { client_email: sa.client_email, private_key: sa.private_key, private_key_id: sa.private_key_id || null, project_id: sa.project_id || null };
    const tok = await serviceAccountToken(clean); // valida contra Google antes de guardar
    const old = tokensBox.get();
    if (old?.refreshToken) await revoke(old.refreshToken);
    tokensBox.set(null);
    saBox.set(clean);
    memToken = tok;
    log(`google: cuenta de servicio ${clean.client_email}`);
    return status();
  }

  // ---------- Tokens de acceso ----------

  async function refreshOAuth(t) {
    const client = clientBox.get();
    if (!client || !client.clientId) throw googleError('Falta el cliente OAuth. Agrégalo y conecta de nuevo.', 'config');
    const { res, data } = await postForm(ep.token, {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      grant_type: 'refresh_token',
      refresh_token: t.refreshToken,
    });
    if (!res.ok || !data.access_token) {
      const err = tokenEndpointError(data, res, 'refresh');
      if (data.error === 'invalid_grant') tokensBox.set(null);
      throw err;
    }
    const next = {
      ...t,
      accessToken: data.access_token,
      expiresAt: now() + (Number(data.expires_in) || 3600) * 1000,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    };
    tokensBox.set(next);
    return next.accessToken;
  }

  async function accessToken(force = false) {
    const m = method();
    if (!m) throw googleError('Conecta tu cuenta de Google primero.', 'auth');
    const fresh = (exp) => exp && exp - 60000 > now();
    if (!force) {
      if (m === 'oauth') {
        const t = tokensBox.get();
        if (t.accessToken && fresh(t.expiresAt)) return t.accessToken;
      } else if (memToken && fresh(memToken.expiresAt)) {
        return memToken.token;
      }
    }
    if (!refreshing) {
      refreshing = (async () => {
        if (m === 'oauth') return refreshOAuth(tokensBox.get());
        memToken = await serviceAccountToken(saBox.get());
        return memToken.token;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  // ---------- Llamadas a las API ----------

  function apiError(res, body, label, apiName) {
    const e = body?.error || {};
    const reasons = (e.errors || []).map((x) => x.reason).concat((e.details || []).map((d) => d.reason)).filter(Boolean);
    const status = res.status;
    const gmsg = e.message ? ` Google dice: ${e.message}` : '';
    const isSA = method() === 'service-account';
    const extra = { status, reasons };

    if (status === 401) return googleError(`${label} rechazó la sesión. Conecta tu cuenta de Google de nuevo.`, 'auth', extra);
    if (status === 429 || reasons.some((r) => /rateLimit|quota|RATE_LIMIT/i.test(r)) || e.status === 'RESOURCE_EXHAUSTED') {
      return googleError(`${label} alcanzó su cuota de solicitudes. Espera unos minutos y vuelve a intentarlo.`, 'quota', extra);
    }
    if (status === 403) {
      if (reasons.some((r) => /accessNotConfigured|SERVICE_DISABLED/i.test(r)) || /has not been used|is disabled/i.test(e.message || '')) {
        return googleError(`Activa la API de ${apiName} en tu proyecto de Google Cloud y vuelve a intentarlo.`, 'config', extra);
      }
      if (reasons.some((r) => /SCOPE_INSUFFICIENT/i.test(r)) || /insufficient authentication scopes/i.test(e.message || '')) {
        return googleError(`Octos no tiene permiso para leer ${label}. Conecta de nuevo y marca todas las casillas de permisos.`, 'auth', extra);
      }
      const help = isSA ? ' ' + serviceAccountHelp(saBox.get()?.client_email) : '';
      return googleError(`${label} rechazó la solicitud: no tienes acceso a esta propiedad.${help}`, 'permission', extra);
    }
    if (status === 404) return googleError(`${label} no encontró la propiedad. Revisa que esté bien escrita.`, 'config', extra);
    if (status >= 500) return googleError(`${label} no respondió bien (error ${status}). Vuelve a intentarlo en unos minutos.`, 'network', extra);
    return googleError(`${label} rechazó la solicitud.${gmsg}`, 'config', extra);
  }

  const RETRIES = 2;

  async function api(methodName, url, body, { label, apiName }) {
    let renewed = false;
    let attempt = 0;
    for (;;) {
      const token = await accessToken();
      let res;
      try {
        res = await fetchImpl(url, {
          method: methodName,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw googleError(`No pudimos conectar con ${label}. Revisa tu conexión a internet.`, 'network', { cause: e });
      }
      let data = null;
      let text;
      try {
        text = await res.text();
      } catch (e) {
        // La conexión se cortó a mitad de la respuesta: se reintenta como un 5xx
        if (attempt < RETRIES) {
          const wait = retryBaseMs * 2 ** attempt;
          attempt++;
          log(`google: respuesta cortada en ${label}, reintento ${attempt} en ${wait} ms`);
          await sleep(wait);
          continue;
        }
        throw googleError(`Se cortó la conexión con ${label}. Revisa tu conexión a internet y vuelve a intentarlo.`, 'network', { cause: e });
      }
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (res.ok) return data;

      if (res.status === 401 && !renewed) {
        renewed = true;
        log(`google: 401 en ${label}, renuevo el token`);
        await accessToken(true);
        continue;
      }
      const err = apiError(res, data, label, apiName);
      const retriable = err.code === 'quota' || res.status === 503 || res.status === 500;
      if (retriable && attempt < RETRIES) {
        const after = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 60000) : retryBaseMs * 2 ** attempt;
        attempt++;
        log(`google: ${res.status} en ${label}, reintento ${attempt} en ${wait} ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  const GSC = { label: 'Search Console', apiName: 'Google Search Console' };
  const GA_ADMIN = { label: 'Google Analytics', apiName: 'Google Analytics Admin' };
  const GA_DATA = { label: 'Google Analytics', apiName: 'Google Analytics Data' };

  async function listSearchConsoleSites() {
    const data = await api('GET', `${ep.webmasters}/sites`, null, GSC);
    return (data.siteEntry || []).map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
  }

  async function listAnalyticsProperties() {
    const out = [];
    let pageToken = '';
    for (let i = 0; i < 100; i++) {
      const u = new URL(`${ep.analyticsAdmin}/accountSummaries`);
      u.searchParams.set('pageSize', '200');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const data = await api('GET', u.toString(), null, GA_ADMIN);
      for (const acc of data.accountSummaries || []) {
        for (const p of acc.propertySummaries || []) {
          out.push({ property: p.property, displayName: p.displayName || p.property, account: acc.displayName || acc.account, accountId: acc.account });
        }
      }
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    return out;
  }

  // Search Analytics con paginación por startRow. rowLimit = total máximo de filas.
  async function searchAnalytics(siteUrl, body, rowLimit) {
    if (!siteUrl) throw googleError('Elige una propiedad de Search Console.', 'config');
    const url = `${ep.webmasters}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const total = Math.max(1, Number(rowLimit) || GSC_PAGE);
    const rows = [];
    let startRow = 0;
    while (rows.length < total) {
      const pageSize = Math.min(GSC_PAGE, total - rows.length);
      const data = await api('POST', url, { ...body, rowLimit: pageSize, startRow }, GSC);
      const got = data.rows || [];
      rows.push(...got);
      if (got.length < pageSize) break;
      startRow += got.length;
    }
    return rows;
  }

  function gscBody({ startDate, endDate, dataState, type }) {
    const r = startDate && endDate ? { startDate, endDate } : defaultRange(new Date(now()));
    const body = { startDate: r.startDate, endDate: r.endDate, type: type || 'web' };
    if (dataState) body.dataState = dataState;
    return { body, range: r };
  }

  const metricsOf = (r) => ({ clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position ?? null });

  async function fetchSearchConsolePages({ siteUrl, startDate, endDate, rowLimit = GSC_PAGE, dataState, type } = {}) {
    const { body, range } = gscBody({ startDate, endDate, dataState, type });
    const rows = await searchAnalytics(siteUrl, { ...body, dimensions: ['page'] }, rowLimit);
    const out = rows.map((r) => ({ url: r.keys[0], ...metricsOf(r) }));
    out.range = range;
    return out;
  }

  async function fetchSearchConsoleQueries({ siteUrl, url, startDate, endDate, rowLimit = 1000, dataState, type } = {}) {
    if (!url) throw googleError('Falta la URL para ver sus consultas.', 'config');
    const { body, range } = gscBody({ startDate, endDate, dataState, type });
    const rows = await searchAnalytics(
      siteUrl,
      {
        ...body,
        dimensions: ['query'],
        dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: url }] }],
      },
      rowLimit
    );
    const out = rows.map((r) => ({ query: r.keys[0], ...metricsOf(r) }));
    out.range = range;
    return out;
  }

  async function inspectUrl({ siteUrl, url } = {}) {
    if (!siteUrl || !url) throw googleError('Falta la propiedad o la URL para inspeccionar.', 'config');
    const data = await api('POST', `${ep.searchConsole}/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl, languageCode: 'es' }, GSC);
    const r = data.inspectionResult?.indexStatusResult || {};
    return {
      verdict: r.verdict || null,
      coverageState: r.coverageState || null,
      indexingState: r.indexingState || null,
      robotsTxtState: r.robotsTxtState || null,
      pageFetchState: r.pageFetchState || null,
      googleCanonical: r.googleCanonical || null,
      userCanonical: r.userCanonical || null,
      lastCrawlTime: r.lastCrawlTime || null,
      crawledAs: r.crawledAs || null,
      inspectedAt: new Date(now()).toISOString(),
      resultLink: data.inspectionResult?.inspectionResultLink || null,
    };
  }

  const GA_METRICS = ['screenPageViews', 'sessions', 'engagementRate', 'keyEvents', 'userEngagementDuration'];

  // avgEngagementTime = userEngagementDuration / sessions (segundos por sesión), igual que
  // «Tiempo de interacción medio por sesión» de GA4. No hay métrica directa en la Data API.
  async function fetchAnalyticsPages({ property, startDate, endDate, limit = GA_PAGE, maxRows = 500000 } = {}) {
    if (!property) throw googleError('Elige una propiedad de Google Analytics.', 'config');
    const prop = /^properties\//.test(property) ? property : `properties/${String(property).replace(/\D/g, '')}`;
    const range = startDate && endDate ? { startDate, endDate } : defaultRange(new Date(now()));
    const pageSize = Math.min(GA_PAGE, Math.max(1, Number(limit) || GA_PAGE));
    const out = [];
    let offset = 0;
    for (;;) {
      const data = await api(
        'POST',
        `${ep.analyticsData}/${prop}:runReport`,
        {
          dateRanges: [range],
          dimensions: [{ name: 'hostName' }, { name: 'pagePath' }],
          metrics: GA_METRICS.map((name) => ({ name })),
          limit: String(pageSize),
          offset: String(offset),
        },
        GA_DATA
      );
      const dIdx = (data.dimensionHeaders || []).map((h) => h.name);
      const mIdx = (data.metricHeaders || []).map((h) => h.name);
      const dim = (row, name, i) => row.dimensionValues?.[dIdx.length ? dIdx.indexOf(name) : i]?.value ?? '';
      const met = (row, name) => Number(row.metricValues?.[mIdx.length ? mIdx.indexOf(name) : GA_METRICS.indexOf(name)]?.value) || 0;
      const rows = data.rows || [];
      for (const row of rows) {
        const sessions = met(row, 'sessions');
        const duration = met(row, 'userEngagementDuration');
        out.push({
          hostName: dim(row, 'hostName', 0),
          pagePath: dim(row, 'pagePath', 1),
          views: met(row, 'screenPageViews'),
          sessions,
          engagementRate: met(row, 'engagementRate'),
          keyEvents: met(row, 'keyEvents'),
          avgEngagementTime: sessions > 0 ? Math.round((duration / sessions) * 10) / 10 : 0,
        });
      }
      offset += rows.length;
      const total = Number(data.rowCount) || 0;
      if (!rows.length || rows.length < pageSize || offset >= total || out.length >= maxRows) break;
    }
    out.range = range;
    return out;
  }

  async function revoke(token) {
    try {
      const { res } = await postForm(ep.revoke, { token });
      if (!res.ok) log(`google: la revocación respondió ${res.status}`);
      return res.ok;
    } catch (e) {
      log(`google: no se pudo revocar (${e.message})`);
      return false;
    }
  }

  async function disconnect({ forgetClient = false } = {}) {
    cancelPending('Se desconectó la cuenta de Google.');
    const t = tokensBox.get();
    let revoked = false;
    if (t?.refreshToken || t?.accessToken) revoked = await revoke(t.refreshToken || t.accessToken);
    tokensBox.set(null);
    saBox.set(null);
    memToken = null;
    if (forgetClient) clientBox.set(null);
    return { ...(await status()), revoked };
  }

  return {
    status,
    setOAuthClient,
    connectOAuth,
    setServiceAccount,
    disconnect,
    listSearchConsoleSites,
    listAnalyticsProperties,
    fetchSearchConsolePages,
    fetchSearchConsoleQueries,
    inspectUrl,
    fetchAnalyticsPages,
  };
}

// ---------- Emparejar propiedades y datos con el rastreo ----------

function hostOf(input) {
  // Solo el host va en minúsculas: la ruta distingue mayúsculas
  const s = String(input || '').trim();
  if (!s) return { host: '', url: null };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return { host: u.hostname.toLowerCase(), url: u };
    } catch {
      return { host: '', url: null };
    }
  }
  return { host: s.toLowerCase().replace(/[:/].*$/, ''), url: null };
}

const stripWww = (h) => h.replace(/^www\./, '');

// Prefiere sc-domain:<dominio registrable>; si no, otra sc-domain que cubra el host;
// si no, el prefijo URL del mismo host (exacto antes que con/sin www, https antes que http).
// Con un host suelto gana el prefijo raíz (cubre todo el sitio); con una URL completa,
// el prefijo más largo que la contenga.
function matchSiteForHost(sites, hostOrUrl) {
  const { host, url } = hostOf(hostOrUrl);
  if (!host) return null;
  const list = (sites || [])
    .map((s) => (typeof s === 'string' ? { siteUrl: s } : s))
    .filter((s) => s && s.siteUrl && s.permissionLevel !== 'siteUnverifiedUser');

  const root = siteRoot(host);
  const domains = list.filter((s) => s.siteUrl.toLowerCase().startsWith('sc-domain:'));
  const exactRoot = domains.find((s) => s.siteUrl.slice(10).toLowerCase() === root);
  if (exactRoot) return exactRoot.siteUrl;
  const covering = domains
    .map((s) => ({ s, d: s.siteUrl.slice(10).toLowerCase() }))
    .filter(({ d }) => host === d || host.endsWith('.' + d) || stripWww(host) === d)
    .sort((a, b) => b.d.length - a.d.length);
  if (covering.length) return covering[0].s.siteUrl;

  const target = url ? url.pathname : '/';
  const candidates = [];
  for (const s of list) {
    let u;
    try {
      u = new URL(s.siteUrl);
    } catch {
      continue;
    }
    const h = u.hostname.toLowerCase();
    const exact = h === host;
    if (!exact && stripWww(h) !== stripWww(host)) continue;
    if (url && !target.startsWith(u.pathname)) continue;
    candidates.push({ s, exact, https: u.protocol === 'https:', len: u.pathname.length, proto: url ? u.protocol === url.protocol : true });
  }
  candidates.sort((a, b) => b.exact - a.exact || b.proto - a.proto || b.https - a.https || (url ? b.len - a.len : a.len - b.len));
  return candidates.length ? candidates[0].s.siteUrl : null;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';
const altWww = (h) => (h.startsWith('www.') ? h.slice(4) : 'www.' + h);

function parseUrl(input) {
  try {
    return new URL(String(input).trim());
  } catch {
    return null;
  }
}

// Clave de URL: protocolo + host en minúsculas sin puerto por defecto, ruta decodificada
// (sin barra final salvo exact), query intacta, sin fragmento.
function keyOf(u, { protocol = u.protocol, host = u.hostname.toLowerCase(), exact = false } = {}) {
  const port = u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) ? ':' + u.port : '';
  const p = safeDecode(u.pathname);
  return `${protocol}//${host}${port}${exact ? p : trimSlash(p)}${u.search}`;
}

// La misma URL con el otro protocolo y con/sin www
function variantKeys(u) {
  const h = u.hostname.toLowerCase();
  const out = [];
  for (const protocol of ['http:', 'https:']) {
    for (const host of [h, altWww(h)]) {
      if (protocol === u.protocol && host === h) continue;
      out.push(keyOf(u, { protocol, host }));
    }
  }
  return out;
}

const pathKey = (host, path) => `${String(host || '').toLowerCase()}|${trimSlash(safeDecode(String(path || '/')))}`;

const isHtmlPage = (row) => row && row.internal !== false && row.status === 200 && (!row.contentType || /html/i.test(row.contentType));

// Elige una sola fila por dato de Google: primero la página HTML 200, luego la mejor
// coincidencia; a igualdad, la primera del rastreo. Así una redirección y su destino no se duplican.
function pickWinner(list, score) {
  let best = null;
  for (const c of list) {
    const s = [isHtmlPage(c.row) ? 1 : 0, score(c)];
    if (!best || s[0] > best.s[0] || (s[0] === best.s[0] && s[1] > best.s[1])) best = { c, s };
  }
  return best.c;
}

function mergeGoogleData(rows, { gscPages, gaPages, startHost, gscRange, gaRange } = {}) {
  const result = { matchedGsc: 0, matchedGa: 0, unmatchedGsc: [] };
  rows = rows || [];
  const parsed = rows.map((row) => parseUrl(row && row.url));

  if (Array.isArray(gscPages)) {
    const range = gscRange || gscPages.range || null;
    const byKey = new Map();
    for (const p of gscPages) {
      const u = parseUrl(p.url);
      if (!u) continue;
      const k = keyOf(u);
      const a = byKey.get(k) || { urls: [], exact: new Set(), clicks: 0, impressions: 0, posW: 0 };
      a.urls.push(p.url);
      a.exact.add(keyOf(u, { exact: true }));
      a.clicks += p.clicks || 0;
      a.impressions += p.impressions || 0;
      a.posW += (p.position || 0) * (p.impressions || 0);
      byKey.set(k, a);
    }
    const rowsByKey = new Map();
    parsed.forEach((u, i) => {
      if (!u) return;
      const k = keyOf(u);
      if (!rowsByKey.has(k)) rowsByKey.set(k, []);
      rowsByKey.get(k).push({ row: rows[i], exact: keyOf(u, { exact: true }) });
    });
    const winners = new Map();
    const shared = new Set(); // filas cuya clave tiene datos, pero se asignaron a otra fila
    for (const [k, list] of rowsByKey) {
      const a = byKey.get(k);
      if (!a) continue;
      const w = pickWinner(list, (c) => (a.exact.has(c.exact) ? 1 : 0));
      winners.set(w.row, a);
      for (const c of list) if (c !== w) shared.add(c.row);
    }
    for (const row of rows) {
      const a = winners.get(row);
      if (a) {
        result.matchedGsc++;
        row.gsc = {
          clicks: a.clicks,
          impressions: a.impressions,
          ctr: a.impressions ? a.clicks / a.impressions : 0,
          position: a.impressions ? Math.round((a.posW / a.impressions) * 10) / 10 : null,
          range,
        };
      } else if (isHtmlPage(row) && !shared.has(row)) {
        // Página rastreada que no aparece en Search Console: sin impresiones en el rango
        row.gsc = { clicks: 0, impressions: 0, ctr: 0, position: null, range };
      } else {
        delete row.gsc;
      }
    }

    // Páginas con clics que el rastreo no encontró: solo del sitio rastreado (una propiedad
    // sc-domain trae también otros subdominios) y sin contar la misma URL con otro protocolo o www.
    const scope = new Set();
    const addHost = (h) => {
      if (!h) return;
      scope.add(h);
      scope.add(altWww(h));
    };
    addHost(hostOf(startHost).host);
    parsed.forEach((u, i) => {
      if (u && rows[i] && rows[i].internal !== false) addHost(u.hostname.toLowerCase());
    });
    for (const [k, a] of byKey) {
      if (rowsByKey.has(k) || a.clicks <= 0) continue;
      const u = parseUrl(a.urls[0]);
      if (scope.size && !scope.has(u.hostname.toLowerCase())) continue;
      if (variantKeys(u).some((v) => rowsByKey.has(v))) continue;
      result.unmatchedGsc.push({
        url: a.urls[0],
        clicks: a.clicks,
        impressions: a.impressions,
        position: a.impressions ? Math.round((a.posW / a.impressions) * 10) / 10 : null,
      });
    }
    result.unmatchedGsc.sort((x, y) => y.clicks - x.clicks);
  }

  if (Array.isArray(gaPages)) {
    const range = gaRange || gaPages.range || null;
    const fallbackHost = hostOf(startHost).host;
    const byKey = new Map();
    for (const p of gaPages) {
      let host = String(p.hostName || '').toLowerCase();
      if (!host || host === '(not set)') host = fallbackHost;
      const k = pathKey(host, p.pagePath);
      const a = byKey.get(k) || { views: 0, sessions: 0, keyEvents: 0, engagedW: 0, timeW: 0 };
      a.views += p.views || 0;
      a.sessions += p.sessions || 0;
      a.keyEvents += p.keyEvents || 0;
      a.engagedW += (p.engagementRate || 0) * (p.sessions || 0);
      a.timeW += (p.avgEngagementTime || 0) * (p.sessions || 0);
      byKey.set(k, a);
    }
    // Rutas sin query presentes en el rastreo: las variantes con query no heredan sus datos
    const plainPaths = new Set();
    for (const u of parsed) if (u && !u.search) plainPaths.add(pathKey(u.hostname, u.pathname));
    // Busca la ruta en el host exacto y, si no está, en la variante con/sin www
    const lookup = (host, p) => {
      const a = byKey.get(pathKey(host, p));
      if (a) return { a, exact: 1 };
      const b = byKey.get(pathKey(altWww(host), p));
      return b ? { a: b, exact: 0 } : null;
    };
    // GA no distingue protocolo y se busca también con/sin www: varias filas pueden caer
    // en el mismo dato. Se agrupan por dato y solo una lo recibe.
    const byAgg = new Map();
    parsed.forEach((u, i) => {
      if (!u) return;
      const h = u.hostname.toLowerCase();
      let m = null;
      if (u.search) m = lookup(h, u.pathname + u.search);
      if (!m && (!u.search || !plainPaths.has(pathKey(h, u.pathname)))) m = lookup(h, u.pathname);
      if (!m) return;
      if (!byAgg.has(m.a)) byAgg.set(m.a, []);
      byAgg.get(m.a).push({ row: rows[i], exact: m.exact, https: u.protocol === 'https:' ? 1 : 0 });
    });
    const winners = new Map();
    const shared = new Set();
    for (const [a, list] of byAgg) {
      const w = pickWinner(list, (c) => c.exact * 2 + c.https);
      winners.set(w.row, a);
      for (const c of list) if (c !== w) shared.add(c.row);
    }
    for (const row of rows) {
      const a = winners.get(row);
      if (a) {
        result.matchedGa++;
        row.ga = {
          views: a.views,
          sessions: a.sessions,
          engagementRate: a.sessions ? Math.round((a.engagedW / a.sessions) * 10000) / 10000 : 0,
          keyEvents: a.keyEvents,
          avgEngagementTime: a.sessions ? Math.round((a.timeW / a.sessions) * 10) / 10 : 0,
          range,
        };
      } else if (isHtmlPage(row) && !shared.has(row)) {
        row.ga = { views: 0, sessions: 0, engagementRate: 0, keyEvents: 0, avgEngagementTime: 0, range };
      } else {
        delete row.ga;
      }
    }
  }

  return result;
}

module.exports = {
  createGoogleClient,
  matchSiteForHost,
  mergeGoogleData,
  serviceAccountHelp,
  defaultRange,
  DEFAULT_ENDPOINTS,
  OAUTH_SCOPES,
};
