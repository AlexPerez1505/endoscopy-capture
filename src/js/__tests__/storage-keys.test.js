import { describe, expect, it } from 'vitest';
import * as storageKeys from '../storage-keys.js';
import { AUTH_STORAGE_KEY } from '../auth.js';

describe('storage-keys', () => {
  it('exporta únicamente strings no vacíos con el prefijo enclaii-', () => {
    const entries = Object.entries(storageKeys);

    expect(entries.length).toBeGreaterThan(0);

    for (const [name, value] of entries) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(value.startsWith('enclaii-')).toBe(true);
      expect(name.endsWith('_STORAGE_KEY')).toBe(true);
    }
  });

  it('no tiene claves duplicadas entre constantes distintas', () => {
    const values = Object.values(storageKeys);
    const uniqueValues = new Set(values);

    expect(uniqueValues.size).toBe(values.length);
  });

  it('auth.js reexporta la misma constante que storage-keys.js', () => {
    expect(AUTH_STORAGE_KEY).toBe(storageKeys.AUTH_STORAGE_KEY);
  });
});
