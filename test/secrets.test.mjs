// Pruebas del almacén de credenciales con respaldo de cifrado local.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSecretStore, createHybridCipher, jsonSecret } = require('../lib/secrets.js');

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
console.log('Octos · pruebas del almacén de credenciales');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octos-sec-'));
const fakeKeychain = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (v) => Buffer.from('v10' + Buffer.from(v).toString('base64')),
  decryptString: (b) => Buffer.from(b.toString().slice(3), 'base64').toString(),
});
const make = (safeStorage, name) => {
  const cipher = createHybridCipher({ safeStorage, keyFile: path.join(dir, name + '.key') });
  return { cipher, store: createSecretStore({ file: path.join(dir, name + '.enc'), encrypt: cipher.encrypt, decrypt: cipher.decrypt }) };
};

await test('con llavero disponible usa el llavero', () => {
  const { cipher, store } = make(fakeKeychain(true), 'a');
  store.set('ai.key.anthropic', 'sk-ant-secreto');
  assert.equal(cipher.backend(), 'llavero');
  assert.equal(store.get('ai.key.anthropic'), 'sk-ant-secreto');
  assert.ok(!fs.readFileSync(path.join(dir, 'a.enc'), 'utf8').includes('secreto'), 'el archivo no guarda la clave en claro');
});

await test('sin llavero cifra con la llave local y no rechaza la clave', () => {
  const { cipher, store } = make(fakeKeychain(false), 'b');
  store.set('ai.key.openai', 'sk-proj-123');
  assert.equal(cipher.backend(), 'local');
  assert.equal(store.get('ai.key.openai'), 'sk-proj-123');
  const raw = fs.readFileSync(path.join(dir, 'b.enc'), 'utf8');
  assert.ok(!raw.includes('sk-proj'), 'cifrado');
  // Los permisos de Unix no existen en Windows: allí la llave queda dentro del perfil del usuario (AppData)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'b.key')).mode & 0o777, 0o600, 'la llave local solo la lee el usuario');
});

await test('si el llavero falla al cifrar, cae al cifrado local', () => {
  const broken = { ...fakeKeychain(true), encryptString: () => { throw new Error('acceso denegado'); } };
  const { store } = make(broken, 'c');
  store.set('x', 'valor');
  assert.equal(store.get('x'), 'valor');
});

await test('la llave local se reutiliza entre sesiones', () => {
  const first = make(fakeKeychain(false), 'd');
  first.store.set('k', 'persistente');
  const second = make(fakeKeychain(false), 'd');
  assert.equal(second.store.get('k'), 'persistente');
});

await test('un archivo alterado se trata como ausente, sin lanzar errores', () => {
  const { store } = make(fakeKeychain(false), 'e');
  store.set('k', 'v');
  const file = path.join(dir, 'e.enc');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const buf = Buffer.from(json.k, 'base64');
  buf[buf.length - 1] ^= 0xff;
  json.k = buf.toString('base64');
  fs.writeFileSync(file, JSON.stringify(json));
  const again = make(fakeKeychain(false), 'e');
  assert.equal(again.store.get('k'), null);
});

await test('jsonSecret guarda y lee objetos', () => {
  const { store } = make(fakeKeychain(false), 'f');
  const s = jsonSecret(store, 'google.tokens');
  s.set({ refresh_token: 'abc', n: 1 });
  assert.deepEqual(s.get(), { refresh_token: 'abc', n: 1 });
  s.set(null);
  assert.equal(s.get(), null);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} pruebas OK`);
