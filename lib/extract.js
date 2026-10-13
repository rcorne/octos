// Analiza el HTML de una página: SEO on-page, enlaces, imágenes, datos
// estructurados, señales de conversión (CRO) y de rendimiento.
const cheerio = require('cheerio');
const { textWidth, LIMITS } = require('./pixels');
const { simhash } = require('./simhash');
const { normalizeUrl } = require('./urls');

const CTA_WORDS = [
  // es
  'comprar', 'compra', 'añadir al carro', 'agregar al carro', 'agregar al carrito', 'añadir al carrito', 'cotizar', 'cotiza',
  'contactar', 'contáctanos', 'contactanos', 'contacto', 'escríbenos', 'llámanos', 'agendar', 'agenda', 'reservar', 'reserva',
  'suscríbete', 'suscribirse', 'registrarse', 'regístrate', 'empezar', 'comenzar', 'comienza', 'empieza', 'prueba gratis',
  'probar gratis', 'solicitar', 'solicita', 'descargar', 'descarga', 'pedir', 'pide', 'quiero', 'ver planes', 'ver precios',
  'hablar con', 'demo', 'inscríbete', 'únete',
  // en
  'buy', 'add to cart', 'add to bag', 'shop now', 'get started', 'start free', 'free trial', 'try free', 'sign up', 'subscribe',
  'contact us', 'book', 'request', 'download', 'get a quote', 'talk to', 'join', 'order now', 'see pricing', 'get demo',
  // pt
  'comprar agora', 'fale conosco', 'assine', 'cadastre-se', 'baixar', 'solicitar orçamento',
];
const CTA_RE = new RegExp('(^|[^\\p{L}])(' + CTA_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')($|[^\\p{L}])', 'iu');

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function analyzeHtml(html, pageUrl, headers = {}) {
  const $ = cheerio.load(html);
  const pageHost = new URL(pageUrl).hostname;
  const isHttps = pageUrl.startsWith('https:');

  const baseHref = $('base[href]').attr('href');
  const base = baseHref ? normalizeUrl(baseHref, pageUrl) || pageUrl : pageUrl;

  // ---- Metadatos
  const titles = $('head title, title').map((_, el) => clean($(el).text())).get();
  const title = titles[0] || '';
  const metaDescs = $('meta[name="description" i]').map((_, el) => clean($(el).attr('content'))).get();
  const metaDesc = metaDescs[0] || '';
  const metaRobots = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, el) => clean($(el).attr('content')).toLowerCase())
    .get()
    .join(', ');
  const canonicals = $('link[rel~="canonical" i]').map((_, el) => $(el).attr('href')).get();
  const canonical = canonicals[0] ? normalizeUrl(canonicals[0], base, { stripTracking: false }) : '';
  const lang = clean($('html').attr('lang'));
  const viewport = clean($('meta[name="viewport" i]').attr('content'));
  const charset = $('meta[charset]').attr('charset') || '';
  const favicon = $('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]').length > 0;

  const hreflang = $('link[rel="alternate" i][hreflang]')
    .map((_, el) => ({ lang: $(el).attr('hreflang'), href: normalizeUrl($(el).attr('href'), base, { stripTracking: false }) }))
    .get();

  const og = {
    title: clean($('meta[property="og:title"]').attr('content')),
    description: clean($('meta[property="og:description"]').attr('content')),
    image: clean($('meta[property="og:image"]').attr('content')),
  };
  const twitterCard = clean($('meta[name="twitter:card"]').attr('content'));

  // ---- Datos estructurados
  const jsonldTypes = new Set();
  let jsonldErrors = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(visit);
        const t = node['@type'];
        if (t) (Array.isArray(t) ? t : [t]).forEach((x) => jsonldTypes.add(String(x)));
        if (node['@graph']) visit(node['@graph']);
      };
      visit(data);
    } catch {
      jsonldErrors++;
    }
  });
  const microdata = $('[itemtype]').length;

  // ---- Encabezados
  const h1 = $('h1').map((_, el) => clean($(el).text())).get().filter(Boolean);
  const h2 = $('h2').map((_, el) => clean($(el).text())).get().filter(Boolean);
  const headingOrder = $('h1,h2,h3,h4,h5,h6').map((_, el) => Number(el.tagName[1])).get();
  let headingSkips = 0;
  for (let i = 1; i < headingOrder.length; i++) if (headingOrder[i] - headingOrder[i - 1] > 1) headingSkips++;

  // ---- Scripts y rendimiento (antes de quitarlos para contar palabras)
  const scripts = $('script[src]');
  let blockingScripts = 0;
  const thirdPartyHosts = new Set();
  scripts.each((_, el) => {
    const $el = $(el);
    const inHead = $el.closest('head').length > 0;
    const type = ($el.attr('type') || '').toLowerCase();
    if (inHead && $el.attr('async') === undefined && $el.attr('defer') === undefined && type !== 'module') blockingScripts++;
    try {
      const host = new URL($el.attr('src'), base).hostname;
      if (host && host !== pageHost) thirdPartyHosts.add(host);
    } catch { /* src inválido */ }
  });
  const stylesheets = $('link[rel="stylesheet" i]').length;
  const inlineScriptBytes = $('script:not([src])').text().length;

  let mixedContent = 0;
  if (isHttps) {
    $('img[src], script[src], link[rel="stylesheet" i][href], iframe[src], source[src], video[src], audio[src]').each((_, el) => {
      const v = $(el).attr('src') || $(el).attr('href') || '';
      if (/^http:\/\//i.test(v)) mixedContent++;
    });
  }

  // ---- Imágenes
  const images = [];
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-src') || '';
    images.push({
      src: src ? normalizeUrl(src, base, { stripTracking: false }) || src : '',
      alt: $el.attr('alt'),
      hasDims: $el.attr('width') !== undefined && $el.attr('height') !== undefined,
      lazy: ($el.attr('loading') || '').toLowerCase() === 'lazy',
    });
  });
  const imagesNoAlt = images.filter((i) => i.alt === undefined).length;
  const imagesEmptyAlt = images.filter((i) => i.alt !== undefined && clean(i.alt) === '').length;
  const imagesNoDims = images.filter((i) => !i.hasDims).length;

  // ---- Conversión (CRO)
  const forms = [];
  $('form').each((_, el) => {
    const $f = $(el);
    const fields = $f.find('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
    let unlabeled = 0;
    fields.each((__, field) => {
      const $field = $(field);
      const id = $field.attr('id');
      const labelled =
        $field.attr('aria-label') ||
        $field.attr('aria-labelledby') ||
        $field.attr('title') ||
        $field.closest('label').length ||
        (id && $(`label[for="${id.replace(/"/g, '\\"')}"]`).length);
      if (!labelled) unlabeled++;
    });
    forms.push({ fields: fields.length, unlabeled });
  });
  const ctaTexts = new Set();
  $('a, button, input[type="submit"], input[type="button"], [role="button"]').each((_, el) => {
    const $el = $(el);
    const label = clean($el.text() || $el.attr('value') || $el.attr('aria-label') || '');
    if (label && label.length <= 60 && CTA_RE.test(label)) ctaTexts.add(label);
  });
  const hrefs = $('a[href]').map((_, el) => $(el).attr('href')).get();
  const hasTel = hrefs.some((h) => /^tel:/i.test(h));
  const hasMailto = hrefs.some((h) => /^mailto:/i.test(h));
  const hasWhatsapp = hrefs.some((h) => /wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(h));

  // ---- Enlaces
  const links = [];
  let nofollowLinks = 0;
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') || '').trim();
    if (!href || /^(javascript:|mailto:|tel:|data:|#)/i.test(href)) return;
    const abs = normalizeUrl(href, base);
    if (!abs) return;
    const rel = ($el.attr('rel') || '').toLowerCase();
    const nofollow = /\bnofollow\b/.test(rel) || /\bnofollow\b/.test(metaRobots);
    if (nofollow) nofollowLinks++;
    let anchor = clean($el.text());
    if (!anchor) anchor = clean($el.find('img[alt]').attr('alt')) ? `[img] ${clean($el.find('img[alt]').attr('alt'))}` : '';
    links.push({ url: abs, anchor: anchor.slice(0, 120), nofollow });
  });

  // ---- Texto visible
  $('script, style, noscript, template, svg, iframe').remove();
  const bodyText = clean($('body').text() || $.root().text());
  const words = bodyText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const wordCount = words.length;
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const textRatio = htmlBytes ? Math.round((Buffer.byteLength(bodyText, 'utf8') / htmlBytes) * 100) : 0;

  return {
    title,
    titleCount: titles.length,
    titleLen: [...title].length,
    titlePx: textWidth(title, LIMITS.titleSize),
    metaDesc,
    metaDescCount: metaDescs.length,
    descLen: [...metaDesc].length,
    descPx: textWidth(metaDesc, LIMITS.descSize),
    metaRobots,
    canonical,
    canonicalCount: canonicals.length,
    lang,
    viewport,
    charset,
    favicon,
    hreflang,
    og,
    twitterCard,
    jsonldTypes: [...jsonldTypes],
    jsonldErrors,
    microdata,
    h1,
    h2Count: h2.length,
    h2First: h2.slice(0, 5),
    headingSkips,
    wordCount,
    textRatio,
    simhash: simhash(bodyText),
    images: images.slice(0, 300),
    imagesTotal: images.length,
    imagesNoAlt,
    imagesEmptyAlt,
    imagesNoDims,
    scripts: scripts.length,
    blockingScripts,
    thirdPartyHosts: [...thirdPartyHosts],
    stylesheets,
    inlineScriptBytes,
    mixedContent,
    forms,
    ctas: [...ctaTexts].slice(0, 12),
    hasTel,
    hasMailto,
    hasWhatsapp,
    links,
    nofollowLinks,
    compression: (headers['content-encoding'] || '').toLowerCase(),
    cacheControl: headers['cache-control'] || '',
  };
}

module.exports = { analyzeHtml, CTA_RE };
