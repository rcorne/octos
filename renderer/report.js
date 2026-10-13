// Informe HTML autocontenido para compartir con clientes o el equipo.
// Sigue el manual de marca: canvas plano, tarjetas surface, atmósfera wash-*,
// logotipo con el loto oficial y la firma «Una creación de Mamífero».
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Anillo en degradé de petal-celeste a octos-blue; el estado va en palabras
  function ring(score, size = 132) {
    const r = size / 2 - 10;
    const c = 2 * Math.PI * r;
    const off = c * (1 - (score || 0) / 100);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)" aria-hidden="true">
      <defs><linearGradient id="anillo" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7FD0FF"/><stop offset="1" stop-color="#0B6BFF"/></linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#EEF1F7" stroke-width="12"/>
      ${score === null || score === undefined ? '' : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#anillo)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>`}
    </svg>`;
  }

  function health(score) {
    if (score === null || score === undefined) return '';
    const [cls, label] = score >= 80 ? ['menta', 'Buena'] : score >= 55 ? ['celeste', 'Mejorable'] : ['rosa', 'Crítica'];
    return `<span class="pill ${cls}">Salud ${label.toLowerCase()}</span>`;
  }

  function build({ result, meta, byId }) {
    const { SEV, CATEGORIES } = window.OctosAnalysis;
    const { logotipo } = window.OctosIcons;
    const host = meta.startHost || '';
    const date = new Date(meta.finishedAt || Date.now()).toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });
    const s = result.stats;
    const catLabel = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
    // Severidades sin rojos ni naranjas: fondo wash, texto ink y la palabra
    const sevClass = { critico: 'rosa', alto: 'lila', medio: 'celeste', bajo: 'borde' };

    const issueBlocks = result.issues
      .map((it, n) => {
        const urls = it.ids.slice(0, 25).map((id) => byId.get(id)).filter(Boolean);
        return `<section class="issue">
          <div class="ih"><span class="n">${n + 1}</span><div>
            <div class="tags"><span class="pill ${sevClass[it.severity]}">${SEV[it.severity].label}</span><span class="pill borde">${esc(catLabel[it.category])}</span><span class="pill borde">${it.site ? 'Todo el sitio' : it.count + ' URL' + (it.count === 1 ? '' : 's')}</span></div>
            <h3>${esc(it.title)}</h3></div></div>
          <div class="two"><div><b>Por qué importa</b><p>${esc(it.why)}</p></div><div><b>Cómo arreglarlo</b><p>${esc(it.fix)}</p></div></div>
          ${urls.length ? `<details><summary>Revisa las URLs afectadas${it.count > 25 ? ` (primeras 25 de ${it.count})` : ''}</summary><ul>${urls.map((r) => `<li><a href="${esc(r.url)}">${esc(r.url)}</a></li>`).join('')}</ul></details>` : ''}
        </section>`;
      })
      .join('');

    const cats = CATEGORIES.map((c) => {
      const v = result.categoryScores[c.id];
      return `<div class="cat"><span>${v ?? '–'}</span>${esc(c.label)}</div>`;
    }).join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe SEO · ${esc(host)}</title>
<style>
:root{--surface:#FFFFFF;--canvas:#EEF1F7;--ink:#12141C;--ink-muted:#5B6070;--hairline:#D9DDE8;--octos-blue:#0B6BFF;--wash-celeste:#BFE5FF;--wash-lila:#E4D6FF;--wash-menta:#C9F1C9;--wash-rosa:#F7D7E4;--shadow-card:0 1px 2px rgba(40,50,90,.12),0 14px 30px rgba(40,50,90,.10);--display:"Manrope","IBM Plex Sans",system-ui,sans-serif;--text:"IBM Plex Sans",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;font:400 15px/24px var(--text);color:var(--ink);background:var(--canvas);-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:40px 16px 64px}
.brand{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;margin:0 0 16px -16px}
.hero{background:radial-gradient(90% 55% at 15% 0%,var(--wash-celeste) 0%,transparent 70%),radial-gradient(80% 60% at 100% 10%,var(--wash-lila) 0%,transparent 70%),var(--surface);border-radius:36px;padding:40px;box-shadow:var(--shadow-card)}
.top{display:flex;gap:32px;align-items:center;flex-wrap:wrap}
.top>div:last-child{flex:1;min-width:280px}
.score{position:relative;display:grid;place-items:center}.score b{position:absolute;font:800 40px/44px var(--display);letter-spacing:-.02em}
h1,h2,h3{font-family:var(--display);font-weight:800;margin:0}
h1{font-size:40px;line-height:44px;letter-spacing:-.02em}h1 small{display:block;font:400 15px/24px var(--text);color:var(--ink-muted);letter-spacing:0;margin-top:8px}
.lead{margin:12px 0 0;color:var(--ink-muted);font-size:18px;line-height:28px;max-width:540px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:32px}.kpi{background:var(--surface);border:1px solid var(--hairline);border-radius:16px;padding:16px}.kpi b{display:block;font:800 26px/32px var(--display);letter-spacing:-.01em}.kpi span{color:var(--ink-muted);font-size:13px;line-height:18px}
.cats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}.cat{background:var(--canvas);border-radius:16px;padding:12px 16px;font-weight:600;font-size:13px;line-height:18px;letter-spacing:.02em;display:flex;gap:12px;align-items:center}.cat span{font:800 20px/26px var(--display);color:var(--ink)}
h2{font-size:26px;line-height:32px;letter-spacing:-.01em;margin:40px 4px 16px}
.issue{background:var(--surface);border-radius:24px;padding:24px;margin-bottom:16px;box-shadow:var(--shadow-card)}
.ih{display:flex;gap:16px}.n{flex:none;width:32px;height:32px;border-radius:8px;background:var(--canvas);display:grid;place-items:center;font:800 13px/18px var(--display);color:var(--ink)}
.tags{display:flex;gap:8px;flex-wrap:wrap}.pill{display:inline-block;font-size:12px;line-height:18px;font-weight:600;padding:2px 8px;border-radius:8px;color:var(--ink);background:var(--canvas)}
.pill.rosa{background:var(--wash-rosa)}.pill.lila{background:var(--wash-lila)}.pill.celeste{background:var(--wash-celeste)}.pill.menta{background:var(--wash-menta)}.pill.borde{box-shadow:inset 0 0 0 1px var(--hairline)}
.top .pill{font-size:13px;margin-top:12px}
h3{margin:8px 0 0;font-size:20px;line-height:26px;font-weight:700}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.two>div{border:1px solid var(--hairline);border-radius:16px;padding:12px 16px}.two b{font-size:13px;line-height:18px;font-weight:600;letter-spacing:.02em;color:var(--ink-muted)}.two p{margin:4px 0 0}
details{margin-top:12px}summary{cursor:pointer;color:var(--octos-blue);font-weight:600;font-size:13px;letter-spacing:.02em}ul{margin:8px 0 0;padding-left:16px;font-size:13px;line-height:20px}a{color:var(--octos-blue);word-break:break-all}
footer{margin-top:40px;padding:24px 4px 0;border-top:1px solid var(--hairline);display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.nota{font-size:12px;line-height:18px;color:var(--ink-muted)}.firma a{display:inline-flex;align-items:center;gap:8px}.firma-logo{height:22px;width:auto;display:block}.nota a{color:var(--ink-muted);text-decoration:none}.nota strong{font-weight:600}
@media(max-width:700px){.kpis,.cats,.two{grid-template-columns:1fr 1fr}.hero{padding:24px}h1{font-size:26px;line-height:32px}}
@media print{body{background:#FFFFFF}.issue,.hero{box-shadow:none;border:1px solid var(--hairline)}details{display:block}details>ul{display:block}}
</style></head><body><div class="wrap">
<header class="brand">${logotipo(40)}</header>
<div class="hero"><div class="top"><div class="score">${ring(result.score)}<b>${result.score ?? '–'}</b></div>
<div><h1>Informe SEO de ${esc(host)}<small>${esc(meta.startUrl)} · ${esc(date)}</small></h1>
${health(result.score)}
<p class="lead">Octos encontró ${result.issues.length} tipos de problema y los ordenó por impacto y esfuerzo. Empieza por arriba.</p></div></div>
<div class="kpis"><div class="kpi"><b>${s.pages}</b><span>Páginas HTML</span></div><div class="kpi"><b>${s.indexable}</b><span>Indexables</span></div><div class="kpi"><b>${s.medianTime} ms</b><span>Respuesta mediana</span></div><div class="kpi"><b>${s.issueCounts.critico + s.issueCounts.alto}</b><span>Problemas críticos o altos</span></div></div>
<div class="cats">${cats}</div></div>
<h2>Plan de acción</h2>${issueBlocks || '<p>Octos no detectó problemas en este rastreo.</p>'}
<footer><span class="nota">Informe generado con Octos, rastreador SEO para Mac.</span><span class="nota firma"><a href="https://mamiferolab.com/">Una creación de <img src="${window.MAMIFERO_LOGO || ''}" alt="Mamífero" class="firma-logo"></a></span></footer></div></body></html>`;
  }

  window.OctosReport = { build };
})();
