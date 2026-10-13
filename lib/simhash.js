// SimHash de 64 bits sobre trigramas de palabras para detectar contenido casi
// duplicado, con bandas de 16 bits para no comparar todos contra todos.
// Sirve en Node (extracción) y en el navegador (análisis).
(function (root) {
  const MASK = (1n << 64n) - 1n;

  function fnv1a64(str) {
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < str.length; i++) {
      h ^= BigInt(str.charCodeAt(i));
      h = (h * 0x100000001b3n) & MASK;
    }
    return h;
  }

  function simhash(text) {
    const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (words.length < 20) return null; // muy poco texto para comparar
    const v = new Array(64).fill(0);
    for (let i = 0; i + 2 < words.length; i++) {
      const h = fnv1a64(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
      for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
    }
    let out = 0n;
    for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
    return out.toString(16).padStart(16, '0');
  }

  function hamming(a, b) {
    let x = BigInt('0x' + a) ^ BigInt('0x' + b);
    let n = 0;
    while (x) {
      x &= x - 1n;
      n++;
    }
    return n;
  }

  // Pares [i, j, similitud%] con distancia ≤ maxDist (3 bits ≈ 95 % de similitud).
  function nearDuplicates(hashes, maxDist = 3) {
    const bands = [new Map(), new Map(), new Map(), new Map()];
    const pairs = new Map();
    hashes.forEach((h, i) => {
      if (!h) return;
      for (let b = 0; b < 4; b++) {
        const key = h.slice(b * 4, b * 4 + 4);
        const bucket = bands[b].get(key);
        if (bucket) {
          for (const j of bucket) {
            const k = j + ':' + i;
            if (pairs.has(k) || hashes[j] === h) continue; // idénticos los cubre "duplicado exacto"
            const d = hamming(h, hashes[j]);
            if (d <= maxDist) pairs.set(k, [j, i, Math.round((1 - d / 64) * 100)]);
          }
          bucket.push(i);
        } else bands[b].set(key, [i]);
      }
    });
    return [...pairs.values()];
  }

  const api = { simhash, hamming, nearDuplicates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OctosSimhash = api;
})(typeof window !== 'undefined' ? window : globalThis);
