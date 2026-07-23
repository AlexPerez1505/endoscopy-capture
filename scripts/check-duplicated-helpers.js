#!/usr/bin/env node
// Evita que vuelva a aparecer la duplicación de helpers que ya están
// centralizados en un único módulo:
//   - src/js/auth.js         -> AUTH_STORAGE_KEY, authHeader(), token()/getToken()
//   - src/js/html.js         -> escapeHtml()
//   - src/js/laravel.js      -> apiBaseUrl()
//   - src/js/storage-keys.js -> claves de localStorage/sessionStorage ('enclaii-...')
//
// Se ejecuta en el pre-commit hook (ver .husky/pre-commit).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC_JS_DIR = join(ROOT, 'src', 'js');

const RULES = [
  {
    allowedFiles: [join(SRC_JS_DIR, 'auth.js'), join(SRC_JS_DIR, 'storage-keys.js')],
    guidance:
      'Usa las funciones exportadas por src/js/auth.js ' +
      '(getAuthToken, authHeader, setAuthToken, clearAuthToken, isAuthenticated) ' +
      'en vez de duplicar esta lógica.',
    patterns: [
      {
        name: "declaración local de AUTH_STORAGE_KEY / 'enclaii-tauri-basic-auth'",
        regex: /(?:const|let|var)\s+\w*AUTH_STORAGE_KEY\w*\s*=|['"]enclaii-tauri-basic-auth['"]/,
      },
      {
        name: 'función authHeader() duplicada localmente',
        regex: /function\s+authHeader\s*\(/,
      },
      {
        name: 'función token()/getToken() que lee el storage manualmente',
        regex: /function\s+(?:get)?[Tt]oken\s*\([^)]*\)\s*{\s*(?:\/\/[^\n]*\n\s*)?return\s+String\(\s*\n?\s*sessionStorage\.getItem/,
      },
    ],
  },
  {
    allowedFiles: [join(SRC_JS_DIR, 'html.js')],
    guidance:
      'Usa escapeHtml (o la tagged template html`...`) exportados por src/js/html.js ' +
      'en vez de duplicar esta función.',
    patterns: [
      {
        name: 'función escapeHtml() duplicada localmente',
        regex: /function\s+escapeHtml\s*\(/,
      },
    ],
  },
  {
    allowedFiles: [join(SRC_JS_DIR, 'laravel.js'), join(SRC_JS_DIR, 'storage-keys.js')],
    guidance:
      'Usa apiBaseUrl() exportado por src/js/laravel.js (ya valida el formato y ' +
      'limpia valores corruptos de localStorage) en vez de duplicar esta lógica.',
    patterns: [
      {
        name: 'función apiBaseUrl() duplicada localmente',
        regex: /function\s+apiBaseUrl\s*\(/,
      },
      {
        name: "lectura manual de localStorage['enclaii-api-url'] fuera de laravel.js",
        regex: /localStorage\.getItem\(\s*['"]enclaii-api-url['"]\s*\)/,
      },
    ],
  },
  {
    allowedFiles: [join(SRC_JS_DIR, 'storage-keys.js')],
    guidance:
      'Usa (o agrega) una constante exportada por src/js/storage-keys.js ' +
      "en vez de escribir la clave 'enclaii-...' como string suelto. " +
      'Esto evita typos que rompen silenciosamente la persistencia.',
    patterns: [
      {
        name: "clave de storage 'enclaii-...' escrita como string literal",
        regex: /['"]enclaii-[a-zA-Z0-9_-]+['"]/,
      },
    ],
  },
];

function collectJsFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      files.push(...collectJsFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  const files = collectJsFiles(SRC_JS_DIR);
  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');

    for (const rule of RULES) {
      if (rule.allowedFiles.includes(file)) continue;

      for (const pattern of rule.patterns) {
        if (pattern.regex.test(content)) {
          violations.push({
            file: relative(ROOT, file),
            rule: pattern.name,
            guidance: rule.guidance,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('\n✖ Duplicación de helpers centralizados detectada:\n');

    for (const violation of violations) {
      console.error(`  - ${violation.file}: ${violation.rule}`);
    }

    console.error('');

    const guidanceMessages = new Set(violations.map((v) => v.guidance));
    for (const guidance of guidanceMessages) {
      console.error(guidance);
    }

    console.error('');

    process.exit(1);
  }
}

main();
