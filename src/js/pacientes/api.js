import { apiBaseUrl, laravelFetch } from '../laravel.js';
import { getAuthToken } from '../auth.js';

function endpoint(path = '') {
  const cleanPath =
    String(path || '')
      .replace(/^\/+/, '');

  return (
    `${apiBaseUrl()}/api/tauri/pacientes` +
    (
      cleanPath
        ? `/${cleanPath}`
        : ''
    )
  );
}

async function request(
  path = '',
  options = {}
) {
  const authToken = getAuthToken();

  if (!authToken) {
    const error = new Error(
      'No existe una sesión activa. Inicia sesión nuevamente.'
    );

    error.code = 'UNAUTHORIZED';

    throw error;
  }

  const response = await laravelFetch(
    endpoint(path),
    {
      ...options,

      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...(options.headers || {}),
      },

      credentials: 'include',
    }
  );

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  let payload = {};

  if (
    contentType.includes(
      'application/json'
    )
  ) {
    payload = await response
      .json()
      .catch(() => ({}));
  } else {
    const responseText = await response
      .text()
      .catch(() => '');

    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = {
          message: responseText,
        };
      }
    }
  }

  if (
    response.status === 401 ||
    response.status === 419
  ) {
    const error = new Error(
      'Tu sesión terminó. Inicia sesión nuevamente.'
    );

    error.code = 'UNAUTHORIZED';

    throw error;
  }

  if (
    !response.ok ||
    payload?.ok === false ||
    payload?.success === false
  ) {
    const validationMessage =
      payload?.errors
        ? Object.values(
            payload.errors
          ).flat()[0]
        : null;

    throw new Error(
      validationMessage ||
      payload?.message ||
      `Laravel respondió HTTP ${response.status}.`
    );
  }

  return payload;
}

export { endpoint, request };
