// Ancho aproximado en píxeles con las métricas de Arial (unidades por 1000 em),
// que es la fuente con la que Google corta títulos y descripciones.
// Sirve en Node y en el navegador.
(function (root) {
  const W = {
    ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333,
    '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584,
    '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, '{': 334,
    '|': 260, '}': 334, '~': 584, '·': 278, '–': 556, '—': 1000, '¿': 611, '¡': 333, '«': 556, '»': 556,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
    n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
    N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  };
  for (const d of '0123456789') W[d] = 556;

  function charWidth(ch) {
    if (W[ch] !== undefined) return W[ch];
    const base = ch.normalize('NFD')[0]; // á → a, Ñ → N
    if (W[base] !== undefined) return W[base];
    return ch.charCodeAt(0) > 0x2e80 ? 1000 : 556; // CJK ocupa un em completo
  }

  function textWidth(text, sizePx) {
    let units = 0;
    for (const ch of String(text || '')) units += charWidth(ch);
    return Math.round((units / 1000) * sizePx);
  }

  // Límites de corte en el escritorio de Google (aprox.)
  const LIMITS = { titlePx: 580, titleSize: 20, descPx: 920, descSize: 14 };

  function truncateToWidth(text, maxPx, sizePx) {
    const ell = textWidth(' …', sizePx);
    let out = '';
    let width = 0;
    for (const ch of String(text || '')) {
      const w = (charWidth(ch) / 1000) * sizePx;
      if (width + w > maxPx - ell) return out.trimEnd() + ' …';
      out += ch;
      width += w;
    }
    return out;
  }

  const api = { textWidth, truncateToWidth, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OctosPixels = api;
})(typeof window !== 'undefined' ? window : globalThis);
