// Lector de robots.txt: grupos por user-agent, Allow/Disallow con comodines
// (* y $) y la regla de coincidencia más larga que usa Google.

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  return { groups, sitemaps };
}

function ruleToRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function groupFor(parsed, userAgent) {
  const token = String(userAgent || '').toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const g of parsed.groups) {
    for (const a of g.agents) {
      if (a !== '*' && token.includes(a) && a.length > bestLen) {
        best = g;
        bestLen = a.length;
      }
    }
  }
  if (best) return best;
  return parsed.groups.find((g) => g.agents.includes('*')) || null;
}

function isAllowed(parsed, url, userAgent) {
  if (!parsed) return true;
  const group = groupFor(parsed, userAgent);
  if (!group) return true;
  let target;
  try {
    const u = new URL(url);
    target = u.pathname + u.search;
  } catch {
    return true;
  }
  let match = null;
  for (const rule of group.rules) {
    if (rule.path === '') continue; // "Disallow:" vacío no bloquea nada
    if (ruleToRegex(rule.path).test(target)) {
      const len = rule.path.length;
      // A igual longitud gana Allow
      if (!match || len > match.len || (len === match.len && rule.allow)) {
        match = { allow: rule.allow, len, path: rule.path };
      }
    }
  }
  return match ? match.allow : true;
}

function matchingRule(parsed, url, userAgent) {
  const group = parsed && groupFor(parsed, userAgent);
  if (!group) return null;
  const u = new URL(url);
  const target = u.pathname + u.search;
  let match = null;
  for (const rule of group.rules) {
    if (rule.path && ruleToRegex(rule.path).test(target)) {
      if (!match || rule.path.length > match.path.length) match = rule;
    }
  }
  return match;
}

module.exports = { parseRobots, isAllowed, matchingRule };
