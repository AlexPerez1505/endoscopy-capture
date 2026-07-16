import { apiBaseUrl, laravelFetch } from './laravel.js';

const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
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

  return payload.token;
}

function redirectAfterLogin() {
  const params = new URLSearchParams(window.location.search);
  const redirectTo = params.get('redirect');
  window.location.href = redirectTo || './app.html#dashboard';
}

// Si ya hay una sesion activa, no mostrar el login de nuevo.
if (sessionStorage.getItem(AUTH_STORAGE_KEY)) {
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
    const token = await loginToLaravel(email, password);
    sessionStorage.setItem(AUTH_STORAGE_KEY, token);
    redirectAfterLogin();
  } catch (error) {
    console.error(error);
    showError(error.message || 'No se pudo iniciar sesion.');
    btnLogin?.setAttribute('data-loading', 'false');
  }
});
