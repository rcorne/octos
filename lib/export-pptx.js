// Presentación .pptx del estado del SEO con la marca de Octos (pptxgenjs, 16:9).
// Uso: const buf = await buildPptx({ result, meta, rows, plan, ai, brandDir })
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PptxGenJS = require('pptxgenjs');
const A = require('./analysis');
const { textWidth } = require('./pixels');
const { buildActionPlan } = require('./plan');

// ---- Marca (docs/tokens.json, tema claro)
const C = {
  surface: 'FFFFFF',
  canvas: 'EEF1F7',
  ink: '12141C',
  muted: '5B6070',
  hairline: 'D9DDE8',
  blue: '0B6BFF',
  onBlue: 'FFFFFF',
};
const PETAL = {
  celeste: '7FD0FF', cielo: '4FB0FF', azul: '2E8CFF', indigo: '5E80F8',
  violeta: '8E7BFF', lila: 'B79CFA', agua: '9ADFD0', menta: '7BE0B0',
};
const WASH = { celeste: 'BFE5FF', lila: 'E4D6FF', menta: 'C9F1C9', rosa: 'F7D7E4' };
const PETAL_ORDER = ['celeste', 'cielo', 'azul', 'indigo', 'violeta', 'lila', 'agua', 'menta'].map((k) => PETAL[k]);
const CAT_PETAL = {
  indexacion: PETAL.azul, contenido: PETAL.violeta, enlaces: PETAL.cielo, rendimiento: PETAL.menta,
  conversion: PETAL.lila, social: PETAL.agua, organico: PETAL.indigo,
};
const EXTRA_CATEGORIES = { organico: 'Tráfico orgánico' };
// Office elige el peso por nombre de familia: «Manrope» en negrita es lo más
// cercano a 800 que funciona con o sin la fuente estática ExtraBold instalada.
const FONT = { display: 'Manrope', text: 'IBM Plex Sans' };
// Pesos de la marca: títulos en Manrope ExtraBold (800) y énfasis en IBM Plex Sans SemiBold (600).
// En OOXML cada peso estático es su propia familia, así que se pide por nombre y sin «negrita».
const FACE = { display: { bold: 'Manrope ExtraBold', regular: 'Manrope' }, text: { bold: 'IBM Plex Sans SemiBold', regular: 'IBM Plex Sans' } };
const face = (family, bold) => ({ fontFace: FACE[family][bold ? 'bold' : 'regular'], bold: false });

const W = 13.333;
const H = 7.5;
const M = 0.75;
const CW = W - 2 * M;
const TOP = 1.8; // inicio del contenido bajo el título
const BOTTOM = 6.7; // fin del contenido sobre el pie

const SEV_WORD = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };
const EFFORT_WORD = { 1: 'Bajo', 2: 'Medio', 3: 'Alto' };
const SIGNATURE = 'Una creación de Mamífero';

// ---- Formatos
const nf = new Intl.NumberFormat('es-CL');
const fmtInt = (n) => nf.format(Math.round(Number(n) || 0));
const fmtDec = (n, d = 1) => (Number(n) || 0).toFixed(d).replace('.', ',');
const fmtPct = (x, d = 0) => `${fmtDec((Number(x) || 0) * 100, d)} %`;
const fmtMs = (ms) => (ms == null || isNaN(ms) ? '—' : ms >= 1000 ? `${fmtDec(ms / 1000, 1)} s` : `${Math.round(ms)} ms`);
const fmtDate = (t) => new Date(t || Date.now()).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
const pad2 = (n) => String(n).padStart(2, '0');

function healthLabel(score) {
  if (score == null) return { word: 'Sin datos', wash: C.canvas };
  if (score >= 80) return { word: 'Buena', wash: WASH.menta };
  if (score >= 55) return { word: 'Mejorable', wash: WASH.celeste };
  return { word: 'Crítica', wash: WASH.rosa };
}

function categoryList(result) {
  const list = A.CATEGORIES.map((c) => ({ id: c.id, label: c.label }));
  for (const id of Object.keys((result && result.categoryScores) || {})) {
    if (!list.some((c) => c.id === id)) list.push({ id, label: EXTRA_CATEGORIES[id] || id });
  }
  return list;
}
const categoryLabel = (result, id) => (categoryList(result).find((c) => c.id === id) || { label: id }).label;

// ---- Medición de texto: métricas de Arial (lib/pixels.js) con un factor por familia
const FACTOR = { display: 1.16, text: 1.06 };
function measure(str, pt, o = {}) {
  return (textWidth(str, pt) / 72) * FACTOR[o.family || 'text'] * (o.bold ? 1.05 : 1);
}

// Corte de líneas como PowerPoint: en espacios y después de guiones; una palabra
// más ancha que la caja (URLs) se corta por caracteres.
function wrap(str, pt, w, o) {
  const out = [];
  for (const para of String(str).split('\n')) {
    const tokens = [];
    for (const word of para.split(/\s+/).filter(Boolean)) {
      word.split(/(?<=-)/).forEach((t, i) => tokens.push({ t, sp: i === 0 }));
    }
    let cur = '';
    for (const tok of tokens) {
      const t = cur ? cur + (tok.sp ? ' ' : '') + tok.t : tok.t;
      if (measure(t, pt, o) <= w) {
        cur = t;
        continue;
      }
      if (cur) out.push(cur);
      let rest = tok.t;
      while (rest.length > 1 && measure(rest, pt, o) > w) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n), pt, o) > w) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      cur = rest;
    }
    out.push(cur);
  }
  return out;
}

const clean = (s) => String(s == null ? '' : s).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

// Busca el tamaño que cabe en la caja; si ni el mínimo cabe, recorta con elipsis.
function fit(str, o) {
  const { w, h, size, lh = 1.25, maxLines = Infinity } = o;
  const min = Math.min(size, o.min || size);
  const text = clean(str);
  const capFor = (pt) => Math.max(1, Math.min(maxLines, Math.floor((h + 0.005) / ((pt * lh) / 72))));
  for (let pt = size; pt >= min - 1e-9; pt -= 0.5) {
    const lines = wrap(text, pt, w, o);
    if (lines.length <= capFor(pt)) return { text, size: pt, lines: lines.length };
  }
  const cap = capFor(min);
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (wrap(text.slice(0, mid).trimEnd() + '…', min, w, o).length <= cap) lo = mid;
    else hi = mid - 1;
  }
  let cut = text.slice(0, lo);
  const sp = cut.lastIndexOf(' ');
  if (sp > 0 && lo - sp < 16 && lo < text.length) cut = cut.slice(0, sp);
  cut = cut.replace(/[\s,.;:·–-]+$/, '') + '…';
  return { text: cut, size: min, lines: cap, cut: true };
}

function ellipsize(str, pt, w, o = {}) {
  const text = clean(str).replace(/\n/g, ' ');
  if (measure(text, pt, o) <= w) return text;
  let n = text.length;
  while (n > 1 && measure(text.slice(0, n) + '…', pt, o) > w) n--;
  return text.slice(0, n).trimEnd() + '…';
}

// ---- PNG mínimo (zlib de Node): atmósfera y loto rasterizado desde el SVG oficial
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const hexRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Distancia con signo a un rectángulo redondeado centrado en (cx, cy)
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Rasteriza los SVG del loto de assets/brand (cápsulas <use> giradas y punto central).
// No redibuja: lee la geometría y los colores del archivo oficial.
function rasterizeLoto(svg, size = 512) {
  if (!svg) return null;
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const vbm = svg.match(/viewBox="([^"]+)"/);
  const def = svg.match(/<rect\b[^>]*id="p"[^>]*\/>/);
  if (!vbm || !def) return null;
  const [vx, vy, vw, vh] = vbm[1].trim().split(/[\s,]+/).map(Number);
  const p = attrs(def[0]);
  const rect = { x: +p.x, y: +p.y, w: +p.width, h: +p.height, r: +(p.rx || 0) };
  const gm = svg.match(/<g\b[^>]*fill="(#[0-9a-fA-F]{6})"/);
  const groupFill = gm ? gm[1] : '#000000';
  const shapes = [];
  for (const m of svg.matchAll(/<use\b([^>]*)\/>/g)) {
    const a = attrs(m[1]);
    const rot = (a.transform || '').match(/rotate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+)[\s,]+([-\d.]+))?\s*\)/);
    shapes.push({
      kind: 'rect',
      color: hexRgb(a.fill || groupFill),
      angle: rot ? (+rot[1] * Math.PI) / 180 : 0,
      ox: rot && rot[2] ? +rot[2] : 0,
      oy: rot && rot[3] ? +rot[3] : 0,
    });
  }
  for (const m of svg.matchAll(/<circle\b([^>]*)\/>/g)) {
    const a = attrs(m[1]);
    shapes.push({ kind: 'circle', color: hexRgb(a.fill || groupFill), cx: +a.cx, cy: +a.cy, r: +a.r });
  }
  if (!shapes.length) return null;
  const hgt = Math.round((size * vh) / vw);
  const px = Buffer.alloc(size * hgt * 4);
  const unit = vw / size; // unidades del SVG por píxel
  const rcx = rect.x + rect.w / 2;
  const rcy = rect.y + rect.h / 2;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < size; x++) {
      const ux = vx + (x + 0.5) * unit;
      const uy = vy + (y + 0.5) * unit;
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      for (const s of shapes) {
        let d;
        if (s.kind === 'circle') d = Math.hypot(ux - s.cx, uy - s.cy) - s.r;
        else {
          // Gira el punto en sentido contrario y mide contra el rectángulo base
          const cos = Math.cos(-s.angle);
          const sin = Math.sin(-s.angle);
          const dx = ux - s.ox;
          const dy = uy - s.oy;
          const qx = s.ox + dx * cos - dy * sin;
          const qy = s.oy + dx * sin + dy * cos;
          d = sdRoundRect(qx, qy, rcx, rcy, rect.w / 2, rect.h / 2, rect.r);
        }
        const cov = clamp01(0.5 - d / unit);
        if (!cov) continue;
        r = s.color[0] * cov + r * (1 - cov);
        g = s.color[1] * cov + g * (1 - cov);
        b = s.color[2] * cov + b * (1 - cov);
        al = cov + al * (1 - cov);
      }
      const i = (y * size + x) * 4;
      if (al > 0) {
        px[i] = Math.round(r / al);
        px[i + 1] = Math.round(g / al);
        px[i + 2] = Math.round(b / al);
        px[i + 3] = Math.round(al * 255);
      }
    }
  }
  return encodePng(size, hgt, px);
}

// Tarjeta de atmósfera: degradés radiales de wash-* arriba, fundidos a surface
// hacia el 55 % de la altura, con esquinas redondeadas transparentes.
function atmospherePng(wIn, hIn, radiusIn, washes, dpi = 96) {
  const w = Math.max(8, Math.round(wIn * dpi));
  const h = Math.max(8, Math.round(hIn * dpi));
  const rad = radiusIn * dpi;
  const px = Buffer.alloc(w * h * 4);
  const spots = washes.map((s) => ({ c: hexRgb(s.color), x: s.x * w, y: s.y * h, r: s.r * w }));
  for (let y = 0; y < h; y++) {
    const fade = clamp01(1 - y / (0.55 * h));
    const fadeE = fade * fade * (3 - 2 * fade);
    for (let x = 0; x < w; x++) {
      let sw = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (const s of spots) {
        const k = clamp01(1 - Math.hypot(x - s.x, y - s.y) / s.r);
        const wgt = k * k;
        sw += wgt;
        cr += s.c[0] * wgt;
        cg += s.c[1] * wgt;
        cb += s.c[2] * wgt;
      }
      const a = clamp01(sw) * fadeE;
      const i = (y * w + x) * 4;
      const mix = (c) => Math.round(255 * (1 - a) + (sw ? c / sw : 255) * a);
      px[i] = mix(cr);
      px[i + 1] = mix(cg);
      px[i + 2] = mix(cb);
      px[i + 3] = Math.round(255 * clamp01(0.5 - sdRoundRect(x + 0.5, y + 0.5, w / 2, h / 2, w / 2, h / 2, rad)));
    }
  }
  return encodePng(w, h, px);
}

// Anillo de salud: pista hairline y arco desde la cima en sentido horario, con puntas redondas
function ringPng(score, arcHex, trackHex, size = 600, thickness = 0.075) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const t = size * thickness;
  const rm = c - t / 2 - 1;
  const sweep = (Math.max(0, Math.min(100, score)) / 100) * Math.PI * 2;
  const arc = hexRgb(arcHex);
  const track = hexRgb(trackHex);
  const capA = [c, c - rm];
  const capB = [c + rm * Math.sin(sweep), c - rm * Math.cos(sweep)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const band = Math.abs(Math.hypot(dx, dy) - rm) - t / 2;
      let theta = Math.atan2(dx, -dy);
      if (theta < 0) theta += Math.PI * 2;
      let dArc = Infinity;
      if (sweep > 0) {
        dArc = theta <= sweep ? band : Math.min(Math.hypot(x + 0.5 - capA[0], y + 0.5 - capA[1]), Math.hypot(x + 0.5 - capB[0], y + 0.5 - capB[1])) - t / 2;
        if (sweep >= Math.PI * 2 - 1e-6) dArc = band;
      }
      const ct = clamp01(0.5 - band);
      const ca = clamp01(0.5 - dArc);
      const al = ca + ct * (1 - ca);
      if (!al) continue;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round((arc[k] * ca + track[k] * ct * (1 - ca)) / al);
      px[i + 3] = Math.round(al * 255);
    }
  }
  return encodePng(size, size, px);
}

// ---- Activos de marca: PNG de scripts/make-icon.js o, si faltan, el SVG oficial rasterizado
function loadBrand(brandDir) {
  const read = (f) => {
    if (!brandDir) return null;
    try {
      return fs.readFileSync(path.join(brandDir, f));
    } catch {
      return null;
    }
  };
  const brand = { notes: [] };
  for (const [key, suffix] of [['color', ''], ['white', '-blanco']]) {
    const logo = read(`octos-logotipo${suffix}.png`);
    const logoSize = pngSize(logo);
    let loto = read(`octos-loto${suffix}.png`);
    let lotoSource = loto && pngSize(loto) ? 'png' : null;
    if (!lotoSource) {
      const svg = read(`octos-loto${suffix}.svg`);
      loto = svg ? rasterizeLoto(svg.toString('utf8')) : null;
      lotoSource = loto ? 'svg' : null;
    }
    brand[key] = {
      logotipo: logoSize ? { data: 'image/png;base64,' + logo.toString('base64'), ratio: logoSize.w / logoSize.h } : null,
      loto: loto ? 'image/png;base64,' + loto.toString('base64') : null,
      lotoSource,
    };
    if (!logoSize) brand.notes.push(`Falta octos-logotipo${suffix}.png: el logotipo se arma con el loto y el texto «Octos».`);
    if (lotoSource === 'svg') brand.notes.push(`Falta octos-loto${suffix}.png: se rasterizó octos-loto${suffix}.svg.`);
    if (!lotoSource) brand.notes.push(`Sin loto${suffix} en brandDir: el logotipo queda solo en texto.`);
  }
  // Logotipo de Mamífero para la firma «Una creación de». Si falta, la firma queda en texto plano.
  const mam = read('mamifero-logo.png');
  const mamSize = pngSize(mam);
  brand.mamifero = mamSize ? { data: 'image/png;base64,' + mam.toString('base64'), ratio: mamSize.w / mamSize.h } : null;
  if (!mamSize) brand.notes.push('Falta mamifero-logo.png: la firma lleva «Mamífero» en texto plano.');
  return brand;
}

// ---- Construcción
async function buildPptx({ result, meta = {}, rows, plan, ai, brandDir } = {}) {
  if (!result || !Array.isArray(result.issues)) throw new Error('Falta el resultado del análisis para crear la presentación.');
  rows = rows || result.rows || [];
  plan = plan || buildActionPlan(result, { rows });
  const brand = loadBrand(brandDir);
  const host = meta.startHost || hostOf(meta.startUrl) || 'tu sitio';
  const date = fmtDate(meta.finishedAt || meta.startedAt);
  const stats = result.stats || {};
  const byId = new Map(rows.map((r) => [r.id, r]));

  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = 'Octos';
  pres.company = 'Mamífero';
  pres.subject = `Estado del SEO de ${host}`;
  pres.title = `Octos · Estado del SEO · ${host}`;
  pres.theme = { headFontFace: FACE.display.bold, bodyFontFace: FONT.text };

  let slideNo = 0;
  const newSlide = () => {
    slideNo++;
    const s = pres.addSlide();
    s.background = { color: C.surface };
    return s;
  };

  const text = (s, str, o) => {
    const family = o.family || 'text';
    const lh = o.lh || 1.25;
    const f = fit(str, { ...o, family, lh });
    s.addText(f.text, {
      x: o.x, y: o.y, w: o.w, h: o.h,
      ...face(family, o.bold), fontSize: f.size, color: o.color || C.ink,
      align: o.align || 'left', valign: o.valign || 'top', margin: [0, 0, 0, 0],
      lineSpacing: Math.round(f.size * lh * 10) / 10, fit: 'none', wrap: true,
      charSpacing: o.charSpacing,
    });
    return f;
  };

  const header = (s, eyebrow, title, o = {}) => {
    text(s, `${pad2(slideNo)} · ${eyebrow}`.toUpperCase(), {
      x: M, y: 0.55, w: CW, h: 0.24, size: 10, bold: true, color: C.blue, charSpacing: 1.5, maxLines: 1,
    });
    return text(s, title, {
      x: M, y: 0.82, w: o.w || CW, h: o.h || 0.75, size: o.size || 32, min: o.min || 22, family: 'display', bold: true,
      lh: 1.12, maxLines: o.maxLines || 1,
    });
  };

  // «Una creación de» + logotipo de Mamífero a la derecha de la línea (manual de marca, pág. 12)
  const signature = (s, x, y, lh = 0.22) => {
    const label = 'Una creación de';
    const tw = measure(label, 9, {}) + 0.08;
    s.addText(label, { x, y, w: tw + 0.1, h: lh, fontFace: FONT.text, fontSize: 9, color: C.muted, margin: [0, 0, 0, 0], valign: 'middle' });
    if (brand.mamifero) s.addImage({ data: brand.mamifero.data, x: x + tw + 0.1, y, w: lh * brand.mamifero.ratio, h: lh });
    else s.addText('Mamífero', { x: x + tw + 0.1, y, w: 1.2, h: lh, ...face('text', true), fontSize: 9, color: C.muted, margin: [0, 0, 0, 0], valign: 'middle' });
  };

  const footer = (s) => {
    s.addShape(pres.ShapeType.line, { x: M, y: 6.92, w: CW, h: 0, line: { color: C.hairline, width: 0.75 } });
    signature(s, M, 6.99);
  };

  const card = (s, x, y, w, h, fill = C.canvas, o = {}) =>
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w, h, fill: { color: fill }, line: o.line ? { color: o.line, width: 0.75 } : { type: 'none' },
      rectRadius: o.radius || 0.24,
    });

  // Tarjeta hero: fondo surface con sombra, degradé de atmósfera y borde hairline encima
  const atmosphere = (s, x, y, w, h, washes, radius = 0.36) => {
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w, h, rectRadius: radius, fill: { color: C.surface }, line: { type: 'none' },
      shadow: { type: 'outer', color: '28325A', opacity: 0.12, blur: 14, offset: 4, angle: 90 },
    });
    s.addImage({ data: 'image/png;base64,' + atmospherePng(w, h, radius, washes).toString('base64'), x, y, w, h });
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: radius, fill: { type: 'none' }, line: { color: C.hairline, width: 0.75 } });
  };

  // Logotipo: PNG oficial o loto + «Octos» (texto a 0,7 H, separación 0,25 H). Devuelve el ancho.
  const logotipo = (s, x, y, h, white = false) => {
    const set = white ? brand.white : brand.color;
    if (set.logotipo) {
      const w = h * set.logotipo.ratio;
      s.addImage({ data: set.logotipo.data, x, y, w, h });
      return w;
    }
    let tx = x;
    if (set.loto) {
      s.addImage({ data: set.loto, x, y, w: h, h });
      tx = x + h * 1.25;
    }
    const pt = Math.round(h * 0.7 * 72 * 10) / 10;
    const tw = measure('Octos', pt, { family: 'display', bold: true }) + 0.1;
    s.addText('Octos', {
      x: tx, y, w: tw, h, fontFace: FONT.display, fontSize: pt, bold: true, color: white ? C.onBlue : C.ink,
      margin: [0, 0, 0, 0], valign: 'middle', charSpacing: -0.02 * pt,
    });
    return tx - x + tw;
  };


  const tile = (s, x, y, w, h, value, label, o = {}) => {
    card(s, x, y, w, h, o.fill || C.canvas);
    const pad = 0.22;
    text(s, value, { x: x + pad, y: y + 0.2, w: w - 2 * pad, h: 0.55, size: o.size || 26, min: 14, family: 'display', bold: true, maxLines: 1, lh: 1.1 });
    text(s, label, { x: x + pad, y: y + 0.78, w: w - 2 * pad, h: h - 0.9, size: 11, min: 9, color: C.muted, lh: 1.3 });
  };

  const pathOf = (url) => {
    try {
      const u = new URL(url);
      return (u.host === host ? '' : u.host) + (u.pathname + u.search || '/');
    } catch {
      return String(url || '');
    }
  };
  const urlsOf = (issue, n) => (issue.ids || []).slice(0, n).map((id) => byId.get(id)).filter(Boolean).map((r) => r.url);

  // Tabla con encabezado en canvas, líneas hairline y celdas recortadas con elipsis
  const table = (s, x, y, cols, data, o = {}) => {
    const fs_ = o.fontSize || 10.5;
    const rowH = o.rowH || 0.38;
    const pad = 0.08;
    const border = (bottom) => [
      { type: 'none' }, { type: 'none' },
      bottom ? { type: 'solid', pt: 0.75, color: C.hairline } : { type: 'none' },
      { type: 'none' },
    ];
    const head = cols.map((c) => ({
      text: ellipsize(c.label, 9.5, c.w - 2 * pad, { bold: true }),
      options: { ...face('text', true), color: C.ink, fill: { color: C.canvas }, fontSize: 9.5, align: c.align || 'left', border: border(false) },
    }));
    const body = data.map((row) =>
      cols.map((c, i) => {
        const v = row[i];
        const cell = v && typeof v === 'object' ? v : { text: v };
        return {
          text: ellipsize(cell.text == null ? '' : String(cell.text), fs_, c.w - 2 * pad, { bold: cell.bold }),
          options: { color: cell.color || C.ink, ...face('text', cell.bold), align: c.align || 'left', border: border(true) },
        };
      })
    );
    s.addTable([head, ...body], {
      x, y, w: cols.reduce((a, c) => a + c.w, 0), colW: cols.map((c) => c.w), rowH,
      fontFace: FONT.text, fontSize: fs_, color: C.ink, valign: 'middle', margin: [3, 6, 3, 6], autoPage: false,
    });
  };

  const issues = result.issues;
  const critHigh = issues.filter((i) => i.severity === 'critico' || i.severity === 'alto');
  const health = healthLabel(result.score);
  const ctaShare = stats.pages ? (stats.withCta || 0) / stats.pages : 0;
  const scores = result.categoryScores || {};
  // Áreas sin datos (p. ej. Tráfico orgánico sin Google conectado) no se grafican
  const cats = categoryList(result).filter((c) => scores[c.id] != null);

  // ---------- 1. Portada
  {
    const s = newSlide();
    const lw = logotipo(s, M, 0.7, 0.42);
    signature(s, M, 1.2, 0.3);
    // Eyebrow, dominio y bajada centrados en la vertical; el dominio va en una
    // línea si cabe a 34 pt o más, si no en dos
    const one = fit(host, { w: 5.7, h: 1.9, size: 60, min: 34, family: 'display', bold: true, lh: 1.05, maxLines: 1 });
    const hostOpts = { w: 5.7, h: 1.9, size: one.cut ? 44 : one.size, min: one.cut ? 24 : one.size, family: 'display', bold: true, lh: 1.05, maxLines: one.cut ? 2 : 1 };
    const hf = fit(host, hostOpts);
    const hostH = (hf.lines * hf.size * 1.05) / 72;
    const y0 = 3.75 - (0.45 + hostH + 0.3 + 0.35) / 2;
    text(s, 'ESTADO DEL SEO', { x: M, y: y0, w: 5.6, h: 0.26, size: 11, bold: true, color: C.blue, charSpacing: 1.5, maxLines: 1 });
    text(s, host, { x: M, y: y0 + 0.45, ...hostOpts, h: hostH + 0.05 });
    text(s, 'Rastreo, prioridades y plan de acción.', { x: M, y: y0 + 0.45 + hostH + 0.3, w: 5.6, h: 0.35, size: 16, color: C.muted, maxLines: 1, min: 12 });
    text(s, `${meta.startUrl || host} · ${date}`, { x: M, y: 6.75, w: 5.6, h: 0.28, size: 11, min: 9, color: C.muted, maxLines: 1 });
    // Bloques de color con el loto blanco encima, como en la portada del manual
    const bx = 7.0;
    const gap = 0.16;
    const bw = (W - bx - gap) / 2;
    const bh = (H - gap) / 2;
    card(s, bx, 0, bw, bh, PETAL.azul, { radius: 0.36 });
    card(s, bx + bw + gap, 0, bw, bh, PETAL.lila, { radius: 0.36 });
    card(s, bx, bh + gap, bw, bh, PETAL.menta, { radius: 0.36 });
    card(s, bx + bw + gap, bh + gap, bw, bh, PETAL.celeste, { radius: 0.36 });
    if (brand.white.loto) {
      const ls = 3.6;
      s.addImage({ data: brand.white.loto, x: bx + bw + gap / 2 - ls / 2, y: H / 2 - ls / 2, w: ls, h: ls });
    }
    s.addNotes(
      `Estado del SEO de ${host}. Rastreo del ${date} desde ${meta.startUrl || host}. ` +
        `Octos revisó ${fmtInt(stats.total)} URLs (${fmtInt(stats.pages)} páginas HTML internas). ${SIGNATURE}.`
    );
  }

  // ---------- 2. Resumen ejecutivo
  {
    const s = newSlide();
    const title =
      result.score == null ? 'Aún no hay páginas para evaluar'
        : result.score >= 80 ? 'Tu sitio tiene una buena base'
          : result.score >= 55 ? 'Tu sitio tiene mejoras claras por hacer'
            : 'Tu sitio necesita arreglos urgentes';
    header(s, 'Resumen ejecutivo', title);
    // Tarjeta de salud con atmósfera
    const hx = M;
    const hy = TOP;
    const hw = 4.3;
    const hh = 4.85;
    atmosphere(s, hx, hy, hw, hh, [
      { color: WASH.celeste, x: 0.1, y: 0.05, r: 0.9 },
      { color: WASH.lila, x: 0.9, y: 0.2, r: 0.85 },
    ]);
    const ring = 2.5;
    const rx = hx + (hw - ring) / 2;
    const ry = hy + 0.45;
    const sc = result.score == null ? 0 : result.score;
    // Anillo como PNG: se ve igual en PowerPoint, Keynote, Google Slides y Quick Look
    s.addImage({ data: 'image/png;base64,' + ringPng(sc, PETAL.azul, C.hairline).toString('base64'), x: rx, y: ry, w: ring, h: ring });
    text(s, result.score == null ? '—' : String(result.score), {
      x: rx, y: ry + ring / 2 - 0.45, w: ring, h: 0.7, size: 46, family: 'display', bold: true, align: 'center', valign: 'middle', maxLines: 1, lh: 1,
    });
    text(s, 'de 100', { x: rx, y: ry + ring / 2 + 0.25, w: ring, h: 0.25, size: 11, color: C.muted, align: 'center', maxLines: 1 });
    const pillW = Math.max(1.3, measure(health.word, 12, { bold: true }) + 0.5);
    card(s, hx + (hw - pillW) / 2, ry + ring + 0.25, pillW, 0.4, health.wash, { radius: 0.2 });
    text(s, health.word, { x: hx + (hw - pillW) / 2, y: ry + ring + 0.25, w: pillW, h: 0.4, size: 12, bold: true, align: 'center', valign: 'middle', maxLines: 1 });
    text(s, 'Salud SEO del sitio', { x: hx + 0.3, y: hy + hh - 0.62, w: hw - 0.6, h: 0.3, size: 11, color: C.muted, align: 'center', maxLines: 1 });

    // Párrafo: resumen de IA o uno armado con los datos
    const px = hx + hw + 0.45;
    const pw = W - M - px;
    const top3 = issues.slice(0, 3).map((i) => i.title.toLowerCase());
    const auto =
      `Octos revisó ${fmtInt(stats.pages)} páginas de ${host} y encontró ${fmtInt(issues.length)} tipos de problema, ` +
      `${fmtInt(critHigh.length)} de ellos críticos o altos. ` +
      (top3.length ? `Empieza por: ${top3.join('; ')}.` : 'No hay problemas pendientes.');
    const para = ai && ai.resumen ? ai.resumen : auto;
    text(s, para, { x: px, y: hy, w: pw, h: 1.55, size: 16, min: 11, color: C.ink, lh: 1.35 });
    // KPI
    const kpis = [
      [fmtInt(stats.pages), 'Páginas HTML rastreadas'],
      [fmtInt(stats.indexable), `Indexables (${fmtPct(stats.pages ? stats.indexable / stats.pages : 0)})`],
      [fmtMs(stats.medianTime), 'Respuesta mediana del servidor'],
      [fmtPct(ctaShare), 'Páginas con llamada a la acción'],
      [fmtInt((stats.issueCounts || {}).critico || 0), 'Problemas críticos'],
      [fmtInt((stats.issueCounts || {}).alto || 0), 'Problemas de prioridad alta'],
    ];
    const gx = 0.22;
    const tw = (pw - 2 * gx) / 3;
    const th = 1.45;
    kpis.forEach(([v, l], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      tile(s, px + col * (tw + gx), hy + 1.75 + row * (th + 0.2), tw, th, v, l);
    });
    footer(s);
    s.addNotes(
      [
        `Salud SEO: ${result.score == null ? 'sin datos' : result.score + ' de 100'} (${health.word}).`,
        `Páginas HTML: ${fmtInt(stats.pages)}; indexables: ${fmtInt(stats.indexable)}; no indexables: ${fmtInt(stats.nonIndexable)}.`,
        `Respuesta mediana: ${fmtMs(stats.medianTime)}; percentil 90: ${fmtMs(stats.p90Time)}.`,
        `Con llamada a la acción: ${fmtInt(stats.withCta)} de ${fmtInt(stats.pages)} (${fmtPct(ctaShare)}).`,
        `Tipos de problema: ${fmtInt(issues.length)} (críticos ${fmtInt((stats.issueCounts || {}).critico)}, altos ${fmtInt((stats.issueCounts || {}).alto)}, medios ${fmtInt((stats.issueCounts || {}).medio)}, bajos ${fmtInt((stats.issueCounts || {}).bajo)}).`,
        ai && ai.resumen ? `Resumen con IA: ${ai.resumen}` : `Resumen: ${auto}`,
        ai && Array.isArray(ai.hallazgos) && ai.hallazgos.length ? `Hallazgos: ${ai.hallazgos.join(' | ')}` : '',
      ].filter(Boolean).join('\n')
    );
  }

  // ---------- 3. Estado por área
  {
    const s = newSlide();
    const weakest = cats.filter((c) => scores[c.id] != null).sort((a, b) => scores[a.id] - scores[b.id])[0];
    header(s, 'Estado por área', weakest ? `${weakest.label} es el área más débil` : 'Puntaje por área');
    // Barras dibujadas con formas (no con un gráfico nativo): se ven igual en PowerPoint,
    // Keynote, Google Slides y Quick Look, y siguen siendo editables.
    const barsW = 7.6;
    const barsH = 4.85;
    const barRowH = barsH / Math.max(1, cats.length);
    const labelW = 2.35;
    const valW = 0.75;
    const trackX = M + labelW;
    const trackW = barsW - labelW - valW - 0.2;
    const barH = Math.min(0.3, barRowH * 0.46);
    cats.forEach((c, i) => {
      const y = TOP + i * barRowH;
      const cy = y + (barRowH - barH) / 2;
      const color = CAT_PETAL[c.id] || PETAL_ORDER[i % PETAL_ORDER.length];
      const v = scores[c.id];
      text(s, c.label, { x: M, y: cy - 0.04, w: labelW - 0.15, h: barH + 0.08, size: 11.5, min: 9, maxLines: 1 });
      s.addShape(pres.ShapeType.roundRect, { x: trackX, y: cy, w: trackW, h: barH, rectRadius: barH / 2, fill: { color: C.canvas }, line: { type: 'none' } });
      if (v != null && v > 0) {
        const w = Math.max(barH, (trackW * v) / 100);
        s.addShape(pres.ShapeType.roundRect, { x: trackX, y: cy, w, h: barH, rectRadius: barH / 2, fill: { color }, line: { type: 'none' } });
      }
      text(s, v == null ? 'Sin datos' : String(v), { x: trackX + trackW + 0.15, y: cy - 0.04, w: valW + 0.05, h: barH + 0.08, size: 12, min: 9, bold: true, align: 'right', maxLines: 1 });
    });
    // Lista lateral: problemas por área
    const lx = M + 7.85;
    const lw = W - M - lx;
    card(s, lx, TOP, lw, 4.85);
    text(s, 'Problemas por área', { x: lx + 0.3, y: TOP + 0.25, w: lw - 0.6, h: 0.35, size: 15, family: 'display', bold: true, maxLines: 1 });
    const rowH = Math.min(0.56, 4.0 / Math.max(1, cats.length));
    cats.forEach((c, i) => {
      const list = issues.filter((it) => it.category === c.id);
      const ch = list.filter((it) => it.severity === 'critico' || it.severity === 'alto').length;
      const y = TOP + 0.8 + i * rowH;
      s.addShape(pres.ShapeType.ellipse, { x: lx + 0.3, y: y + 0.09, w: 0.16, h: 0.16, fill: { color: CAT_PETAL[c.id] || PETAL_ORDER[i % 8] }, line: { type: 'none' } });
      text(s, c.label, { x: lx + 0.58, y, w: lw - 2.25, h: 0.34, size: 11.5, min: 9, maxLines: 1 });
      text(s, `${list.length} · ${ch} urgentes`, { x: lx + lw - 1.65, y, w: 1.35, h: 0.34, size: 10.5, min: 9, color: C.muted, align: 'right', maxLines: 1 });
    });
    footer(s);
    s.addNotes(
      'Puntaje de 0 a 100 por área (100 = sin problemas detectados).\n' +
        cats.map((c) => `${c.label}: ${scores[c.id] == null ? 'sin datos' : scores[c.id]} · ${issues.filter((it) => it.category === c.id).length} tipos de problema`).join('\n')
    );
  }

  // ---------- 4. Prioridades
  {
    const s = newSlide();
    const top = issues.slice(0, 10);
    header(s, 'Prioridades', top.length ? `Arregla primero estos ${top.length} problemas` : 'Sin problemas pendientes');
    if (top.length) {
      const cols = [
        { label: '#', w: 0.45, align: 'center' },
        { label: 'Problema', w: 5.45 },
        { label: 'Severidad', w: 1.3 },
        { label: 'Área', w: 2.55 },
        { label: 'URLs', w: 0.95, align: 'right' },
        { label: 'Esfuerzo', w: 1.13 },
      ];
      table(
        s, M, TOP, cols,
        top.map((it, i) => [
          String(i + 1),
          it.title,
          { text: SEV_WORD[it.severity] || it.severity, bold: it.severity === 'critico' || it.severity === 'alto' },
          categoryLabel(result, it.category),
          it.site ? 'Sitio' : fmtInt(it.count),
          EFFORT_WORD[it.effort] || String(it.effort),
        ]),
        { rowH: 0.44 }
      );
    } else {
      text(s, 'Octos no encontró problemas en este rastreo. Rastrea de nuevo después de cada cambio grande.', { x: M, y: TOP, w: CW, h: 1, size: 16, color: C.muted });
    }
    footer(s);
    s.addNotes(
      'Orden por impacto sobre esfuerzo (severidad, URLs afectadas y esfuerzo).\n' +
        top.map((it, i) => `${i + 1}. ${it.title} · ${SEV_WORD[it.severity]} · ${categoryLabel(result, it.category)} · ${it.site ? 'todo el sitio' : it.count + ' URLs'} · esfuerzo ${(EFFORT_WORD[it.effort] || '').toLowerCase()}. ${it.fix}`).join('\n')
    );
  }

  // ---------- 5–7. Detalle de los 3 problemas principales
  issues.slice(0, 3).forEach((it, k) => {
    const s = newSlide();
    header(s, `Prioridad ${k + 1} · ${categoryLabel(result, it.category)}`, it.title, { maxLines: 1, min: 20 });
    const lx = M;
    const lw = 6.55;
    let y = TOP;
    text(s, 'Por qué importa', { x: lx, y, w: lw, h: 0.36, size: 17, family: 'display', bold: true, maxLines: 1 });
    const why = text(s, it.why, { x: lx, y: y + 0.45, w: lw, h: 1.75, size: 16, min: 11, color: C.muted, lh: 1.4 });
    y += 0.45 + Math.min(1.75, (why.lines * why.size * 1.4) / 72) + 0.4;
    text(s, 'Cómo arreglarlo', { x: lx, y, w: lw, h: 0.36, size: 17, family: 'display', bold: true, maxLines: 1 });
    text(s, it.fix, { x: lx, y: y + 0.45, w: lw, h: BOTTOM - (y + 0.45), size: 16, min: 11, color: C.muted, lh: 1.4 });

    const cx = M + lw + 0.5;
    const cw = W - M - cx;
    const ch = BOTTOM - TOP;
    card(s, cx, TOP, cw, ch);
    s.addShape(pres.ShapeType.roundRect, { x: cx + 0.3, y: TOP + 0.3, w: 0.9, h: 0.1, fill: { color: CAT_PETAL[it.category] || PETAL.azul }, line: { type: 'none' }, rectRadius: 0.05 });
    const facts = [
      [SEV_WORD[it.severity] || it.severity, 'Severidad'],
      [EFFORT_WORD[it.effort] || String(it.effort), 'Esfuerzo'],
      [it.site ? 'Sitio' : fmtInt(it.count), it.site ? 'Alcance' : 'URLs afectadas'],
    ];
    const fw = (cw - 0.6) / 3;
    facts.forEach(([v, l], i) => {
      text(s, v, { x: cx + 0.3 + i * fw, y: TOP + 0.6, w: fw - 0.1, h: 0.45, size: 20, min: 12, family: 'display', bold: true, maxLines: 1 });
      text(s, l, { x: cx + 0.3 + i * fw, y: TOP + 1.08, w: fw - 0.1, h: 0.25, size: 10, color: C.muted, maxLines: 1 });
    });
    s.addShape(pres.ShapeType.line, { x: cx + 0.3, y: TOP + 1.55, w: cw - 0.6, h: 0, line: { color: C.hairline, width: 0.75 } });
    const examples = urlsOf(it, 8);
    text(s, it.site ? 'Alcance' : 'URLs de ejemplo', { x: cx + 0.3, y: TOP + 1.75, w: cw - 0.6, h: 0.3, size: 11, bold: true, maxLines: 1 });
    if (it.site || !examples.length) {
      text(s, it.site ? 'Afecta a todo el sitio, no a páginas puntuales.' : 'Sin URLs de ejemplo.', { x: cx + 0.3, y: TOP + 2.15, w: cw - 0.6, h: 0.8, size: 12, color: C.muted });
    } else {
      const lines = examples.map((u) => ellipsize(pathOf(u), 11, cw - 0.6));
      const more = it.count > examples.length ? `\ny ${fmtInt(it.count - examples.length)} más` : '';
      s.addText(lines.join('\n') + more, {
        x: cx + 0.3, y: TOP + 2.15, w: cw - 0.6, h: ch - 2.4, fontFace: FONT.text, fontSize: 11, color: C.ink,
        margin: [0, 0, 0, 0], valign: 'top', lineSpacing: 19, fit: 'none',
      });
    }
    footer(s);
    s.addNotes(
      `${it.title} (${SEV_WORD[it.severity]}, esfuerzo ${(EFFORT_WORD[it.effort] || '').toLowerCase()}, ${it.site ? 'todo el sitio' : it.count + ' URLs'}, ${fmtPct(it.share || 0)} de las páginas).\n` +
        `Por qué importa: ${it.why}\nCómo arreglarlo: ${it.fix}\n` +
        (it.site ? '' : `URLs de ejemplo:\n${urlsOf(it, 20).join('\n')}`)
    );
  });

  // ---------- 8. Plan de acción
  {
    const s = newSlide();
    header(s, 'Plan de acción', 'Tu plan en tres horizontes');
    const fromAi = ai && Array.isArray(ai.plan) && ai.plan.length;
    const names = ['Esta semana', 'Este mes', 'Este trimestre'];
    const columns = names.map((name, i) => {
      if (fromAi) {
        const g = ai.plan.find((p) => String(p.horizonte || '').toLowerCase() === name.toLowerCase()) || ai.plan[i] || { acciones: [] };
        return {
          horizonte: name,
          titulo: (plan[i] && plan[i].titulo) || '',
          items: (g.acciones || []).map((a) => (typeof a === 'string' ? { titulo: a } : { titulo: a.titulo || a.accion || a.detalle || '', meta: a.detalle && a.titulo ? a.detalle : '' })),
        };
      }
      const g = plan.find((p) => p.horizonte === name) || plan[i] || { acciones: [] };
      return {
        horizonte: name,
        titulo: g.titulo || '',
        items: (g.acciones || []).map((a) => ({
          titulo: a.titulo,
          meta: `${SEV_WORD[a.severidad] || a.severidad} · esfuerzo ${(EFFORT_WORD[a.esfuerzo] || '').toLowerCase()}${a.urls && a.urls.length ? ` · ${a.urls.length >= 10 ? '10+' : a.urls.length} URLs` : ''}`,
        })),
      };
    });
    const gap = 0.3;
    const colW = (CW - 2 * gap) / 3;
    const tones = [PETAL.azul, PETAL.violeta, PETAL.agua];
    columns.forEach((col, i) => {
      const x = M + i * (colW + gap);
      const ch = BOTTOM - TOP;
      card(s, x, TOP, colW, ch);
      s.addShape(pres.ShapeType.roundRect, { x: x + 0.3, y: TOP + 0.3, w: 0.9, h: 0.1, fill: { color: tones[i] }, line: { type: 'none' }, rectRadius: 0.05 });
      text(s, col.horizonte, { x: x + 0.3, y: TOP + 0.55, w: colW - 0.6, h: 0.42, size: 20, min: 14, family: 'display', bold: true, maxLines: 1 });
      text(s, col.titulo ? `${col.titulo} · ${col.items.length} acciones` : `${col.items.length} acciones`, { x: x + 0.3, y: TOP + 1.0, w: colW - 0.6, h: 0.26, size: 10, color: C.muted, maxLines: 1 });
      const iw = colW - 0.6;
      let y = TOP + 1.45;
      const limit = TOP + ch - 0.5;
      let shown = 0;
      for (const item of col.items) {
        const tl = Math.min(2, wrap(item.titulo, 12, iw, {}).length);
        const need = (tl * 12 * 1.25) / 72 + (item.meta ? 0.24 : 0) + 0.18;
        if (y + need > limit) break;
        const f = text(s, item.titulo, { x: x + 0.3, y, w: iw, h: (tl * 12 * 1.25) / 72 + 0.02, size: 12, min: 12, maxLines: 2 });
        y += (f.lines * 12 * 1.25) / 72 + 0.03;
        if (item.meta) {
          text(s, item.meta, { x: x + 0.3, y, w: iw, h: 0.22, size: 9.5, color: C.muted, maxLines: 1 });
          y += 0.22;
        }
        y += 0.18;
        shown++;
      }
      if (!col.items.length) {
        text(s, 'Sin acciones en este horizonte.', { x: x + 0.3, y, w: iw, h: 0.3, size: 12, color: C.muted, maxLines: 1 });
      } else if (shown < col.items.length) {
        text(s, `y ${col.items.length - shown} acciones más en el Excel`, { x: x + 0.3, y: TOP + ch - 0.45, w: iw, h: 0.25, size: 10, color: C.muted, maxLines: 1 });
      }
    });
    footer(s);
    s.addNotes(
      (fromAi ? 'Plan propuesto con IA.\n' : 'Regla: crítico o alto de esfuerzo bajo, esta semana; alto de esfuerzo medio o alto y medio de esfuerzo bajo o medio, este mes; el resto, este trimestre.\n') +
        columns.map((c) => `${c.horizonte}:\n${c.items.map((a) => `- ${a.titulo}${a.meta ? ' (' + a.meta + ')' : ''}`).join('\n') || '- Sin acciones'}`).join('\n')
    );
  }

  // ---------- 9. Datos de Google (si hay)
  const gscRows = rows.filter((r) => r.gsc && typeof r.gsc.impressions === 'number');
  const gaRows = rows.filter((r) => r.ga && typeof r.ga.views === 'number');
  if (gscRows.length || gaRows.length) {
    const s = newSlide();
    const clicks = gscRows.reduce((a, r) => a + (r.gsc.clicks || 0), 0);
    const impr = gscRows.reduce((a, r) => a + (r.gsc.impressions || 0), 0);
    const posW = impr ? gscRows.reduce((a, r) => a + (r.gsc.position || 0) * (r.gsc.impressions || 0), 0) / impr : 0;
    const views = gaRows.reduce((a, r) => a + (r.ga.views || 0), 0);
    const sessions = gaRows.reduce((a, r) => a + (r.ga.sessions || 0), 0);
    const keyEvents = gaRows.reduce((a, r) => a + (r.ga.keyEvents || 0), 0);
    const range = (gscRows[0] && gscRows[0].gsc.range) || (gaRows[0] && gaRows[0].ga.range);
    const opps = gscRows
      .filter((r) => r.gsc.position >= 4 && r.gsc.position <= 15 && r.gsc.impressions > 0)
      .sort((a, b) => b.gsc.impressions - a.gsc.impressions)
      .slice(0, 5);
    header(s, 'Datos de Google', opps.length ? `${opps.length} páginas están cerca del top 3` : 'Así te encuentra Google');
    const kp = [];
    if (gscRows.length) kp.push([fmtInt(clicks), 'Clics'], [fmtInt(impr), 'Impresiones'], [fmtPct(impr ? clicks / impr : 0, 1), 'CTR medio'], [fmtDec(posW, 1), 'Posición media']);
    if (gaRows.length) kp.push([fmtInt(views), 'Vistas'], [fmtInt(sessions), 'Sesiones'], [fmtInt(keyEvents), 'Eventos clave']);
    const shownK = kp.slice(0, 6);
    const kg = 0.2;
    const kw = (CW - kg * (shownK.length - 1)) / shownK.length;
    shownK.forEach(([v, l], i) => tile(s, M + i * (kw + kg), TOP, kw, 1.25, v, l, { size: 22 }));
    const ty = TOP + 1.6;
    const half = (CW - 0.4) / 2;
    if (gscRows.length) {
      const topClicks = [...gscRows].sort((a, b) => b.gsc.clicks - a.gsc.clicks).slice(0, 5);
      text(s, 'Páginas con más clics', { x: M, y: ty, w: half, h: 0.32, size: 14, family: 'display', bold: true, maxLines: 1 });
      table(s, M, ty + 0.42, [
        { label: 'Página', w: half - 3.2 }, { label: 'Clics', w: 0.85, align: 'right' }, { label: 'Impr.', w: 0.95, align: 'right' },
        { label: 'CTR', w: 0.7, align: 'right' }, { label: 'Pos.', w: 0.7, align: 'right' },
      ], topClicks.map((r) => [pathOf(r.url), fmtInt(r.gsc.clicks), fmtInt(r.gsc.impressions), fmtPct(r.gsc.ctr, 1), fmtDec(r.gsc.position, 1)]), { fontSize: 10, rowH: 0.36 });
      text(s, 'Oportunidades: posición 4 a 15', { x: M + half + 0.4, y: ty, w: half, h: 0.32, size: 14, family: 'display', bold: true, maxLines: 1 });
      if (opps.length) {
        table(s, M + half + 0.4, ty + 0.42, [
          { label: 'Página', w: half - 2.5 }, { label: 'Impr.', w: 0.95, align: 'right' }, { label: 'Pos.', w: 0.75, align: 'right' }, { label: 'CTR', w: 0.8, align: 'right' },
        ], opps.map((r) => [pathOf(r.url), fmtInt(r.gsc.impressions), fmtDec(r.gsc.position, 1), fmtPct(r.gsc.ctr, 1)]), { fontSize: 10, rowH: 0.36 });
      } else {
        text(s, 'Ninguna página está entre las posiciones 4 y 15.', { x: M + half + 0.4, y: ty + 0.45, w: half, h: 0.4, size: 12, color: C.muted });
      }
    } else {
      const topViews = [...gaRows].sort((a, b) => b.ga.views - a.ga.views).slice(0, 5);
      text(s, 'Páginas con más vistas', { x: M, y: ty, w: CW, h: 0.32, size: 14, family: 'display', bold: true, maxLines: 1 });
      table(s, M, ty + 0.42, [
        { label: 'Página', w: CW - 4.4 }, { label: 'Vistas', w: 1.1, align: 'right' }, { label: 'Sesiones', w: 1.1, align: 'right' },
        { label: 'Interacción', w: 1.1, align: 'right' }, { label: 'Eventos', w: 1.1, align: 'right' },
      ], topViews.map((r) => [pathOf(r.url), fmtInt(r.ga.views), fmtInt(r.ga.sessions), fmtPct(r.ga.engagementRate), fmtInt(r.ga.keyEvents)]), { fontSize: 10, rowH: 0.36 });
    }
    if (range && range.startDate) text(s, `Período: ${range.startDate} a ${range.endDate}`, { x: M, y: BOTTOM - 0.22, w: CW, h: 0.22, size: 9, color: C.muted, maxLines: 1 });
    footer(s);
    s.addNotes(
      [
        range ? `Período: ${range.startDate} a ${range.endDate}.` : '',
        gscRows.length ? `Search Console: ${fmtInt(clicks)} clics, ${fmtInt(impr)} impresiones, CTR ${fmtPct(impr ? clicks / impr : 0, 1)}, posición media ${fmtDec(posW, 1)} (${gscRows.length} URLs con datos).` : '',
        gaRows.length ? `Analytics: ${fmtInt(views)} vistas, ${fmtInt(sessions)} sesiones, ${fmtInt(keyEvents)} eventos clave.` : '',
        opps.length ? 'Oportunidades (mejora título y contenido para subir al top 3):\n' + opps.map((r) => `- ${r.url}: ${fmtInt(r.gsc.impressions)} impresiones, posición ${fmtDec(r.gsc.position, 1)}`).join('\n') : '',
      ].filter(Boolean).join('\n')
    );
  }

  // ---------- 10. Rendimiento Lighthouse (si hay)
  const lhRows = rows
    .map((r) => {
      const lh = r.lighthouse && (r.lighthouse.mobile && !r.lighthouse.mobile.error ? r.lighthouse.mobile : r.lighthouse.desktop && !r.lighthouse.desktop.error ? r.lighthouse.desktop : null);
      return lh ? { row: r, lh } : null;
    })
    .filter(Boolean);
  if (lhRows.length) {
    const s = newSlide();
    const avg = (get) => {
      const v = lhRows.map(get).filter((x) => typeof x === 'number' && !isNaN(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const sc = {
      performance: avg((x) => x.lh.scores && x.lh.scores.performance),
      accessibility: avg((x) => x.lh.scores && x.lh.scores.accessibility),
      bestPractices: avg((x) => x.lh.scores && x.lh.scores.bestPractices),
      seo: avg((x) => x.lh.scores && x.lh.scores.seo),
    };
    const lcpAvg = avg((x) => x.lh.metrics && x.lh.metrics.lcp);
    const clsAvg = avg((x) => x.lh.metrics && x.lh.metrics.cls);
    const mobile = lhRows.filter((x) => x.lh.strategy === 'mobile').length;
    header(s, 'Rendimiento Lighthouse', sc.performance == null ? 'Rendimiento medido con Lighthouse' : `Rendimiento promedio: ${Math.round(sc.performance)} de 100`);
    const kp = [
      [sc.performance, 'Rendimiento'], [sc.accessibility, 'Accesibilidad'], [sc.bestPractices, 'Buenas prácticas'], [sc.seo, 'SEO'],
    ].map(([v, l]) => [v == null ? '—' : String(Math.round(v)), l]);
    kp.push([fmtMs(lcpAvg), 'LCP promedio'], [clsAvg == null ? '—' : fmtDec(clsAvg, 2), 'CLS promedio']);
    const kg = 0.2;
    const kw = (CW - kg * 5) / 6;
    kp.forEach(([v, l], i) => tile(s, M + i * (kw + kg), TOP, kw, 1.25, v, l, { size: 22 }));
    const ty = TOP + 1.6;
    const half = (CW - 0.4) / 2;
    const worstLcp = lhRows.filter((x) => x.lh.metrics && x.lh.metrics.lcp != null).sort((a, b) => b.lh.metrics.lcp - a.lh.metrics.lcp).slice(0, 5);
    const worstCls = lhRows.filter((x) => x.lh.metrics && x.lh.metrics.cls != null).sort((a, b) => b.lh.metrics.cls - a.lh.metrics.cls).slice(0, 5);
    text(s, 'Peores páginas por LCP', { x: M, y: ty, w: half, h: 0.32, size: 14, family: 'display', bold: true, maxLines: 1 });
    table(s, M, ty + 0.42, [{ label: 'Página', w: half - 2.1 }, { label: 'LCP', w: 1.0, align: 'right' }, { label: 'Rend.', w: 1.1, align: 'right' }],
      worstLcp.map((x) => [pathOf(x.row.url), fmtMs(x.lh.metrics.lcp), x.lh.scores && x.lh.scores.performance != null ? String(Math.round(x.lh.scores.performance)) : '—']), { fontSize: 10, rowH: 0.36 });
    text(s, 'Peores páginas por CLS', { x: M + half + 0.4, y: ty, w: half, h: 0.32, size: 14, family: 'display', bold: true, maxLines: 1 });
    table(s, M + half + 0.4, ty + 0.42, [{ label: 'Página', w: half - 2.1 }, { label: 'CLS', w: 1.0, align: 'right' }, { label: 'Rend.', w: 1.1, align: 'right' }],
      worstCls.map((x) => [pathOf(x.row.url), fmtDec(x.lh.metrics.cls, 3), x.lh.scores && x.lh.scores.performance != null ? String(Math.round(x.lh.scores.performance)) : '—']), { fontSize: 10, rowH: 0.36 });
    text(s, `${lhRows.length} páginas medidas · ${mobile} en móvil · objetivo: LCP bajo 2,5 s y CLS bajo 0,1`, { x: M, y: BOTTOM - 0.22, w: CW, h: 0.22, size: 9, color: C.muted, maxLines: 1 });
    footer(s);
    const opps = {};
    for (const x of lhRows) for (const o of x.lh.opportunities || []) opps[o.title] = (opps[o.title] || 0) + (o.savingsMs || 0);
    const topOpps = Object.entries(opps).sort((a, b) => b[1] - a[1]).slice(0, 5);
    s.addNotes(
      [
        `Promedios de ${lhRows.length} páginas (móvil cuando existe): rendimiento ${kp[0][0]}, accesibilidad ${kp[1][0]}, buenas prácticas ${kp[2][0]}, SEO ${kp[3][0]}, LCP ${fmtMs(lcpAvg)}, CLS ${clsAvg == null ? '—' : fmtDec(clsAvg, 2)}.`,
        'Peores por LCP:\n' + worstLcp.map((x) => `- ${x.row.url}: ${fmtMs(x.lh.metrics.lcp)}`).join('\n'),
        'Peores por CLS:\n' + worstCls.map((x) => `- ${x.row.url}: ${fmtDec(x.lh.metrics.cls, 3)}`).join('\n'),
        topOpps.length ? 'Oportunidades con más ahorro:\n' + topOpps.map(([t, ms]) => `- ${t}: ${fmtMs(ms)} en total`).join('\n') : '',
      ].filter(Boolean).join('\n')
    );
  }

  // ---------- 11. Próximos pasos y cierre
  {
    const s = newSlide();
    header(s, 'Próximos pasos', 'Qué hacer ahora', { w: 6.6 });
    const week = (plan.find((p) => p.horizonte === 'Esta semana') || { acciones: [] }).acciones;
    const month = (plan.find((p) => p.horizonte === 'Este mes') || { acciones: [] }).acciones;
    const first = (week.length ? week : month).slice(0, 2).map((a) => a.titulo.toLowerCase());
    const steps = [
      first.length ? `Corrige esta semana: ${first.join(' y ')}.` : 'Revisa la lista de prioridades y elige las primeras correcciones.',
      'Asigna un responsable y una fecha a cada acción del mes y del trimestre.',
      !gscRows.length && !gaRows.length
        ? 'Conecta Search Console y Analytics para medir clics, impresiones y conversiones.'
        : !lhRows.length
          ? 'Mide las páginas clave con Lighthouse para conocer LCP y CLS reales.'
          : 'Revisa las oportunidades de Google: mejora títulos de las páginas en posición 4 a 15.',
      'Rastrea de nuevo en 30 días y compara el puntaje de salud.',
    ];
    let y = TOP;
    const sw = 6.6;
    steps.forEach((st, i) => {
      card(s, M, y, 0.5, 0.5, [WASH.celeste, WASH.lila, WASH.menta, WASH.rosa][i % 4], { radius: 0.25 });
      text(s, String(i + 1), { x: M, y, w: 0.5, h: 0.5, size: 15, family: 'display', bold: true, align: 'center', valign: 'middle', maxLines: 1 });
      text(s, st, { x: M + 0.75, y: y + 0.04, w: sw - 0.75, h: 0.8, size: 15, min: 11, lh: 1.3, maxLines: 2 });
      y += 1.15;
    });
    // Tarjeta de cierre con atmósfera, logotipo y firma
    const cx = M + sw + 0.6;
    const cw = W - M - cx;
    const ch = BOTTOM - TOP;
    atmosphere(s, cx, TOP, cw, ch, [
      { color: WASH.lila, x: 0.15, y: 0.05, r: 0.85 },
      { color: WASH.menta, x: 0.95, y: 0.1, r: 0.8 },
    ]);
    logotipo(s, cx + 0.45, TOP + ch - 2.1, 0.55);
    signature(s, cx + 0.45, TOP + ch - 1.42, 0.3);
    text(s, `Estado del SEO de ${host} · ${date}`, { x: cx + 0.45, y: TOP + ch - 0.95, w: cw - 0.9, h: 0.5, size: 11, color: C.muted, maxLines: 2 });
    footer(s);
    s.addNotes(steps.map((st, i) => `${i + 1}. ${st}`).join('\n') + `\n${SIGNATURE}.` + (brand.notes.length ? `\nMarca: ${brand.notes.join(' ')}` : ''));
  }

  const buf = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

module.exports = { buildPptx, _internals: { fit, wrap, ellipsize, measure, encodePng, pngSize, rasterizeLoto, atmospherePng, ringPng, loadBrand, healthLabel } };
