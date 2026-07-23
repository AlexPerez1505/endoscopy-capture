import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw } from '../html.js';

describe('escapeHtml', () => {
  it('escapa los 5 caracteres peligrosos de HTML', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(escapeHtml('Kevin & "Martinez" \'Jr\'')).toBe(
      'Kevin &amp; &quot;Martinez&quot; &#039;Jr&#039;'
    );
  });

  it('convierte null/undefined en cadena vacía', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('convierte números y otros valores a texto', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('html (tagged template)', () => {
  it('escapa automáticamente los valores interpolados', () => {
    const userInput = '<img src=x onerror="alert(1)">';
    const result = html`<p>${userInput}</p>`;

    expect(result).toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>');
    expect(result).not.toContain('<img');
  });

  it('no escapa los literales de la plantilla', () => {
    const result = html`<div class="card"><strong>${'ok'}</strong></div>`;

    expect(result).toBe('<div class="card"><strong>ok</strong></div>');
  });

  it('preserva múltiples interpolaciones en orden', () => {
    const result = html`${'a'}-${'b'}-${'c'}`;

    expect(result).toBe('a-b-c');
  });

  it('escapa cada elemento de un arreglo interpolado', () => {
    const items = ['<b>uno</b>', '<b>dos</b>'];
    const result = html`<ul>${items}</ul>`;

    expect(result).toBe('<ul>&lt;b&gt;uno&lt;/b&gt;&lt;b&gt;dos&lt;/b&gt;</ul>');
  });

  it('no escapa contenido envuelto con raw()', () => {
    const trustedSvg = '<svg><circle/></svg>';
    const result = html`<div>${raw(trustedSvg)}</div>`;

    expect(result).toBe('<div><svg><circle/></svg></div>');
  });

  it('permite anidar html`...` marcando el resultado como raw', () => {
    const inner = html`<li>${'<script>x</script>'}</li>`;
    const outer = html`<ul>${raw(inner)}</ul>`;

    expect(outer).toBe('<ul><li>&lt;script&gt;x&lt;/script&gt;</li></ul>');
  });

  it('escapa cada elemento de un arreglo de raw() individualmente marcados', () => {
    const rows = ['<tr>1</tr>', '<tr>2</tr>'].map((row) => raw(row));
    const result = html`<table>${rows}</table>`;

    expect(result).toBe('<table><tr>1</tr><tr>2</tr></table>');
  });
});
