import { describe, expect, it } from 'vitest';

describe('vitest pipeline', () => {
  it('corre en entorno jsdom con acceso al DOM', () => {
    document.body.innerHTML = '<div id="smoke"></div>';

    expect(document.getElementById('smoke')).not.toBeNull();
  });

  it('soporta ESM y aritmética básica', () => {
    expect(1 + 1).toBe(2);
  });
});
