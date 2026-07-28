import { authHeader } from './auth.js';
import { API_URL_STORAGE_KEY } from './storage-keys.js';

export { authHeader };

const DEFAULT_API_BASE_URL =
  'https://sistema.enclaii.com';

const LOCAL_LARAVEL_HOSTS =
  new Set([
    'localhost',
    '127.0.0.1',
    '::1',
  ]);

const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 60 * 60;

/* =========================================================
   PETICIÓN PRINCIPAL
========================================================= */

export async function laravelFetch(
  url,
  options = {}
) {
  const invoke =
    window.__TAURI__?.core?.invoke;

  /*
   * Cuando no se ejecuta dentro de Tauri,
   * se utiliza fetch normal.
   */
  if (!invoke) {
    return fetch(url, options);
  }

  try {
    const headers =
      normalizeHeaders(
        options.headers
      );

    const preparedBody =
      await prepareBody(
        options.body,
        headers
      );

    const timeoutSeconds =
      normalizeTimeoutSeconds(
        options.timeoutSeconds ??
        options.timeout_seconds
      );

    /*
     * LaravelRequest es un struct de Rust.
     * Se debe enviar como objeto JavaScript.
     *
     * NO usar JSON.stringify(requestPayload).
     */
    const requestPayload = {
      method: String(
        options.method || 'GET'
      ).toUpperCase(),

      url: String(url),

      headers,

      body:
        preparedBody.body,

      timeout_seconds:
        timeoutSeconds,
    };

    const result =
      await invoke(
        'laravel_request',
        {
          request:
            requestPayload,
        }
      );

    return createResponse(
      normalizeResult(result)
    );
  } catch (error) {
    console.error(
      'Error en laravel_request:',
      error
    );

    throw new Error(
      String(
        error?.message ||
        error ||
        'No se pudo alcanzar Laravel.'
      )
    );
  }
}

function normalizeTimeoutSeconds(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const seconds =
    Math.round(Number(value));

  if (!Number.isFinite(seconds)) {
    return null;
  }

  return Math.min(
    Math.max(seconds, MIN_TIMEOUT_SECONDS),
    MAX_TIMEOUT_SECONDS
  );
}

/* =========================================================
   URL BASE
========================================================= */

/**
 * Valida que el valor guardado sea una URL http(s) absoluta y bien
 * formada (protocolo + host). Cualquier otra cosa (texto suelto, una
 * ruta relativa, un valor truncado o corrupto) se considera inválida.
 */
export function isValidApiBaseUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

export function apiBaseUrl() {
  const rawSaved = localStorage.getItem(
    API_URL_STORAGE_KEY
  );

  let saved = String(rawSaved || '')
    .trim()
    .replace(/\/+$/, '');

  if (saved && !isValidApiBaseUrl(saved)) {
    console.warn(
      `Valor guardado en localStorage['${API_URL_STORAGE_KEY}'] no es una URL válida ("${saved}"). Se descarta automáticamente.`
    );

    localStorage.removeItem(
      API_URL_STORAGE_KEY
    );

    saved = '';
  }

  const currentOrigin =
    currentLaravelOrigin();

  if (saved) {
    if (
      currentOrigin &&
      isLocalLaravelUrl(saved)
    ) {
      return currentOrigin;
    }

    return saved;
  }

  return (
    currentOrigin ||
    DEFAULT_API_BASE_URL
  );
}

const PASSTHROUGH_ASSET_PROTOCOLS =
  new Set([
    'data:',
    'blob:',
  ]);

const PUBLIC_STORAGE_PATH_PREFIXES = [
  'storage/app/public/',
  'app/public/',
  'public/',
];

const DIRECT_PUBLIC_PATH_PREFIXES = [
  'storage/',
  'uploads/',
  'images/',
  'img/',
  'media/',
];

const NESTED_ASSET_VALUE_KEYS = [
  'url',
  'src',
  'href',
  'path',
  'ruta',
  'file',
  'archivo',
  'public_url',
  'temporary_url',
  'signed_url',
  'full_url',
  'original_url',
  'preview_url',
  'thumb_url',
  'thumbnail_url',
];

function readFieldPath(source, field) {
  if (!source || !field) {
    return undefined;
  }

  return String(field)
    .split('.')
    .reduce(
      (value, key) =>
        value &&
        typeof value === 'object'
          ? value[key]
          : undefined,
      source
    );
}

function assetCandidates(value, depth = 0) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return [];
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      assetCandidates(item, depth + 1)
    );
  }

  if (
    typeof value !== 'object' ||
    depth > 2
  ) {
    return [];
  }

  return NESTED_ASSET_VALUE_KEYS.flatMap((key) =>
    assetCandidates(value[key], depth + 1)
  );
}

export function firstLaravelAssetUrl(
  source,
  fields = []
) {
  const values =
    fields.length
      ? fields.flatMap((field) =>
          assetCandidates(
            readFieldPath(source, field)
          )
        )
      : assetCandidates(source);

  for (const value of values) {
    const url =
      laravelAssetUrl(value);

    if (url) {
      return url;
    }
  }

  return '';
}

function normalizeLaravelAssetPath(
  value
) {
  let path =
    String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

  for (const prefix of PUBLIC_STORAGE_PATH_PREFIXES) {
    if (path.startsWith(prefix)) {
      path =
        `storage/${path.slice(prefix.length)}`;

      break;
    }
  }

  if (
    !DIRECT_PUBLIC_PATH_PREFIXES.some(
      (prefix) => path.startsWith(prefix)
    ) &&
    /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(path)
  ) {
    path = `storage/${path}`;
  }

  return path;
}

export function laravelAssetUrl(
  value
) {
  const raw =
    String(value || '').trim();

  if (!raw) {
    return '';
  }

  try {
    const parsed =
      new URL(raw);

    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      PASSTHROUGH_ASSET_PROTOCOLS.has(parsed.protocol)
    ) {
      return raw;
    }

    return '';
  } catch {
    // Relative path; resolve it against the configured Laravel origin below.
  }

  try {
    const base =
      new URL(`${apiBaseUrl()}/`);

    if (raw.startsWith('//')) {
      return `${base.protocol}${raw}`;
    }

    const path =
      normalizeLaravelAssetPath(raw);

    if (!path) {
      return '';
    }

    return new URL(
      path.startsWith('/')
        ? path
        : `/${path}`,
      base
    ).toString();
  } catch {
    return '';
  }
}

/*
 * URL del protocolo nativo `assetproxy` (registrado en
 * src-tauri/src/lib.rs). El WebView la trata como cualquier recurso HTTP
 * normal: la puede poner directo en un <img src>/<video src> y Rust hace
 * el GET real a Laravel y devuelve los bytes, sin pasar por Base64 ni por
 * el puente IPC de invoke().
 *
 * En Windows/Android, WebView2/WebView no aceptan un esquema arbitrario
 * como `assetproxy://` en la barra de recursos (ERR_UNKNOWN_URL_SCHEME):
 * Tauri exige usar la forma `https://<scheme>.localhost/...` (activada
 * con "useHttpsScheme": true en tauri.conf.json) y la traduce
 * internamente hacia el mismo handler registrado como "assetproxy".
 */
function assetProxyUrl(url) {
  return `https://assetproxy.localhost/?u=${encodeURIComponent(url)}`;
}

function shouldSendAuthorizationToAsset(
  url
) {
  try {
    const assetOrigin =
      new URL(url).origin;

    const apiOrigin =
      new URL(apiBaseUrl()).origin;

    return assetOrigin === apiOrigin;
  } catch {
    return true;
  }
}

/*
 * Cache en memoria de URLs de assets ya resueltos (foto -> objectURL).
 *
 * Sin esto, cada re-render de una lista (pacientes, galeria, reportes,
 * etc.) vuelve a pedir la MISMA foto a Laravel, re-codificarla en Base64
 * en Rust y re-decodificarla en JS, aunque ya se hubiera cargado hace
 * un instante. El Map guarda la Promise en curso (para deduplicar
 * llamadas concurrentes a la misma URL) y luego el objectURL final.
 * Si la peticion falla, se limpia la entrada para permitir reintentar.
 */
const assetUrlCache = new Map();

export function clearAuthenticatedAssetCache() {
  for (const value of assetUrlCache.values()) {
    if (typeof value === 'string' && value.startsWith('blob:')) {
      URL.revokeObjectURL(value);
    }
  }

  assetUrlCache.clear();
}

export async function authenticatedLaravelAssetUrl(
  value,
  options = {}
) {
  const url =
    laravelAssetUrl(value);

  if (!url) {
    return '';
  }

  if (
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }

  const invoke =
    window.__TAURI__?.core?.invoke;

  // Bajo Tauri, el protocolo assetproxy:// sirve el archivo directo desde
  // Rust (streaming de bytes reales, sin Base64 ni IPC), asi que el
  // <img>/<video> puede apuntar ahi sin que JS descargue ni decodifique
  // nada. El propio WebView se encarga de cachear la respuesta HTTP.
  if (invoke) {
    return assetProxyUrl(url);
  }

  if (assetUrlCache.has(url)) {
    return assetUrlCache.get(url);
  }

  const requestPromise = (async () => {
    const authorization =
      shouldSendAuthorizationToAsset(url)
        ? authHeader()
        : '';

    const headers =
      normalizeHeaders({
        Accept:
          options.accept ||
          'image/*,video/*,*/*',
        ...(authorization
          ? { Authorization: authorization }
          : {}),
        ...(options.headers || {}),
      });

    const response =
      await fetch(url, {
        headers,
        credentials: 'include',
      });

    if (!response.ok) {
      throw new Error(
        `Laravel respondiÃ³ HTTP ${response.status} al cargar el archivo.`
      );
    }

    return URL.createObjectURL(
      await response.blob()
    );
  })();

  assetUrlCache.set(url, requestPromise);

  try {
    return await requestPromise;
  } catch (error) {
    assetUrlCache.delete(url);
    throw error;
  }
}

/* =========================================================
   NORMALIZAR HEADERS
========================================================= */

function normalizeHeaders(
  headers = {}
) {
  const normalized = {};

  if (
    typeof Headers !== 'undefined' &&
    headers instanceof Headers
  ) {
    headers.forEach(
      (value, key) => {
        normalized[
          String(key)
        ] = String(value);
      }
    );

    return normalized;
  }

  if (Array.isArray(headers)) {
    headers.forEach(
      (entry) => {
        if (
          !Array.isArray(entry) ||
          entry.length < 2
        ) {
          return;
        }

        const [key, value] =
          entry;

        if (
          key === undefined ||
          value === undefined ||
          value === null
        ) {
          return;
        }

        normalized[
          String(key)
        ] = String(value);
      }
    );

    return normalized;
  }

  Object.entries(
    headers || {}
  ).forEach(
    ([key, value]) => {
      if (
        value === undefined ||
        value === null
      ) {
        return;
      }

      normalized[
        String(key)
      ] = String(value);
    }
  );

  return normalized;
}

function hasHeader(
  headers,
  searchedName
) {
  const expected =
    String(
      searchedName
    ).toLowerCase();

  return Object.keys(
    headers
  ).some(
    (key) =>
      key.toLowerCase() ===
      expected
  );
}

function removeHeader(
  headers,
  searchedName
) {
  const expected =
    String(
      searchedName
    ).toLowerCase();

  Object.keys(
    headers
  ).forEach(
    (key) => {
      if (
        key.toLowerCase() ===
        expected
      ) {
        delete headers[key];
      }
    }
  );
}

/* =========================================================
   PREPARAR BODY
========================================================= */

async function prepareBody(
  body,
  headers
) {
  if (
    body === undefined ||
    body === null
  ) {
    return {
      body: null,
    };
  }

  /*
   * FormData.
   *
   * El comando Rust normalmente recibe body como String.
   * Para no enviar un objeto no serializable, convertimos
   * el formulario a multipart manualmente.
   */
  if (
    typeof FormData !== 'undefined' &&
    body instanceof FormData
  ) {
    return buildMultipartBody(
      body,
      headers
    );
  }

  /*
   * URLSearchParams.
   */
  if (
    typeof URLSearchParams !== 'undefined' &&
    body instanceof URLSearchParams
  ) {
    if (
      !hasHeader(
        headers,
        'Content-Type'
      )
    ) {
      headers[
        'Content-Type'
      ] =
        'application/x-www-form-urlencoded;charset=UTF-8';
    }

    return {
      body:
        body.toString(),
    };
  }

  /*
   * Texto ya preparado, por ejemplo JSON.stringify(...).
   */
  if (
    typeof body === 'string'
  ) {
    return {
      body,
    };
  }

  /*
   * Blob o File directo.
   */
  if (
    typeof Blob !== 'undefined' &&
    body instanceof Blob
  ) {
    const base64 =
      await blobToBase64(body);

    if (
      !hasHeader(
        headers,
        'Content-Type'
      )
    ) {
      headers[
        'Content-Type'
      ] =
        body.type ||
        'application/octet-stream';
    }

    headers[
      'X-Body-Encoding'
    ] = 'base64';

    return {
      body: base64,
    };
  }

  /*
   * Objeto JavaScript.
   */
  if (
    typeof body === 'object'
  ) {
    if (
      !hasHeader(
        headers,
        'Content-Type'
      )
    ) {
      headers[
        'Content-Type'
      ] =
        'application/json';
    }

    return {
      body:
        JSON.stringify(body),
    };
  }

  return {
    body:
      String(body),
  };
}

/* =========================================================
   MULTIPART FORM-DATA MANUAL
========================================================= */

async function buildMultipartBody(
  formData,
  headers
) {
  const boundary =
    `----ENCLAIITauriBoundary${Date.now()}${Math.random()
      .toString(16)
      .slice(2)}`;

  const chunks = [];

  for (
    const [name, value]
    of formData.entries()
  ) {
    chunks.push(
      `--${boundary}\r\n`
    );

    if (
      typeof File !== 'undefined' &&
      value instanceof File
    ) {
      chunks.push(
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"; filename="${escapeHeaderValue(value.name || 'archivo')}"\r\n`
      );

      chunks.push(
        `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`
      );

      chunks.push(
        new Uint8Array(
          await value.arrayBuffer()
        )
      );

      chunks.push(
        '\r\n'
      );
    } else if (
      typeof Blob !== 'undefined' &&
      value instanceof Blob
    ) {
      chunks.push(
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"; filename="archivo"\r\n`
      );

      chunks.push(
        `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`
      );

      chunks.push(
        new Uint8Array(
          await value.arrayBuffer()
        )
      );

      chunks.push(
        '\r\n'
      );
    } else {
      chunks.push(
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n\r\n`
      );

      chunks.push(
        String(value)
      );

      chunks.push(
        '\r\n'
      );
    }
  }

  chunks.push(
    `--${boundary}--\r\n`
  );

  const bytes =
    combineMultipartChunks(
      chunks
    );

  /*
   * El struct LaravelRequest solo recibe body como String.
   * El contenido multipart binario se codifica en base64.
   *
   * Rust deberá detectar X-Body-Encoding: base64,
   * decodificarlo y enviarlo como bytes.
   */
  removeHeader(
    headers,
    'Content-Type'
  );

  headers[
    'Content-Type'
  ] =
    `multipart/form-data; boundary=${boundary}`;

  headers[
    'X-Body-Encoding'
  ] =
    'base64';

  return {
    body:
      uint8ArrayToBase64(
        bytes
      ),
  };
}

function escapeHeaderValue(
  value
) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '');
}

function combineMultipartChunks(
  chunks
) {
  const encoder =
    new TextEncoder();

  const byteChunks =
    chunks.map(
      (chunk) => {
        if (
          chunk instanceof
          Uint8Array
        ) {
          return chunk;
        }

        return encoder.encode(
          String(chunk)
        );
      }
    );

  const totalLength =
    byteChunks.reduce(
      (
        total,
        current
      ) =>
        total +
        current.length,
      0
    );

  const result =
    new Uint8Array(
      totalLength
    );

  let offset = 0;

  byteChunks.forEach(
    (chunk) => {
      result.set(
        chunk,
        offset
      );

      offset +=
        chunk.length;
    }
  );

  return result;
}

function uint8ArrayToBase64(
  bytes
) {
  const chunkSize =
    0x8000;

  let binary = '';

  for (
    let index = 0;
    index < bytes.length;
    index += chunkSize
  ) {
    const chunk =
      bytes.subarray(
        index,
        Math.min(
          index + chunkSize,
          bytes.length
        )
      );

    binary +=
      String.fromCharCode(
        ...chunk
      );
  }

  return btoa(binary);
}

function blobToBase64(
  blob
) {
  return blob
    .arrayBuffer()
    .then(
      (buffer) =>
        uint8ArrayToBase64(
          new Uint8Array(
            buffer
          )
        )
    );
}

/* =========================================================
   NORMALIZAR RESPUESTA
========================================================= */

function normalizeResult(
  result
) {
  /*
   * Si Rust devuelve un objeto, se utiliza directamente.
   * Si devuelve texto JSON, se intenta convertir.
   */
  if (
    typeof result === 'string'
  ) {
    try {
      return JSON.parse(
        result
      );
    } catch {
      return {
        ok: true,
        status: 200,
        headers: {
          'content-type':
            'text/plain',
        },
        body: result,
      };
    }
  }

  return result || {};
}

function normalizeResponseHeaders(
  headers = {}
) {
  const normalized = {};

  if (Array.isArray(headers)) {
    headers.forEach(
      (entry) => {
        if (
          !Array.isArray(entry) ||
          entry.length < 2
        ) {
          return;
        }

        normalized[
          String(entry[0])
            .toLowerCase()
        ] =
          String(entry[1]);
      }
    );

    return normalized;
  }

  Object.entries(
    headers || {}
  ).forEach(
    ([key, value]) => {
      if (
        value === undefined ||
        value === null
      ) {
        return;
      }

      normalized[
        String(key)
          .toLowerCase()
      ] =
        Array.isArray(value)
          ? value.join(', ')
          : String(value);
    }
  );

  return normalized;
}

function createResponse(
  result
) {
  const status =
    Number(
      result.status ??
      result.status_code ??
      0
    );

  const responseHeaders =
    normalizeResponseHeaders(
      result.headers || {}
    );

  let responseBody =
    result.body ?? '';

  if (
    typeof responseBody ===
      'object' &&
    responseBody !== null
  ) {
    responseBody =
      JSON.stringify(
        responseBody
      );

    if (
      !responseHeaders[
        'content-type'
      ]
    ) {
      responseHeaders[
        'content-type'
      ] =
        'application/json';
    }
  }

  return {
    ok:
      typeof result.ok ===
      'boolean'
        ? result.ok
        : status >= 200 &&
          status < 300,

    status,

    statusText:
      String(
        result.status_text || ''
      ),

    headers: {
      get(name) {
        return (
          responseHeaders[
            String(name)
              .toLowerCase()
          ] || ''
        );
      },

      has(name) {
        return Boolean(
          responseHeaders[
            String(name)
              .toLowerCase()
          ]
        );
      },

      entries() {
        return Object.entries(
          responseHeaders
        );
      },
    },

    async json() {
      if (
        responseBody === '' ||
        responseBody === null ||
        responseBody === undefined
      ) {
        return null;
      }

      if (
        typeof responseBody ===
        'object'
      ) {
        return responseBody;
      }

      try {
        return JSON.parse(
          String(
            responseBody
          )
        );
      } catch {
        throw new Error(
          'Laravel no devolvió una respuesta JSON válida.'
        );
      }
    },

    async text() {
      if (
        responseBody === null ||
        responseBody === undefined
      ) {
        return '';
      }

      return String(
        responseBody
      );
    },
  };
}

/* =========================================================
   LARAVEL LOCAL
========================================================= */

function currentLaravelOrigin() {
  if (
    ![
      'http:',
      'https:',
    ].includes(
      window.location.protocol
    )
  ) {
    return '';
  }

  if (
    !LOCAL_LARAVEL_HOSTS.has(
      window.location.hostname
    )
  ) {
    return '';
  }

  if (
    window.location.port &&
    window.location.port !==
      '8000'
  ) {
    return '';
  }

  return window.location.origin;
}

function isLocalLaravelUrl(
  value
) {
  try {
    const url =
      new URL(value);

    return (
      LOCAL_LARAVEL_HOSTS.has(
        url.hostname
      ) &&
      (
        !url.port ||
        url.port === '8000'
      )
    );
  } catch {
    return false;
  }
}
