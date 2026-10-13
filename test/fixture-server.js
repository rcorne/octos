// Sitio de prueba con problemas conocidos para validar el rastreador.
const http = require('http');

const lorem = (n, seed = '') =>
  Array.from({ length: n }, (_, i) => ['contenido', 'útil', 'sobre', 'seo', 'técnico', 'para', 'pymes', 'chilenas', 'que', 'venden', 'online'][(i * 7 + seed.length) % 11]).join(' ');
const long = (topic) =>
  `${topic} ` +
  Array.from({ length: 260 }, (_, i) => `${topic}${i % 13} palabra${i % 17} frase${i % 23}`).join(' ');

function page({ title, desc, h1, body = '', links = [], extraHead = '', lang = 'es' }) {
  return `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title !== undefined ? `<title>${title}</title>` : ''}
${desc ? `<meta name="description" content="${desc}">` : ''}
${extraHead}
<link rel="icon" href="/favicon.ico">
</head><body>
${h1 ? `<h1>${h1}</h1>` : ''}
<nav>${links.map(([href, text]) => `<a href="${href}">${text}</a>`).join(' ')}</nav>
<main>${body}</main>
</body></html>`;
}

const routes = {
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /privado\nAllow: /privado/publico\nSitemap: /sitemap.xml\n' },
  '/sitemap.xml': {
    type: 'application/xml',
    body: (base) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/</loc></url><url><loc>${base}/servicios</loc></url><url><loc>${base}/huerfana</loc></url>
<url><loc>${base}/viejo</loc></url><url><loc>${base}/noindex</loc></url></urlset>`,
  },
  '/': {
    body: page({
      title: 'Agencia SEO en Santiago | Ejemplo',
      desc: 'Hacemos crecer tu tráfico orgánico con estrategia, contenido y técnica. Agenda una llamada gratis hoy.',
      h1: 'Agencia SEO en Santiago',
      extraHead: '<link rel="canonical" href="/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Ejemplo"}</script><meta property="og:title" content="Ejemplo"><meta property="og:image" content="/og.jpg">',
      body: `<p>${long('portada')}</p><a class="btn" href="/contacto">Agenda una llamada</a><a href="tel:+56900000000">Llámanos</a><img src="/a.jpg" alt="Equipo" width="10" height="10"><img src="/b.jpg">`,
      links: [['/servicios', 'Servicios'], ['/blog', 'Blog'], ['/viejo', 'Página vieja'], ['/no-existe', 'Roto'], ['/privado/x', 'Privado'], ['/Duplicada-A', 'Dup A'], ['/duplicada-b', 'Dup B'], ['/lenta', 'Lenta'], ['/sin-titulo', 'Sin título'], ['/noindex', 'Noindex'], ['/js', 'JS'], ['https://externo.invalid/', 'Externo']],
    }),
  },
  '/servicios': {
    body: page({ title: 'Servicios', desc: 'Servicios', h1: 'Servicios', body: `<p>${long('servicios')}</p><form><input name="email" placeholder="Email"><button>Cotizar</button></form>`, links: [['/', 'Inicio'], ['/servicios/seo', 'SEO']] }),
  },
  '/servicios/seo': { body: page({ title: 'SEO técnico', desc: 'SEO técnico para sitios grandes y medianos con foco en negocio.', h1: 'SEO técnico', body: `<p>${long('seotecnico')}</p>`, links: [['/servicios/seo/auditoria', 'Auditoría']] }) },
  '/servicios/seo/auditoria': { body: page({ title: 'Auditoría SEO', desc: 'Auditoría SEO completa.', h1: 'Auditoría', body: `<p>${long('auditoria')}</p>`, links: [['/servicios/seo/auditoria/profunda', 'Profunda']] }) },
  '/servicios/seo/auditoria/profunda': { body: page({ title: 'Página profunda de ejemplo para el test', desc: 'Profunda.', h1: 'Profunda', body: `<p>${long('profunda')}</p>`, links: [['/', 'Inicio']] }) },
  '/blog': { body: page({ title: 'Blog', h1: 'Blog', body: `<p>${lorem(50)}</p><h2>A</h2><h4>Salto</h4>`, links: [['/', 'Inicio']] }) },
  '/viejo': { status: 301, location: '/intermedio' },
  '/intermedio': { status: 302, location: '/servicios' },
  '/huerfana': { body: page({ title: 'Huérfana', desc: 'Nadie me enlaza', h1: 'Huérfana', body: `<p>${long('huerfana')}</p>` }) },
  '/Duplicada-A': { body: page({ title: 'Título repetido', desc: 'Descripción repetida', h1: 'Igual', body: `<p>${long('duplicada')}</p>`, links: [['/', 'Inicio']] }) },
  '/duplicada-b': { body: page({ title: 'Título repetido', desc: 'Descripción repetida', h1: 'Igual', body: `<p>${long('duplicada')}</p>`, links: [['/', 'Inicio']] }) },
  '/lenta': { delay: 1200, body: page({ title: 'Página lenta de ejemplo', desc: 'Lenta', h1: 'Lenta', body: `<p>${long('lenta')}</p>`, links: [['/', 'Inicio']] }) },
  '/sin-titulo': { body: page({ title: undefined, h1: '', lang: '', body: `<p>${lorem(30)}</p>` }).replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '') },
  '/noindex': { body: page({ title: 'No indexar', desc: 'x', h1: 'No', extraHead: '<meta name="robots" content="noindex, follow">', body: '<p>Privada</p>' }) },
  '/js': {
    body: page({ title: 'Cargando…', h1: '', body: '<div id="app"></div><script>document.title="Página renderizada con JS";document.getElementById("app").innerHTML="<h1>Hola desde JS</h1>"+Array.from({length:300},(_, i)=>"palabra"+i).join(" ")+"<a href=\\"/js-hija\\">Hija</a>";</script>' }),
  },
  '/js-hija': { body: page({ title: 'Hija del JS', desc: 'Solo visible con render', h1: 'Hija', body: `<p>${long('hija')}</p>` }) },
  '/contacto': { body: page({ title: 'Contacto | Ejemplo', desc: 'Escríbenos y te respondemos en el día con una propuesta concreta para tu negocio.', h1: 'Contacto', body: `<p>${long('contacto')}</p><form><label>Nombre <input name="n"></label><button>Enviar</button></form>`, links: [['/', 'Inicio']] }) },
};

function start(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const base = `http://${req.headers.host}`;
      const path = req.url.split('?')[0];
      const r = routes[path];
      const send = () => {
        if (!r) {
          res.writeHead(404, { 'content-type': 'text/html' });
          return res.end('<html><title>404</title><body>No existe</body></html>');
        }
        if (r.location) {
          res.writeHead(r.status, { location: r.location });
          return res.end();
        }
        const body = typeof r.body === 'function' ? r.body(base) : r.body;
        res.writeHead(r.status || 200, { 'content-type': (r.type || 'text/html') + '; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : body);
      };
      if (r && r.delay) setTimeout(send, r.delay);
      else send();
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start };
if (require.main === module) start(4321).then(() => console.log('Sitio de prueba en http://127.0.0.1:4321'));
