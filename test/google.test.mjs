// Pruebas de lib/google.js contra un servidor falso de Google en 127.0.0.1.
// Uso: node test/google.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createGoogleClient, matchSiteForHost, mergeGoogleData } = require('../lib/google.js');
const { createSecretStore } = require('../lib/secrets.js');

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

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------- Servidor falso ----------

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_EMAIL = 'octos-test@proyecto.iam.gserviceaccount.com';

const fake = {
  codes: new Map(), // code -> { challenge, redirectUri, clientId }
  validTokens: new Set(),
  refreshToken: 'rt-' + crypto.randomBytes(8).toString('hex'),
  calls: [],
  revoked: [],
  fail429: 0,
  fail401Once: false,
  truncate: 0, // respuestas cortadas a mitad del cuerpo
  truncateToken: 0,
  scope: null, // scope que devuelve el canje (null = todos)
  jwtClaims: null,
  gscRows: Array.from({ length: 30010 }, (_, i) => ({ keys: [`https://www.ejemplo.cl/p/${i}`], clicks: 30010 - i, impressions: 100, ctr: 0.1, position: 5 })),
  gaRows: [
    ['www.ejemplo.cl', '/', '100', '80', '0.5', '3', '1600'],
    ['www.ejemplo.cl', '/servicios', '50', '40', '0.75', '1', '400'],
    ['www.ejemplo.cl', '/blog', '10', '5', '0.2', '0', '50'],
  ],
};

function issueToken() {
  const t = 'at-' + crypto.randomBytes(8).toString('hex');
  fake.validTokens.add(t);
  return t;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });
}

// Promete 1000 bytes, envía unos pocos y corta la conexión
function truncated(res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
  res.write('{"siteEntry":[');
  setTimeout(() => res.socket.destroy(), 5);
}

function handleToken(form, res) {
  if (fake.truncateToken > 0) {
    fake.truncateToken--;
    return truncated(res);
  }
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const entry = fake.codes.get(form.get('code'));
    if (!entry) return json(res, 400, { error: 'invalid_grant' });
    const expected = b64url(crypto.createHash('sha256').update(form.get('code_verifier') || '').digest());
    if (expected !== entry.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE' });
    if (form.get('redirect_uri') !== entry.redirectUri) return json(res, 400, { error: 'redirect_uri_mismatch' });
    if (!form.get('client_secret')) return json(res, 400, { error: 'invalid_request', error_description: 'client_secret is missing.' });
    if (form.get('client_id') !== 'cliente.apps.googleusercontent.com' || form.get('client_secret') !== 'secreto') return json(res, 401, { error: 'invalid_client' });
    fake.codes.delete(form.get('code'));
    const idToken = `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ email: 'rodrigo@ejemplo.cl', sub: '1' }))}.x`;
    return json(res, 200, {
      access_token: issueToken(),
      expires_in: 3599,
      refresh_token: fake.refreshToken,
      id_token: idToken,
      scope: fake.scope || 'openid https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/userinfo.email',
      token_type: 'Bearer',
    });
  }
  if (grant === 'refresh_token') {
    if (form.get('refresh_token') !== fake.refreshToken) return json(res, 400, { error: 'invalid_grant' });
    return json(res, 200, { access_token: issueToken(), expires_in: 3599, token_type: 'Bearer' });
  }
  if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
    const [h, c, sig] = String(form.get('assertion')).split('.');
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), publicKey, fromB64url(sig));
    if (!ok) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
    const header = JSON.parse(fromB64url(h));
    const claims = JSON.parse(fromB64url(c));
    fake.jwtClaims = { header, claims };
    if (header.alg !== 'RS256' || claims.iss !== SA_EMAIL || claims.aud !== 'https://oauth2.googleapis.com/token' || claims.exp - claims.iat > 3600) {
      return json(res, 400, { error: 'invalid_grant' });
    }
    return json(res, 200, { access_token: issueToken(), expires_in: 3600, token_type: 'Bearer' });
  }
  return json(res, 400, { error: 'unsupported_grant_type' });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const raw = await readBody(req);
  fake.calls.push({ method: req.method, path: u.pathname, search: u.search, body: raw });

  if (u.pathname === '/token') return handleToken(new URLSearchParams(raw), res);
  if (u.pathname === '/revoke') {
    fake.revoked.push(new URLSearchParams(raw).get('token'));
    return json(res, 200, {});
  }

  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (fake.fail401Once) {
    fake.fail401Once = false;
    fake.validTokens.delete(token);
  }
  if (!fake.validTokens.has(token)) return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
  if (fake.fail429 > 0) {
    fake.fail429--;
    return json(res, 429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, { 'Retry-After': '0' });
  }
  const body = raw ? JSON.parse(raw) : {};

  if (req.method === 'GET' && u.pathname === '/wm/sites' && fake.truncate > 0) {
    fake.truncate--;
    return truncated(res);
  }
  if (req.method === 'GET' && u.pathname === '/wm/sites') {
    return json(res, 200, {
      siteEntry: [
        { siteUrl: 'https://www.ejemplo.cl/', permissionLevel: 'siteOwner' },
        { siteUrl: 'sc-domain:ejemplo.cl', permissionLevel: 'siteFullUser' },
      ],
    });
  }
  const sa = u.pathname.match(/^\/wm\/sites\/([^/]+)\/searchAnalytics\/query$/);
  if (req.method === 'POST' && sa) {
    const siteUrl = decodeURIComponent(sa[1]);
    if (siteUrl === 'sc-domain:ajeno.cl') return json(res, 403, { error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:ajeno.cl'.", errors: [{ reason: 'forbidden' }] } });
    if (body.dimensions[0] === 'query') {
      const f = body.dimensionFilterGroups?.[0]?.filters?.[0];
      assert.equal(f.dimension, 'page');
      return json(res, 200, { rows: [{ keys: ['agencia seo'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 }] });
    }
    const start = body.startRow || 0;
    return json(res, 200, { rows: fake.gscRows.slice(start, start + body.rowLimit), responseAggregationType: 'byPage' });
  }
  if (req.method === 'POST' && u.pathname === '/sc/urlInspection/index:inspect') {
    return json(res, 200, {
      inspectionResult: {
        inspectionResultLink: 'https://search.google.com/search-console/inspect?x',
        indexStatusResult: {
          verdict: 'PASS',
          coverageState: 'Enviada e indexada',
          robotsTxtState: 'ALLOWED',
          indexingState: 'INDEXING_ALLOWED',
          lastCrawlTime: '2026-10-01T10:00:00Z',
          pageFetchState: 'SUCCESSFUL',
          googleCanonical: body.inspectionUrl,
          userCanonical: body.inspectionUrl,
          crawledAs: 'MOBILE',
        },
      },
    });
  }
  if (req.method === 'GET' && u.pathname === '/admin/accountSummaries') {
    const page = u.searchParams.get('pageToken');
    if (!page) {
      return json(res, 200, {
        accountSummaries: [{ name: 'accountSummaries/1', account: 'accounts/1', displayName: 'Cuenta Uno', propertySummaries: [{ property: 'properties/123', displayName: 'Ejemplo GA4', propertyType: 'PROPERTY_TYPE_ORDINARY', parent: 'accounts/1' }] }],
        nextPageToken: 'p2',
      });
    }
    return json(res, 200, { accountSummaries: [{ name: 'accountSummaries/2', account: 'accounts/2', displayName: 'Cuenta Dos', propertySummaries: [{ property: 'properties/456', displayName: 'Otro sitio' }] }] });
  }
  if (req.method === 'POST' && u.pathname === '/data/properties/123:runReport') {
    const offset = Number(body.offset || 0);
    const limit = Number(body.limit || 10000);
    const slice = fake.gaRows.slice(offset, offset + limit);
    return json(res, 200, {
      dimensionHeaders: [{ name: 'hostName' }, { name: 'pagePath' }],
      metricHeaders: body.metrics.map((m) => ({ name: m.name, type: 'TYPE_INTEGER' })),
      rows: slice.map((r) => ({ dimensionValues: [{ value: r[0] }, { value: r[1] }], metricValues: r.slice(2).map((value) => ({ value })) })),
      rowCount: fake.gaRows.length,
      kind: 'analyticsData#runReport',
    });
  }
  json(res, 404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const endpoints = {
  auth: base + '/auth',
  token: base + '/token',
  revoke: base + '/revoke',
  webmasters: base + '/wm',
  searchConsole: base + '/sc',
  analyticsAdmin: base + '/admin',
  analyticsData: base + '/data',
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-google-'));
let storeN = 0;
const newStore = () => createSecretStore({ file: path.join(tmp, `s${storeN++}.json`), encrypt: (s) => Buffer.from(s, 'utf8'), decrypt: (b) => b.toString('utf8') });

// Navegador falso: lee la URL de autorización, registra el code_challenge y vuelve al loopback
// forgeFirst: antes de la respuesta real llega otra con state ajeno (otro proceso local)
function fakeBrowser({ tamperState = false, forgeFirst = false, error = null, record, opened } = {}) {
  return async (authUrl) => {
    if (opened) opened.push(authUrl);
    const u = new URL(authUrl);
    const p = Object.fromEntries(u.searchParams);
    if (record) record.params = p;
    if (forgeFirst || tamperState) {
      const forged = new URL(p.redirect_uri);
      forged.searchParams.set('error', 'access_denied');
      forged.searchParams.set('state', 'falso');
      const r = await fetch(forged);
      if (record) record.forgedStatus = r.status;
      if (tamperState) return;
    }
    const code = 'code-' + crypto.randomBytes(6).toString('hex');
    fake.codes.set(code, { challenge: p.code_challenge, redirectUri: p.redirect_uri, clientId: p.client_id });
    const cb = new URL(p.redirect_uri);
    if (error) cb.searchParams.set('error', error);
    else cb.searchParams.set('code', code);
    cb.searchParams.set('state', tamperState ? 'otro-state' : p.state);
    setTimeout(async () => {
      const res = await fetch(cb);
      if (record) {
        record.status = res.status;
        record.html = await res.text();
      }
    }, 10);
  };
}

console.log('Octos · Google (Search Console y GA4)');

let g;
let store;
const browser = {};

await test('sin cliente OAuth: error de configuración', async () => {
  store = newStore();
  g = createGoogleClient({ store, openExternal: fakeBrowser(), endpoints, retryBaseMs: 5 });
  await assert.rejects(() => g.connectOAuth(), (e) => e.code === 'config' && /cliente OAuth/.test(e.message));
  assert.deepEqual(await g.status(), { connected: false, method: null, email: null, hasOAuthClient: false });
});

await test('flujo OAuth completo con PKCE, state y loopback', async () => {
  g = createGoogleClient({ store, openExternal: fakeBrowser({ record: browser }), endpoints, retryBaseMs: 5 });
  g.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' });
  const st = await g.connectOAuth();
  assert.deepEqual(st, { connected: true, method: 'oauth', email: 'rodrigo@ejemplo.cl', hasOAuthClient: true });
  const p = browser.params;
  assert.match(p.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(p.code_challenge_method, 'S256');
  assert.equal(p.access_type, 'offline');
  assert.equal(p.prompt, 'consent');
  assert.equal(p.response_type, 'code');
  assert.ok(p.state.length >= 20, 'state aleatorio');
  for (const s of ['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly', 'openid', 'email']) {
    assert.ok(p.scope.split(' ').includes(s), `falta el scope ${s}`);
  }
  // PKCE: el servidor falso verificó code_challenge = base64url(sha256(verifier)) al canjear
  const exch = fake.calls.find((c) => c.path === '/token' && c.body.includes('authorization_code'));
  const verifier = new URLSearchParams(exch.body).get('code_verifier');
  assert.ok(verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9\-._~]+$/.test(verifier));
  assert.equal(b64url(crypto.createHash('sha256').update(verifier).digest()), p.code_challenge);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(browser.status, 200);
  assert.match(browser.html, /Listo\. Vuelve a Octos\./);
  const visible = browser.html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /[!¡]/, 'sin signos de exclamación');
  // El servidor loopback se cerró
  await assert.rejects(() => fetch(p.redirect_uri + '/?state=x'));
  // Los tokens quedan en el almacén, no en el estado
  const saved = JSON.parse(store.get('google.tokens'));
  assert.equal(saved.refreshToken, fake.refreshToken);
  assert.ok(!JSON.stringify(st).includes('rt-'));
});

await test('state ajeno: se rechaza sin cortar el flujo', async () => {
  // Una respuesta forjada (incluso con error=access_denied) no cancela la conexión real
  const s2 = newStore();
  const rec = {};
  const g2 = createGoogleClient({ store: s2, openExternal: fakeBrowser({ forgeFirst: true, record: rec }), endpoints });
  g2.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' });
  const st = await g2.connectOAuth();
  assert.equal(st.connected, true);
  assert.equal(rec.forgedStatus, 400);
  // Solo llega la forjada: sigue esperando hasta el tiempo máximo y no guarda nada
  const s3 = newStore();
  const rec3 = {};
  const g3 = createGoogleClient({ store: s3, openExternal: fakeBrowser({ tamperState: true, record: rec3 }), endpoints, oauthTimeoutMs: 150 });
  g3.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' });
  await assert.rejects(() => g3.connectOAuth(), (e) => e.code === 'auth' && /tiempo/.test(e.message));
  assert.equal(rec3.forgedStatus, 400);
  assert.equal(s3.get('google.tokens'), null);
});

await test('dos conexiones seguidas: la segunda cancela la primera', async () => {
  const opened = [];
  const s4 = newStore();
  const g4 = createGoogleClient({ store: s4, openExternal: fakeBrowser({ opened }), endpoints });
  g4.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' });
  const t0 = Date.now();
  const p1 = g4.connectOAuth();
  const p2 = g4.connectOAuth();
  await assert.rejects(p1, (e) => e.code === 'auth' && /otra conexión/.test(e.message));
  assert.ok(Date.now() - t0 < 1000, 'la primera se cancela de inmediato');
  assert.equal((await p2).connected, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(opened.length, 1, 'una sola pestaña del navegador');
});

await test('cliente OAuth sin secreto', async () => {
  const s6 = newStore();
  const g6 = createGoogleClient({ store: s6, openExternal: fakeBrowser(), endpoints });
  assert.throws(() => g6.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: ' ' }), (e) => e.code === 'config' && /secreto/.test(e.message));
  assert.throws(() => g6.setOAuthClient({ installed: { client_id: 'cliente.apps.googleusercontent.com' } }), (e) => e.code === 'config');
  // Un cliente guardado sin secreto (versión anterior): Google lo pide al canjear
  s6.set('google.oauthClient', JSON.stringify({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: '' }));
  await assert.rejects(() => g6.connectOAuth(), (e) => e.code === 'config' && /secreto/.test(e.message));
});

await test('acceso cancelado y tiempo máximo del loopback', async () => {
  const s3 = newStore();
  const g3 = createGoogleClient({ store: s3, openExternal: fakeBrowser({ error: 'access_denied' }), endpoints });
  g3.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' });
  await assert.rejects(() => g3.connectOAuth(), (e) => e.code === 'auth' && /Cancelaste/.test(e.message));
  const g4 = createGoogleClient({ store: s3, openExternal: async () => {}, endpoints, oauthTimeoutMs: 50 });
  await assert.rejects(() => g4.connectOAuth(), (e) => e.code === 'auth' && /tiempo/.test(e.message));
});

await test('Search Console: propiedades y páginas con paginación', async () => {
  const sites = await g.listSearchConsoleSites();
  assert.deepEqual(sites[0], { siteUrl: 'https://www.ejemplo.cl/', permissionLevel: 'siteOwner' });
  fake.calls.length = 0;
  const pages = await g.fetchSearchConsolePages({ siteUrl: 'sc-domain:ejemplo.cl', startDate: '2026-09-01', endDate: '2026-09-28', rowLimit: 40000 });
  assert.equal(pages.length, 30010);
  assert.deepEqual(pages[0], { url: 'https://www.ejemplo.cl/p/0', clicks: 30010, impressions: 100, ctr: 0.1, position: 5 });
  const q = fake.calls.filter((c) => c.path.includes('searchAnalytics'));
  assert.equal(q.length, 2, 'dos páginas');
  assert.ok(q[0].path.includes('sc-domain%3Aejemplo.cl'), 'siteUrl codificado');
  const b0 = JSON.parse(q[0].body);
  const b1 = JSON.parse(q[1].body);
  assert.deepEqual([b0.rowLimit, b0.startRow, b1.rowLimit, b1.startRow], [25000, 0, 15000, 25000]);
  assert.deepEqual(b0.dimensions, ['page']);
  assert.deepEqual(pages.range, { startDate: '2026-09-01', endDate: '2026-09-28' });
});

await test('Search Console: consultas por URL e inspección', async () => {
  fake.calls.length = 0;
  const qs = await g.fetchSearchConsoleQueries({ siteUrl: 'sc-domain:ejemplo.cl', url: 'https://www.ejemplo.cl/', startDate: '2026-09-01', endDate: '2026-09-28', dataState: 'all' });
  assert.deepEqual(qs[0], { query: 'agencia seo', clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 });
  const body = JSON.parse(fake.calls[0].body);
  assert.equal(body.dataState, 'all');
  assert.deepEqual(body.dimensionFilterGroups[0].filters[0], { dimension: 'page', operator: 'equals', expression: 'https://www.ejemplo.cl/' });
  const ins = await g.inspectUrl({ siteUrl: 'sc-domain:ejemplo.cl', url: 'https://www.ejemplo.cl/' });
  assert.equal(ins.verdict, 'PASS');
  assert.equal(ins.crawledAs, 'MOBILE');
  assert.equal(ins.googleCanonical, 'https://www.ejemplo.cl/');
  assert.ok(ins.inspectedAt);
  const ib = JSON.parse(fake.calls.at(-1).body);
  assert.deepEqual(ib, { inspectionUrl: 'https://www.ejemplo.cl/', siteUrl: 'sc-domain:ejemplo.cl', languageCode: 'es' });
});

await test('renueva el token tras un 401 y reintenta', async () => {
  fake.calls.length = 0;
  fake.fail401Once = true;
  const sites = await g.listSearchConsoleSites();
  assert.equal(sites.length, 2);
  const refresh = fake.calls.filter((c) => c.path === '/token' && c.body.includes('grant_type=refresh_token'));
  assert.equal(refresh.length, 1);
  assert.equal(fake.calls.filter((c) => c.path === '/wm/sites').length, 2);
});

await test('429: espera y reintenta; sin cuota tras 2 reintentos', async () => {
  fake.fail429 = 2;
  const sites = await g.listSearchConsoleSites();
  assert.equal(sites.length, 2);
  fake.fail429 = 3;
  await assert.rejects(() => g.listSearchConsoleSites(), (e) => e.code === 'quota' && /cuota/.test(e.message));
  fake.fail429 = 0;
});

await test('respuesta cortada a mitad del cuerpo: reintenta y luego error de red', async () => {
  fake.truncate = 1;
  assert.equal((await g.listSearchConsoleSites()).length, 2, 'reintenta una respuesta cortada');
  fake.truncate = 3;
  await assert.rejects(() => g.listSearchConsoleSites(), (e) => e.code === 'network' && /Se cortó la conexión con Search Console/.test(e.message));
  fake.truncate = 0;
  // En el endpoint de tokens
  fake.truncateToken = 1;
  const key = JSON.stringify({ type: 'service_account', client_email: SA_EMAIL, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  await assert.rejects(() => createGoogleClient({ store: newStore(), endpoints }).setServiceAccount(key), (e) => e.code === 'network' && /Se cortó/.test(e.message));
  fake.truncateToken = 0;
});

await test('403: sin acceso a la propiedad', async () => {
  await assert.rejects(
    () => g.fetchSearchConsolePages({ siteUrl: 'sc-domain:ajeno.cl' }),
    (e) => e.code === 'permission' && e.message.startsWith('Search Console rechazó la solicitud: no tienes acceso a esta propiedad.')
  );
});

await test('GA4: propiedades paginadas y runReport con offset', async () => {
  const props = await g.listAnalyticsProperties();
  assert.deepEqual(props.map((p) => p.property), ['properties/123', 'properties/456']);
  assert.equal(props[0].account, 'Cuenta Uno');
  assert.equal(props[0].displayName, 'Ejemplo GA4');
  fake.calls.length = 0;
  const ga = await g.fetchAnalyticsPages({ property: 'properties/123', startDate: '2026-09-01', endDate: '2026-09-28', limit: 2 });
  assert.equal(ga.length, 3);
  const reqs = fake.calls.filter((c) => c.path.endsWith(':runReport'));
  assert.equal(reqs.length, 2);
  const b = JSON.parse(reqs[1].body);
  assert.equal(b.offset, '2');
  assert.equal(b.limit, '2');
  assert.deepEqual(b.dimensions, [{ name: 'hostName' }, { name: 'pagePath' }]);
  assert.deepEqual(b.metrics.map((m) => m.name), ['screenPageViews', 'sessions', 'engagementRate', 'keyEvents', 'userEngagementDuration']);
  assert.deepEqual(ga[0], { hostName: 'www.ejemplo.cl', pagePath: '/', views: 100, sessions: 80, engagementRate: 0.5, keyEvents: 3, avgEngagementTime: 20 });
});

await test('desconectar revoca el refresh token y borra los tokens', async () => {
  const st = await g.disconnect();
  assert.equal(st.connected, false);
  assert.equal(st.revoked, true);
  assert.equal(st.hasOAuthClient, true, 'mantiene el cliente OAuth para reconectar');
  assert.deepEqual(fake.revoked, [fake.refreshToken]);
  assert.equal(store.get('google.tokens'), null);
  await assert.rejects(() => g.listSearchConsoleSites(), (e) => e.code === 'auth');
});

await test('sin permisos de datos: revoca el token emitido', async () => {
  fake.revoked.length = 0;
  fake.scope = 'openid https://www.googleapis.com/auth/userinfo.email';
  const s7 = newStore();
  const g7 = createGoogleClient({ store: s7, openExternal: fakeBrowser(), endpoints });
  g7.setOAuthClient({ clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' });
  await assert.rejects(() => g7.connectOAuth(), (e) => e.code === 'auth' && /No diste permiso/.test(e.message));
  assert.deepEqual(fake.revoked, [fake.refreshToken]);
  assert.equal(s7.get('google.tokens'), null);
  fake.scope = null;
});

await test('cuenta de servicio: JWT RS256 verificado por el servidor', async () => {
  const s5 = newStore();
  const g5 = createGoogleClient({ store: s5, endpoints });
  await assert.rejects(() => g5.setServiceAccount('{no es json'), (e) => e.code === 'config');
  await assert.rejects(() => g5.setServiceAccount('{"type":"service_account"}'), (e) => e.code === 'config' && /client_email/.test(e.message));
  const key = JSON.stringify({ type: 'service_account', project_id: 'p', private_key_id: 'k1', client_email: SA_EMAIL, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const st = await g5.setServiceAccount(key);
  assert.deepEqual(st, { connected: true, method: 'service-account', email: SA_EMAIL, hasOAuthClient: false });
  assert.equal(fake.jwtClaims.header.kid, 'k1');
  assert.equal(fake.jwtClaims.claims.scope, 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly');
  const sites = await g5.listSearchConsoleSites();
  assert.equal(sites.length, 2);
  // 401 con cuenta de servicio: firma un JWT nuevo
  fake.fail401Once = true;
  assert.equal((await g5.listSearchConsoleSites()).length, 2);
  // 403 explica cómo dar acceso
  await assert.rejects(
    () => g5.fetchSearchConsolePages({ siteUrl: 'sc-domain:ajeno.cl' }),
    (e) => e.code === 'permission' && e.message.includes(SA_EMAIL) && /Lector en Google Analytics/.test(e.message)
  );
  // Clave de otra cuenta: la firma no coincide
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const g6 = createGoogleClient({ store: newStore(), endpoints });
  await assert.rejects(() => g6.setServiceAccount(JSON.stringify({ type: 'service_account', client_email: SA_EMAIL, private_key: other })), (e) => e.code === 'auth');
});

await test('matchSiteForHost', () => {
  const sites = [
    { siteUrl: 'http://ejemplo.cl/', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://www.ejemplo.cl/', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://www.ejemplo.cl/blog/', permissionLevel: 'siteOwner' },
    { siteUrl: 'sc-domain:otro.com.ar', permissionLevel: 'siteFullUser' },
    { siteUrl: 'sc-domain:tienda.cl', permissionLevel: 'siteUnverifiedUser' },
  ];
  assert.equal(matchSiteForHost(sites, 'www.ejemplo.cl'), 'https://www.ejemplo.cl/');
  assert.equal(matchSiteForHost(sites, 'ejemplo.cl'), 'http://ejemplo.cl/');
  assert.equal(matchSiteForHost(sites, 'https://www.ejemplo.cl/blog/nota'), 'https://www.ejemplo.cl/blog/');
  assert.equal(matchSiteForHost(sites, 'blog.otro.com.ar'), 'sc-domain:otro.com.ar');
  assert.equal(matchSiteForHost(sites, 'tienda.cl'), null, 'ignora propiedades sin verificar');
  assert.equal(matchSiteForHost([...sites, { siteUrl: 'sc-domain:ejemplo.cl', permissionLevel: 'siteOwner' }], 'www.ejemplo.cl'), 'sc-domain:ejemplo.cl');
  assert.equal(matchSiteForHost(['https://ejemplo.cl/'], 'WWW.Ejemplo.cl'), 'https://ejemplo.cl/', 'con/sin www');
  assert.equal(matchSiteForHost(sites, 'nada.cl'), null);
  // La ruta distingue mayúsculas: solo el host se pasa a minúsculas
  const mayus = [{ siteUrl: 'https://x.com/Blog/', permissionLevel: 'siteOwner' }];
  assert.equal(matchSiteForHost(mayus, 'https://x.com/Blog/post'), 'https://x.com/Blog/');
  assert.equal(matchSiteForHost(mayus, 'HTTPS://X.COM/Blog/post'), 'https://x.com/Blog/');
  assert.equal(matchSiteForHost(mayus, 'https://x.com/blog/post'), null);
});

await test('mergeGoogleData', () => {
  const html = { internal: true, status: 200, contentType: 'text/html' };
  const rows = [
    { url: 'https://www.ejemplo.cl/', ...html },
    { url: 'https://www.ejemplo.cl/servicios', ...html },
    { url: 'https://www.ejemplo.cl/blog/', ...html },
    { url: 'https://www.ejemplo.cl/blog/?pagina=2', ...html },
    { url: 'https://www.ejemplo.cl/nueva', ...html },
    { url: 'https://www.ejemplo.cl/viejo', internal: true, status: 301 },
  ];
  const gscPages = [
    { url: 'https://WWW.ejemplo.cl/', clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
    { url: 'https://www.ejemplo.cl/servicios/', clicks: 4, impressions: 50, ctr: 0.08, position: 6 },
    { url: 'https://www.ejemplo.cl/servicios#precios', clicks: 1, impressions: 50, ctr: 0.02, position: 8 },
    { url: 'https://www.ejemplo.cl/blog', clicks: 2, impressions: 20, ctr: 0.1, position: 9 },
    { url: 'https://www.ejemplo.cl/escondida', clicks: 7, impressions: 70, ctr: 0.1, position: 4 },
    { url: 'https://www.ejemplo.cl/sin-clics', clicks: 0, impressions: 5, ctr: 0, position: 40 },
  ];
  gscPages.range = { startDate: '2026-09-01', endDate: '2026-09-28' };
  const gaPages = [
    { hostName: 'ejemplo.cl', pagePath: '/', views: 100, sessions: 80, engagementRate: 0.5, keyEvents: 3, avgEngagementTime: 20 },
    { hostName: 'ejemplo.cl', pagePath: '/servicios/', views: 50, sessions: 40, engagementRate: 0.75, keyEvents: 1, avgEngagementTime: 10 },
    { hostName: '(not set)', pagePath: '/blog', views: 10, sessions: 5, engagementRate: 0.2, keyEvents: 0, avgEngagementTime: 10 },
  ];
  const r = mergeGoogleData(rows, { gscPages, gaPages, startHost: 'www.ejemplo.cl', gaRange: { startDate: 'a', endDate: 'b' } });
  assert.deepEqual(rows[0].gsc, { clicks: 10, impressions: 100, ctr: 0.1, position: 3, range: gscPages.range });
  // /servicios/ y /servicios#precios se suman: 5 clics, 100 impresiones, posición ponderada 7
  assert.deepEqual(rows[1].gsc, { clicks: 5, impressions: 100, ctr: 0.05, position: 7, range: gscPages.range });
  assert.equal(rows[2].gsc.clicks, 2, 'barra final tolerante');
  assert.equal(rows[3].gsc.clicks, 0, 'con query no hereda la ruta en Search Console');
  assert.equal(rows[4].gsc.impressions, 0, 'rastreada sin datos: ceros');
  assert.equal(rows[5].gsc, undefined, 'redirecciones sin datos');
  assert.equal(r.matchedGsc, 3);
  assert.deepEqual(r.unmatchedGsc.map((x) => x.url), ['https://www.ejemplo.cl/escondida']);
  assert.equal(r.unmatchedGsc[0].clicks, 7);
  // GA4: host con/sin www, (not set) → startHost, query ignorada salvo que exista la ruta sola
  assert.deepEqual(rows[0].ga, { views: 100, sessions: 80, engagementRate: 0.5, keyEvents: 3, avgEngagementTime: 20, range: { startDate: 'a', endDate: 'b' } });
  assert.equal(rows[1].ga.views, 50);
  assert.equal(rows[2].ga.views, 10);
  assert.equal(rows[3].ga.views, 0, 'la variante con query no duplica los datos de /blog/');
  assert.equal(r.matchedGa, 3);
  // Sin la ruta sola en el rastreo, la variante con query sí recibe los datos
  const solo = [{ url: 'https://www.ejemplo.cl/blog?pagina=2', ...html }];
  mergeGoogleData(solo, { gaPages, startHost: 'www.ejemplo.cl' });
  assert.equal(solo[0].ga.views, 10);
});

await test('mergeGoogleData: alcance de unmatchedGsc y sin duplicar redirecciones', () => {
  const html = { internal: true, status: 200, contentType: 'text/html' };
  const rows = [
    { url: 'https://www.x.com/p', ...html },
    { url: 'https://x.com/a', internal: true, status: 301 },
    { url: 'https://x.com/a/', ...html },
    { url: 'https://x.com/', internal: true, status: 301 },
    { url: 'https://www.x.com/', ...html },
    { url: 'https://www.x.com/d', ...html },
    { url: 'https://www.x.com/d/', ...html },
    { url: 'https://cdn.otro.com/app.js', internal: false, status: 200, contentType: 'text/javascript' },
  ];
  const gscPages = [
    { url: 'https://shop.x.com/cart', clicks: 900, impressions: 5000, position: 2 }, // otro subdominio (sc-domain)
    { url: 'https://x.com/p', clicks: 7, impressions: 70, position: 3 }, // la misma página sin www
    { url: 'http://www.x.com/p', clicks: 5, impressions: 50, position: 3 }, // la misma página con http
    { url: 'https://x.com/a', clicks: 100, impressions: 1000, position: 2 },
    { url: 'https://www.x.com/d/', clicks: 9, impressions: 90, position: 4 },
    { url: 'https://x.com/otra', clicks: 3, impressions: 30, position: 8 }, // sí falta en el rastreo
    { url: 'https://cdn.otro.com/pagina', clicks: 4, impressions: 40, position: 5 }, // host externo
  ];
  const gaPages = [{ hostName: 'x.com', pagePath: '/', views: 500, sessions: 400, engagementRate: 0.5, keyEvents: 2, avgEngagementTime: 30 }];
  const r = mergeGoogleData(rows, { gscPages, gaPages, startHost: 'www.x.com' });
  assert.deepEqual(r.unmatchedGsc.map((x) => x.url), ['https://x.com/otra']);
  // Redirección y destino comparten clave: los datos van solo a la página 200
  assert.equal(rows[2].gsc.clicks, 100);
  assert.equal(rows[1].gsc, undefined);
  // /d y /d/ son 200: gana la que coincide exacta; la otra queda sin datos (no con ceros)
  assert.equal(rows[6].gsc.clicks, 9);
  assert.equal(rows[5].gsc, undefined);
  assert.equal(rows[0].gsc.impressions, 0, 'sin coincidencia exacta: ceros');
  assert.equal(r.matchedGsc, 2);
  // GA: https://x.com/ (301, host exacto) y https://www.x.com/ (200, con www) caen en el mismo dato
  assert.equal(rows[4].ga.views, 500);
  assert.equal(rows[3].ga, undefined);
  assert.equal(r.matchedGa, 1);
  // Una redirección que sí tiene tráfico propio y no comparte clave conserva sus datos
  const red = [{ url: 'https://www.x.com/viejo', internal: true, status: 301 }];
  const r2 = mergeGoogleData(red, { gscPages: [{ url: 'https://www.x.com/viejo', clicks: 2, impressions: 20, position: 5 }], startHost: 'www.x.com' });
  assert.equal(red[0].gsc.clicks, 2);
  assert.equal(r2.matchedGsc, 1);
  assert.deepEqual(r2.unmatchedGsc, []);
});

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} pruebas OK`);
