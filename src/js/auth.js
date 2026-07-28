// Módulo centralizado de autenticación para el frontend de Tauri.
//
// Antes, la lógica de leer/escribir el token de sesión (authHeader,
// la clave de storage, etc.) estaba copiada casi al pie de la letra en
// ~12 módulos distintos. Esto hacía muy fácil que un cambio (por ejemplo,
// invalidar sesión ante un 401, o cambiar la clave de storage) se aplicara
// en unos módulos y se olvidara en otros.
//
// Este módulo es la única fuente de verdad para leer, escribir y limpiar
// el token de autenticación básica de Laravel.

import { AUTH_STORAGE_KEY } from './storage-keys.js';

export { AUTH_STORAGE_KEY };

/**
 * Token crudo (sin el prefijo "Bearer"), leyendo primero sessionStorage
 * y luego localStorage como respaldo.
 */
export function getAuthToken() {
  return String(
    sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY) || ''
  )
    .replace(/^Bearer\s+/i, '')
    .trim();
}

/**
 * Header "Authorization" listo para usar en una petición, o cadena vacía
 * si no hay sesión activa.
 */
export function authHeader() {
  const token = getAuthToken();
  return token ? `Bearer ${token}` : '';
}

export function isAuthenticated() {
  return Boolean(getAuthToken());
}

/**
 * El protocolo `assetproxy://` (usado para servir imagenes/videos sin
 * Base64/IPC, ver laravel.js) corre del lado de Rust y no puede leer
 * sessionStorage, asi que necesita su propia copia del token en memoria
 * del proceso nativo. Se sincroniza aqui, en el unico lugar donde se
 * escribe/borra el token, para que nunca queden desincronizados.
 */
function syncAuthTokenToNative(token) {
  const invoke = window.__TAURI__?.core?.invoke;

  if (!invoke) return;

  invoke('set_session_auth_token', { token: token || null }).catch((error) => {
    console.warn('No se pudo sincronizar el token de sesion con el proceso nativo.', error);
  });
}

/**
 * Guarda el token de sesión. Se persiste únicamente en sessionStorage,
 * igual que hacían todos los flujos de login existentes (la sesión no
 * sobrevive a un reinicio completo de la app, solo a la navegación
 * interna de la SPA).
 */
export function setAuthToken(token) {
  const value = String(token || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (!value) return;

  sessionStorage.setItem(AUTH_STORAGE_KEY, value);
  syncAuthTokenToNative(value);
}

/**
 * Limpia el token de ambos storages. Usar en logout o cuando Laravel
 * responde 401/403 (sesión expirada o inválida).
 */
export function clearAuthToken() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  syncAuthTokenToNative(null);
}
