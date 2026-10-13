// Almacén de credenciales (claves de API, tokens de Google). Guarda un JSON con
// los valores cifrados; el cifrado lo inyecta quien lo usa: en la app,
// safeStorage de Electron (llavero de macOS); en las pruebas, una función falsa.
// Las credenciales viven solo en el proceso principal y nunca se envían a la interfaz.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createSecretStore({ file, encrypt, decrypt }) {
  if (!file || typeof encrypt !== 'function' || typeof decrypt !== 'function') {
    throw new Error('createSecretStore necesita file, encrypt y decrypt');
  }
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      cache = {};
    }
    return cache;
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    get(key) {
      const v = load()[key];
      if (!v) return null;
      try {
        return decrypt(Buffer.from(v, 'base64'));
      } catch {
        return null; // llavero cambiado o archivo dañado: se trata como ausente
      }
    },
    set(key, value) {
      load();
      if (value === null || value === undefined || value === '') delete cache[key];
      else cache[key] = Buffer.from(encrypt(String(value))).toString('base64');
      persist();
    },
    delete(key) {
      load();
      delete cache[key];
      persist();
    },
    has(key) {
      return !!load()[key];
    },
    keys() {
      return Object.keys(load());
    },
  };
}

// Para guardar objetos (tokens OAuth, cuenta de servicio)
function jsonSecret(store, key) {
  return {
    get() {
      const raw = store.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(obj) {
      store.set(key, obj ? JSON.stringify(obj) : null);
    },
  };
}

// Cifrado con respaldo. Primero usa el llavero de macOS (safeStorage); si no responde, cifra con
// AES-256-GCM y una llave aleatoria guardada en un archivo solo legible por el usuario. Así Octos
// nunca rechaza una clave por un problema del llavero. Los valores del respaldo llevan la marca OCF1.
function createHybridCipher({ safeStorage, keyFile, log = () => {} }) {
  const MARK = Buffer.from('OCF1');
  let key = null;
  const localKey = () => {
    if (key) return key;
    try {
      key = fs.readFileSync(keyFile);
      if (key.length !== 32) throw new Error('llave inválida');
    } catch {
      key = crypto.randomBytes(32);
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, key, { mode: 0o600 });
    }
    return key;
  };
  const keychainOk = () => {
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  return {
    backend: () => (keychainOk() ? 'llavero' : 'local'),
    encrypt(value) {
      if (keychainOk()) {
        try {
          return safeStorage.encryptString(value);
        } catch (err) {
          log('El llavero no pudo cifrar; se usa el cifrado local: ' + err.message);
        }
      }
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', localKey(), iv);
      const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([MARK, iv, cipher.getAuthTag(), enc]);
    },
    decrypt(buf) {
      if (buf.subarray(0, 4).equals(MARK)) {
        const iv = buf.subarray(4, 16);
        const tag = buf.subarray(16, 32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', localKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]).toString('utf8');
      }
      return safeStorage.decryptString(buf);
    },
  };
}

module.exports = { createSecretStore, jsonSecret, createHybridCipher };
