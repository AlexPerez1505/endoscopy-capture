const DEFAULT_API_BASE_URL = 'https://sistema.enclaii.com';
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
const LOCAL_LARAVEL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export async function laravelFetch(url, options = {}) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) {
    return fetch(url, options);
  }

  let result;

  try {
    result = await invoke('laravel_request', {
      request: {
        method: options.method || 'GET',
        url,
        headers: normalizeHeaders(options.headers),
        body: options.body ?? null,
      },
    });
  } catch (error) {
    throw new Error(String(error?.message || error || 'No se pudo alcanzar Laravel.'));
  }

  return {
    ok: Boolean(result.ok),
    status: Number(result.status) || 0,
    headers: {
      get(name) {
        return result.headers?.[String(name).toLowerCase()] || '';
      },
    },
    async json() {
      return JSON.parse(result.body || 'null');
    },
    async text() {
      return result.body || '';
    },
  };
}

export function apiBaseUrl() {
  const saved = (localStorage.getItem('enclaii-api-url') || '').replace(/\/+$/, '');
  const currentOrigin = currentLaravelOrigin();
  if (saved) return currentOrigin && isLocalLaravelUrl(saved) ? currentOrigin : saved;
  return currentOrigin || DEFAULT_API_BASE_URL;
}

export function authHeader() {
  const token = sessionStorage.getItem(AUTH_STORAGE_KEY);
  return token ? `Bearer ${token}` : '';
}

function normalizeHeaders(headers = {}) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

function currentLaravelOrigin() {
  if (!['http:', 'https:'].includes(window.location.protocol)) return '';
  if (!LOCAL_LARAVEL_HOSTS.has(window.location.hostname)) return '';
  if (window.location.port && window.location.port !== '8000') return '';
  return window.location.origin;
}

function isLocalLaravelUrl(value) {
  try {
    const url = new URL(value);
    return LOCAL_LARAVEL_HOSTS.has(url.hostname) && (!url.port || url.port === '8000');
  } catch (_) {
    return false;
  }
}
