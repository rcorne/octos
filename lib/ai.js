// Análisis con IA usando la clave propia del usuario («trae tu propia clave»).
// Proveedores: Claude (SDK oficial @anthropic-ai/sdk), OpenAI y cualquier
// endpoint compatible con la API de OpenAI (SDK oficial openai con baseURL).
// Corre solo en el proceso principal: las claves viven en el almacén inyectado
// y nunca se envían a la interfaz ni se escriben en el registro.
const z = require('zod');

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
// Modelos que admiten el respaldo del servidor `fallbacks: "default"`
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 16000; // sin streaming: dentro del tiempo de espera del SDK
const EXCERPT_MAX = 6000;
const CONTEXT_MAX = 120000; // caracteres del contexto del rastreo que se envían
const META_BATCH = 20;
const HORIZONTES = ['Esta semana', 'Este mes', 'Este trimestre'];
const IMPACTOS = ['alto', 'medio', 'bajo'];
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    needsKey: true,
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    defaultModel: null, // se elige de la lista de modelos
    baseURL: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  compatible: {
    id: 'compatible',
    label: 'Compatible con OpenAI',
    needsKey: false, // depende del servicio: Ollama local no la pide
    defaultModel: null,
    presets: [
      { id: 'gemini', label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
      { id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
      { id: 'mistral', label: 'Mistral', baseURL: 'https://api.mistral.ai/v1', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
      { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
      { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
      { id: 'ollama', label: 'Ollama (local)', baseURL: 'http://127.0.0.1:11434/v1', needsKey: false },
    ],
  },
};

// ---- Esquemas (zod 4). Lo que se pide al modelo usa textos libres en los
// campos de valores cerrados; después se normaliza y se valida el resultado final.

const prioridadOut = z.object({
  titulo: z.string(),
  detalle: z.string(),
  impacto: z.string().describe('alto, medio o bajo'),
});

const PageAnalysisOut = z.object({
  resumen: z.string(),
  prioridades: z.array(prioridadOut),
  titulos: z.array(z.string()),
  metaDescripciones: z.array(z.string()),
  h1: z.string(),
  contenido: z.array(z.string()),
  conversion: z.array(z.string()),
  datosEstructurados: z.array(z.string()),
});

const PageAnalysis = z.object({
  resumen: z.string().min(1),
  prioridades: z.array(z.object({ titulo: z.string(), detalle: z.string(), impacto: z.enum(IMPACTOS) })),
  titulos: z.array(z.string()),
  metaDescripciones: z.array(z.string()),
  h1: z.string(),
  contenido: z.array(z.string()),
  conversion: z.array(z.string()),
  datosEstructurados: z.array(z.string()),
});

const MetaOut = z.object({
  sugerencias: z.array(z.object({ url: z.string(), title: z.string(), description: z.string(), h1: z.string() })),
});

const accionOut = z.object({ titulo: z.string(), detalle: z.string() });
const SummaryOut = z.object({
  resumen: z.string(),
  hallazgos: z.array(prioridadOut),
  plan: z.array(z.object({ horizonte: z.string().describe('Esta semana, Este mes o Este trimestre'), acciones: z.array(accionOut) })),
});

const ExecutiveSummary = z.object({
  resumen: z.string().min(1),
  hallazgos: z.array(z.object({ titulo: z.string(), detalle: z.string(), impacto: z.enum(IMPACTOS) })),
  plan: z.array(z.object({ horizonte: z.enum(HORIZONTES), acciones: z.array(accionOut) })),
});

// ---- Voz y prompts

const VOZ = [
  'Escribe en español neutro y en segunda persona (tú).',
  'Usa frases cortas. Empieza cada recomendación con un verbo concreto: «Agrega», «Corrige», «Reescribe».',
  'No uses signos de exclamación ni emoji. No uses relleno ni frases de cortesía.',
  'Basa cada afirmación en los datos entregados. Si falta un dato, dilo en vez de inventarlo.',
].join(' ');

const SYSTEM_PAGE = [
  'Eres consultor SEO senior y especialista en conversión. Analizas una sola página web a partir de los datos de un rastreo.',
  VOZ,
  'Devuelve JSON con estas claves:',
  '- resumen: dos o tres frases sobre el estado de la página y lo más urgente.',
  '- prioridades: de 3 a 6 acciones ordenadas por impacto; impacto es «alto», «medio» o «bajo».',
  '- titulos: 3 propuestas de etiqueta title de hasta 60 caracteres.',
  '- metaDescripciones: 2 propuestas de meta description de hasta 155 caracteres.',
  '- h1: una propuesta de H1.',
  '- contenido: mejoras concretas al contenido (vacíos, intención de búsqueda, enlaces internos).',
  '- conversion: mejoras para que más visitas tomen acción (llamadas a la acción, formularios, contacto).',
  '- datosEstructurados: tipos de schema.org que convienen y qué campos completar.',
  'Escribe titulos, metaDescripciones y h1 en el idioma de la página. Escribe el resto en español.',
].join('\n');

const SYSTEM_META = [
  'Eres redactor SEO. Propones etiquetas title, meta descriptions y H1 para varias páginas de un sitio.',
  VOZ,
  'Reglas: title de hasta 60 caracteres aprox., con la palabra clave principal al inicio y sin repetir la marca dos veces.',
  'Meta description de hasta 155 caracteres, con un beneficio claro y una invitación a la acción.',
  'H1 claro y distinto del title. Escribe cada propuesta en el idioma de su página.',
  'Devuelve JSON con la clave sugerencias: una entrada por página con url (idéntica a la recibida), title, description y h1.',
].join('\n');

const SYSTEM_SUMMARY = [
  'Eres director de SEO y preparas el resumen ejecutivo de una auditoría para presentarlo a la gerencia.',
  VOZ,
  'Devuelve JSON con estas claves:',
  '- resumen: un párrafo de 3 a 5 frases con el estado del sitio, el riesgo principal y la oportunidad principal.',
  '- hallazgos: de 4 a 7 hallazgos con titulo, detalle (con cifras del rastreo) e impacto «alto», «medio» o «bajo».',
  '- plan: exactamente tres horizontes, en este orden: «Esta semana», «Este mes» y «Este trimestre», cada uno con 2 a 5 acciones (titulo y detalle).',
  'Pon en «Esta semana» lo crítico y fácil de arreglar; en «Este trimestre», los proyectos de más esfuerzo.',
].join('\n');

const SYSTEM_ASK = [
  'Eres consultor SEO y respondes preguntas sobre un rastreo de un sitio web.',
  VOZ,
  'Responde solo con los datos del rastreo entregado. Cita URLs y cifras cuando ayuden.',
  'Si los datos no alcanzan para responder, dilo y sugiere qué revisar. Responde en texto simple, sin tablas.',
].join('\n');

// ---- Utilidades

function aiError(message, code, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

function normImpacto(v) {
  const s = String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (s.startsWith('alt') || s === 'high') return 'alto';
  if (s.startsWith('baj') || s === 'low') return 'bajo';
  return 'medio';
}

function normHorizonte(v) {
  const s = String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.includes('semana')) return 'Esta semana';
  if (s.includes('trimestre')) return 'Este trimestre';
  if (s.includes('mes')) return 'Este mes';
  return null;
}

function normalizeBaseURL(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw aiError('La URL del servicio no es válida. Escríbela completa, por ejemplo https://api.groq.com/openai/v1.', 'config');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw aiError('La URL del servicio debe empezar con http:// o https://.', 'config');
  }
  return u.toString().replace(/\/+$/, '');
}

function compatibleLabel(baseURL) {
  if (!baseURL) return 'El servicio compatible';
  const norm = baseURL.replace(/\/+$/, '');
  const preset = PROVIDERS.compatible.presets.find((p) => p.baseURL.replace(/\/+$/, '') === norm);
  if (preset) return preset.label;
  try {
    return new URL(baseURL).host;
  } catch {
    return 'El servicio compatible';
  }
}

// Saca el JSON de una respuesta en texto (con o sin bloque ```json)
function extractJson(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(body.slice(a, b + 1));
    throw new SyntaxError('sin JSON');
  }
}

function compactJson(value, max) {
  const s = JSON.stringify(value ?? {}, null, 0);
  return s.length > max ? s.slice(0, max) + ' …(recortado)' : s;
}

// Resume una fila de Lighthouse para no mandar el informe entero
function lighthouseBrief(lh) {
  if (!lh) return undefined;
  const one = (r) => r && {
    scores: r.scores,
    metrics: r.metrics,
    field: r.field || undefined,
    opportunities: (r.opportunities || []).slice(0, 5).map((o) => ({ title: o.title, savingsMs: o.savingsMs })),
  };
  return { mobile: one(lh.mobile), desktop: one(lh.desktop) };
}

function gscBrief(gsc) {
  if (!gsc) return undefined;
  const { clicks, impressions, ctr, position, range } = gsc;
  return { clicks, impressions, ctr, position, range, queries: (gsc.queries || []).slice(0, 15) };
}

// ---- Cliente

function createAiClient({ store, log = () => {}, maxRetries = 2, timeoutMs } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new Error('createAiClient necesita un almacén con get y set');
  }
  // Modo de salida JSON que funcionó por endpoint y modelo (json_schema → json_object → texto)
  const jsonModeCache = new Map();
  let anthropicSdk = null;
  let openaiSdk = null;

  const loadAnthropic = () => {
    if (!anthropicSdk) {
      anthropicSdk = {
        Anthropic: require('@anthropic-ai/sdk'),
        zodOutputFormat: require('@anthropic-ai/sdk/helpers/zod').zodOutputFormat,
        betaZodOutputFormat: require('@anthropic-ai/sdk/helpers/beta/zod').betaZodOutputFormat,
      };
    }
    return anthropicSdk;
  };
  const loadOpenAI = () => {
    if (!openaiSdk) {
      openaiSdk = {
        OpenAI: require('openai'),
        zodResponseFormat: require('openai/helpers/zod').zodResponseFormat,
      };
    }
    return openaiSdk;
  };

  function checkProvider(provider) {
    if (!PROVIDERS[provider]) throw aiError(`Proveedor de IA desconocido: ${provider}.`, 'config');
  }

  function setKey(provider, apiKey) {
    checkProvider(provider);
    const key = apiKey == null ? '' : String(apiKey).trim();
    store.set(`ai.key.${provider}`, key || null);
    log(`ia: clave de ${provider} ${key ? 'guardada' : 'borrada'}`);
  }

  function hasKey(provider) {
    checkProvider(provider);
    const k = `ai.key.${provider}`;
    return typeof store.has === 'function' ? store.has(k) : !!store.get(k);
  }

  function setBaseURL(url) {
    const norm = url ? normalizeBaseURL(url) : null;
    store.set('ai.baseURL', norm);
  }

  function resolve(cfg) {
    if (!cfg || !cfg.provider) throw aiError('Elige un proveedor de IA en Ajustes.', 'config');
    checkProvider(cfg.provider);
    const provider = cfg.provider;
    const apiKey = store.get(`ai.key.${provider}`) || null;
    let baseURL = null;
    if (provider === 'compatible') {
      baseURL = normalizeBaseURL(cfg.baseURL || store.get('ai.baseURL'));
      if (!baseURL) throw aiError('Escribe la URL del servicio compatible en Ajustes.', 'config');
    } else if (cfg.baseURL) {
      baseURL = normalizeBaseURL(cfg.baseURL); // proxys propios y pruebas
    }
    if (PROVIDERS[provider].needsKey && !apiKey) {
      throw aiError(`Agrega tu clave de ${PROVIDERS[provider].label} en Ajustes.`, 'auth');
    }
    const model = cfg.model || PROVIDERS[provider].defaultModel;
    const label = provider === 'compatible' ? compatibleLabel(baseURL) : provider === 'openai' ? 'OpenAI' : 'Anthropic';
    const effort = EFFORTS.has(cfg.effort) ? cfg.effort : undefined;
    return { provider, apiKey, baseURL, model, label, effort };
  }

  const requireModel = (r) => {
    if (!r.model) throw aiError('Elige un modelo en Ajustes.', 'config');
    return r.model;
  };

  // ---- Errores tipados → mensajes en español

  function redact(text, r) {
    let s = String(text || '');
    if (r.apiKey) s = s.split(r.apiKey).join('***');
    return s.replace(/\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_*-]{8,}/g, '$1***');
  }

  function serverMessage(err) {
    const body = err && err.error;
    const m = body && ((body.error && body.error.message) || body.message);
    return typeof m === 'string' ? m : '';
  }

  function mapAnthropicError(err, r) {
    const A = loadAnthropic().Anthropic;
    if (err && err.code && !(err instanceof A.AnthropicError)) return err; // ya es nuestro
    const detail = redact(serverMessage(err), r);
    if (err instanceof A.AuthenticationError) return aiError('La clave de Anthropic no es válida. Revísala en Ajustes.', 'auth', err);
    if (err instanceof A.PermissionDeniedError) return aiError(`Tu clave de Anthropic no tiene permiso para esta operación.${detail ? ' ' + detail : ''}`, 'permission', err);
    if (err instanceof A.NotFoundError) return aiError(`Anthropic no encontró el modelo «${r.model}». Elige otro en Ajustes.`, 'config', err);
    if (err instanceof A.RateLimitError) return aiError('Anthropic limitó tus solicitudes. Espera un minuto y vuelve a intentarlo.', 'quota', err);
    if (err instanceof A.BadRequestError) return aiError(`Anthropic rechazó la solicitud.${detail ? ' ' + detail : ''}`, 'request', err);
    if (err instanceof A.InternalServerError) return aiError('Anthropic tiene problemas en este momento. Intenta de nuevo en unos minutos.', 'server', err);
    if (err instanceof A.APIConnectionTimeoutError) return aiError('Anthropic tardó demasiado en responder. Intenta de nuevo.', 'network', err);
    if (err instanceof A.APIConnectionError) return aiError('No se pudo conectar con Anthropic. Revisa tu conexión a internet.', 'network', err);
    if (err instanceof A.APIError) {
      if (err.status === 402) return aiError('Tu cuenta de Anthropic no tiene saldo. Revisa la facturación en la consola de Anthropic.', 'quota', err);
      if (err.status === 413) return aiError('La solicitud es demasiado grande para Anthropic. Reduce el contexto.', 'request', err);
      if (err.status >= 500) return aiError('Anthropic tiene problemas en este momento. Intenta de nuevo en unos minutos.', 'server', err);
      return aiError(`Anthropic respondió con un error (${err.status ?? 'sin código'}).${detail ? ' ' + detail : ''}`, 'request', err);
    }
    return aiError(`Falló la llamada a Anthropic: ${redact(err && err.message, r)}`, 'unknown', err);
  }

  function mapOpenAIError(err, r) {
    const O = loadOpenAI().OpenAI;
    if (err && err.code && !(err instanceof O.OpenAIError)) return err;
    const who = r.label;
    const detail = redact(serverMessage(err), r);
    if (err instanceof O.AuthenticationError) {
      return aiError(r.provider === 'openai' ? 'La clave de OpenAI no es válida. Revísala en Ajustes.' : `${who} rechazó la clave. Revísala en Ajustes.`, 'auth', err);
    }
    if (err instanceof O.PermissionDeniedError) return aiError(`${who} no te da permiso para esta operación.${detail ? ' ' + detail : ''}`, 'permission', err);
    if (err instanceof O.NotFoundError) return aiError(`${who} no encontró el modelo «${r.model}» o la URL del servicio no es correcta.`, 'config', err);
    if (err instanceof O.RateLimitError) return aiError(`${who} limitó tus solicitudes o se agotó tu cuota. Espera un minuto y vuelve a intentarlo.`, 'quota', err);
    if (err instanceof O.BadRequestError) return aiError(`${who} rechazó la solicitud.${detail ? ' ' + detail : ''}`, 'request', err);
    if (err instanceof O.InternalServerError) return aiError(`${who} tiene problemas en este momento. Intenta de nuevo en unos minutos.`, 'server', err);
    if (err instanceof O.APIConnectionTimeoutError) return aiError(`${who} tardó demasiado en responder. Intenta de nuevo.`, 'network', err);
    if (err instanceof O.APIConnectionError) {
      const local = r.baseURL && /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(r.baseURL);
      return aiError(local ? `No se pudo conectar con ${who}. Revisa que el servicio esté abierto en tu Mac.` : `No se pudo conectar con ${who}. Revisa tu conexión y la URL del servicio.`, 'network', err);
    }
    if (err instanceof O.APIError) {
      if (err.status >= 500) return aiError(`${who} tiene problemas en este momento. Intenta de nuevo en unos minutos.`, 'server', err);
      return aiError(`${who} respondió con un error (${err.status ?? 'sin código'}).${detail ? ' ' + detail : ''}`, 'request', err);
    }
    return aiError(`Falló la llamada a ${who}: ${redact(err && err.message, r)}`, 'unknown', err);
  }

  // ---- Clientes de los SDK (la clave se pasa explícita: no se leen variables de entorno)

  function anthropicClient(r) {
    const { Anthropic } = loadAnthropic();
    return new Anthropic({
      apiKey: r.apiKey,
      authToken: null,
      baseURL: r.baseURL || 'https://api.anthropic.com',
      maxRetries,
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
  }

  function openaiClient(r) {
    const { OpenAI } = loadOpenAI();
    return new OpenAI({
      apiKey: r.apiKey || 'sin-clave', // Ollama y otros locales no la piden; el SDK exige un valor
      baseURL: r.baseURL || PROVIDERS.openai.baseURL,
      organization: null,
      project: null,
      webhookSecret: null,
      maxRetries,
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
  }

  // ---- Anthropic

  function anthropicParams(r, { system, user, maxTokens, format }) {
    const model = requireModel(r);
    const params = {
      model,
      max_tokens: maxTokens || MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    };
    const outputConfig = {};
    if (r.effort) outputConfig.effort = r.effort;
    if (format) outputConfig.format = format;
    if (Object.keys(outputConfig).length) params.output_config = outputConfig;
    return params;
  }

  // Llama a Messages. En los modelos que lo admiten agrega el respaldo del
  // servidor (beta) para que una negativa se reintente en otro modelo.
  async function anthropicCall(r, opts) {
    const client = anthropicClient(r);
    const useFallback = FALLBACK_MODELS.has(r.model) && opts.fallback !== false;
    const sdk = loadAnthropic();
    let format;
    if (opts.schema) {
      const f = useFallback ? sdk.betaZodOutputFormat(opts.schema) : sdk.zodOutputFormat(opts.schema);
      format = { type: f.type, schema: f.schema };
    }
    const params = anthropicParams(r, { ...opts, format });
    const started = Date.now();
    let msg;
    try {
      msg = useFallback
        ? await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      const mapped = mapAnthropicError(err, r);
      log(`ia: anthropic ${r.model} falló (${err.status ?? mapped.code})`);
      throw mapped;
    }
    log(`ia: anthropic ${r.model} → ${msg.model} ${msg.stop_reason} en ${Date.now() - started} ms`);
    // La negativa se revisa antes de leer el contenido
    if (msg.stop_reason === 'refusal') {
      const cat = msg.stop_details && msg.stop_details.category;
      throw aiError(`Claude no quiso responder esta solicitud${cat ? ` (categoría: ${cat})` : ''}. Cambia el modelo o reformula la pregunta.`, 'refusal');
    }
    if (msg.stop_reason === 'max_tokens') {
      throw aiError('La respuesta de Claude quedó incompleta porque superó el largo máximo. Reduce el contexto e intenta de nuevo.', 'truncated');
    }
    if (msg.stop_reason === 'model_context_window_exceeded') {
      throw aiError('La respuesta de Claude quedó incompleta porque el contexto superó la ventana del modelo. Reduce el contexto e intenta de nuevo.', 'truncated');
    }
    // Si hubo cambio de modelo, vale solo el texto posterior al último bloque «fallback»
    const blocks = msg.content || [];
    let start = 0;
    blocks.forEach((b, i) => {
      if (b.type === 'fallback') start = i + 1;
    });
    const text = blocks.slice(start).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, model: msg.model || r.model };
  }

  // ---- OpenAI y compatibles

  const MODES = ['json_schema', 'json_object', 'text'];

  async function openaiCall(r, { system, user, schema, name }) {
    const model = requireModel(r);
    const client = openaiClient(r);
    const cacheKey = `${r.baseURL || 'openai'}|${model}`;
    const modes = schema ? MODES.slice(Math.max(0, MODES.indexOf(jsonModeCache.get(cacheKey) || 'json_schema'))) : ['plain'];
    let lastErr = null;
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      if (mode === 'json_schema') {
        body.response_format = loadOpenAI().zodResponseFormat(schema, name || 'respuesta');
      } else if (mode === 'json_object' || mode === 'text') {
        const shape = JSON.stringify(z.toJSONSchema(schema));
        body.messages[0].content = `${system}\n\nResponde solo con un objeto JSON válido, sin texto adicional, que siga este esquema JSON:\n${shape}`;
        if (mode === 'json_object') body.response_format = { type: 'json_object' };
      }
      const started = Date.now();
      let res;
      try {
        res = await client.chat.completions.create(body);
      } catch (err) {
        const O = loadOpenAI().OpenAI;
        // 400 (o 422 en algunos servidores): el endpoint no acepta ese formato de salida
        if ((err instanceof O.BadRequestError || err instanceof O.UnprocessableEntityError) && i < modes.length - 1) {
          log(`ia: ${r.provider} ${model} no aceptó ${mode} (${err.status}); se intenta ${modes[i + 1]}`);
          lastErr = err;
          continue;
        }
        const mapped = mapOpenAIError(err, r);
        log(`ia: ${r.provider} ${model} falló (${err.status ?? mapped.code})`);
        throw mapped;
      }
      if (schema) jsonModeCache.set(cacheKey, mode);
      const choice = (res.choices || [])[0];
      log(`ia: ${r.provider} ${model} ${mode} ${choice ? choice.finish_reason : 'sin respuesta'} en ${Date.now() - started} ms`);
      if (!choice || !choice.message) throw aiError(`${r.label} no devolvió respuesta.`, 'empty');
      if (choice.message.refusal) throw aiError(`${r.label} no quiso responder esta solicitud. Cambia el modelo o reformula la pregunta.`, 'refusal');
      if (choice.finish_reason === 'content_filter') throw aiError(`${r.label} bloqueó la respuesta por sus filtros de contenido.`, 'refusal');
      if (choice.finish_reason === 'length') throw aiError(`La respuesta de ${r.label} quedó incompleta porque superó el largo máximo. Reduce el contexto o elige otro modelo.`, 'truncated');
      return { text: choice.message.content || '', model: res.model || model, mode };
    }
    throw mapOpenAIError(lastErr, r);
  }

  // ---- Capa común

  async function generateText(cfg, { system, user, maxTokens }) {
    const r = resolve(cfg);
    const out = r.provider === 'anthropic'
      ? await anthropicCall(r, { system, user, maxTokens })
      : await openaiCall(r, { system, user });
    const text = String(out.text || '').trim();
    if (!text) throw aiError(`${r.label} devolvió una respuesta vacía.`, 'empty');
    return { text, model: out.model, r };
  }

  async function generateJson(cfg, { system, user, schema, name, maxTokens }) {
    const r = resolve(cfg);
    const out = r.provider === 'anthropic'
      ? await anthropicCall(r, { system, user, schema, maxTokens })
      : await openaiCall(r, { system, user, schema, name });
    let data;
    try {
      data = extractJson(out.text);
    } catch {
      throw aiError(`${r.label} no devolvió JSON válido. Intenta de nuevo o elige otro modelo.`, 'format');
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      log(`ia: respuesta fuera del esquema ${name}: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ')}`);
      throw aiError(`La respuesta de ${r.label} no tiene la forma esperada. Intenta de nuevo o elige otro modelo.`, 'format');
    }
    return { data: parsed.data, model: out.model, r };
  }

  // Validación final tras normalizar: un fallo aquí también es un error de formato en español
  function finalParse(schema, value, r, name) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      log(`ia: resultado final fuera del esquema ${name}: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ')}`);
      throw aiError(`La respuesta de ${r.label} no tiene la forma esperada. Intenta de nuevo o elige otro modelo.`, 'format');
    }
    return parsed.data;
  }

  // ---- API pública

  async function listModels(cfg) {
    const r = resolve(cfg);
    const out = [];
    if (r.provider === 'anthropic') {
      try {
        for await (const m of anthropicClient(r).models.list({ limit: 100, lifecycle: ['active'] })) {
          out.push({ id: m.id, label: m.display_name || m.id });
        }
      } catch (err) {
        throw mapAnthropicError(err, r);
      }
      return out;
    }
    try {
      for await (const m of openaiClient(r).models.list()) {
        out.push({ id: m.id, label: m.name || m.display_name || m.id });
      }
    } catch (err) {
      throw mapOpenAIError(err, r);
    }
    // En OpenAI se dejan fuera los modelos que no sirven para chat
    const filtered = r.provider === 'openai'
      ? out.filter((m) => !/(embed|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|image|realtime|audio|search|sora)/i.test(m.id))
      : out;
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  async function test(cfg) {
    const started = Date.now();
    const r = resolve(cfg);
    let out;
    try {
      if (r.provider === 'anthropic') {
        out = await anthropicCall(r, { system: 'Responde con una sola palabra.', user: 'Escribe: listo', maxTokens: 1024, fallback: false });
      } else {
        out = await openaiCall(r, { system: 'Responde con una sola palabra.', user: 'Escribe: listo' });
      }
    } catch (err) {
      // Una respuesta cortada igual prueba que la clave y el modelo funcionan
      if (err.code !== 'truncated') throw err;
      out = { model: r.model };
    }
    return { ok: true, model: out.model, latencyMs: Date.now() - started };
  }

  // pageContext = { url, title, metaDesc, h1, h2: [string], wordCount, textoExtracto (≤ 6000),
  //   issues: [{ titulo, severidad }], gsc?, ga?, lighthouse?, idioma }
  async function analyzePage(cfg, ctx = {}) {
    if (!ctx.url) throw aiError('Falta la URL de la página para analizarla.', 'config');
    const datos = {
      url: ctx.url,
      idioma: ctx.idioma || 'desconocido',
      title: ctx.title || '',
      metaDescription: ctx.metaDesc || '',
      h1: ctx.h1 || '',
      h2: (Array.isArray(ctx.h2) ? ctx.h2 : ctx.h2 ? [ctx.h2] : []).slice(0, 20),
      palabras: ctx.wordCount ?? null,
      problemasDetectados: (Array.isArray(ctx.issues) ? ctx.issues : []).filter((i) => i && typeof i === 'object').slice(0, 40).map((i) => ({ titulo: i.titulo, severidad: i.severidad })),
      searchConsole: gscBrief(ctx.gsc),
      analytics: ctx.ga || undefined,
      lighthouse: lighthouseBrief(ctx.lighthouse),
    };
    const user = [
      'Datos de la página (JSON):',
      JSON.stringify(datos),
      '',
      'Extracto del texto visible:',
      '"""',
      clip(ctx.textoExtracto, EXCERPT_MAX),
      '"""',
    ].join('\n');
    const { data, r } = await generateJson(cfg, { system: SYSTEM_PAGE, user, schema: PageAnalysisOut, name: 'analisis_pagina' });
    const result = {
      ...data,
      resumen: data.resumen.trim(),
      prioridades: data.prioridades.map((p) => ({ titulo: p.titulo, detalle: p.detalle, impacto: normImpacto(p.impacto) })),
    };
    return finalParse(PageAnalysis, result, r, 'analisis_pagina');
  }

  // pages = [{ url, title, metaDesc, h1, idioma?, textoExtracto? }]
  // Devuelve [{ url, title, description, h1 }] en el orden recibido (omite las que el modelo no devolvió).
  async function suggestMeta(cfg, pages = [], { onProgress } = {}) {
    const list = (pages || []).filter((p) => p && p.url);
    const byUrl = new Map();
    for (let i = 0; i < list.length; i += META_BATCH) {
      const batch = list.slice(i, i + META_BATCH);
      const datos = batch.map((p) => ({
        url: p.url,
        idioma: p.idioma || 'desconocido',
        titleActual: p.title || '',
        descriptionActual: p.metaDesc || '',
        h1Actual: p.h1 || '',
        extracto: clip(p.textoExtracto, 600),
      }));
      const user = `Propón title, meta description y H1 para estas ${batch.length} páginas (JSON):\n${JSON.stringify(datos)}`;
      const { data } = await generateJson(cfg, { system: SYSTEM_META, user, schema: MetaOut, name: 'sugerencias_meta' });
      for (const s of data.sugerencias) {
        if (batch.some((p) => p.url === s.url)) byUrl.set(s.url, { url: s.url, title: s.title.trim(), description: s.description.trim(), h1: s.h1.trim() });
      }
      if (onProgress) onProgress({ done: Math.min(i + META_BATCH, list.length), total: list.length });
    }
    return list.map((p) => byUrl.get(p.url)).filter(Boolean);
  }

  // crawlContext (se arma fuera) = {
  //   sitio, fecha, idioma, paginas,                       // datos generales del rastreo
  //   salud, puntajes: { [categoria]: 0..100 },            // de analysis.js
  //   problemas: [{ titulo, severidad, categoria, urls, ejemplos?: [url] }],
  //   plan?: [{ horizonte, acciones: [{ titulo, severidad, esfuerzo, urls }] }],  // de plan.js
  //   gsc?: { clicks, impressions, ctr, position, topPaginas?: [...], topConsultas?: [...] },
  //   ga?: { views, sessions, engagementRate, keyEvents },
  //   lighthouse?: { performance, lcp, cls, inp, ... },
  //   paginasClave?: [{ url, title, status, palabras }],
  // }
  // Devuelve { resumen, hallazgos: [{ titulo, detalle, impacto }], plan: [{ horizonte, acciones: [{ titulo, detalle }] }] }
  async function executiveSummary(cfg, crawlCtx = {}) {
    const user = `Datos del rastreo (JSON):\n${compactJson(crawlCtx, CONTEXT_MAX)}`;
    const { data, r } = await generateJson(cfg, { system: SYSTEM_SUMMARY, user, schema: SummaryOut, name: 'resumen_ejecutivo' });
    const grupos = new Map(HORIZONTES.map((h) => [h, []]));
    for (const g of data.plan) {
      const h = normHorizonte(g.horizonte) || 'Este trimestre';
      grupos.get(h).push(...g.acciones);
    }
    return finalParse(ExecutiveSummary, {
      resumen: data.resumen.trim(),
      hallazgos: data.hallazgos.map((h) => ({ titulo: h.titulo, detalle: h.detalle, impacto: normImpacto(h.impacto) })),
      plan: HORIZONTES.map((h) => ({ horizonte: h, acciones: grupos.get(h) })),
    }, r, 'resumen_ejecutivo');
  }

  // Misma forma de crawlContext que executiveSummary. Devuelve texto.
  async function ask(cfg, question, crawlCtx = {}) {
    const q = String(question || '').trim();
    if (!q) throw aiError('Escribe una pregunta.', 'config');
    const user = `Datos del rastreo (JSON):\n${compactJson(crawlCtx, CONTEXT_MAX)}\n\nPregunta: ${clip(q, 2000)}`;
    const { text } = await generateText(cfg, { system: SYSTEM_ASK, user });
    return text;
  }

  return { setKey, hasKey, setBaseURL, listModels, test, analyzePage, suggestMeta, executiveSummary, ask };
}

module.exports = { createAiClient, PROVIDERS, DEFAULT_ANTHROPIC_MODEL, schemas: { PageAnalysis, ExecutiveSummary } };
