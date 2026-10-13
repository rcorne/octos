// Genera, desde los SVG oficiales del sistema de diseño (assets/brand), los PNG
// que usan el ícono de macOS, el PowerPoint y el Excel. No redibuja la marca:
// solo la rasteriza.
//   assets/icon-1024.png                 ícono de app (versión azul) en la retícula de macOS
//   assets/brand/octos-loto.png          loto a color, 1024 px
//   assets/brand/octos-loto-blanco.png   loto blanco, 1024 px
//   assets/brand/octos-loto-azul.png     loto monocromo azul, 1024 px
//   assets/brand/octos-logotipo.png      loto + «Octos» (Manrope 800), para fondos claros
//   assets/brand/octos-logotipo-blanco.png  versión blanca para octos-blue u oscuros
// Usa Chrome headless del sistema para rasterizar (sin Electron).
// Uso: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const FONTS = path.join(ROOT, 'renderer', 'fonts');
const svg = (name) => fs.readFileSync(path.join(BRAND, name), 'utf8');
const { pathToFileURL } = require('url');
const TMP = path.join(ROOT, 'out', 'marca-tmp');
// Archivos locales en vez de data: (la página con fuentes incrustadas excede el límite de URL)
const dataUri = (s) => {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, 'svg-' + Buffer.from(s).length + '-' + s.length % 997 + '.svg');
  fs.writeFileSync(file, s);
  return pathToFileURL(file).href;
};
const font = (file) => pathToFileURL(path.join(FONTS, file)).href;

// Rasteriza con Chrome headless (fondo transparente). Primero mide el elemento #c
// con --dump-dom y luego captura una ventana del tamaño exacto.
const { execFileSync } = require('child_process');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find((p) => fs.existsSync(p));
function chrome(args) {
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', '--user-data-dir=' + path.join(TMP, 'perfil'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
}
function render(html, width, height, outFile) {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, 'pagina.html');
  fs.writeFileSync(file, html.replace('</body>', '<script>document.fonts.ready.then(()=>{const r=document.getElementById("c").getBoundingClientRect();document.title="m:"+Math.ceil(r.width)+"x"+Math.ceil(r.height);document.body.setAttribute("data-m",document.title)})</script></body>'));
  const dom = chrome(['--virtual-time-budget=4000', '--dump-dom', pathToFileURL(file).href]);
  const m = /data-m="m:(\d+)x(\d+)"/.exec(dom);
  const w = m ? Number(m[1]) : width;
  const h = m ? Number(m[2]) : height;
  chrome(['--virtual-time-budget=4000', '--default-background-color=00000000', '--force-device-scale-factor=1', `--window-size=${w},${h}`, `--screenshot=${outFile}`, pathToFileURL(file).href]);
}

const page = (body, w, h) => `<!doctype html><html><head><style>
@font-face{font-family:"Manrope";font-weight:800;src:url("${font('Manrope-800.woff2')}") format("woff2")}
html,body{margin:0;background:transparent;overflow:hidden}
#c{display:inline-flex;align-items:center}
</style></head><body>${body}</body></html>`;

// (la aceleración por hardware se deja activa: sin ella la ventana oculta no carga)
function main() {
  if (!CHROME) throw new Error('Hace falta Google Chrome, Chromium o Edge para rasterizar los activos de marca.');
  fs.mkdirSync(BRAND, { recursive: true });

  // Ícono de app: squircle azul oficial a 824 px sobre 1024 px, con shadow-icon
  const iconHtml = page(
    `<div id="c" style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
       <img src="${dataUri(svg('octos-icono-azul.svg'))}" width="824" height="824"
            style="filter:drop-shadow(0 20px 22px rgba(70,90,170,.22)) drop-shadow(0 2px 3px rgba(70,90,170,.10))">
     </div>`,
    1024,
    1024
  );
  render(iconHtml, 1024, 1024, path.join(ROOT, 'assets', 'icon-1024.png'));

  // Lotos sueltos
  for (const [src, out] of [
    ['octos-loto.svg', 'octos-loto.png'],
    ['octos-loto-blanco.svg', 'octos-loto-blanco.png'],
    ['octos-loto-azul.svg', 'octos-loto-azul.png'],
  ]) {
    render(page(`<div id="c"><img src="${dataUri(svg(src))}" width="1024" height="1024" style="display:block"></div>`, 1024, 1024), 1024, 1024, path.join(BRAND, out));
  }

  // Logotipo: loto de alto H, «Octos» a 0,7 H en Manrope 800, tracking −0,02em, separación 0,25 H
  const H = 400;
  for (const [src, color, out] of [
    ['octos-loto.svg', '#12141C', 'octos-logotipo.png'],
    ['octos-loto-blanco.svg', '#FFFFFF', 'octos-logotipo-blanco.png'],
  ]) {
    const html = page(
      `<div id="c"><img src="${dataUri(svg(src))}" width="${H}" height="${H}" style="display:block">
         <span style="font-family:Manrope;font-weight:800;font-size:${0.7 * H}px;line-height:1;letter-spacing:-0.02em;color:${color};margin-left:${0.25 * H}px;padding-right:${0.06 * H}px">Octos</span></div>`,
      2000,
      H
    );
    render(html, 2000, H, path.join(BRAND, out));
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Ícono y activos de marca generados.');
}

try {
  main();
} catch (err) {
  console.error('Error generando activos:', err.message);
  process.exit(1);
}
