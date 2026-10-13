// Libro .xlsx del rastreo con la marca de Octos (exceljs).
// Uso: const buf = await buildXlsx({ result, meta, rows, plan })
const ExcelJS = require('exceljs');
const A = require('./analysis');
const { buildActionPlan } = require('./plan');

const C = {
  ink: 'FF12141C',
  muted: 'FF5B6070',
  hairline: 'FFD9DDE8',
  canvas: 'FFEEF1F7',
  blue: 'FF0B6BFF',
  white: 'FFFFFFFF',
  petalAzul: 'FF2E8CFF',
};
const SEV_FILL = { critico: 'FFF7D7E4', alto: 'FFE4D6FF', medio: 'FFBFE5FF', bajo: 'FFEEF1F7' };
const SEV_WORD = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };
const EFFORT_WORD = { 1: 'Bajo', 2: 'Medio', 3: 'Alto' };
const EXTRA_CATEGORIES = { organico: 'Tráfico orgánico' };
const FONT = 'IBM Plex Sans';
const FONT_DISPLAY = 'Manrope ExtraBold'; // peso 800 de la marca: es una familia propia, sin «negrita»

const FMT = {
  int: '#,##0',
  dec1: '0.0',
  pct: '0.0%',
  ms: '#,##0" ms"',
  kb: '#,##0.0" KB"',
  sec: '#,##0.0" s"',
  cls: '0.000',
};

const font = (extra = {}) => ({ name: FONT, size: 11, color: { argb: C.ink }, ...extra });
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const hairBottom = { bottom: { style: 'thin', color: { argb: C.hairline } } };
const num = (v) => (typeof v === 'number' && !isNaN(v) ? v : null);
const yesNo = (v) => (v ? 'Sí' : 'No');

function healthWord(score) {
  if (score == null) return 'Sin datos';
  if (score >= 80) return 'Buena';
  if (score >= 55) return 'Mejorable';
  return 'Crítica';
}

function categoryList(result) {
  const list = A.CATEGORIES.map((c) => ({ id: c.id, label: c.label }));
  for (const id of Object.keys((result && result.categoryScores) || {})) {
    if (!list.some((c) => c.id === id)) list.push({ id, label: EXTRA_CATEGORIES[id] || id });
  }
  return list;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

const link = (url) => (url ? { text: url, hyperlink: url } : '');

// Hoja de tabla: encabezado con estilo, filtro automático, paneles inmovilizados,
// anchos, formatos y vínculos. columns: [{ header, width, fmt, link, value(row) }]
function tableSheet(wb, name, columns, items, opts = {}) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', xSplit: opts.xSplit || 0, ySplit: 1, showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width || 14 }));
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((cell) => {
    cell.font = font({ bold: true, size: 10 });
    cell.fill = fill(C.canvas);
    cell.border = hairBottom;
    cell.alignment = { vertical: 'middle', wrapText: false };
  });
  for (const item of items) {
    const row = ws.addRow(columns.map((c) => {
      const v = c.value(item);
      return v === undefined ? null : v;
    }));
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const isLink = c.link && cell.value && typeof cell.value === 'object' && cell.value.hyperlink;
      cell.font = isLink ? font({ color: { argb: C.blue }, underline: true }) : font();
      if (c.fmt) cell.numFmt = FMT[c.fmt] || c.fmt;
      cell.alignment = { vertical: 'middle', horizontal: c.align || (c.fmt ? 'right' : 'left') };
      cell.border = hairBottom;
      if (c.fill) {
        const f = c.fill(item);
        if (f) cell.fill = fill(f);
      }
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, items.length + 1), column: columns.length } };
  return ws;
}

async function buildXlsx({ result, meta = {}, rows, plan, brandDir } = {}) {
  if (!result || !Array.isArray(result.issues)) throw new Error('Falta el resultado del análisis para crear el Excel.');
  rows = rows || result.rows || [];
  plan = plan || buildActionPlan(result, { rows });
  const stats = result.stats || {};
  const host = meta.startHost || hostOf(meta.startUrl) || 'sitio';
  const when = new Date(meta.finishedAt || meta.startedAt || Date.now());
  const dateText = when.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cats = categoryList(result);
  const catLabel = (id) => (cats.find((c) => c.id === id) || { label: id }).label;

  // Problemas por fila
  const issuesByRow = new Map();
  for (const it of result.issues) {
    for (const id of it.ids || []) {
      if (!issuesByRow.has(id)) issuesByRow.set(id, []);
      issuesByRow.get(id).push(it.title);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Octos';
  wb.lastModifiedBy = 'Octos';
  wb.company = 'Mamífero';
  wb.title = `Octos · Estado del SEO · ${host}`;
  wb.subject = 'Una creación de Mamífero';
  wb.created = when;
  wb.modified = when;

  // ---------- Resumen
  {
    const ws = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 38 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 4 }, { width: 4 }];
    ws.mergeCells('A1:D1');
    ws.mergeCells('A2:D2');
    const t = ws.getCell('A1');
    t.value = 'Octos · Estado del SEO';
    t.font = { name: FONT_DISPLAY, size: 20, color: { argb: C.white } };
    t.fill = fill(C.blue);
    t.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 40;
    const sub = ws.getCell('A2');
    sub.value = `${host} · ${dateText}`;
    sub.font = font({ color: { argb: C.white } });
    sub.fill = fill(C.blue);
    sub.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 24;
    const sig = ws.getCell('A3');
    sig.value = 'Una creación de';
    sig.font = font({ size: 9, color: { argb: C.muted } });
    sig.alignment = { indent: 1, vertical: 'middle' };
    ws.getRow(3).height = 20;
    // Logotipo de Mamífero a la derecha de la línea (si falta el archivo, la firma queda en texto)
    try {
      const file = require('path').join(brandDir || require('path').join(__dirname, '..', 'assets', 'brand'), 'mamifero-logo.png');
      const buf = require('fs').readFileSync(file);
      const imgId = wb.addImage({ buffer: buf, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0.4, row: 2.12 }, ext: { width: Math.round(18 * (1637 / 322)), height: 18 } });
    } catch {
      sig.value = 'Una creación de Mamífero';
    }

    let r = 5;
    const label = (row, text) => {
      const c = ws.getCell(`A${row}`);
      c.value = text;
      c.font = font();
      c.border = hairBottom;
    };
    const section = (row, cols) => {
      cols.forEach((text, i) => {
        const c = ws.getRow(row).getCell(i + 1);
        c.value = text;
        c.font = font({ bold: true, size: 10 });
        c.fill = fill(C.canvas);
        c.border = hairBottom;
        c.alignment = { horizontal: i ? 'right' : 'left', vertical: 'middle' };
      });
      ws.getRow(row).height = 22;
    };
    // Salud
    section(r, ['Salud SEO', 'Puntaje', 'Estado', '']);
    r++;
    label(r, 'Puntaje de 0 a 100');
    const sc = ws.getCell(`B${r}`);
    sc.value = result.score;
    sc.font = { name: FONT_DISPLAY, size: 18, color: { argb: C.ink } };
    sc.alignment = { horizontal: 'right' };
    sc.border = hairBottom;
    const st = ws.getCell(`C${r}`);
    st.value = healthWord(result.score);
    st.font = font({ bold: true });
    st.alignment = { horizontal: 'right' };
    st.border = hairBottom;
    ws.getRow(r).height = 28;
    r += 2;

    // KPI
    section(r, ['Indicador', 'Valor', '', '']);
    r++;
    const pages = stats.pages || 0;
    const ic = stats.issueCounts || {};
    const kpis = [
      ['Páginas HTML rastreadas', pages, FMT.int],
      ['Indexables', stats.indexable || 0, FMT.int],
      ['Indexables sobre el total', pages ? (stats.indexable || 0) / pages : 0, FMT.pct],
      ['No indexables', stats.nonIndexable || 0, FMT.int],
      ['Respuesta mediana del servidor', stats.medianTime || 0, FMT.ms],
      ['Respuesta percentil 90', stats.p90Time || 0, FMT.ms],
      ['Páginas con llamada a la acción', pages ? (stats.withCta || 0) / pages : 0, FMT.pct],
      ['Páginas con datos estructurados', pages ? (stats.withSchema || 0) / pages : 0, FMT.pct],
      ['Promedio de palabras por página', stats.avgWords || 0, FMT.int],
      ['URLs rastreadas (total)', stats.total || 0, FMT.int],
      ['Problemas críticos', ic.critico || 0, FMT.int],
      ['Problemas altos', ic.alto || 0, FMT.int],
      ['Problemas medios', ic.medio || 0, FMT.int],
      ['Problemas bajos', ic.bajo || 0, FMT.int],
    ];
    for (const [k, v, f] of kpis) {
      label(r, k);
      const c = ws.getCell(`B${r}`);
      c.value = v;
      c.numFmt = f;
      c.font = font();
      c.border = hairBottom;
      r++;
    }
    r++;

    // Puntaje por área
    section(r, ['Área', 'Puntaje', 'Problemas', 'Críticos y altos']);
    r++;
    const first = r;
    for (const c of cats) {
      const list = result.issues.filter((i) => i.category === c.id);
      label(r, c.label);
      const vals = [
        (result.categoryScores || {})[c.id] ?? null,
        list.length,
        list.filter((i) => i.severity === 'critico' || i.severity === 'alto').length,
      ];
      vals.forEach((v, i) => {
        const cell = ws.getRow(r).getCell(i + 2);
        cell.value = v;
        cell.numFmt = FMT.int;
        cell.font = font();
        cell.border = hairBottom;
      });
      r++;
    }
    if (r > first) {
      ws.addConditionalFormatting({
        ref: `B${first}:B${r - 1}`,
        rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 100 }], color: { argb: C.petalAzul }, gradient: false }],
      });
    }
    r++;
    const src = ws.getCell(`A${r}`);
    src.value = meta.startUrl ? link(meta.startUrl) : host;
    src.font = meta.startUrl ? font({ color: { argb: C.blue }, underline: true, size: 9 }) : font({ size: 9, color: { argb: C.muted } });
  }

  // ---------- Prioridades
  tableSheet(wb, 'Prioridades', [
    { header: '#', width: 6, fmt: 'int', value: (x) => x.i + 1 },
    { header: 'Problema', width: 46, value: (x) => x.it.title },
    { header: 'Área', width: 22, value: (x) => catLabel(x.it.category) },
    { header: 'Severidad', width: 12, value: (x) => SEV_WORD[x.it.severity] || x.it.severity, fill: (x) => SEV_FILL[x.it.severity] },
    { header: 'Esfuerzo', width: 11, value: (x) => EFFORT_WORD[x.it.effort] || x.it.effort },
    { header: 'URLs afectadas', width: 15, fmt: 'int', value: (x) => (x.it.site ? null : x.it.count) },
    { header: 'Páginas afectadas', width: 17, fmt: 'pct', value: (x) => num(x.it.share) },
    { header: 'Prioridad', width: 11, fmt: 'dec1', value: (x) => num(x.it.priority) },
    { header: 'Alcance', width: 12, value: (x) => (x.it.site ? 'Todo el sitio' : 'Páginas') },
    { header: 'Por qué importa', width: 70, value: (x) => x.it.why },
    { header: 'Cómo arreglarlo', width: 70, value: (x) => x.it.fix },
    { header: 'URL de ejemplo', width: 50, link: true, value: (x) => link((byId.get((x.it.ids || [])[0]) || {}).url) },
    { header: 'Código', width: 22, value: (x) => x.it.id },
  ], result.issues.map((it, i) => ({ it, i })), { xSplit: 2 });

  // ---------- Plan de acción
  const actions = [];
  for (const g of plan) (g.acciones || []).forEach((a, i) => actions.push({ g, a, i }));
  tableSheet(wb, 'Plan de acción', [
    { header: 'Horizonte', width: 16, value: (x) => x.g.horizonte },
    { header: '#', width: 6, fmt: 'int', value: (x) => x.i + 1 },
    { header: 'Acción', width: 46, value: (x) => x.a.titulo },
    { header: 'Severidad', width: 12, value: (x) => SEV_WORD[x.a.severidad] || x.a.severidad, fill: (x) => SEV_FILL[x.a.severidad] },
    { header: 'Esfuerzo', width: 11, value: (x) => EFFORT_WORD[x.a.esfuerzo] || x.a.esfuerzo },
    { header: 'URLs de ejemplo', width: 15, fmt: 'int', value: (x) => (x.a.urls || []).length },
    { header: 'Cómo arreglarlo', width: 70, value: (x) => x.a.como },
    { header: 'Por qué importa', width: 70, value: (x) => x.a.porque },
    { header: 'Primera URL', width: 50, link: true, value: (x) => link((x.a.urls || [])[0]) },
    { header: 'Otras URLs', width: 80, value: (x) => (x.a.urls || []).slice(1).join(' · ') },
    { header: 'Responsable', width: 18, value: () => '' },
    { header: 'Fecha', width: 14, value: () => '' },
    { header: 'Hecho', width: 10, value: () => '' },
  ], actions, { xSplit: 3 });

  // ---------- URLs internas
  const internal = rows.filter((r) => r.internal);
  tableSheet(wb, 'URLs', [
    { header: 'URL', width: 60, link: true, value: (r) => link(r.url) },
    { header: 'Estado', width: 9, fmt: '0', value: (r) => r.status },
    { header: 'Tipo', width: 14, value: (r) => r.contentType || '' },
    { header: 'Indexable', width: 11, value: (r) => (r.indexable == null ? '' : yesNo(r.indexable)) },
    { header: 'Motivo', width: 20, value: (r) => r.indexReason || '' },
    { header: 'Título', width: 50, value: (r) => r.title || '' },
    { header: 'Meta descripción', width: 60, value: (r) => r.metaDesc || '' },
    { header: 'H1', width: 40, value: (r) => (r.h1 || [])[0] || '' },
    { header: 'Palabras', width: 11, fmt: 'int', value: (r) => num(r.wordCount) },
    { header: 'Profundidad', width: 12, fmt: '0', value: (r) => num(r.clickDepth) },
    { header: 'Enlaces entrantes', width: 16, fmt: 'int', value: (r) => num(r.inlinks) },
    { header: 'Salientes internos', width: 17, fmt: 'int', value: (r) => num(r.outlinksInternal) },
    { header: 'Respuesta', width: 12, fmt: 'ms', value: (r) => num(r.time) },
    { header: 'Tamaño', width: 12, fmt: 'kb', value: (r) => (num(r.size) == null ? null : r.size / 1024) },
    { header: 'Canonical', width: 50, value: (r) => r.canonical || '' },
    { header: 'En sitemap', width: 12, value: (r) => yesNo(r.inSitemap) },
    { header: 'Nº de problemas', width: 15, fmt: 'int', value: (r) => (issuesByRow.get(r.id) || []).length },
    { header: 'Problemas', width: 80, value: (r) => (issuesByRow.get(r.id) || []).join(' · ') },
  ], internal, { xSplit: 1 });

  // ---------- Títulos y metas
  const pages = rows.filter(A.isPage);
  const titleState = (r) => (!r.title ? 'Falta' : r.dupTitle > 1 ? 'Duplicado' : r.titlePx > 580 ? 'Largo' : r.titleLen < 30 ? 'Corto' : 'Correcto');
  const descState = (r) => (!r.metaDesc ? 'Falta' : r.dupDesc > 1 ? 'Duplicada' : r.descPx > 920 ? 'Larga' : 'Correcta');
  tableSheet(wb, 'Títulos y metas', [
    { header: 'URL', width: 60, link: true, value: (r) => link(r.url) },
    { header: 'Título', width: 55, value: (r) => r.title || '' },
    { header: 'Caracteres', width: 12, fmt: 'int', value: (r) => num(r.titleLen) },
    { header: 'Píxeles', width: 10, fmt: 'int', value: (r) => num(r.titlePx) },
    { header: 'Estado del título', width: 17, value: titleState },
    { header: 'Meta descripción', width: 70, value: (r) => r.metaDesc || '' },
    { header: 'Caracteres', width: 12, fmt: 'int', value: (r) => num(r.descLen) },
    { header: 'Píxeles', width: 10, fmt: 'int', value: (r) => num(r.descPx) },
    { header: 'Estado de la descripción', width: 22, value: descState },
    { header: 'H1', width: 45, value: (r) => (r.h1 || [])[0] || '' },
    { header: 'Nº de H1', width: 10, fmt: 'int', value: (r) => (r.h1 || []).length },
  ], pages, { xSplit: 1 });

  // ---------- Enlaces
  tableSheet(wb, 'Enlaces', [
    { header: 'URL', width: 60, link: true, value: (r) => link(r.url) },
    { header: 'Estado', width: 9, fmt: '0', value: (r) => r.status },
    { header: 'Enlaces entrantes', width: 16, fmt: 'int', value: (r) => num(r.inlinks) },
    { header: 'Páginas que enlazan', width: 18, fmt: 'int', value: (r) => num(r.inlinkSources) },
    { header: 'Salientes internos', width: 17, fmt: 'int', value: (r) => num(r.outlinksInternal) },
    { header: 'Salientes externos', width: 17, fmt: 'int', value: (r) => num(r.outlinksExternal) },
    { header: 'Profundidad', width: 12, fmt: '0', value: (r) => num(r.clickDepth) },
    { header: 'Huérfana', width: 10, value: (r) => (r.orphan == null ? '' : yesNo(r.orphan)) },
    { header: 'Redirige a', width: 50, link: true, value: (r) => link(r.redirectTo) },
    { header: 'Saltos', width: 9, fmt: '0', value: (r) => num(r.hops) },
    { header: 'Estado final', width: 12, fmt: '0', value: (r) => num(r.finalStatus) },
    { header: 'Bucle', width: 9, value: (r) => (r.redirectLoop ? 'Sí' : '') },
  ], internal, { xSplit: 1 });

  // ---------- Rendimiento (tiempos + Lighthouse si existe)
  const lhOf = (r) => r.lighthouse && (r.lighthouse.mobile || r.lighthouse.desktop);
  const hasLh = rows.some((r) => lhOf(r));
  const perfCols = [
    { header: 'URL', width: 60, link: true, value: (r) => link(r.url) },
    { header: 'Respuesta', width: 12, fmt: 'ms', value: (r) => num(r.time) },
    { header: 'Descarga', width: 12, fmt: 'ms', value: (r) => num(r.download) },
    { header: 'Tamaño', width: 12, fmt: 'kb', value: (r) => (num(r.size) == null ? null : r.size / 1024) },
    { header: 'Compresión', width: 12, value: (r) => r.compression || 'No' },
    { header: 'Scripts', width: 9, fmt: 'int', value: (r) => num(r.scripts) },
    { header: 'Scripts bloqueantes', width: 18, fmt: 'int', value: (r) => num(r.blockingScripts) },
    { header: 'Dominios de terceros', width: 19, fmt: 'int', value: (r) => (r.thirdPartyHosts || []).length },
  ];
  if (hasLh) {
    const m = (k) => (r) => {
      const lh = lhOf(r);
      return lh && lh.metrics ? num(lh.metrics[k]) : null;
    };
    const s = (k) => (r) => {
      const lh = lhOf(r);
      return lh && lh.scores ? num(lh.scores[k]) : null;
    };
    perfCols.push(
      { header: 'Estrategia', width: 12, value: (r) => (lhOf(r) ? (lhOf(r).strategy === 'desktop' ? 'Escritorio' : 'Móvil') : '') },
      { header: 'Rendimiento', width: 13, fmt: 'int', value: s('performance') },
      { header: 'Accesibilidad', width: 13, fmt: 'int', value: s('accessibility') },
      { header: 'Buenas prácticas', width: 16, fmt: 'int', value: s('bestPractices') },
      { header: 'SEO', width: 8, fmt: 'int', value: s('seo') },
      { header: 'LCP', width: 11, fmt: 'ms', value: m('lcp') },
      { header: 'CLS', width: 9, fmt: 'cls', value: m('cls') },
      { header: 'TBT', width: 11, fmt: 'ms', value: m('tbt') },
      { header: 'INP', width: 11, fmt: 'ms', value: m('inp') },
      { header: 'FCP', width: 11, fmt: 'ms', value: m('fcp') },
      { header: 'TTFB (Lighthouse)', width: 17, fmt: 'ms', value: m('ttfb') },
      { header: 'Error de Lighthouse', width: 30, value: (r) => (lhOf(r) && lhOf(r).error) || '' }
    );
  }
  tableSheet(wb, 'Rendimiento', perfCols, pages, { xSplit: 1 });

  // ---------- Google (si existe)
  const gRows = rows.filter((r) => r.gsc || r.ga);
  if (gRows.length) {
    gRows.sort((a, b) => ((b.gsc && b.gsc.clicks) || 0) - ((a.gsc && a.gsc.clicks) || 0) || ((b.ga && b.ga.views) || 0) - ((a.ga && a.ga.views) || 0));
    const g = (k) => (r) => (r.gsc ? num(r.gsc[k]) : null);
    const a = (k) => (r) => (r.ga ? num(r.ga[k]) : null);
    tableSheet(wb, 'Google', [
      { header: 'URL', width: 60, link: true, value: (r) => link(r.url) },
      { header: 'Clics', width: 10, fmt: 'int', value: g('clicks') },
      { header: 'Impresiones', width: 13, fmt: 'int', value: g('impressions') },
      { header: 'CTR', width: 9, fmt: 'pct', value: g('ctr') },
      { header: 'Posición', width: 10, fmt: 'dec1', value: g('position') },
      { header: 'Vistas', width: 10, fmt: 'int', value: a('views') },
      { header: 'Sesiones', width: 10, fmt: 'int', value: a('sessions') },
      { header: 'Interacción', width: 12, fmt: 'pct', value: a('engagementRate') },
      { header: 'Eventos clave', width: 13, fmt: 'int', value: a('keyEvents') },
      { header: 'Tiempo medio', width: 13, fmt: 'sec', value: a('avgEngagementTime') },
      { header: 'Oportunidad', width: 13, value: (r) => (r.gsc && r.gsc.position >= 4 && r.gsc.position <= 15 && r.gsc.impressions > 0 ? 'Posición 4–15' : '') },
      { header: 'Período', width: 24, value: (r) => { const rg = (r.gsc && r.gsc.range) || (r.ga && r.ga.range); return rg ? `${rg.startDate} a ${rg.endDate}` : ''; } },
    ], gRows, { xSplit: 1 });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = { buildXlsx };
