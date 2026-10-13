// Corre todas las pruebas de Octos, una por proceso, y resume el resultado.
// Uso: npm test
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const archivos = ['run-tests.mjs', 'secrets.test.mjs', 'analisis-v2.test.mjs', 'google.test.mjs', 'ai.test.mjs', 'lighthouse.test.mjs', 'exportes.test.mjs', 'marca.test.mjs'];
let fallos = 0;
for (const f of archivos) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 240000 });
  const ok = r.status === 0;
  if (!ok) fallos++;
  console.log(`${ok ? '✓' : '✗'} ${f} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').filter((l) => /✗|Error|error/.test(l)).slice(0, 8).join('\n'));
}
console.log(fallos ? `\n${fallos} archivo(s) con fallos` : '\nTodas las pruebas pasan');
process.exit(fallos ? 1 : 0);
