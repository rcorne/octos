// Empaqueta Octos como app de macOS (Apple Silicon), la firma de forma local
// (ad hoc) y crea el instalador .dmg con acceso directo a Aplicaciones.
// Uso: npm run package
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = path.join(ROOT, 'out');
const arch = process.argv[2] || 'arm64';
const electronVersion = pkg.devDependencies?.electron || pkg.dependencies?.electron;
const electronZipName = `electron-v${electronVersion}-darwin-${arch}.zip`;

function cachedElectronZip() {
  const configured = process.env.ELECTRON_ZIP_DIR;
  if (configured && fs.existsSync(path.join(configured, electronZipName))) return path.resolve(configured);
  const roots = [process.env.ELECTRON_CACHE, path.join(os.homedir(), 'Library', 'Caches', 'electron'), path.join(os.homedir(), '.cache', 'electron')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const visit = (dir, depth) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isFile() && entry.name === electronZipName) return full;
          if (entry.isDirectory() && depth > 0) {
            const found = visit(full, depth - 1);
            if (found) return found;
          }
        }
      } catch { /* caché inaccesible */ }
      return null;
    };
    const found = visit(root, 3);
    if (found) return path.dirname(found);
  }
  return undefined;
}

const electronZipDir = cachedElectronZip();

if (!fs.existsSync(path.join(ROOT, 'assets', 'icon.icns'))) {
  console.error('Falta assets/icon.icns. Ejecuta primero: npm run icon');
  process.exit(1);
}

console.log(`Empaquetando Octos ${pkg.version} para macOS ${arch}…`);
const [appDir] = await packager({
  dir: ROOT,
  out: OUT,
  name: 'Octos',
  platform: 'darwin',
  arch,
  overwrite: true,
  asar: false, // Lighthouse y sus dependencias no funcionan dentro de un .asar (el worker corre como proceso aparte)
  electronVersion,
  ...(electronZipDir ? { electronZipDir } : {}),
  prune: true,
  icon: path.join(ROOT, 'assets', 'icon.icns'),
  appBundleId: 'com.mamiferolab.octos',
  appCategoryType: 'public.app-category.developer-tools',
  appCopyright: `© ${new Date().getFullYear()} Rodrigo Cornejo`,
  appVersion: pkg.version,
  buildVersion: pkg.version,
  darwinDarkModeSupport: true,
  ignore: [/^\/out($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/assets\/icon-1024\.png$/, /\.md$/, /^\/\.gitignore$/],
  extendInfo: {
    CFBundleDocumentTypes: [
      {
        CFBundleTypeName: 'Rastreo de Octos',
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
        LSItemContentTypes: ['com.mamiferolab.octos.rastreo'],
        CFBundleTypeIconFile: 'electron.icns',
      },
    ],
    UTExportedTypeDeclarations: [
      {
        UTTypeIdentifier: 'com.mamiferolab.octos.rastreo',
        UTTypeDescription: 'Rastreo de Octos',
        UTTypeConformsTo: ['public.json', 'public.data'],
        UTTypeTagSpecification: { 'public.filename-extension': ['octos'] },
      },
    ],
    LSApplicationCategoryType: 'public.app-category.developer-tools',
    NSHumanReadableCopyright: `© ${new Date().getFullYear()} Rodrigo Cornejo`,
  },
});

const app = path.join(appDir, 'Octos.app');
console.log('Firmando de forma local (ad hoc)…');
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });

console.log('Creando el instalador .dmg…');
const stage = path.join(OUT, 'dmg-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
execFileSync('ditto', [app, path.join(stage, 'Octos.app')]);
fs.symlinkSync('/Applications', path.join(stage, 'Aplicaciones'));
const dmg = path.join(OUT, `Octos-${pkg.version}-${arch}.dmg`);
fs.rmSync(dmg, { force: true });
const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(0) + ' MB';
let installer = dmg;
try {
  execFileSync('hdiutil', ['create', '-volname', 'Octos', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-fs', 'HFS+', dmg], { stdio: 'inherit' });
} catch (error) {
  console.warn(`No se pudo crear el DMG con hdiutil (${error.message}). Creando ZIP para macOS…`);
  installer = path.join(OUT, `Octos-${pkg.version}-${arch}.zip`);
  fs.rmSync(installer, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, installer], { stdio: 'inherit' });
}
fs.rmSync(stage, { recursive: true, force: true });

console.log(`\nListo:\n  App: ${app}\n  Instalador: ${installer} (${mb(installer)})`);
