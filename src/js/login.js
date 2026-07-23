import {
  apiBaseUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from './laravel.js';
import { getAuthToken, setAuthToken } from './auth.js';
import {
  ACCOUNT_NAME_STORAGE_KEY,
  ACCOUNT_PHOTO_URL_STORAGE_KEY,
} from './storage-keys.js';

const LOGIN_ENDPOINT = `${apiBaseUrl()}/api/tauri/login`;

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password-input');
const alertBox = document.getElementById('loginAlert');
const btnLogin = document.getElementById('btnLogin');

function showError(message) {
  if (!alertBox) return;
  alertBox.textContent = message;
  alertBox.classList.remove('is-hidden');
  form?.classList.remove('ec-shake');
  requestAnimationFrame(() => form?.classList.add('ec-shake'));
}

function hideError() {
  alertBox?.classList.add('is-hidden');
}

async function loginToLaravel(email, password) {
  const response = await laravelFetch(LOGIN_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || 'No se pudo iniciar sesion. Verifica tus credenciales.');
  }

  return {
    token: payload.token,
    accountName: payload.user?.account_name || payload.user?.name || 'Doctor',
    accountPhotoUrl: firstLaravelAssetUrl(
      payload.user || {},
      [
        'photo_url',
        'avatar_url',
        'profile_photo_url',
        'foto_url',
        'image_url',
        'photo',
        'avatar',
        'profile_photo',
        'profile_photo_path',
        'foto',
        'imagen',
      ]
    ),
  };
}

function redirectAfterLogin() {
  const params = new URLSearchParams(window.location.search);
  const redirectTo = params.get('redirect');
  window.location.href = redirectTo || './app.html#dashboard';
}

// Si ya hay una sesion activa, no mostrar el login de nuevo.
if (getAuthToken()) {
  redirectAfterLogin();
}

document.querySelectorAll('.toggle-visibility').forEach((btn) => {
  const targetSel = btn.getAttribute('data-target');
  const input = document.querySelector(targetSel);
  const eye = btn.querySelector('.icon-eye');
  const eyeOff = btn.querySelector('.icon-eye-off');

  btn.addEventListener('click', () => {
    if (!input) return;
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';

    if (eye && eyeOff) {
      eye.style.display = isPwd ? 'none' : 'inline';
      eyeOff.style.display = isPwd ? 'inline' : 'none';
    }

    btn.setAttribute('aria-pressed', isPwd ? 'true' : 'false');
    btn.setAttribute('aria-label', isPwd ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();

  const email = emailInput?.value.trim() || '';
  const password = passwordInput?.value || '';
  if (!email || !password) return;

  btnLogin?.setAttribute('data-loading', 'true');

  try {
    const { token, accountName, accountPhotoUrl } = await loginToLaravel(email, password);
    setAuthToken(token);
    if (accountName) sessionStorage.setItem(ACCOUNT_NAME_STORAGE_KEY, accountName);
    if (accountPhotoUrl) sessionStorage.setItem(ACCOUNT_PHOTO_URL_STORAGE_KEY, accountPhotoUrl);
    redirectAfterLogin();
  } catch (error) {
    console.error(error);
    showError(error.message || 'No se pudo iniciar sesion.');
    btnLogin?.setAttribute('data-loading', 'false');
  }
});
