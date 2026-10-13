// Motor de rastreo: cola BFS con concurrencia, robots.txt, sitemaps,
// redirecciones paso a paso, enlaces externos opcionales y renderizado JS.
const { EventEmitter } = require('events');
const { parseRobots, isAllowed } = require('./robots');
const { readSitemaps } = require('./sitemap');
const { normalizeUrl, isInternal } = require('./urls');
const { analyzeHtml } = require('./extract');

const MAX_BODY = 12 * 1024 * 1024;

const DEFAULTS = {
  maxUrls: 5000,
  maxDepth: 12,
  concurrency: 6,
  delayMs: 0,
  timeoutMs: 20000,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) OctosSEO/1.0',
  respectRobots: true,
  includeSubdomains: false,
  checkExternal: false,
  crawlSitemaps: true,
  renderJs: false,
  includePatterns: [],
  excludePatterns: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function compile(patterns) {
  return (patterns || [])
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

class Crawler extends EventEmitter {
  constructor(options = {}, { render } = {}) {
    super();
    this.opts = { ...DEFAULTS, ...options };
    this.render = render || null; // async (url) => ({ html, error })
    this.include = compile(this.opts.includePatterns);
    this.exclude = compile(this.opts.excludePatterns);
    this.rows = new Map(); // url → fila
    this.edges = []; // [fromId, toUrl, anchor, nofollow]
    this.queue = [];
    this.queued = new Set();
    this.internalQueued = 0;
    this.externalQueued = 0;
    this.active = 0;
    this.nextId = 1;
    this.state = 'idle';
    this.sitemapUrls = new Set();
    this.sitemapFiles = [];
    this.robots = null;
    this.robotsTxt = '';
    this.startedAt = 0;
    this.finishedAt = 0;
    this._resume = null;
  }

  log(msg) {
    this.emit('log', msg);
  }

  async start() {
    const start = normalizeUrl(this.opts.startUrl, undefined, { stripTracking: false });
    if (!start) throw new Error('La URL de inicio no es válida. Prueba con https://tusitio.com');
    this.startUrl = start;
    this.startHost = new URL(start).hostname;
    this.state = 'running';
    this.startedAt = Date.now();
    this.emit('state', this.state);

    const origin = new URL(start).origin;
    try {
      const res = await this.fetchBuffer(origin + '/robots.txt');
      if (res && res.status === 200) {
        this.robotsTxt = res.body.toString('utf8').slice(0, 500000);
        this.robots = parseRobots(this.robotsTxt);
        this.log(`robots.txt leído (${this.robots.groups.length} grupos, ${this.robots.sitemaps.length} sitemaps)`);
      } else this.log(`Sin robots.txt (estado ${res ? res.status : 'sin respuesta'})`);
    } catch (err) {
      this.log(`No se pudo leer robots.txt: ${err.message}`);
    }

    if (this.robots) this.robots.sitemaps = this.robots.sitemaps.map((s) => normalizeUrl(s, origin, { stripTracking: false })).filter(Boolean);
    const seeds = this.robots && this.robots.sitemaps.length ? this.robots.sitemaps : [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
    try {
      const { urls, files } = await readSitemaps(seeds, (u) => this.fetchBuffer(u), (m) => this.log(m));
      for (const u of urls) {
        const n = normalizeUrl(u, undefined, { stripTracking: false });
        if (n) this.sitemapUrls.add(n);
      }
      // Los sitemaps "adivinados" que no existen no son un error del sitio
      const declared = new Set(this.robots ? this.robots.sitemaps : []);
      this.sitemapFiles = files.filter((f) => f.status === 200 || declared.has(f.url) || !seeds.includes(f.url));
      if (this.sitemapUrls.size) this.log(`${this.sitemapUrls.size} URLs encontradas en ${files.filter((f) => f.status === 200).length} sitemaps`);
    } catch (err) {
      this.log(`Error leyendo sitemaps: ${err.message}`);
    }
    this.emit('meta', this.meta());

    this.enqueue(start, 0, 'inicio');
    if (this.opts.crawlSitemaps) for (const u of this.sitemapUrls) this.enqueue(u, null, 'sitemap');

    const workers = Array.from({ length: Math.max(1, Math.min(32, this.opts.concurrency)) }, () => this.worker());
    await Promise.all(workers);
    this.finishedAt = Date.now();
    if (this.state !== 'stopped') this.state = 'done';
    this.emit('meta', this.meta());
    this.emit('state', this.state);
    this.emit('done');
  }

  meta() {
    return {
      startUrl: this.startUrl,
      startHost: this.startHost,
      robotsTxt: this.robotsTxt,
      sitemapFiles: this.sitemapFiles,
      sitemapUrlCount: this.sitemapUrls.size,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      options: this.opts,
    };
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.emit('state', this.state);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.emit('state', this.state);
    if (this._resume) this._resume();
    this._resume = null;
  }

  stop() {
    const wasPaused = this.state === 'paused';
    this.state = 'stopped';
    this.queue.length = 0;
    if (wasPaused && this._resume) this._resume();
    this.emit('state', this.state);
  }

  allowedByPatterns(url) {
    if (this.include.length && !this.include.some((r) => r.test(url))) return false;
    if (this.exclude.some((r) => r.test(url))) return false;
    return true;
  }

  enqueue(url, depth, source) {
    if (!url || this.queued.has(url) || this.state === 'stopped') return;
    const internal = isInternal(url, this.startHost, this.opts.includeSubdomains);
    if (internal) {
      if (this.internalQueued >= this.opts.maxUrls) return;
      if (depth !== null && depth > this.opts.maxDepth) return;
      if (url !== this.startUrl && !this.allowedByPatterns(url)) return;
      this.internalQueued++;
    } else {
      if (!this.opts.checkExternal || this.externalQueued >= this.opts.maxUrls) return;
      this.externalQueued++;
    }
    this.queued.add(url);
    this.queue.push({ url, depth, source, internal });
  }

  async worker() {
    for (;;) {
      if (this.state === 'stopped') return;
      if (this.state === 'paused') {
        await new Promise((r) => {
          const prev = this._resume;
          this._resume = () => {
            if (prev) prev();
            r();
          };
        });
        continue;
      }
      const item = this.queue.shift();
      if (!item) {
        if (this.active === 0) return;
        await sleep(40);
        continue;
      }
      this.active++;
      try {
        await this.process(item);
      } catch (err) {
        this.saveRow(this.newRow(item, { status: 0, error: err.message }));
      } finally {
        this.active--;
      }
      this.emit('progress', this.progress());
      if (this.opts.delayMs) await sleep(this.opts.delayMs);
    }
  }

  progress() {
    const crawled = this.rows.size;
    const elapsed = (Date.now() - this.startedAt) / 1000 || 1;
    return {
      crawled,
      queued: this.queue.length,
      active: this.active,
      total: this.queued.size,
      rate: Math.round((crawled / elapsed) * 10) / 10,
    };
  }

  newRow(item, extra = {}) {
    return {
      id: this.nextId++,
      url: item.url,
      internal: item.internal,
      depth: item.depth,
      source: item.source,
      inSitemap: this.sitemapUrls.has(item.url),
      status: 0,
      ...extra,
    };
  }

  saveRow(row) {
    this.rows.set(row.url, row);
    this.emit('row', row);
  }

  async request(url, method = 'GET') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': this.opts.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'es-CL,es;q=0.9,en;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
      });
      const ttfb = Math.round(performance.now() - t0);
      const headers = Object.fromEntries(res.headers.entries());
      let body = Buffer.alloc(0);
      if (method === 'GET' && res.body) {
        const chunks = [];
        let size = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BODY) {
            ctrl.abort();
            break;
          }
          chunks.push(value);
        }
        body = Buffer.concat(chunks);
      }
      return { status: res.status, statusText: res.statusText, headers, body, ttfb, total: Math.round(performance.now() - t0) };
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchBuffer(url) {
    // Para robots y sitemaps: sigue redirecciones
    let current = url;
    for (let i = 0; i < 5; i++) {
      const res = await this.request(current);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        current = new URL(res.headers.location, current).toString();
        continue;
      }
      return res;
    }
    return null;
  }

  async process(item) {
    const { url } = item;

    if (!item.internal) {
      let res;
      try {
        res = await this.request(url, 'HEAD');
        if (res.status === 405 || res.status === 403 || res.status === 501) res = await this.request(url, 'GET');
      } catch (err) {
        return this.saveRow(this.newRow(item, { status: 0, error: err.name === 'AbortError' ? 'Tiempo de espera agotado' : err.message }));
      }
      return this.saveRow(
        this.newRow(item, {
          status: res.status,
          statusText: res.statusText,
          contentType: (res.headers['content-type'] || '').split(';')[0],
          time: res.ttfb,
          redirectTo: res.headers.location ? normalizeUrl(res.headers.location, url, { stripTracking: false }) : '',
        })
      );
    }

    if (this.opts.respectRobots && !isAllowed(this.robots, url, this.opts.userAgent)) {
      return this.saveRow(this.newRow(item, { status: 0, blockedByRobots: true, indexable: false, indexReason: 'Bloqueada por robots.txt' }));
    }

    let res;
    try {
      res = await this.request(url);
    } catch (err) {
      return this.saveRow(this.newRow(item, { status: 0, error: err.name === 'AbortError' ? 'Tiempo de espera agotado' : err.message, indexable: false, indexReason: 'Sin respuesta' }));
    }

    const contentType = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const xRobots = (res.headers['x-robots-tag'] || '').toLowerCase();
    const row = this.newRow(item, {
      status: res.status,
      statusText: res.statusText,
      contentType,
      size: res.body.length,
      time: res.ttfb,
      download: res.total,
      xRobots,
      server: res.headers.server || '',
      lastModified: res.headers['last-modified'] || '',
      hsts: !!res.headers['strict-transport-security'],
    });

    if (res.status >= 300 && res.status < 400) {
      const target = res.headers.location ? normalizeUrl(res.headers.location, url, { stripTracking: false }) : '';
      row.redirectTo = target;
      row.indexable = false;
      row.indexReason = 'Redirección';
      this.saveRow(row);
      if (target) {
        this.edges.push([row.id, target, '(redirección)', 0]);
        this.emit('edges', [[row.id, target, '(redirección)', 0]]);
        this.enqueue(target, item.depth, 'redirección');
      }
      return;
    }

    const isHtml = contentType.includes('html') || (!contentType && /^\s*</.test(res.body.slice(0, 200).toString()));
    if (!isHtml || res.status >= 400) {
      row.indexable = false;
      row.indexReason = res.status >= 500 ? 'Error del servidor' : res.status >= 400 ? 'Error del cliente' : 'No es HTML';
      if (res.status === 200 && !isHtml) row.indexable = !/noindex/.test(xRobots);
      if (res.status === 200 && !isHtml && row.indexable) row.indexReason = '';
      return this.saveRow(row);
    }

    const rawHtml = res.body.toString('utf8');
    let page = analyzeHtml(rawHtml, url, res.headers);

    if (this.opts.renderJs && this.render) {
      const rendered = await this.render(url);
      if (rendered && rendered.html) {
        const raw = page;
        page = analyzeHtml(rendered.html, url, res.headers);
        const rawLinks = new Set(raw.links.map((l) => l.url));
        row.jsDiff = {
          titleChanged: raw.title !== page.title,
          rawTitle: raw.title,
          linksAdded: page.links.filter((l) => !rawLinks.has(l.url)).length,
          wordsAdded: page.wordCount - raw.wordCount,
          rawWords: raw.wordCount,
          h1Changed: raw.h1.join('|') !== page.h1.join('|'),
          canonicalChanged: raw.canonical !== page.canonical,
        };
      } else if (rendered && rendered.error) {
        row.renderError = rendered.error;
      }
    }

    const { links, ...fields } = page;
    Object.assign(row, fields);

    const robotsDirectives = (page.metaRobots + ',' + xRobots).toLowerCase();
    const canonicalOther = page.canonical && page.canonical !== url && page.canonical.replace(/\/$/, '') !== url.replace(/\/$/, '');
    if (/noindex|none/.test(robotsDirectives)) {
      row.indexable = false;
      row.indexReason = 'noindex';
    } else if (canonicalOther) {
      row.indexable = false;
      row.indexReason = 'Canonicalizada';
    } else {
      row.indexable = true;
      row.indexReason = '';
    }

    let internalOut = 0;
    let externalOut = 0;
    const seen = new Set();
    const newEdges = [];
    const followAllowed = !/nofollow|none/.test(robotsDirectives);
    for (const link of links) {
      const internal = isInternal(link.url, this.startHost, this.opts.includeSubdomains);
      if (internal) internalOut++;
      else externalOut++;
      const key = link.url + '|' + link.anchor;
      if (seen.has(key)) continue;
      seen.add(key);
      newEdges.push([row.id, link.url, link.anchor, link.nofollow ? 1 : 0]);
      if (!link.nofollow && followAllowed) {
        const nextDepth = item.depth === null ? null : item.depth + 1;
        this.enqueue(link.url, internal ? nextDepth : 0, 'enlace');
      }
    }
    row.outlinksInternal = internalOut;
    row.outlinksExternal = externalOut;
    for (const e of newEdges) this.edges.push(e);
    this.saveRow(row);
    if (newEdges.length) this.emit('edges', newEdges);
  }

  snapshot() {
    return { meta: this.meta(), rows: [...this.rows.values()], edges: this.edges };
  }
}

module.exports = { Crawler, DEFAULTS };
