import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY, authHeader, clearAuthToken, getAuthToken, isAuthenticated, setAuthToken } from '../auth.js';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('auth.js', () => {
  it('getAuthToken devuelve vacío cuando no hay sesión', () => {
    expect(getAuthToken()).toBe('');
    expect(isAuthenticated()).toBe(false);
    expect(authHeader()).toBe('');
  });

  it('setAuthToken guarda en sessionStorage y limpia el prefijo Bearer', () => {
    setAuthToken('Bearer abc123');

    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe('abc123');
    expect(getAuthToken()).toBe('abc123');
    expect(isAuthenticated()).toBe(true);
    expect(authHeader()).toBe('Bearer abc123');
  });

  it('setAuthToken no persiste en localStorage', () => {
    setAuthToken('abc123');

    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('setAuthToken ignora valores vacíos', () => {
    setAuthToken('   ');

    expect(getAuthToken()).toBe('');
  });

  it('getAuthToken usa localStorage como respaldo si no hay sessionStorage', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, 'fallback-token');

    expect(getAuthToken()).toBe('fallback-token');
    expect(authHeader()).toBe('Bearer fallback-token');
  });

  it('sessionStorage tiene prioridad sobre localStorage', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, 'local-token');
    sessionStorage.setItem(AUTH_STORAGE_KEY, 'session-token');

    expect(getAuthToken()).toBe('session-token');
  });

  it('clearAuthToken limpia ambos storages', () => {
    sessionStorage.setItem(AUTH_STORAGE_KEY, 'session-token');
    localStorage.setItem(AUTH_STORAGE_KEY, 'local-token');

    clearAuthToken();

    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(getAuthToken()).toBe('');
    expect(isAuthenticated()).toBe(false);
  });
});
