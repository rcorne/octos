// Pruebas de marca: tokens en styles.css, voz de los textos, geometría del
// loto oficial y firma del informe. Uso: node test/marca.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.message);
    process.exitCode = 1;
  }
};

const tokensCss = read('renderer/tokens.css');
const stylesCss = read('renderer/styles.css');
const appJs = read('renderer/app.js');
const reportJs = read('renderer/report.js');
const iconsJs = read('renderer/icons.js');
const indexHtml = read('renderer/index.html');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('Octos · pruebas de marca');

await test('index.html carga tokens.css antes que styles.css y no trae los blobs viejos', () => {
  const t = indexHtml.indexOf('href="tokens.css"');
  const s = indexHtml.indexOf('href="styles.css"');
  assert.ok(t > 0 && s > t, 'tokens.css debe ir antes que styles.css');
  assert.ok(!/class="blobs"/.test(indexHtml), 'quedan los blobs de fondo');
});

await test('styles.css no usa colores fuera de los tokens (salvo rgba de sombras)', () => {
  const css = stripComments(stylesCss);
  // Excepciones oficiales: el ícono claro (octos-icono-claro.svg) lleva fondo #FFFFFF y borde #E3E7F2
  // en cualquier tema, y el logotipo sobre fondo oscuro va en blanco (#FFFFFF).
  const OFICIALES = new Set(['#FFFFFF', '#E3E7F2']);
  const hex = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) => !OFICIALES.has(h.toUpperCase()));
  assert.deepEqual(hex, [], `colores hex: ${hex.join(', ')}`);
  const fns = css.match(/\b(?:hsla?|hwb|lab|lch|oklab|oklch)\s*\(/g) || [];
  assert.deepEqual(fns, [], `funciones de color: ${fns.join(', ')}`);
  // rgb/rgba solo dentro de box-shadow
  for (const decl of css.split(/[;{}]/)) {
    if (/\brgba?\s*\(/.test(decl)) assert.match(decl.trim(), /^box-shadow\s*:/, `rgba fuera de una sombra: ${decl.trim()}`);
  }
  const named = css.match(/(?<![\w-])(?:white|black|red|orange|green|blue|gray|grey|pink|purple|yellow)(?![\w-])/gi) || [];
  assert.deepEqual(named, [], `colores con nombre: ${named.join(', ')}`);
  // Cada var(--x) existe en tokens.css o se define en styles.css
  const defined = new Set([...(tokensCss + css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
  const unknown = used.filter((v) => !defined.has(v));
  assert.deepEqual(unknown, [], `variables sin definir: ${unknown.join(', ')}`);
  for (const old of ['--primary', '--sky', '--peri', '--lavender', '--bad', '--warn', '--ok', '--card', '--muted', '--faint', '.blobs']) {
    assert.ok(!css.includes(old), `queda la paleta vieja: ${old}`);
  }
});

await test('styles.css usa los tokens de la marca y las familias tipográficas', () => {
  for (const t of ['--canvas', '--surface', '--ink', '--ink-muted', '--hairline', '--octos-blue', '--on-octos-blue', '--wash-celeste', '--wash-lila', '--wash-menta', '--wash-rosa', '--shadow-card', '--shadow-icon', '--radius-md', '--radius-xl', '--radius-app', '--font-display', '--font-text']) {
    assert.ok(stylesCss.includes(`var(${t})`), `no usa ${t}`);
  }
  assert.match(stylesCss, /body\s*{[^}]*background:\s*var\(--canvas\)/, 'el fondo general debe ser canvas plano');
  assert.match(stylesCss, /\.btn\s*{[^}]*background:\s*var\(--octos-blue\)[^}]*}/, 'el botón primario debe ser octos-blue');
  assert.match(tokensCss, /\[data-theme="dark"\]/, 'tokens.css debe traer el tema oscuro');
});

// Textos visibles: sin emoji, sin «¡» y sin «!» al final de una frase
const EMOJI = /[\p{Emoji_Presentation}\u{FE0F}]/u;
const BANG = /[\p{L}\p{N}.)»”]!(?=[\s<'"`]|$)/mu;
await test('sin emoji ni signos de exclamación en los textos de renderer/', () => {
  for (const [file, src] of [['app.js', appJs], ['report.js', reportJs], ['icons.js', iconsJs], ['index.html', indexHtml]]) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      assert.ok(!EMOJI.test(line), `emoji en ${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
      assert.ok(!line.includes('¡'), `«¡» en ${file}:${i + 1}`);
      assert.ok(!BANG.test(line), `«!» en ${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
});

await test('la firma reemplaza al sello «Powered by» y Octos se escribe bien', () => {
  for (const [file, src] of [['app.js', appJs], ['report.js', reportJs], ['index.html', indexHtml]]) {
    assert.ok(!/powered by/i.test(src), `queda «Powered by» en ${file}`);
    assert.ok(!/OCTOS(?![_A-Z])/.test(src.replace(/window\.octos|octos-|\.octos/g, '')), `«OCTOS» en mayúsculas en ${file}`);
  }
  // La firma lleva el logotipo de Mamífero (imagen) a la derecha de «Una creación de»
  assert.match(appJs, /Una creación de<\/span><img class="firma-logo" src="\$\{window\.MAMIFERO_LOGO/);
  assert.match(appJs, /alt="Mamífero"/);
  assert.match(appJs, /data-ext="\$\{MAMIFERO_URL\}"/);
  assert.match(appJs, /MAMIFERO_URL = 'https:\/\/mamiferolab\.com\/'/);
});

// Carga icons.js en un contexto aislado
const ctx = vm.createContext({ window: {}, document: { querySelectorAll: () => [] } });
vm.runInContext(iconsJs, ctx);
const Icons = ctx.window.OctosIcons;

await test('icons.js reproduce la geometría del loto oficial', () => {
  const svg = read('assets/brand/octos-loto.svg');
  const brandColors = [...svg.matchAll(/<use href="#p" fill="(#[0-9A-F]{6})"/gi)].map((m) => m[1].toUpperCase());
  assert.equal(brandColors.length, 8);
  assert.match(svg, /<rect id="p" x="90" y="30" width="20" height="46" rx="10"\/>/);
  assert.match(svg, /viewBox="20 20 160 160"/);

  const out = Icons.lotus(48, 'color');
  assert.match(out, /viewBox="20 20 160 160"/);
  const rects = [...out.matchAll(/<rect ([^>]*)\/>/g)].map((m) => m[1]);
  assert.equal(rects.length, 8, 'ocho pétalos');
  rects.forEach((r, i) => {
    assert.match(r, /x="90" y="30" width="20" height="46" rx="10"/, `pétalo ${i + 1}: cápsula 20 × 46 rx 10`);
    const rot = (r.match(/rotate\((\d+) 100 100\)/) || [, '0'])[1];
    assert.equal(Number(rot), i * 45, `pétalo ${i + 1}: rotación`);
    assert.equal((r.match(/fill="(#[0-9A-F]{6})"/i) || [])[1].toUpperCase(), brandColors[i], `pétalo ${i + 1}: color y orden`);
  });
  assert.match(out, /<circle cx="100" cy="100" r="6" fill="#2E8CFF"\/>/, 'punto central r = 6 en petal-azul');
  assert.ok(!/filter|stroke|shadow/.test(out), 'sin sombras ni contornos en el símbolo');

  // Paleta de pétalos igual a tokens.css
  const tokenPetals = ['celeste', 'cielo', 'azul', 'indigo', 'violeta', 'lila', 'agua', 'menta'].map((n) => tokensCss.match(new RegExp(`--petal-${n}:\\s*(#[0-9A-F]{6})`, 'i'))[1].toUpperCase());
  assert.deepEqual([...Icons.PETALS], tokenPetals);
});

await test('versiones azul y blanca, y tamaño mínimo del loto a color', () => {
  assert.match(Icons.lotus(32, 'azul'), /style="fill:var\(--octos-blue, #0B6BFF\)"/);
  assert.match(Icons.lotus(32, 'blanco'), /style="fill:#FFFFFF"/);
  const small = Icons.lotus(20, 'color');
  assert.ok(small.includes('loto-azul') && !small.includes('#7FD0FF'), 'bajo 24 px se usa la versión azul');
  assert.ok(Icons.lotus(24, 'color').includes('#7FD0FF'), 'a 24 px sigue a color');
});

await test('logotipo: loto H, «Octos» a 0,7 H, separación 0,25 H, Manrope 800, mínimo 32 px', () => {
  const l = Icons.logotipo(40);
  assert.match(l, /gap:10px/);
  assert.match(l, /height:40px/);
  assert.match(l, /width="40" height="40"/);
  assert.match(l, /font-size:28px/);
  assert.match(l, /font-weight:800/);
  assert.match(l, /letter-spacing:-0\.02em/);
  assert.match(l, /font-family:Manrope/);
  assert.match(l, /align-items:center/);
  assert.match(l, />Octos<\/span>/);
  assert.match(Icons.logotipo(20), /height:32px/, 'nunca menos de 32 px de alto');
  assert.match(Icons.icon('logotipo'), /height:32px/);
  assert.match(indexHtml, /data-icon="logotipo"/, 'la barra de título usa el logotipo');
});

await test('barra de título: botones Atrás, Adelante e Inicio, y atajos editables', () => {
  for (const id of ['nav-back', 'nav-forward', 'nav-home']) assert.match(indexHtml, new RegExp(`id="${id}"`), id);
  for (const id of ['back', 'forward', 'home']) assert.match(appJs, new RegExp(`id: '${id}'`), `atajo ${id}`);
  assert.match(appJs, /function navStep\(delta\)/);
});

await test('Google: paso a paso con los nombres de la consola y aviso que guía', () => {
  for (const t of ['Aplicación de escritorio', 'Google Auth platform', 'Usuarios de prueba', 'Crear cliente', 'webmasters.readonly', 'analytics.readonly', 'Publicar la app', 'Google no verificó esta aplicación']) {
    assert.ok(appJs.includes(t), `la guía no menciona «${t}»`);
  }
  assert.ok(appJs.includes('Rellena la información de abajo para sumar datos de Google a tus rastreos'));
  assert.ok(!appJs.includes("'Sin conectar'"), 'quedó la etiqueta «Sin conectar», que no ayuda');
  assert.ok(!appJs.includes('El llavero de macOS no está disponible'), 'quedó la alerta del llavero');
});

await test('asistente de IA: el modelo es una lista que se carga con el proveedor', () => {
  assert.match(appJs, /<select id="ai-model"/);
  assert.match(appJs, /function ensureAiModels/);
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) assert.ok(appJs.includes(m), m);
});

await test('logotipo de Mamífero: archivo, versión incrustada y uso en la firma', () => {
  const png = readFileSync(path.join(ROOT, 'assets/brand/mamifero-logo.png'));
  assert.equal(png.readUInt32BE(16), 1637, 'ancho del logotipo original');
  const js = read('renderer/mamifero-logo.js');
  assert.match(js, /window\.MAMIFERO_LOGO = 'data:image\/png;base64,/);
  assert.match(indexHtml, /mamifero-logo\.js/);
  assert.ok(indexHtml.indexOf('mamifero-logo.js') < indexHtml.indexOf('app.js'), 'el logotipo carga antes que app.js');
});

await test('el informe HTML lleva la marca y la firma «Una creación de Mamífero»', () => {
  const { analyze, SEV, CATEGORIES } = require('../lib/analysis.js');
  const project = JSON.parse(read('test/preview/proyecto-ejemplo.json'));
  const result = analyze(project);
  const byId = new Map(project.rows.map((r) => [r.id, r]));
  ctx.window.OctosAnalysis = { SEV, CATEGORIES };
  vm.runInContext(reportJs, ctx);
  const html = ctx.window.OctosReport.build({ result, meta: project.meta, byId });
  const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '');
  assert.ok(text.includes('Una creación de'), 'falta la firma');
  assert.match(html, /<a href="https:\/\/mamiferolab\.com\/">Una creación de <img src="[^"]*" alt="Mamífero" class="firma-logo"><\/a>/);
  assert.match(html, /viewBox="20 20 160 160"/, 'falta el loto en el logotipo');
  assert.match(html, /font-family:Manrope/);
  assert.match(html, /"Manrope","IBM Plex Sans",system-ui/);
  assert.ok(!EMOJI.test(html), 'emoji en el informe');
  assert.ok(!/powered by/i.test(html));
  // Severidades sin rojos ni naranjas
  for (const c of ['#ee3b6d', '#f2871f', '#17b37f', '#0a8cff']) assert.ok(!html.toLowerCase().includes(c + ';') && !html.toLowerCase().includes(c + '"'), `color fuera de marca ${c}`);
  assert.match(text, /Salud (buena|mejorable|crítica)/);
});

console.log(`\n${passed} pruebas de marca OK`);
