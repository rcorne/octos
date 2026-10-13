# Contratos entre módulos de Octos (v2)

Fuente de verdad para trabajar en paralelo. Si un módulo necesita cambiar un contrato, lo anota aquí.

## Reglas generales

- Proceso principal (Node/Electron, CommonJS): todo lo que toca red, credenciales o archivos. La interfaz (renderer) nunca ve claves ni tokens: solo estados («conectado», «configurado»).
- Las bibliotecas de `lib/` no importan `electron`. Reciben dependencias inyectadas (`fetchImpl`, almacén de credenciales, `openExternal`, `log`) para poder probarlas en Node puro con servidores falsos.
- Credenciales: `lib/secrets.js` → `createSecretStore({ file, encrypt, decrypt })` con `get/set/delete/has`, y `jsonSecret(store, key)` para objetos. En la app, `encrypt/decrypt` = `safeStorage` de Electron.
- Textos visibles en español neutro, segunda persona, frases cortas, verbo al inicio («Rastrea», «Revisa», «Corrige»). Sin signos de exclamación, sin emoji.
- Cada biblioteca trae su prueba en `test/<modulo>.test.mjs` ejecutable con `node test/<modulo>.test.mjs` (sin red real; servidores falsos en 127.0.0.1). `npm test` corre `test/run-tests.mjs`, que debe seguir pasando.

## Campos nuevos en cada fila (`row`) del rastreo

Se agregan sin romper los existentes. Todos opcionales.

```js
row.gsc = {            // Search Console, últimos 28 días (o el rango elegido)
  clicks, impressions, ctr,        // ctr en 0..1
  position,                         // posición media
  queries?: [{ query, clicks, impressions, ctr, position }],   // bajo demanda (detalle)
  range: { startDate, endDate },
}
row.ga = {             // Google Analytics 4 (pagePath + hostName)
  views, sessions, engagementRate,  // engagementRate en 0..1
  keyEvents, avgEngagementTime,     // segundos
  range: { startDate, endDate },
}
row.inspection = {     // URL Inspection API (bajo demanda)
  verdict, coverageState, indexingState, robotsTxtState, pageFetchState,
  googleCanonical, userCanonical, lastCrawlTime, crawledAs, inspectedAt,
}
row.lighthouse = {     // por estrategia; ver normalize() en lib/lighthouse.js
  mobile?: LighthouseResult, desktop?: LighthouseResult,
}
row.ai = {             // último análisis con IA de esta URL
  provider, model, createdAt, result: PageAnalysis,
}
```

`LighthouseResult`:

```js
{
  source: 'psi' | 'local', strategy: 'mobile' | 'desktop', fetchedAt, lighthouseVersion,
  scores: { performance, accessibility, bestPractices, seo },   // 0..100 o null
  metrics: { lcp, cls, tbt, fcp, si, ttfb, inp },               // ms (cls sin unidad); null si no aplica
  field: null | { lcp, cls, inp, fcp, ttfb, category, origin: boolean },  // CrUX (solo PSI)
  opportunities: [{ id, title, savingsMs, savingsBytes }],      // ordenadas por ahorro
  diagnostics: [{ id, title, displayValue }],
  error?: string,
}
```

## lib/google.js

```js
const { createGoogleClient, matchSiteForHost } = require('./google');
const g = createGoogleClient({ store, openExternal, fetchImpl = fetch, log = () => {}, endpoints? });
await g.status()             // { connected, method: 'oauth'|'service-account'|null, email, hasOAuthClient }
g.setOAuthClient({ clientId, clientSecret })   // credenciales de un cliente OAuth «App de escritorio» del usuario
await g.connectOAuth()       // abre el navegador, servidor loopback 127.0.0.1, PKCE + state; guarda refresh token
await g.setServiceAccount(jsonString)          // valida y guarda la clave JSON de una cuenta de servicio
await g.disconnect()         // revoca si es OAuth y borra credenciales
await g.listSearchConsoleSites()               // [{ siteUrl, permissionLevel }]
await g.listAnalyticsProperties()              // [{ property: 'properties/123', displayName, account }]
await g.fetchSearchConsolePages({ siteUrl, startDate, endDate, rowLimit })     // [{ url, clicks, impressions, ctr, position }]
await g.fetchSearchConsoleQueries({ siteUrl, url, startDate, endDate, rowLimit }) // [{ query, clicks, impressions, ctr, position }]
await g.inspectUrl({ siteUrl, url })           // objeto row.inspection
await g.fetchAnalyticsPages({ property, startDate, endDate })  // [{ hostName, pagePath, views, sessions, engagementRate, keyEvents, avgEngagementTime }]
matchSiteForHost(sites, host)                  // elige la propiedad de Search Console que corresponde al host (sc-domain: o prefijo)
mergeGoogleData(rows, { gscPages, gaPages, startHost })   // escribe row.gsc / row.ga emparejando por URL normalizada y por ruta
```

Errores: lanzar `Error` con mensaje en español listo para mostrar («Search Console rechazó la solicitud: no tienes acceso a esta propiedad.») y `err.code` (`'auth'`, `'permission'`, `'quota'`, `'network'`, `'config'`).

## lib/ai.js

```js
const { createAiClient, PROVIDERS } = require('./ai');
const ai = createAiClient({ store, log });
// cfg = { provider: 'anthropic' | 'openai' | 'compatible', model, baseURL? }
// La clave se lee del almacén: `ai.key.<provider>` (para 'compatible' además `ai.baseURL`).
ai.setKey(provider, apiKey) ; ai.hasKey(provider)
await ai.listModels(cfg)                 // [{ id, label }]
await ai.test(cfg)                       // { ok, model, latencyMs } o lanza Error en español
await ai.analyzePage(cfg, pageContext)   // PageAnalysis (JSON validado)
await ai.suggestMeta(cfg, pages)         // [{ url, title, description, h1 }]
await ai.executiveSummary(cfg, crawlContext)   // { resumen, hallazgos: [..], plan: [{ horizonte, acciones: [..] }] }
await ai.ask(cfg, question, crawlContext)      // string
```

`PageAnalysis`: `{ resumen, prioridades: [{ titulo, detalle, impacto: 'alto'|'medio'|'bajo' }], titulos: [string], metaDescripciones: [string], h1: string, contenido: [string], conversion: [string], datosEstructurados: [string] }`.

Claude se llama con el SDK oficial `@anthropic-ai/sdk` (modelo por defecto `claude-opus-5-5`, salida estructurada con `output_config.format`, respaldo `fallbacks: "default"` con la beta `server-side-fallback-2026-07-01` en los modelos que lo admiten). OpenAI y endpoints compatibles se llaman con el SDK oficial `openai` (`baseURL` para compatibles: Groq, Mistral, OpenRouter, Ollama, Gemini, DeepSeek…).

## lib/lighthouse.js

```js
const { runPageSpeed, runLocal, findChrome, normalize } = require('./lighthouse');
await runPageSpeed({ url, strategy, apiKey?, fetchImpl?, locale: 'es' })   // LighthouseResult (con field si hay CrUX)
await runLocal({ url, strategy, chromePath?, timeoutMs? })                 // LighthouseResult con Chrome instalado (chrome-launcher)
findChrome()                                                               // ruta o null
normalize(lhr, { source, strategy, loadingExperience? })                   // LighthouseResult
```

## lib/plan.js (UMD: Node y navegador, como analysis.js)

```js
OctosPlan.buildActionPlan(result, { rows? })   // [{ id, horizonte: 'Esta semana'|'Este mes'|'Este trimestre', titulo, acciones: [{ issueId, titulo, urls, severidad, esfuerzo, porque, como }] }]
```

Regla: crítico o alto con esfuerzo 1 → «Esta semana»; alto con esfuerzo 2–3 y medio con esfuerzo 1–2 → «Este mes»; el resto → «Este trimestre». Los problemas de sitio (`site: true`) van según su severidad.

## lib/export-pptx.js y lib/export-xlsx.js

```js
await buildPptx({ result, meta, rows, plan, ai?, brandDir })   // Buffer .pptx
await buildXlsx({ result, meta, rows, plan })                  // Buffer .xlsx
```

`brandDir` = `assets/brand` (PNG generados por `scripts/make-icon.js`: `octos-loto.png`, `octos-loto-blanco.png`, `octos-logotipo.png`, `octos-logotipo-blanco.png`).

## Reglas nuevas en lib/analysis.js

Se activan solo si la fila tiene los datos (`row.gsc`, `row.ga`, `row.lighthouse`, `row.inspection`). Categoría nueva `organico` («Tráfico orgánico») para las de Google; las de Lighthouse van en `rendimiento`.
