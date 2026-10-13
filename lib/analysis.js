// Análisis del rastreo completo: enlaces entrantes, profundidad real,
// cadenas de redirección, duplicados y la lista priorizada de problemas
// con explicación y solución. Corre en el navegador (en vivo) y en Node (tests).
(function (root) {
  const Simhash = typeof module !== 'undefined' && module.exports ? require('./simhash') : root.OctosSimhash;

  const SEV = {
    critico: { label: 'Crítico', weight: 18 },
    alto: { label: 'Alto', weight: 9 },
    medio: { label: 'Medio', weight: 4 },
    bajo: { label: 'Bajo', weight: 1.5 },
  };

  const CATEGORIES = [
    { id: 'indexacion', label: 'Indexación', tone: 'azul' },
    { id: 'contenido', label: 'Contenido', tone: 'lavanda' },
    { id: 'enlaces', label: 'Enlaces', tone: 'cielo' },
    { id: 'rendimiento', label: 'Rendimiento', tone: 'menta' },
    { id: 'conversion', label: 'Conversión', tone: 'rosa' },
    { id: 'social', label: 'Social y datos estructurados', tone: 'durazno' },
    { id: 'organico', label: 'Tráfico orgánico', tone: 'azul' },
  ];

  const isPage = (r) => r.internal && r.status === 200 && r.contentType && r.contentType.includes('html');

  // ---- Datos de Google y Lighthouse (row.gsc, row.ga, row.inspection, row.lighthouse).
  // Son opcionales: sin ellos estas reglas no se activan y el resultado no cambia.

  // CTR orgánico esperado según la posición media (posiciones 1 a 10). Valores
  // redondeados del promedio de estudios públicos de CTR por posición 2023–2025
  // (resultados orgánicos de escritorio y móvil, sin separar marca). Entre
  // posiciones enteras se interpola; de la 10 a la 20 baja en línea recta de
  // 2 % a 0,5 %, y desde la 20 queda en 0,5 %.
  const CTR_CURVE = [0.28, 0.16, 0.11, 0.08, 0.06, 0.045, 0.035, 0.03, 0.025, 0.02];
  function expectedCtr(position) {
    const p = Number(position);
    if (!Number.isFinite(p) || p <= 0) return null;
    if (p <= 1) return CTR_CURVE[0];
    if (p >= 20) return 0.005;
    if (p >= 10) return CTR_CURVE[9] + ((0.005 - CTR_CURVE[9]) * (p - 10)) / 10;
    const i = Math.floor(p) - 1;
    const f = p - Math.floor(p);
    return f ? CTR_CURVE[i] + (CTR_CURVE[i + 1] - CTR_CURVE[i]) * f : CTR_CURVE[i];
  }

  // Umbrales de las reglas con datos de Google (periodo del informe, por defecto 28 días)
  const GOOGLE_RULES = {
    lowCtrImpressions: 100, // CTR bajo: mínimo de impresiones para que el CTR sea confiable
    lowCtrRatio: 0.5, // CTR bajo: menos de la mitad del esperado para su posición
    lowCtrMaxPosition: 10, // más allá de la primera página el problema es la posición, no el fragmento
    opportunityImpressions: 200, // oportunidades: impresiones altas
    opportunityFrom: 4,
    opportunityTo: 15,
    trafficClicks: 10, // «con tráfico» para la regla de llamada a la acción
    trafficViews: 100,
    keyEventViews: 100, // visitas sin eventos clave
  };
  // Umbrales de Lighthouse (los de «necesita mejorar» de Google para Core Web Vitals)
  const LIGHTHOUSE_RULES = { lcp: 2500, cls: 0.1, inp: 200, tbt: 200, performance: 50, accessibility: 80 };

  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const hasGsc = (r) => !!(r.gsc && num(r.gsc.impressions));
  const hasGa = (r) => !!(r.ga && num(r.ga.views));
  const gscCtr = (g) => (num(g.ctr) ? g.ctr : g.impressions > 0 ? (g.clicks || 0) / g.impressions : 0);
  const hasTraffic = (r) => (hasGsc(r) && r.gsc.clicks > 0) || (hasGa(r) && r.ga.views > 0);

  // Resultado de Lighthouse a usar: móvil si existe y no falló; si no, escritorio
  function pickLighthouse(r) {
    const l = r.lighthouse;
    if (!l) return null;
    for (const k of ['mobile', 'desktop']) {
      const x = l[k];
      if (x && !x.error && (x.metrics || x.scores)) return x;
    }
    return null;
  }
  // Dato real de la URL (CrUX) si existe; si no, laboratorio. El dato de CrUX a nivel
  // de origen (field.origin) se descarta porque es igual para todas las páginas.
  function metricOf(lh, key, { fieldOnly = false, labOnly = false } = {}) {
    const f = lh.field;
    if (!labOnly && f && !f.origin && num(f[key])) return f[key];
    if (fieldOnly) return null;
    return lh.metrics && num(lh.metrics[key]) ? lh.metrics[key] : null;
  }

  // Estados de cobertura de la inspección de URL que significan «no está en el índice»
  // (en inglés y en español, según el idioma de la respuesta).
  const NOT_INDEXED_RE = /not indexed|no indexad|sin indexar|unknown to google|desconocida para google|excluded|excluida|noindex|blocked|bloquead|redirect|redirecci|duplicate|duplicad|not found|no encontrad|soft 404|404|server error|error del servidor|alternate|alternativa/i;
  // «Indexed, though blocked by robots.txt», «Indexada, aunque bloqueada…»: sí está en el índice
  const INDEXED_RE = /^(indexed|indexad[ao])\b/i;
  function notIndexed(ins) {
    if (!ins) return false;
    const cov = String(ins.coverageState || '').trim();
    if (cov && INDEXED_RE.test(cov)) return false;
    if (cov && NOT_INDEXED_RE.test(cov)) return true;
    // PARTIAL = indexada con advertencias; VERDICT_UNSPECIFIED = sin veredicto
    return !!ins.verdict && !['PASS', 'PARTIAL', 'VERDICT_UNSPECIFIED'].includes(ins.verdict);
  }
  const sameUrl = (a, b) => {
    const norm = (u) => {
      try {
        const x = new URL(String(u).trim());
        x.hash = '';
        return x.href;
      } catch {
        return String(u).trim();
      }
    };
    return norm(a) === norm(b);
  };
  // Clave flexible de URL (host sin www, ruta sin barra final, con query). mergeGoogleData
  // de lib/google.js copia los mismos datos a variantes que solo difieren en eso (y GA4 ni
  // siquiera distingue el protocolo), así que sirve para no contarlos dos veces.
  const looseKey = (u) => {
    try {
      const x = new URL(String(u).trim());
      let p = x.pathname;
      try {
        p = decodeURIComponent(p);
      } catch {}
      return x.hostname.toLowerCase().replace(/^www\./, '') + (p.replace(/\/+$/, '') || '/') + x.search;
    } catch {
      return String(u);
    }
  };
  const uniqueBy = (list, sig) => {
    const seen = new Set();
    return list.filter((r) => {
      const k = looseKey(r.url) + '|' + sig(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const median = (list) => {
    const s = list.filter(num).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };

  function analyze({ rows, edges, meta }) {
    const byUrl = new Map();
    const byId = new Map();
    for (const r of rows) {
      byUrl.set(r.url, r);
      byId.set(r.id, r);
      r.inlinks = 0;
      r.inlinksFollow = 0;
      r.inlinkSources = 0;
    }

    // ---- Enlaces entrantes y grafo para profundidad
    const adj = new Map();
    const linkedFrom = new Map(); // url → Set(ids)
    const brokenLinkSources = new Map(); // id origen → nº enlaces rotos
    const redirectLinkSources = new Map();
    for (const [from, to, , nofollow] of edges) {
      const target = byUrl.get(to);
      if (!target) continue;
      const source = byId.get(from);
      if (source && source.url === to) continue; // autoenlace
      target.inlinks++;
      if (!nofollow) target.inlinksFollow++;
      let set = linkedFrom.get(to);
      if (!set) linkedFrom.set(to, (set = new Set()));
      set.add(from);
      if (source && source.internal) {
        let list = adj.get(source.url);
        if (!list) adj.set(source.url, (list = []));
        list.push(to);
        if (target.status >= 400 || target.status === 0) brokenLinkSources.set(from, (brokenLinkSources.get(from) || 0) + 1);
        else if (target.status >= 300 && target.status < 400) redirectLinkSources.set(from, (redirectLinkSources.get(from) || 0) + 1);
      }
    }
    for (const r of rows) r.inlinkSources = linkedFrom.has(r.url) ? linkedFrom.get(r.url).size : 0;

    // Profundidad real (clics desde la portada)
    const start = meta && meta.startUrl;
    if (start && byUrl.has(start)) {
      const dist = new Map([[start, 0]]);
      const q = [start];
      while (q.length) {
        const u = q.shift();
        for (const v of adj.get(u) || []) {
          if (!dist.has(v)) {
            dist.set(v, dist.get(u) + 1);
            q.push(v);
          }
        }
      }
      for (const r of rows) r.clickDepth = dist.has(r.url) ? dist.get(r.url) : null;
    }

    // ---- Cadenas de redirección
    for (const r of rows) {
      if (!(r.status >= 300 && r.status < 400)) continue;
      const chain = [r.url];
      let cur = r;
      let loop = false;
      while (cur && cur.redirectTo && chain.length < 12) {
        if (chain.includes(cur.redirectTo)) {
          loop = true;
          chain.push(cur.redirectTo);
          break;
        }
        chain.push(cur.redirectTo);
        cur = byUrl.get(cur.redirectTo);
        if (!cur || !(cur.status >= 300 && cur.status < 400)) break;
      }
      r.chain = chain;
      r.hops = chain.length - 1;
      r.redirectLoop = loop;
      const final = byUrl.get(chain[chain.length - 1]);
      r.finalStatus = loop ? 0 : final ? final.status : null;
    }

    // ---- Canonical apunta a URL no válida
    for (const r of rows) {
      if (r.canonical && r.canonical !== r.url) {
        const t = byUrl.get(r.canonical);
        r.canonicalStatus = t ? t.status : null;
      }
    }

    // ---- Duplicados
    const pages = rows.filter(isPage);
    const indexable = pages.filter((r) => r.indexable);
    const groupBy = (list, key) => {
      const m = new Map();
      for (const r of list) {
        const v = (key(r) || '').trim().toLowerCase();
        if (!v) continue;
        if (!m.has(v)) m.set(v, []);
        m.get(v).push(r);
      }
      return [...m.values()].filter((g) => g.length > 1);
    };
    const dupTitles = groupBy(indexable, (r) => r.title);
    const dupDescs = groupBy(indexable, (r) => r.metaDesc);
    const dupH1 = groupBy(indexable, (r) => (r.h1 || [])[0]);
    const exactDup = groupBy(indexable, (r) => r.simhash);
    for (const r of pages) {
      r.dupTitle = 0;
      r.dupDesc = 0;
      r.nearDup = [];
    }
    for (const g of dupTitles) for (const r of g) r.dupTitle = g.length;
    for (const g of dupDescs) for (const r of g) r.dupDesc = g.length;
    for (const g of exactDup) for (const r of g) r.exactDup = g.length;
    const near = Simhash.nearDuplicates(indexable.map((r) => r.simhash), 3);
    for (const [i, j, sim] of near) {
      indexable[i].nearDup.push({ id: indexable[j].id, url: indexable[j].url, sim });
      indexable[j].nearDup.push({ id: indexable[i].id, url: indexable[i].url, sim });
    }

    // Huérfanas: están en el sitemap pero ninguna página interna las enlaza
    for (const r of pages) r.orphan = !!r.inSitemap && r.inlinkSources === 0 && r.url !== start;

    // ---- Reglas
    const issues = [];
    const add = (id, category, sev, effort, title, why, fix, list, extra = {}) => {
      const ids = list.map((r) => r.id);
      if (!ids.length && !extra.site) return;
      issues.push({ id, category, severity: sev, effort, title, why, fix, ids, count: ids.length, ...extra });
    };
    const internal = rows.filter((r) => r.internal);
    const htmlInternal = internal.filter((r) => r.contentType && r.contentType.includes('html'));

    // Indexación
    add('5xx', 'indexacion', 'critico', 2, 'Errores del servidor (5xx)',
      'Google reduce el rastreo de un sitio que falla y saca estas páginas del índice si el error persiste.',
      'Revisa los logs del servidor o del hosting en esas URLs; suelen ser timeouts, memoria o un plugin roto.',
      internal.filter((r) => r.status >= 500));
    add('4xx', 'indexacion', 'alto', 1, 'Páginas internas que no existen (4xx)',
      'Cada 404 enlazado es una visita perdida y autoridad que se va por el desagüe.',
      'Redirige con 301 a la página equivalente más cercana o quita el enlace si ya no tiene reemplazo.',
      internal.filter((r) => r.status >= 400 && r.status < 500));
    add('timeout', 'indexacion', 'alto', 2, 'URLs sin respuesta',
      'Si Octos no obtuvo respuesta, Googlebot probablemente tampoco.',
      'Comprueba firewall, WAF o límites de tasa; baja la concurrencia en Ajustes si el servidor es pequeño.',
      internal.filter((r) => r.status === 0 && !r.blockedByRobots));
    add('robots-bloqueada', 'indexacion', 'medio', 1, 'Bloqueadas por robots.txt',
      'Google no puede leer su contenido; si reciben enlaces aún pueden aparecer sin descripción.',
      'Si deben posicionar, quita la regla Disallow; si no, déjalo así y no las enlaces desde el menú.',
      internal.filter((r) => r.blockedByRobots));
    add('noindex', 'indexacion', 'medio', 1, 'Páginas con noindex',
      'No aparecerán en Google. Está bien para carritos o filtros, no para páginas de servicio o categorías.',
      'Confirma que cada una debe estar fuera del índice; quita la etiqueta en las que deberían posicionar.',
      pages.filter((r) => r.indexReason === 'noindex'));
    add('sitemap-no-indexable', 'indexacion', 'alto', 1, 'En el sitemap pero no indexables',
      'El sitemap le dice a Google "esto importa"; incluir redirecciones, errores o noindex desperdicia rastreo y confunde.',
      'Deja en el sitemap solo URLs 200, indexables y canónicas. Puedes generar uno limpio desde Archivo → Generar sitemap.',
      internal.filter((r) => r.inSitemap && (r.status !== 200 || r.indexable === false)));
    add('huerfanas', 'indexacion', 'alto', 2, 'Páginas huérfanas',
      'Están en el sitemap, pero ninguna página las enlaza. Reciben poca autoridad y Google las considera poco importantes.',
      'Enlázalas desde categorías, el menú o artículos relacionados con un texto ancla descriptivo.',
      pages.filter((r) => r.orphan));
    add('profundas', 'indexacion', 'medio', 2, 'Páginas a más de 3 clics de la portada',
      'Cuanto más profunda, menos se rastrea y menos autoridad recibe.',
      'Agrega enlaces desde páginas de nivel superior, migas de pan o bloques de “relacionados”.',
      indexable.filter((r) => r.clickDepth !== null && r.clickDepth > 3));
    add('canonical-falta', 'indexacion', 'bajo', 1, 'Sin etiqueta canonical',
      'Sin canonical, parámetros y versiones con/sin barra pueden competir entre sí.',
      'Agrega <link rel="canonical"> autorreferente en cada página indexable.',
      indexable.filter((r) => !r.canonical));
    add('canonical-roto', 'indexacion', 'alto', 1, 'Canonical que apunta a una URL que no responde 200',
      'Google ignora un canonical que redirige o da error y puede elegir otra versión por su cuenta.',
      'Apunta el canonical directo a la URL final que responde 200.',
      pages.filter((r) => r.canonicalStatus && r.canonicalStatus !== 200));
    add('canonical-multiple', 'indexacion', 'medio', 1, 'Más de una etiqueta canonical',
      'Con señales contradictorias Google descarta todas.',
      'Deja una sola; suele venir duplicada por el tema y un plugin SEO a la vez.',
      pages.filter((r) => r.canonicalCount > 1));
    add('js-dependiente', 'indexacion', 'medio', 3, 'Contenido que depende de JavaScript',
      'El HTML inicial y el renderizado difieren mucho. Google renderiza con retraso y otros buscadores e IA a veces no lo hacen.',
      'Sirve título, H1, texto principal y enlaces en el HTML del servidor (SSR o prerender).',
      pages.filter((r) => r.jsDiff && (r.jsDiff.titleChanged || r.jsDiff.h1Changed || r.jsDiff.linksAdded > 10 || r.jsDiff.wordsAdded > 150)));
    add('http', 'indexacion', 'alto', 2, 'Páginas sin HTTPS',
      'Chrome las marca como “No seguro”; afecta confianza, conversión y es una señal de ranking.',
      'Instala un certificado y redirige todo HTTP a HTTPS con 301.',
      pages.filter((r) => r.url.startsWith('http:')));

    // Contenido
    add('title-falta', 'contenido', 'alto', 1, 'Sin título',
      'El título es lo primero que se ve en Google y uno de los factores on-page más fuertes.',
      'Escribe un título único de 50–60 caracteres con la palabra clave principal al inicio.',
      pages.filter((r) => !r.title));
    add('title-dup', 'contenido', 'alto', 1, 'Títulos duplicados',
      'Google no sabe cuál mostrar y las páginas compiten entre sí por la misma búsqueda.',
      'Diferencia cada título según la intención de búsqueda de su página.',
      dupTitles.flat());
    add('title-largo', 'contenido', 'medio', 1, 'Títulos que Google corta (> 580 px)',
      'Se truncan con “…” y el mensaje clave puede quedar fuera.',
      'Acorta poniendo primero lo importante. Usa la vista previa del resultado en el panel de detalle.',
      pages.filter((r) => r.title && r.titlePx > 580));
    add('title-corto', 'contenido', 'bajo', 1, 'Títulos muy cortos (< 30 caracteres)',
      'Desaprovechan espacio para palabras clave y propuesta de valor.',
      'Suma un beneficio, la categoría o la ubicación (ej. “… en Santiago | Marca”).',
      pages.filter((r) => r.title && r.titleLen < 30));
    add('desc-falta', 'contenido', 'medio', 1, 'Sin meta descripción',
      'Google improvisa un fragmento y suele elegir peor texto: baja el CTR.',
      'Escribe 140–155 caracteres con beneficio y una llamada a la acción.',
      indexable.filter((r) => !r.metaDesc));
    add('desc-dup', 'contenido', 'medio', 1, 'Meta descripciones duplicadas',
      'Resultados que se ven iguales reducen clics y señalan contenido repetido.',
      'Personaliza la descripción de cada página.',
      dupDescs.flat());
    add('desc-larga', 'contenido', 'bajo', 1, 'Meta descripciones que Google corta (> 920 px)',
      'La llamada a la acción del final no se verá.',
      'Lleva el beneficio y el CTA a los primeros 120 caracteres.',
      indexable.filter((r) => r.metaDesc && r.descPx > 920));
    add('h1-falta', 'contenido', 'medio', 1, 'Sin H1',
      'El H1 confirma a usuarios y buscadores de qué trata la página.',
      'Agrega un H1 visible, único y alineado con el título.',
      pages.filter((r) => !(r.h1 || []).length));
    add('h1-multiple', 'contenido', 'bajo', 1, 'Varios H1',
      'No es grave, pero diluye la jerarquía y suele ser un error de plantilla.',
      'Deja un H1 y convierte el resto en H2.',
      pages.filter((r) => (r.h1 || []).length > 1));
    add('h1-dup', 'contenido', 'bajo', 1, 'H1 duplicados',
      'Varias páginas que dicen lo mismo en su encabezado principal.',
      'Haz que cada H1 describa lo específico de esa página.',
      dupH1.flat());
    add('contenido-pobre', 'contenido', 'medio', 3, 'Poco contenido (< 200 palabras)',
      'Las páginas delgadas rara vez posicionan y pueden arrastrar la calidad percibida del sitio.',
      'Amplía con respuestas a preguntas reales, detalles del producto o consolida con otra página.',
      indexable.filter((r) => r.wordCount < 200));
    add('duplicado-exacto', 'contenido', 'alto', 2, 'Contenido duplicado exacto',
      'Google indexa solo una versión y elige él cuál.',
      'Unifica con 301 o declara la principal con canonical.',
      exactDup.flat());
    add('casi-duplicado', 'contenido', 'medio', 3, 'Contenido casi duplicado (≥ 95 %)',
      'Páginas casi iguales canibalizan búsquedas y gastan presupuesto de rastreo.',
      'Fusiona, diferencia el texto o usa canonical hacia la principal.',
      indexable.filter((r) => r.nearDup.length));
    add('img-alt', 'contenido', 'medio', 1, 'Imágenes sin atributo alt',
      'Pierdes tráfico de Google Imágenes y la página es menos accesible.',
      'Describe cada imagen en 5–15 palabras; usa alt="" solo en las decorativas.',
      pages.filter((r) => r.imagesNoAlt > 0));
    add('lang', 'contenido', 'bajo', 1, 'Sin atributo lang',
      'Ayuda a buscadores, traductores y lectores de pantalla a saber el idioma.',
      'Agrega lang="es" (o es-CL) en la etiqueta <html>.',
      pages.filter((r) => !r.lang));
    add('encabezados-saltos', 'contenido', 'bajo', 1, 'Saltos en la jerarquía de encabezados',
      'Pasar de H2 a H4 rompe la estructura que leen lectores de pantalla y buscadores.',
      'Usa los niveles en orden, sin saltarte ninguno.',
      pages.filter((r) => r.headingSkips > 0));

    // Enlaces
    add('enlaces-rotos', 'enlaces', 'alto', 1, 'Páginas con enlaces rotos',
      'Frustran al usuario justo cuando quiere avanzar y desperdician autoridad.',
      'Abre la página, busca el enlace en la pestaña Enlaces del panel y corrígelo o elimínalo.',
      [...brokenLinkSources.keys()].map((id) => byId.get(id)).filter(Boolean));
    add('enlaces-a-redireccion', 'enlaces', 'bajo', 1, 'Enlaces internos que pasan por una redirección',
      'Cada salto agrega latencia y pierde algo de señal.',
      'Actualiza el enlace para que apunte directo a la URL final.',
      [...redirectLinkSources.keys()].map((id) => byId.get(id)).filter(Boolean));
    add('cadenas', 'enlaces', 'medio', 1, 'Cadenas de redirección (2+ saltos)',
      'Googlebot sigue hasta 10 saltos, pero cada uno suma tiempo y riesgo de perder señales.',
      'Redirige el origen directamente al destino final.',
      internal.filter((r) => r.hops > 1 && !r.redirectLoop));
    add('bucles', 'enlaces', 'critico', 1, 'Bucles de redirección',
      'La página nunca carga: ni usuarios ni Google llegan.',
      'Revisa reglas en .htaccess, servidor o plugin de redirecciones que se pisan entre sí.',
      internal.filter((r) => r.redirectLoop));
    add('redireccion-temporal', 'enlaces', 'bajo', 1, 'Redirecciones temporales (302/307)',
      'Si el cambio es permanente, una 302 retrasa la consolidación de señales.',
      'Usa 301 o 308 para cambios definitivos.',
      internal.filter((r) => r.status === 302 || r.status === 307));
    add('sin-enlaces-salientes', 'enlaces', 'bajo', 1, 'Páginas sin enlaces internos salientes',
      'Son callejones sin salida para usuarios y rastreadores.',
      'Agrega navegación, migas de pan o enlaces a contenido relacionado.',
      pages.filter((r) => r.outlinksInternal === 0));
    add('demasiados-enlaces', 'enlaces', 'bajo', 2, 'Más de 150 enlaces internos en una página',
      'Diluye la autoridad de cada enlace y la atención del usuario.',
      'Simplifica menús enormes y footers con decenas de enlaces.',
      pages.filter((r) => r.outlinksInternal > 150));
    add('externos-rotos', 'enlaces', 'medio', 1, 'Enlaces externos rotos',
      'Restan confianza y son una mala experiencia.',
      'Reemplázalos por una fuente vigente o quítalos.',
      rows.filter((r) => !r.internal && (r.status >= 400 || r.status === 0)));
    add('url-mayusculas', 'enlaces', 'bajo', 2, 'URLs con mayúsculas',
      'Las URLs distinguen mayúsculas: /Pagina y /pagina pueden duplicarse.',
      'Usa minúsculas y redirige las variantes.',
      htmlInternal.filter((r) => /[A-Z]/.test(new URL(r.url).pathname)));
    add('url-larga', 'enlaces', 'bajo', 2, 'URLs muy largas (> 115 caracteres)',
      'Se cortan en resultados y son difíciles de compartir.',
      'Acorta el slug a las palabras clave esenciales.',
      htmlInternal.filter((r) => r.url.length > 115));
    add('url-parametros', 'enlaces', 'bajo', 2, 'URLs con parámetros rastreables',
      'Filtros y parámetros multiplican URLs casi iguales.',
      'Usa canonical hacia la versión limpia y no enlaces combinaciones infinitas de filtros.',
      htmlInternal.filter((r) => r.url.includes('?')));

    // Rendimiento
    add('lenta', 'rendimiento', 'alto', 3, 'Respuesta lenta del servidor (> 1 s)',
      'Un TTFB alto retrasa todo lo demás y empeora LCP; cada segundo extra baja la conversión.',
      'Activa caché de página, revisa el hosting y consultas pesadas, o usa un CDN.',
      pages.filter((r) => r.time > 1000));
    add('pesada', 'rendimiento', 'medio', 2, 'HTML muy pesado (> 1 MB)',
      'Más bytes = más tiempo en móviles con mala señal.',
      'Saca JSON incrustado, SVG enormes y estilos inline repetidos.',
      pages.filter((r) => r.size > 1024 * 1024));
    add('sin-compresion', 'rendimiento', 'medio', 1, 'HTML sin compresión',
      'Gzip o Brotli reducen el HTML hasta 80 % sin tocar el sitio.',
      'Actívalo en el servidor o CDN (en Apache: mod_deflate; en Nginx: gzip on).',
      pages.filter((r) => !r.compression && r.size > 2048));
    add('scripts-bloqueantes', 'rendimiento', 'medio', 2, 'Scripts que bloquean el renderizado',
      'Scripts en <head> sin async ni defer frenan la primera pintura.',
      'Agrega defer a los scripts que no sean críticos.',
      pages.filter((r) => r.blockingScripts > 2));
    add('terceros', 'rendimiento', 'bajo', 2, 'Muchos dominios de terceros (> 8)',
      'Cada dominio suma DNS, conexión y JavaScript ajeno que no controlas.',
      'Revisa píxeles y widgets que ya no uses; carga los demás después de la interacción.',
      pages.filter((r) => (r.thirdPartyHosts || []).length > 8));
    add('img-dimensiones', 'rendimiento', 'bajo', 1, 'Imágenes sin width/height',
      'El contenido salta mientras cargan (CLS), y eso molesta y provoca clics equivocados.',
      'Declara width y height (o aspect-ratio en CSS) en cada imagen.',
      pages.filter((r) => r.imagesNoDims > 3));
    add('contenido-mixto', 'rendimiento', 'alto', 1, 'Contenido mixto (HTTP dentro de HTTPS)',
      'El navegador bloquea esos recursos y puede quitar el candado.',
      'Cambia las URLs de recursos a https:// o a rutas relativas.',
      pages.filter((r) => r.mixedContent > 0));
    add('viewport', 'rendimiento', 'alto', 1, 'Sin meta viewport',
      'La página no se adapta al móvil y Google indexa primero la versión móvil.',
      'Agrega <meta name="viewport" content="width=device-width, initial-scale=1">.',
      pages.filter((r) => !r.viewport));

    // Conversión (CRO)
    const keyPages = indexable.filter((r) => r.clickDepth !== null && r.clickDepth <= 2);
    add('sin-cta', 'conversion', 'alto', 2, 'Páginas clave sin llamada a la acción',
      'Páginas a 1–2 clics de la portada que no piden nada al visitante: tráfico que no convierte.',
      'Agrega un botón visible con verbo de acción (“Cotiza”, “Agenda”, “Compra”) arriba y al final.',
      keyPages.filter((r) => !(r.ctas || []).length && !(r.forms || []).length));
    add('form-sin-label', 'conversion', 'medio', 1, 'Formularios con campos sin etiqueta',
      'Cuando el placeholder desaparece, el usuario no recuerda qué escribir; también falla en accesibilidad.',
      'Agrega <label> visible a cada campo.',
      pages.filter((r) => (r.forms || []).some((f) => f.unlabeled > 0)));
    add('form-largo', 'conversion', 'medio', 2, 'Formularios largos (> 7 campos)',
      'Cada campo extra baja la tasa de envío.',
      'Pide solo lo imprescindible; el resto, después del primer contacto.',
      pages.filter((r) => (r.forms || []).some((f) => f.fields > 7)));
    const contactPages = pages.filter((r) => r.hasTel || r.hasMailto || r.hasWhatsapp);
    if (pages.length >= 3 && !contactPages.length) {
      add('sin-contacto', 'conversion', 'alto', 1, 'No hay contacto directo en todo el sitio',
        'Ningún enlace tel:, mailto: ni WhatsApp. En servicios y pymes es la vía de conversión más usada.',
        'Agrega teléfono clicable o botón de WhatsApp en el header o footer.',
        [], { site: true });
    }
    add('sin-favicon', 'conversion', 'bajo', 1, 'Sin favicon',
      'Google lo muestra junto al resultado móvil; sin él la marca se ve descuidada.',
      'Agrega <link rel="icon"> con un icono de al menos 48×48.',
      pages.filter((r) => !r.favicon));

    // Social y datos estructurados
    add('og-falta', 'social', 'bajo', 1, 'Sin Open Graph (og:title / og:image)',
      'Al compartir en WhatsApp, LinkedIn o Facebook sale una tarjeta pobre o sin imagen.',
      'Agrega og:title, og:description y og:image de 1200×630.',
      indexable.filter((r) => !r.og || !r.og.title || !r.og.image));
    add('schema-falta', 'social', 'bajo', 2, 'Sin datos estructurados',
      'Pierdes resultados enriquecidos (estrellas, precios, FAQ, migas) y contexto para buscadores e IA.',
      'Agrega JSON-LD: Organization en la portada, Product, Article, LocalBusiness o BreadcrumbList según el tipo.',
      indexable.filter((r) => !(r.jsonldTypes || []).length && !r.microdata));
    add('schema-error', 'social', 'medio', 1, 'JSON-LD con errores de sintaxis',
      'Un JSON mal formado se ignora completo.',
      'Valida el bloque en la prueba de resultados enriquecidos de Google.',
      pages.filter((r) => r.jsonldErrors > 0));

    // Tráfico orgánico (Search Console, Analytics e inspección de URL). Solo con datos.
    const G = GOOGLE_RULES;
    const gscRows = rows.filter(hasGsc);
    const gaRows = rows.filter(hasGa);
    // mergeGoogleData pone ceros en toda página HTML sin fila en Google. Si ninguna fila
    // tiene impresiones (o visitas), la descarga vino vacía (propiedad vacía o equivocada,
    // sitio nuevo) y se trata como «sin datos», no como «ninguna página aparece».
    const siteHasGsc = gscRows.some((r) => r.gsc.impressions > 0);
    const siteHasGa = gaRows.some((r) => r.ga.views > 0);
    const inspected = rows.filter((r) => r.inspection && (r.inspection.verdict || r.inspection.coverageState));
    const hasGoogleData = siteHasGsc || siteHasGa || inspected.length > 0;
    if (siteHasGsc) {
      add('ctr-bajo', 'organico', 'medio', 1, 'Páginas con impresiones y CTR bajo',
        'Google ya las muestra, pero pocas personas hacen clic: su CTR no llega a la mitad de lo esperado para su posición. Es tráfico al alcance sin subir un puesto.',
        'Reescribe el título y la meta descripción con el beneficio y la búsqueda principal al inicio. Revisa las consultas de la página en Search Console.',
        pages.filter((r) => {
          if (!hasGsc(r) || r.gsc.impressions < G.lowCtrImpressions) return false;
          const pos = r.gsc.position;
          const exp = expectedCtr(pos);
          return exp !== null && pos <= G.lowCtrMaxPosition && gscCtr(r.gsc) < exp * G.lowCtrRatio;
        }), { source: 'gsc' });
      add('oportunidad-4-15', 'organico', 'medio', 2, 'Oportunidades en posiciones 4 a 15',
        'Tienen muchas impresiones y están cerca del top 3, donde se concentra la mayoría de los clics. Subir unos puestos rinde más que crear contenido nuevo.',
        'Amplía el contenido con las consultas que ya traen impresiones, mejora el título y suma enlaces internos desde páginas con autoridad.',
        pages.filter((r) => hasGsc(r) && r.gsc.impressions >= G.opportunityImpressions && r.gsc.position >= G.opportunityFrom && r.gsc.position <= G.opportunityTo),
        { source: 'gsc' });
      // Una página indexable sin fila de Search Console cuenta como 0 impresiones
      add('sin-impresiones', 'organico', 'medio', 2, 'Páginas indexables sin impresiones en el periodo',
        'Son indexables, pero no aparecieron ni una vez en Google durante el periodo. O no están en el índice o no responden a ninguna búsqueda real.',
        'Inspecciona la URL en Search Console. Si está indexada, enfoca el contenido en una búsqueda concreta; si no aporta, fusiónala con otra o sácala del sitemap.',
        indexable.filter((r) => !(hasGsc(r) && r.gsc.impressions > 0)), { source: 'gsc' });
    }
    // Una redirección solo falla si entra en bucle o termina en error, sin respuesta o
    // noindex. Una 301 a una página 200 es justo la solución que se recomienda; además,
    // mergeGoogleData le copia los datos de su destino cuando solo cambia la barra final,
    // el www o el protocolo, y Search Console sigue mostrando los clics de la URL antigua
    // durante todo el periodo.
    const redirectFails = (r) => {
      if (r.redirectLoop) return true;
      if (!num(r.finalStatus)) return false; // destino fuera del rastreo: no se sabe
      if (r.finalStatus !== 200) return true;
      const final = byUrl.get(r.chain[r.chain.length - 1]);
      return !!final && final.indexReason === 'noindex';
    };
    const failsNow = (r) => (r.status >= 300 && r.status < 400 ? redirectFails(r) : r.status >= 400 || r.status === 0 || r.indexReason === 'noindex');
    add('trafico-falla', 'organico', 'critico', 1, 'Páginas con tráfico que hoy fallan',
      'Recibieron clics o visitas en el periodo, pero hoy dan error, no responden, tienen noindex o redirigen a una página que falla. Cada día así pierdes visitas y posiciones que ya tenías.',
      'Restaura la página o redirígela con 301 a su equivalente más cercana que responda 200. Si el noindex no es intencional, quítalo y pide la indexación en Search Console.',
      internal.filter((r) => hasTraffic(r) && failsNow(r)),
      { source: 'gsc+ga' });
    // Va en Conversión: la solución es de CRO (agregar la llamada a la acción) y así
    // se agrupa con «Páginas clave sin llamada a la acción»; el tráfico solo sube su prioridad.
    add('trafico-sin-cta', 'conversion', 'alto', 2, 'Páginas con tráfico sin llamada a la acción',
      'Ya traen visitas según Search Console o Analytics, pero no le piden nada al visitante: ni botón ni formulario. Es tráfico ganado que se va sin convertir.',
      'Agrega una llamada a la acción acorde a la intención de la página: un botón visible arriba y otro al final, o un formulario corto.',
      pages.filter((r) => ((hasGsc(r) && r.gsc.clicks >= G.trafficClicks) || (hasGa(r) && r.ga.views >= G.trafficViews)) && !(r.ctas || []).length && !(r.forms || []).length),
      { source: 'gsc+ga' });
    if (siteHasGa) {
      const siteHasKeyEvents = gaRows.some((r) => r.ga.keyEvents > 0);
      add('sin-eventos-clave', 'organico', 'medio', 2, 'Páginas con visitas pero sin eventos clave',
        'Tienen visitas en Analytics y ninguna termina en un evento clave (formulario, compra, clic a WhatsApp). O la página no convierte o la conversión no se mide.',
        siteHasKeyEvents
          ? 'Revisa la llamada a la acción de cada página y prueba el recorrido hasta el evento clave en el informe en tiempo real de GA4.'
          : 'Ninguna página registra eventos clave. Marca en GA4 los eventos que cuentan como conversión (Administrar → Visualización de datos → Eventos clave) y vuelve a importar los datos.',
        pages.filter((r) => hasGa(r) && r.ga.views >= G.keyEventViews && !(r.ga.keyEvents > 0)),
        { source: 'ga' });
    }
    add('no-indexada', 'organico', 'alto', 2, 'Google no indexó la página',
      'La inspección de URL de Search Console indica que Google no la tiene en su índice, aunque tu sitio la marca como indexable. No puede aparecer en ninguna búsqueda.',
      'Revisa el estado de cobertura en el panel de detalle. Enlázala desde páginas importantes, inclúyela en el sitemap y pide la indexación en Search Console.',
      indexable.filter((r) => notIndexed(r.inspection)), { source: 'inspection' });
    add('canonical-google', 'organico', 'alto', 2, 'Canonical elegido por Google distinto del declarado',
      'Google ignoró tu canonical y eligió otra URL como principal. Las señales se juntan en una versión que no elegiste.',
      'Compara ambas URLs. Unifica el contenido duplicado, apunta enlaces internos y sitemap a la versión que quieres, o redirige la otra con 301.',
      pages.filter((r) => {
        const ins = r.inspection;
        if (!ins || !ins.googleCanonical) return false;
        const declared = ins.userCanonical || r.canonical;
        return !!declared && !sameUrl(ins.googleCanonical, declared);
      }), { source: 'inspection' });

    // Rendimiento medido con Lighthouse (móvil si existe; si no, escritorio). Solo con datos.
    const L = LIGHTHOUSE_RULES;
    const lhPages = pages.map((r) => [r, pickLighthouse(r)]).filter(([, lh]) => lh);
    const cwvNote = 'Octos usa la medición móvil si existe y prefiere los datos reales de usuarios de Chrome (CrUX) de la URL; si no hay, usa el laboratorio de Lighthouse.';
    add('lcp-lento', 'rendimiento', 'alto', 2, 'LCP lento (> 2,5 s)',
      'El contenido principal tarda en aparecer, y el LCP es una de las Core Web Vitals que Google usa. ' + cwvNote,
      'Optimiza la imagen principal (WebP o AVIF, tamaño justo, fetchpriority="high"), no la cargues en diferido y baja el tiempo de respuesta del servidor.',
      lhPages.filter(([, lh]) => metricOf(lh, 'lcp') > L.lcp).map(([r]) => r), { source: 'lighthouse' });
    add('cls-alto', 'rendimiento', 'medio', 2, 'CLS alto (> 0,1)',
      'El contenido se mueve mientras carga y provoca clics equivocados. El CLS es una de las Core Web Vitals. ' + cwvNote,
      'Declara width y height en imágenes y videos, reserva espacio para banners y anuncios, y precarga las fuentes principales.',
      lhPages.filter(([, lh]) => metricOf(lh, 'cls') > L.cls).map(([r]) => r), { source: 'lighthouse' });
    add('inp-tbt-alto', 'rendimiento', 'medio', 3, 'INP o TBT altos',
      'La página tarda en responder a clics y toques. Octos usa el INP real de Chrome (> 200 ms) cuando existe para la URL; si no, el TBT de laboratorio (> 200 ms).',
      'Divide las tareas largas de JavaScript, difiere los scripts de terceros y quita el código que no se usa.',
      lhPages.filter(([, lh]) => {
        const inp = metricOf(lh, 'inp', { fieldOnly: true });
        if (inp !== null) return inp > L.inp;
        const tbt = metricOf(lh, 'tbt', { labOnly: true });
        return tbt !== null && tbt > L.tbt;
      }).map(([r]) => r), { source: 'lighthouse' });
    add('lh-rendimiento', 'rendimiento', 'alto', 3, 'Puntaje de rendimiento bajo (< 50)',
      'Lighthouse resume la velocidad de carga en este puntaje de laboratorio. Bajo 50 la experiencia es mala, sobre todo en móviles.',
      'Abre las oportunidades de Lighthouse en el panel de detalle y parte por las de mayor ahorro.',
      lhPages.filter(([, lh]) => lh.scores && num(lh.scores.performance) && lh.scores.performance < L.performance).map(([r]) => r),
      { source: 'lighthouse' });
    add('lh-accesibilidad', 'rendimiento', 'medio', 2, 'Puntaje de accesibilidad bajo (< 80)',
      'Hay barreras para quienes usan lector de pantalla, ven poco o navegan con teclado. Esas mismas barreras suelen bajar la conversión.',
      'Corrige contraste, etiquetas de formularios, textos alternativos y nombres de botones según el informe de Lighthouse.',
      lhPages.filter(([, lh]) => lh.scores && num(lh.scores.accessibility) && lh.scores.accessibility < L.accessibility).map(([r]) => r),
      { source: 'lighthouse' });

    // ---- Prioridad y puntaje
    const base = Math.max(1, pages.length);
    for (const it of issues) {
      const w = SEV[it.severity].weight;
      const share = it.site ? 1 : Math.min(1, it.count / base);
      it.share = share;
      it.penalty = w * Math.sqrt(share);
      it.priority = (w * Math.sqrt(Math.max(1, it.count))) / it.effort;
    }
    issues.sort((a, b) => b.priority - a.priority);

    const scoreFrom = (list) => Math.max(0, Math.round(100 - Math.min(100, list.reduce((s, i) => s + i.penalty, 0))));
    const categoryScores = {};
    for (const c of CATEGORIES) categoryScores[c.id] = scoreFrom(issues.filter((i) => i.category === c.id).map((i) => ({ penalty: i.penalty * 2.2 })));
    // «Tráfico orgánico» depende de Search Console, Analytics o la inspección de URL.
    // Sin esos datos su puntaje es null (la interfaz lo muestra como «Sin datos») en vez
    // de un 100 que haría creer que todo está bien. Las demás categorías salen del
    // rastreo y siempre tienen número.
    if (!hasGoogleData) categoryScores.organico = null;
    const score = pages.length ? scoreFrom(issues) : null;

    // ---- Estadísticas
    const buckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, 'Sin respuesta': 0 };
    for (const r of internal) {
      if (r.status === 0) buckets['Sin respuesta']++;
      else buckets[`${String(r.status)[0]}xx`] = (buckets[`${String(r.status)[0]}xx`] || 0) + 1;
    }
    const depth = {};
    for (const r of pages) {
      const d = r.clickDepth === null || r.clickDepth === undefined ? '?' : r.clickDepth > 5 ? '5+' : String(r.clickDepth);
      depth[d] = (depth[d] || 0) + 1;
    }
    const times = pages.map((r) => r.time).filter((t) => t > 0).sort((a, b) => a - b);
    const stats = {
      total: rows.length,
      internal: internal.length,
      external: rows.length - internal.length,
      pages: pages.length,
      indexable: indexable.length,
      nonIndexable: htmlInternal.length - indexable.length,
      buckets,
      depth,
      medianTime: times.length ? times[Math.floor(times.length / 2)] : 0,
      p90Time: times.length ? times[Math.floor(times.length * 0.9)] : 0,
      avgWords: pages.length ? Math.round(pages.reduce((s, r) => s + (r.wordCount || 0), 0) / pages.length) : 0,
      withCta: pages.filter((r) => (r.ctas || []).length || (r.forms || []).length).length,
      withSchema: pages.filter((r) => (r.jsonldTypes || []).length).length,
      schemaTypes: countTypes(pages),
      issueCounts: {
        critico: issues.filter((i) => i.severity === 'critico').length,
        alto: issues.filter((i) => i.severity === 'alto').length,
        medio: issues.filter((i) => i.severity === 'medio').length,
        bajo: issues.filter((i) => i.severity === 'bajo').length,
      },
    };

    // Datos de Google y Lighthouse: las claves solo existen si hay datos. Los totales
    // cuentan una sola vez las variantes de URL (redirección por barra final, www o
    // protocolo) que recibieron los mismos datos que su destino.
    if (siteHasGsc) {
      const uniq = uniqueBy(gscRows, (r) => `${r.gsc.clicks}|${r.gsc.impressions}|${r.gsc.position}`);
      const clicks = uniq.reduce((s, r) => s + (r.gsc.clicks || 0), 0);
      const impressions = uniq.reduce((s, r) => s + r.gsc.impressions, 0);
      const weighted = uniq.filter((r) => num(r.gsc.position) && r.gsc.impressions > 0);
      const wImpr = weighted.reduce((s, r) => s + r.gsc.impressions, 0);
      stats.gsc = {
        pages: uniq.length,
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0, // CTR medio ponderado por impresiones (0..1)
        position: wImpr ? weighted.reduce((s, r) => s + r.gsc.position * r.gsc.impressions, 0) / wImpr : null, // ponderada por impresiones
        range: (gscRows.find((r) => r.gsc.range) || { gsc: {} }).gsc.range || null,
      };
    }
    if (siteHasGa) {
      const uniq = uniqueBy(gaRows, (r) => `${r.ga.views}|${r.ga.sessions}|${r.ga.keyEvents}`);
      stats.ga = {
        pages: uniq.length,
        views: uniq.reduce((s, r) => s + r.ga.views, 0),
        sessions: uniq.reduce((s, r) => s + (num(r.ga.sessions) ? r.ga.sessions : 0), 0),
        keyEvents: uniq.reduce((s, r) => s + (num(r.ga.keyEvents) ? r.ga.keyEvents : 0), 0),
        range: (gaRows.find((r) => r.ga.range) || { ga: {} }).ga.range || null,
      };
    }
    if (lhPages.length) {
      stats.lighthouse = {
        pages: lhPages.length,
        mobile: lhPages.filter(([r, lh]) => r.lighthouse.mobile === lh).length, // el resto usa escritorio
        medianLcp: median(lhPages.map(([, lh]) => metricOf(lh, 'lcp'))),
        medianCls: median(lhPages.map(([, lh]) => metricOf(lh, 'cls'))),
        medianPerformance: median(lhPages.map(([, lh]) => lh.scores && lh.scores.performance)),
      };
    }
    if (inspected.length) {
      stats.inspection = { pages: inspected.length, notIndexed: inspected.filter((r) => notIndexed(r.inspection)).length };
    }

    return { rows, issues, score, categoryScores, stats, nearPairs: near.length };
  }

  function countTypes(pages) {
    const m = {};
    for (const r of pages) for (const t of r.jsonldTypes || []) m[t] = (m[t] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }

  // Resumen para comparar con el rastreo anterior
  function summarize(result) {
    return {
      score: result.score,
      pages: result.stats.pages,
      issues: Object.fromEntries(result.issues.map((i) => [i.id, i.count])),
    };
  }

  const api = { analyze, summarize, SEV, CATEGORIES, isPage, expectedCtr, CTR_CURVE, GOOGLE_RULES, LIGHTHOUSE_RULES, pickLighthouse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OctosAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
