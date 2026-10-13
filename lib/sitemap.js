// Descubre y lee sitemaps XML (índices, .gz) hasta un tope razonable.
const zlib = require('zlib');

const MAX_SITEMAPS = 60;
const MAX_URLS = 100000;

function locs(xml) {
  const out = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

async function readSitemaps(seeds, fetchBuffer, onLog = () => {}) {
  const queue = [...new Set(seeds)];
  const seen = new Set();
  const urls = new Set();
  const files = [];

  while (queue.length && seen.size < MAX_SITEMAPS && urls.size < MAX_URLS) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    try {
      const res = await fetchBuffer(sm);
      if (!res || res.status !== 200) {
        files.push({ url: sm, status: res ? res.status : 0, urls: 0 });
        continue;
      }
      let buf = res.body;
      if (sm.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) {
        try { buf = zlib.gunzipSync(buf); } catch { /* ya venía descomprimido */ }
      }
      const xml = buf.toString('utf8');
      const found = locs(xml);
      if (/<sitemapindex/i.test(xml)) {
        for (const child of found) queue.push(child);
        files.push({ url: sm, status: 200, urls: 0, index: true, children: found.length });
      } else {
        for (const u of found) if (urls.size < MAX_URLS) urls.add(u);
        files.push({ url: sm, status: 200, urls: found.length });
      }
    } catch (err) {
      onLog(`No se pudo leer el sitemap ${sm}: ${err.message}`);
      files.push({ url: sm, status: 0, urls: 0, error: err.message });
    }
  }
  return { urls, files };
}

function buildSitemapXml(list) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = list
    .map((u) => `  <url>\n    <loc>${esc(u.url)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

module.exports = { readSitemaps, buildSitemapXml, locs };
