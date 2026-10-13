// Normalización de URLs y utilidades de dominio.

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

function normalizeUrl(input, base, { stripTracking = true } = {}) {
  let u;
  try {
    u = new URL(String(input).trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  if (stripTracking && u.search) {
    const params = new URLSearchParams(u.search);
    for (const key of [...params.keys()]) if (TRACKING.test(key)) params.delete(key);
    const qs = params.toString();
    u.search = qs ? '?' + qs : '';
  }
  return u.toString();
}

// Dominio registrable aproximado (ej.co, ej.cl, ej.com.ar → mantiene 3 partes)
function siteRoot(hostname) {
  const parts = hostname.replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  if (parts[parts.length - 1].length === 2 && /^(co|com|org|net|gob|gov|edu|ac|or|ne)$/.test(sld)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isInternal(url, startHost, includeSubdomains) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === startHost) return true;
  const strip = (h) => h.replace(/^www\./, '');
  if (strip(host) === strip(startHost)) return true;
  if (includeSubdomains) return siteRoot(host) === siteRoot(startHost);
  return false;
}

module.exports = { normalizeUrl, siteRoot, isInternal };
