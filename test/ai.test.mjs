// Pruebas de lib/ai.js con servidores falsos en 127.0.0.1 que imitan la API
// de Anthropic (Messages y Models) y la de OpenAI (chat/completions y models).
// Uso: node test/ai.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiClient, PROVIDERS, schemas } = require('../lib/ai.js');

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    failed++;
    console.error('  ✗', name, '\n   ', err.stack || err.message);
    process.exitCode = 1;
  }
};

// ---- Servidor falso genérico: guarda cada solicitud y responde con `handler`
function fakeServer() {
  const state = { requests: [], handler: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const entry = { method: req.method, path: req.url, headers: req.headers, body };
      state.requests.push(entry);
      const out = state.handler ? state.handler(entry) : { status: 500, body: { error: 'sin handler' } };
      res.writeHead(out.status || 200, { 'content-type': 'application/json', ...(out.headers || {}) });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      state.base = `http://127.0.0.1:${server.address().port}`;
      state.close = () => new Promise((r) => server.close(r));
      state.reset = (handler) => {
        state.requests = [];
        state.handler = handler;
      };
      resolve(state);
    });
  });
}

function memoryStore() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => (v === null || v === undefined || v === '' ? m.delete(k) : m.set(k, String(v))),
    has: (k) => m.has(k),
    delete: (k) => m.delete(k),
    _map: m,
  };
}

// ---- Respuestas de ejemplo

const ANALISIS = {
  resumen: 'La página carga bien, pero el title no dice qué vendes.',
  prioridades: [
    { titulo: 'Reescribe el title', detalle: 'Pon la palabra clave al inicio.', impacto: 'Alto' },
    { titulo: 'Agrega una llamada a la acción', detalle: 'Suma un botón visible arriba.', impacto: 'medio' },
    { titulo: 'Comprime imágenes', detalle: 'El LCP es de 4,1 s.', impacto: 'bajo' },
  ],
  titulos: ['Zapatillas de running | Tienda Ejemplo', 'Zapatillas para correr con envío gratis', 'Running: zapatillas y ropa'],
  metaDescripciones: ['Compra zapatillas de running con envío gratis. Elige tu talla y recibe en 48 horas.', 'Encuentra tu zapatilla ideal para correr.'],
  h1: 'Zapatillas de running',
  contenido: ['Agrega una guía de tallas.'],
  conversion: ['Muestra el teléfono en la cabecera.'],
  datosEstructurados: ['Product con price y availability.'],
};

const RESUMEN = {
  resumen: 'El sitio tiene 12 páginas sin title. Corrige eso primero.',
  hallazgos: [{ titulo: 'Títulos ausentes', detalle: '12 de 80 páginas no tienen title.', impacto: 'ALTO' }],
  plan: [
    { horizonte: 'Este trimestre', acciones: [{ titulo: 'Migra a HTTPS', detalle: 'Redirige todo con 301.' }] },
    { horizonte: 'esta semana', acciones: [{ titulo: 'Agrega los títulos', detalle: 'Empieza por las 12 páginas.' }] },
  ],
};

const anthropicMessage = (content, extra = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: extra.model || 'claude-opus-5-5',
  content,
  stop_reason: extra.stop_reason || 'end_turn',
  stop_sequence: null,
  stop_details: extra.stop_details || null,
  usage: { input_tokens: 10, output_tokens: 20 },
});

const anthropicError = (status, type, message) => ({ status, body: { type: 'error', error: { type, message } }, headers: { 'retry-after': '0' } });

const chatCompletion = (content, extra = {}) => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1760000000,
  model: extra.model || 'gpt-test',
  choices: [{ index: 0, message: { role: 'assistant', content, refusal: extra.refusal || null }, finish_reason: extra.finish_reason || 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const openaiError = (status, message, type = 'invalid_request_error') => ({ status, body: { error: { message, type, code: null, param: null } }, headers: { 'retry-after': '0' } });

const PAGE_CTX = {
  url: 'https://tienda.test/running',
  title: 'Inicio',
  metaDesc: '',
  h1: 'Bienvenido',
  h2: ['Ofertas', 'Contacto'],
  wordCount: 320,
  textoExtracto: 'x'.repeat(10000),
  issues: [{ titulo: 'Title demasiado corto', severidad: 'alto' }],
  gsc: { clicks: 10, impressions: 900, ctr: 0.011, position: 14.2, queries: [{ query: 'zapatillas running', clicks: 4, impressions: 300, ctr: 0.013, position: 11 }] },
  lighthouse: { mobile: { scores: { performance: 52, accessibility: 90, bestPractices: 95, seo: 92 }, metrics: { lcp: 4100, cls: 0.02 }, opportunities: [{ id: 'img', title: 'Comprime imágenes', savingsMs: 900 }] } },
  idioma: 'es',
};

const ANTHROPIC_KEY = 'sk-ant-test-0123456789abcdef';
const OPENAI_KEY = 'sk-test-openai-abcdef0123456789';

const anth = await fakeServer();
const oai = await fakeServer();
const logs = [];
const store = memoryStore();
const ai = createAiClient({ store, log: (m) => logs.push(String(m)), maxRetries: 0, timeoutMs: 5000 });

const cfgA = { provider: 'anthropic', model: 'claude-opus-5-5', baseURL: anth.base };
const cfgO = { provider: 'openai', model: 'gpt-test', baseURL: oai.base + '/v1' };
const cfgC = { provider: 'compatible', model: 'llama-test', baseURL: oai.base + '/v1' };

console.log('Octos · pruebas de IA');

await test('PROVIDERS trae los tres proveedores y los ajustes predefinidos', () => {
  assert.deepEqual(Object.keys(PROVIDERS), ['anthropic', 'openai', 'compatible']);
  assert.equal(PROVIDERS.anthropic.defaultModel, 'claude-opus-5-5');
  const ids = PROVIDERS.compatible.presets.map((p) => p.id);
  for (const id of ['gemini', 'groq', 'mistral', 'openrouter', 'deepseek', 'ollama']) assert.ok(ids.includes(id), id);
  const gemini = PROVIDERS.compatible.presets.find((p) => p.id === 'gemini');
  assert.equal(gemini.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai/');
  const ollama = PROVIDERS.compatible.presets.find((p) => p.id === 'ollama');
  assert.equal(ollama.baseURL, 'http://127.0.0.1:11434/v1');
  assert.equal(ollama.needsKey, false);
});

await test('setKey y hasKey usan el almacén inyectado', () => {
  assert.equal(ai.hasKey('anthropic'), false);
  ai.setKey('anthropic', '  ' + ANTHROPIC_KEY + '  ');
  ai.setKey('openai', OPENAI_KEY);
  assert.equal(store.get('ai.key.anthropic'), ANTHROPIC_KEY);
  assert.equal(store.get('ai.key.openai'), OPENAI_KEY);
  assert.equal(ai.hasKey('anthropic'), true);
  ai.setKey('compatible', 'temporal');
  ai.setKey('compatible', '');
  assert.equal(ai.hasKey('compatible'), false);
  assert.throws(() => ai.setKey('otro', 'x'), /desconocido/);
});

await test('sin clave: error en español antes de llamar a la red', async () => {
  const sinClave = createAiClient({ store: memoryStore(), maxRetries: 0 });
  anth.reset(() => ({ body: {} }));
  await assert.rejects(sinClave.analyzePage(cfgA, PAGE_CTX), (e) => e.code === 'auth' && /Agrega tu clave de Claude/.test(e.message));
  assert.equal(anth.requests.length, 0);
});

await test('Claude: analyzePage manda cabeceras, respaldo y output_config.format, y valida el PageAnalysis', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(ANALISIS) }]) }));
  const res = await ai.analyzePage(cfgA, PAGE_CTX);
  assert.equal(anth.requests.length, 1);
  const req = anth.requests[0];
  assert.equal(req.method, 'POST');
  assert.match(req.path, /^\/v1\/messages(\?|$)/);
  assert.equal(req.headers['x-api-key'], ANTHROPIC_KEY);
  assert.ok(req.headers['anthropic-version'], 'anthropic-version');
  assert.ok(String(req.headers['anthropic-beta']).split(',').includes('server-side-fallback-2026-07-01'), 'beta del respaldo');
  assert.equal(req.headers.authorization, undefined, 'sin Authorization en Anthropic');
  const b = req.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.fallbacks, 'default');
  assert.equal(b.max_tokens, 16000);
  assert.equal(b.stream, undefined);
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.equal(b.output_config.format.schema.type, 'object');
  assert.ok(b.output_config.format.schema.required.includes('prioridades'));
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'output_format']) assert.equal(b[k], undefined, k);
  assert.ok(!JSON.stringify(b).includes('budget_tokens'));
  // El extracto se recorta a 6000 caracteres
  const user = b.messages[0].content;
  assert.ok(user.includes('x'.repeat(6000)) && !user.includes('x'.repeat(6001)), 'extracto ≤ 6000');
  assert.ok(user.includes('zapatillas running'), 'incluye Search Console');
  assert.ok(/segunda persona/.test(b.system), 'voz de marca en el system');
  // Resultado validado y normalizado
  schemas.PageAnalysis.parse(res);
  assert.equal(res.prioridades[0].impacto, 'alto');
  assert.equal(res.h1, 'Zapatillas de running');
});

await test('Claude: modelo sin respaldo no manda la beta ni fallbacks', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify(ANALISIS) }], { model: 'claude-haiku-5-5' }) }));
  await ai.analyzePage({ ...cfgA, model: 'claude-haiku-5-5' }, PAGE_CTX);
  const req = anth.requests[0];
  assert.ok(!String(req.headers['anthropic-beta'] || '').includes('server-side-fallback'));
  assert.equal(req.body.fallbacks, undefined);
  assert.equal(req.body.output_config.format.type, 'json_schema');
});

await test('Claude: sin modelo usa claude-opus-5-5', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify(ANALISIS) }]) }));
  await ai.analyzePage({ provider: 'anthropic', baseURL: anth.base }, PAGE_CTX);
  assert.equal(anth.requests[0].body.model, 'claude-opus-5-5');
});

await test('Claude: tras un bloque fallback vale solo el texto del modelo de respaldo', async () => {
  anth.reset(() => ({
    body: anthropicMessage([
      { type: 'text', text: '{"resumen": "parcial' },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
      { type: 'text', text: JSON.stringify(ANALISIS) },
    ], { model: 'claude-opus-4-8' }),
  }));
  const res = await ai.analyzePage(cfgA, PAGE_CTX);
  assert.equal(res.resumen, ANALISIS.resumen);
});

await test('Claude: stop_reason refusal da un error claro en español', async () => {
  anth.reset(() => ({ body: anthropicMessage([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }) }));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), (e) => e.code === 'refusal' && /Claude no quiso responder/.test(e.message) && /cyber/.test(e.message));
});

await test('Claude: 401 → «La clave de Anthropic no es válida» sin filtrar la clave', async () => {
  anth.reset(() => anthropicError(401, 'authentication_error', 'invalid x-api-key'));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), (e) => e.code === 'auth' && /La clave de Anthropic no es válida/.test(e.message) && !e.message.includes(ANTHROPIC_KEY));
});

await test('Claude: 429 → mensaje de límite', async () => {
  anth.reset(() => anthropicError(429, 'rate_limit_error', 'Number of requests has exceeded your rate limit'));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), (e) => e.code === 'quota' && /limitó tus solicitudes/.test(e.message));
  assert.equal(anth.requests.length, 1, 'con maxRetries 0 no reintenta');
});

await test('Claude: 404 de modelo → pide elegir otro', async () => {
  anth.reset(() => anthropicError(404, 'not_found_error', 'model: claude-x'));
  await assert.rejects(ai.analyzePage({ ...cfgA, model: 'claude-x' }, PAGE_CTX), (e) => e.code === 'config' && /claude-x/.test(e.message));
});

await test('Claude: JSON fuera del esquema → error de formato', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: '{"resumen": "solo esto"}' }]) }));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), (e) => e.code === 'format');
});

await test('Claude: listModels usa GET /v1/models', async () => {
  anth.reset((r) => (r.method === 'GET'
    ? { body: { data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' }, { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-haiku-5-5' } }
    : { status: 405, body: {} }));
  const models = await ai.listModels(cfgA);
  assert.match(anth.requests[0].path, /^\/v1\/models/);
  assert.equal(anth.requests[0].headers['x-api-key'], ANTHROPIC_KEY);
  assert.deepEqual(models, [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }]);
});

await test('Claude: test() devuelve ok, modelo y latencia', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: 'listo' }]) }));
  const r = await ai.test(cfgA);
  assert.equal(r.ok, true);
  assert.equal(r.model, 'claude-opus-5-5');
  assert.ok(Number.isFinite(r.latencyMs));
  assert.equal(anth.requests[0].body.output_config, undefined);
});

await test('Claude: executiveSummary ordena el plan en los tres horizontes', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify(RESUMEN) }]) }));
  const r = await ai.executiveSummary(cfgA, { sitio: 'tienda.test', paginas: 80, salud: 61, problemas: [{ titulo: 'Sin title', severidad: 'critico', urls: 12 }] });
  schemas.ExecutiveSummary.parse(r);
  assert.deepEqual(r.plan.map((g) => g.horizonte), ['Esta semana', 'Este mes', 'Este trimestre']);
  assert.equal(r.plan[0].acciones[0].titulo, 'Agrega los títulos');
  assert.equal(r.plan[1].acciones.length, 0);
  assert.equal(r.hallazgos[0].impacto, 'alto');
  assert.ok(anth.requests[0].body.messages[0].content.includes('tienda.test'));
});

await test('Claude: ask devuelve texto', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: 'Revisa las 12 páginas sin title.' }]) }));
  const t = await ai.ask(cfgA, '¿Qué arreglo primero?', { sitio: 'tienda.test' });
  assert.equal(t, 'Revisa las 12 páginas sin title.');
  const b = anth.requests[0].body;
  assert.equal(b.output_config, undefined);
  assert.equal(b.fallbacks, 'default');
  assert.ok(b.messages[0].content.includes('¿Qué arreglo primero?'));
});

await test('OpenAI: analyzePage manda Bearer y response_format json_schema estricto', async () => {
  oai.reset(() => ({ body: chatCompletion(JSON.stringify(ANALISIS)) }));
  const res = await ai.analyzePage(cfgO, PAGE_CTX);
  const req = oai.requests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/v1/chat/completions');
  assert.equal(req.headers.authorization, `Bearer ${OPENAI_KEY}`);
  assert.equal(req.headers['openai-organization'], undefined);
  const b = req.body;
  assert.equal(b.response_format.type, 'json_schema');
  assert.equal(b.response_format.json_schema.strict, true);
  assert.equal(b.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(b.messages[0].role, 'system');
  for (const k of ['temperature', 'top_p']) assert.equal(b[k], undefined, k);
  schemas.PageAnalysis.parse(res);
});

await test('Compatible: si json_schema da 400 reintenta con json_object y recuerda el modo', async () => {
  oai.reset((r) => (r.body.response_format && r.body.response_format.type === 'json_schema'
    ? openaiError(400, 'response_format json_schema is not supported')
    : { body: chatCompletion(JSON.stringify(ANALISIS), { model: 'llama-test' }) }));
  const res = await ai.analyzePage(cfgC, PAGE_CTX);
  schemas.PageAnalysis.parse(res);
  assert.deepEqual(oai.requests.map((r) => r.body.response_format && r.body.response_format.type), ['json_schema', 'json_object']);
  assert.match(oai.requests[1].body.messages[0].content, /objeto JSON/);
  // Segunda llamada: va directo a json_object
  oai.requests = [];
  await ai.analyzePage(cfgC, PAGE_CTX);
  assert.deepEqual(oai.requests.map((r) => r.body.response_format.type), ['json_object']);
});

await test('Compatible: si tampoco acepta json_object pide JSON en texto y lo valida', async () => {
  const cfg = { ...cfgC, model: 'otro-modelo' };
  oai.reset((r) => (r.body.response_format
    ? openaiError(400, 'unsupported response_format')
    : { body: chatCompletion('Aquí va:\n```json\n' + JSON.stringify(ANALISIS) + '\n```') }));
  const res = await ai.analyzePage(cfg, PAGE_CTX);
  schemas.PageAnalysis.parse(res);
  assert.equal(oai.requests.length, 3);
  assert.equal(oai.requests[2].body.response_format, undefined);
});

await test('Compatible sin clave (como Ollama) funciona', async () => {
  oai.reset(() => ({ body: chatCompletion('Bien.') }));
  const t = await ai.ask(cfgC, 'Hola', {});
  assert.equal(t, 'Bien.');
  assert.ok(String(oai.requests[0].headers.authorization).startsWith('Bearer '));
});

await test('Compatible: la baseURL puede venir del almacén', async () => {
  const s = memoryStore();
  const c = createAiClient({ store: s, maxRetries: 0 });
  c.setBaseURL(oai.base + '/v1/');
  oai.reset(() => ({ body: chatCompletion('ok') }));
  assert.equal(await c.ask({ provider: 'compatible', model: 'm' }, 'Hola', {}), 'ok');
  assert.equal(s.get('ai.baseURL'), oai.base + '/v1');
  await assert.rejects(createAiClient({ store: memoryStore() }).ask({ provider: 'compatible', model: 'm' }, 'Hola', {}), (e) => e.code === 'config');
});

await test('OpenAI: refusal, 401 y 429 dan errores en español', async () => {
  oai.reset(() => ({ body: chatCompletion(null, { refusal: 'I cannot help with that.' }) }));
  await assert.rejects(ai.analyzePage(cfgO, PAGE_CTX), (e) => e.code === 'refusal' && /no quiso responder/.test(e.message));
  oai.reset(() => openaiError(401, `Incorrect API key provided: ${OPENAI_KEY}`, 'invalid_api_key'));
  await assert.rejects(ai.analyzePage(cfgO, PAGE_CTX), (e) => e.code === 'auth' && /La clave de OpenAI no es válida/.test(e.message) && !e.message.includes(OPENAI_KEY));
  assert.equal(oai.requests.length, 1, '401 no pasa a json_object');
  oai.reset(() => openaiError(429, 'Rate limit reached', 'rate_limit_exceeded'));
  await assert.rejects(ai.analyzePage(cfgO, PAGE_CTX), (e) => e.code === 'quota' && /limitó tus solicitudes/.test(e.message));
  oai.reset(() => openaiError(401, 'bad key'));
  await assert.rejects(ai.ask(cfgC, 'Hola', {}), (e) => e.code === 'auth' && /rechazó la clave/.test(e.message));
});

await test('OpenAI: finish_reason length → respuesta incompleta', async () => {
  oai.reset(() => ({ body: chatCompletion('{"resumen": "a', { finish_reason: 'length' }) }));
  await assert.rejects(ai.analyzePage(cfgO, PAGE_CTX), (e) => e.code === 'truncated');
});

await test('OpenAI: listModels usa GET /v1/models y deja fuera embeddings', async () => {
  oai.reset(() => ({ body: { object: 'list', data: [{ id: 'gpt-test', object: 'model', owned_by: 'x' }, { id: 'text-embedding-3-small', object: 'model', owned_by: 'x' }, { id: 'a-model', object: 'model', owned_by: 'x' }] } }));
  const models = await ai.listModels(cfgO);
  assert.equal(oai.requests[0].method, 'GET');
  assert.equal(oai.requests[0].path, '/v1/models');
  assert.equal(oai.requests[0].headers.authorization, `Bearer ${OPENAI_KEY}`);
  assert.deepEqual(models.map((m) => m.id), ['a-model', 'gpt-test']);
  const compat = await ai.listModels(cfgC);
  assert.equal(compat.length, 3, 'en compatibles no se filtra');
});

await test('suggestMeta procesa por lotes de 20 y respeta el orden', async () => {
  const pages = Array.from({ length: 25 }, (_, i) => ({ url: `https://tienda.test/p${i}`, title: `Página ${i}`, metaDesc: '', h1: '', idioma: i % 2 ? 'en' : 'es' }));
  oai.reset((r) => {
    const datos = JSON.parse(r.body.messages[1].content.split('\n').slice(1).join('\n'));
    return { body: chatCompletion(JSON.stringify({ sugerencias: datos.map((d) => ({ url: d.url, title: 'T ' + d.url, description: 'D', h1: 'H' })).reverse() })) };
  });
  const out = await ai.suggestMeta(cfgO, pages);
  assert.equal(oai.requests.length, 2);
  assert.equal(out.length, 25);
  assert.deepEqual(out.map((o) => o.url), pages.map((p) => p.url));
  assert.match(oai.requests[0].body.messages[0].content, /60 caracteres/);
});

await test('resumen vacío: error de formato en español con code, no ZodError', async () => {
  const esFormato = (e) => e.code === 'format' && /no tiene la forma esperada/.test(e.message) && e.name !== 'ZodError';
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify({ ...ANALISIS, resumen: '' }) }]) }));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), esFormato);
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify({ ...ANALISIS, resumen: '   ' }) }]) }));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), esFormato);
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify({ resumen: '', hallazgos: [], plan: [] }) }]) }));
  await assert.rejects(ai.executiveSummary(cfgA, { sitio: 'tienda.test' }), esFormato);
  oai.reset(() => ({ body: chatCompletion(JSON.stringify({ ...ANALISIS, resumen: '' })) }));
  await assert.rejects(ai.analyzePage(cfgO, PAGE_CTX), esFormato);
});

await test('Claude: model_context_window_exceeded → respuesta incompleta en vez de texto cortado', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: 'Respuesta parcial' }], { stop_reason: 'model_context_window_exceeded' }) }));
  await assert.rejects(ai.ask(cfgA, '¿Qué arreglo primero?', { sitio: 'tienda.test' }), (e) => e.code === 'truncated' && /Reduce el contexto/.test(e.message));
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: '{"resumen": "a' }], { stop_reason: 'model_context_window_exceeded' }) }));
  await assert.rejects(ai.analyzePage(cfgA, PAGE_CTX), (e) => e.code === 'truncated');
  await assert.rejects(ai.executiveSummary(cfgA, { sitio: 'tienda.test' }), (e) => e.code === 'truncated');
});

await test('analyzePage ignora elementos nulos o inválidos en issues', async () => {
  anth.reset(() => ({ body: anthropicMessage([{ type: 'text', text: JSON.stringify(ANALISIS) }]) }));
  const res = await ai.analyzePage(cfgA, { ...PAGE_CTX, issues: [null, undefined, 'texto', { titulo: 'Sin H1', severidad: 'medio' }] });
  schemas.PageAnalysis.parse(res);
  const user = anth.requests[0].body.messages[0].content;
  const datos = JSON.parse(user.split('\n')[1]);
  assert.deepEqual(datos.problemasDetectados, [{ titulo: 'Sin H1', severidad: 'medio' }]);
  anth.requests = [];
  await ai.analyzePage(cfgA, { ...PAGE_CTX, issues: { no: 'es arreglo' } });
  assert.deepEqual(JSON.parse(anth.requests[0].body.messages[0].content.split('\n')[1]).problemasDetectados, []);
});

await test('los registros nunca incluyen las claves', () => {
  assert.ok(logs.length > 0);
  for (const l of logs) {
    assert.ok(!l.includes(ANTHROPIC_KEY) && !l.includes(OPENAI_KEY), l);
  }
});

await anth.close();
await oai.close();
console.log(`\n${passed} pruebas pasaron${failed ? `, ${failed} fallaron` : ''}`);
