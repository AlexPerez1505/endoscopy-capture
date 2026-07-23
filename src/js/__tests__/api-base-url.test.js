import { beforeEach, describe, expect, it } from 'vitest';
import { apiBaseUrl, isValidApiBaseUrl } from '../laravel.js';
import { API_URL_STORAGE_KEY as STORAGE_KEY } from '../storage-keys.js';

// vitest.config.js arranca jsdom en http://localhost/, así que
// currentLaravelOrigin() siempre devuelve 'http://localhost' en estos
// tests. Por eso los casos usan una URL remota (no local) para probar el
// valor guardado tal cual, y dejamos que los casos "sin valor guardado" /
// "valor corrupto" caigan de forma predecible en ese origen local.
const REMOTE_URL = 'https://sistema.enclaii.com';

beforeEach(() => {
  localStorage.clear();
});

describe('isValidApiBaseUrl', () => {
  it('acepta URLs http/https absolutas', () => {
    expect(isValidApiBaseUrl('https://sistema.enclaii.com')).toBe(true);
    expect(isValidApiBaseUrl('http://localhost:8000')).toBe(true);
  });

  it('rechaza valores corruptos o mal formados', () => {
    expect(isValidApiBaseUrl('no-es-una-url')).toBe(false);
    expect(isValidApiBaseUrl('/solo/una/ruta')).toBe(false);
    expect(isValidApiBaseUrl('')).toBe(false);
    expect(isValidApiBaseUrl('   ')).toBe(false);
  });

  it('rechaza protocolos que no sean http/https', () => {
    expect(isValidApiBaseUrl('javascript:alert(1)')).toBe(false);
    expect(isValidApiBaseUrl('ftp://files.example.com')).toBe(false);
  });
});

describe('apiBaseUrl', () => {
  it('devuelve el valor guardado (remoto) sin cambios, sin slash final', () => {
    localStorage.setItem(STORAGE_KEY, `${REMOTE_URL}/`);

    expect(apiBaseUrl()).toBe(REMOTE_URL);
  });

  it('descarta un valor corrupto y limpia el localStorage automáticamente', () => {
    localStorage.setItem(STORAGE_KEY, 'esto-no-es-una-url');

    const result = apiBaseUrl();

    expect(isValidApiBaseUrl(result) || result.startsWith('http://localhost')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('no toca el localStorage cuando el valor guardado es válido', () => {
    localStorage.setItem(STORAGE_KEY, REMOTE_URL);

    apiBaseUrl();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(REMOTE_URL);
  });

  it('usa un valor por defecto razonable cuando no hay nada guardado', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const result = apiBaseUrl();

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(isValidApiBaseUrl(result)).toBe(true);
  });
});
