// Node 22+ define un global `localStorage` propio (experimental-webstorage).
// Ese getter nativo exige `--localstorage-file` para funcionar y, sin él,
// deja `localStorage` en `undefined` tanto en `globalThis` como en el
// `window` de jsdom (jsdom delega en la implementación nativa de Node si
// existe). Esto rompe cualquier test que use el storage real del navegador
// simulado.
//
// Se sustituye por un polyfill simple en memoria, suficiente para tests.
function createMemoryStorage() {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  const memoryStorage = createMemoryStorage();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    value: memoryStorage,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: memoryStorage,
    });
  }
}
