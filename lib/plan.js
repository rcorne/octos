// Plan de acción en tres horizontes a partir de los problemas del análisis.
// Corre en el navegador (window.OctosPlan) y en Node (exportes y tests).
(function (root) {
  const HORIZONS = [
    { id: 'semana', horizonte: 'Esta semana', titulo: 'Corrige lo urgente y rápido' },
    { id: 'mes', horizonte: 'Este mes', titulo: 'Resuelve lo importante' },
    { id: 'trimestre', horizonte: 'Este trimestre', titulo: 'Mejora la base del sitio' },
  ];

  const MAX_URLS = 10;

  // Regla del contrato. «Crítico o alto con esfuerzo 1» se lee como
  // «crítico (cualquier esfuerzo) o alto con esfuerzo 1»: un crítico nunca
  // espera al trimestre. Los problemas de sitio van solo por severidad.
  function horizonFor(issue) {
    const sev = issue.severity;
    const effort = Number(issue.effort) || 2;
    if (issue.site) {
      if (sev === 'critico' || sev === 'alto') return 'semana';
      if (sev === 'medio') return 'mes';
      return 'trimestre';
    }
    if (sev === 'critico') return 'semana';
    if (sev === 'alto') return effort <= 1 ? 'semana' : 'mes';
    if (sev === 'medio' && effort <= 2) return 'mes';
    return 'trimestre';
  }

  function buildActionPlan(result, opts = {}) {
    const issues = (result && result.issues) || [];
    const rows = opts.rows || (result && result.rows) || [];
    const urlById = new Map();
    for (const r of rows) urlById.set(r.id, r.url);

    const groups = new Map(HORIZONS.map((h) => [h.id, []]));
    for (const it of issues) {
      const urls = [];
      for (const id of it.ids || []) {
        const u = urlById.get(id);
        if (u) urls.push(u);
        if (urls.length >= MAX_URLS) break;
      }
      groups.get(horizonFor(it)).push({
        issueId: it.id,
        titulo: it.title,
        urls,
        severidad: it.severity,
        esfuerzo: it.effort,
        porque: it.why,
        como: it.fix,
        _priority: Number(it.priority) || 0,
      });
    }

    return HORIZONS.map((h) => ({
      id: h.id,
      horizonte: h.horizonte,
      titulo: h.titulo,
      acciones: groups
        .get(h.id)
        .sort((a, b) => b._priority - a._priority)
        .map(({ _priority, ...a }) => a),
    }));
  }

  const api = { buildActionPlan, horizonFor, HORIZONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OctosPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
