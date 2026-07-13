// ================= Configuracion - Inicializador =================
// Tauri lee y guarda preferencias por Laravel. No toca la base de datos.

const DEFAULT_API_BASE_URL = 'http://localhost:8000';
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
const LOCAL_SETTINGS = {
  language: 'enclaii-lang',
  api_url: 'enclaii-api-url',
};

let settingsTemplate = '';
let settingsState = {};
let userState = {};
let planState = {};
let isApplyingSettings = false;
let alertTimer = null;

function apiBaseUrl() {
  return (localStorage.getItem(LOCAL_SETTINGS.api_url) || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function configEndpoint() {
  return `${apiBaseUrl()}/tauri/configuracion`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function encodeBasicCredentials(email, password) {
  const bytes = new TextEncoder().encode(`${email}:${password}`);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function authHeader() {
  const token = sessionStorage.getItem(AUTH_STORAGE_KEY);
  return token ? `Basic ${token}` : '';
}

async function configRequest(options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const authorization = authHeader();

  if (authorization) headers.Authorization = authorization;

  const response = await fetch(configEndpoint(), {
    method: options.method || 'GET',
    headers,
    body: options.body,
    credentials: 'include',
  });
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar configuracion.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvio JSON. Revisa sesion y ruta: ${configEndpoint()}`);
  }

  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status}.`);
  }

  return payload;
}

function setSettingsAlert(message, type = 'ok') {
  const alert = document.getElementById('settingsAlert');
  if (!alert) return;

  clearTimeout(alertTimer);
  alert.textContent = message || '';
  alert.className = `settings-alert ${message ? type : 'is-hidden'}`;
  if (message) {
    alertTimer = setTimeout(() => setSettingsAlert(''), 2800);
  }
}

function restoreSettingsTemplate(root) {
  if (!root.querySelector('[data-settings-tab]') && settingsTemplate) {
    root.innerHTML = settingsTemplate;
    bindSettingsEvents(root);
  }
}

function renderLaravelLogin(root, message = 'Inicia sesion con tu usuario de Laravel.') {
  root.innerHTML = `
    <form class="settings-login" id="laravelSettingsLoginForm">
      <strong>Conectar Configuracion con Laravel</strong>
      <p>${escapeHtml(message)}</p>
      <label for="laravelSettingsEmail">Correo</label>
      <input id="laravelSettingsEmail" type="email" autocomplete="username" required>
      <label for="laravelSettingsPassword">Contrasena</label>
      <input id="laravelSettingsPassword" type="password" autocomplete="current-password" required>
      <button type="submit">Conectar Configuracion</button>
    </form>`;

  document.getElementById('laravelSettingsLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('laravelSettingsEmail')?.value.trim();
    const password = document.getElementById('laravelSettingsPassword')?.value || '';
    if (!email || !password) return;

    sessionStorage.setItem(AUTH_STORAGE_KEY, encodeBasicCredentials(email, password));
    restoreSettingsTemplate(root);
    await loadSettings();
  });
}

function renderSettingsError(root, error) {
  if (error.code === 'UNAUTHORIZED') {
    renderLaravelLogin(root, error.message);
    return;
  }

  root.innerHTML = `
    <div class="card" style="padding:42px 20px;text-align:center;color:var(--txt-soft);">
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
      <span>${escapeHtml(error.message || 'No se pudo cargar configuracion.')}</span>
    </div>`;
}

function boolValue(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function applyUiEffects(settings) {
  document.documentElement.dataset.reading = boolValue(settings.reading_mode) ? 'on' : 'off';
  document.documentElement.dataset.animations = boolValue(settings.animations) ? 'on' : 'off';
  document.documentElement.dataset.compact = boolValue(settings.compact) ? 'on' : 'off';
  localStorage.setItem('enclaii-pref-reading_mode', boolValue(settings.reading_mode) ? '1' : '0');
  localStorage.setItem('enclaii-pref-animations', boolValue(settings.animations) ? '1' : '0');
  localStorage.setItem('enclaii-pref-compact', boolValue(settings.compact) ? '1' : '0');
}

function setControlValue(control, value) {
  if (control.type === 'checkbox') {
    control.checked = boolValue(value);
    return;
  }

  control.value = value ?? '';
}

function updateTextCounts(root) {
  root.querySelectorAll('[data-count-for]').forEach((counter) => {
    const field = document.getElementById(counter.dataset.countFor);
    counter.textContent = String(field?.value.length || 0);
  });
}

function renderQrTemplate(value) {
  const clinicName = userState.clinic || 'Clinica principal';
  return String(value || '')
    .replaceAll('{enlace}', 'https://enclaii.app/registro-paciente/ejemplo')
    .replaceAll('{codigo}', 'QR-2026-0001')
    .replaceAll('{mensaje}', 'Por favor completa tus datos con la mayor informacion posible.')
    .replaceAll('{clinica}', clinicName);
}

function renderQrPreviews() {
  const whatsappInput = document.getElementById('cfgQrWhatsapp');
  const consentInput = document.getElementById('cfgQrConsent');
  const whatsappPreview = document.getElementById('cfgQrWhatsappPreview');
  const consentPreview = document.getElementById('cfgQrConsentPreview');

  if (whatsappPreview) {
    const text = renderQrTemplate(whatsappInput?.value || 'Hola, te comparto tu enlace de pre-registro de ENCLAII: {enlace}');
    whatsappPreview.textContent = text || 'Sin texto configurado.';
  }

  if (consentPreview) {
    const text = renderQrTemplate(consentInput?.value || 'Autorizo el envio de estos datos y, si la adjunto, mi fotografia a {clinica} para preparar mi atencion y crear mi expediente despues de que el personal medico revise la informacion.');
    consentPreview.textContent = text || 'Sin texto configurado.';
  }
}

function setBindValue(key, value) {
  document.querySelectorAll(`[data-config-bind="${key}"]`).forEach((node) => {
    if ('value' in node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) {
      node.value = value ?? '';
    } else {
      node.textContent = value ?? '--';
    }
  });
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'DR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function renderMetadata() {
  const initials = userState.initials || initialsFromName(userState.name);
  const role = userState.role || 'Medico';

  setBindValue('userInitials', initials);
  setBindValue('userName', userState.name || 'Doctor');
  setBindValue('userRole', role);
  setBindValue('userEmail', userState.email || '');
  setBindValue('clinicName', userState.clinic || 'ENCLAII');
  setBindValue('specialty', userState.specialty || role);
  setBindValue('professionalLicense', userState.professional_license || '');
  setBindValue('planLabel', planState.label || 'Plan');
  setBindValue('planStatus', planState.status_label || 'Activo');
  setBindValue('memberLimit', planState.member_limit ?? '--');
  setBindValue('signatureStatus', userState.has_signature ? 'Firma configurada' : 'Sin firma registrada');
  setBindValue('signatureUpdated', userState.signature_updated_at || '--');

  const headerProfile = document.querySelector('.profile');
  if (headerProfile) {
    const avatar = headerProfile.querySelector('.avatar');
    const name = headerProfile.querySelector('strong');
    const sub = headerProfile.querySelector('span:not(.avatar)');
    if (avatar) avatar.textContent = initials;
    if (name) name.textContent = userState.name || 'Doctor';
    if (sub) sub.textContent = role;
  }
}

function applyLocalSettings(root) {
  root.querySelectorAll('[data-local-setting]').forEach((control) => {
    const key = control.dataset.localSetting;
    const storageKey = LOCAL_SETTINGS[key];
    const fallback = key === 'api_url' ? DEFAULT_API_BASE_URL : 'es';
    control.value = localStorage.getItem(storageKey) || fallback;
  });
}

function applySettings(payload) {
  const root = document.getElementById('settingsAppRoot');
  if (!root) return;

  settingsState = {
    ...(payload.settings || {}),
    ...(payload.security || {}),
  };
  userState = payload.user || {};
  planState = payload.plan || {};

  isApplyingSettings = true;
  root.querySelectorAll('[data-setting]').forEach((control) => {
    setControlValue(control, settingsState[control.dataset.setting]);
  });
  root.querySelectorAll('[data-setting-list]').forEach((control) => {
    const values = Array.isArray(settingsState[control.dataset.settingList])
      ? settingsState[control.dataset.settingList]
      : [];
    control.checked = values.includes(control.value);
  });
  applyLocalSettings(root);
  updateTextCounts(root);
  renderMetadata();
  renderQrPreviews();
  applyUiEffects(settingsState);
  isApplyingSettings = false;
}

function controlPayload(control) {
  const key = control?.dataset.setting;
  if (!key) return null;

  if (control.type === 'checkbox') return { key, value: control.checked };
  if (key === 'capture_auto_interval') return { key, value: Number(control.value || 0) };
  return { key, value: control.value };
}

function listPayload(root, key) {
  const values = [...root.querySelectorAll(`[data-setting-list="${key}"]:checked`)]
    .map((control) => control.value);
  return { key, value: values };
}

async function saveSetting(key, value) {
  const root = document.getElementById('settingsAppRoot');
  if (!root || !key) return;

  const previous = settingsState[key];
  settingsState[key] = value;
  root.dataset.saving = 'true';

  try {
    const payload = await configRequest({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    applySettings(payload);
    setSettingsAlert('Cambios guardados.', 'ok');
  } catch (error) {
    console.error(error);
    settingsState[key] = previous;
    applySettings({ settings: settingsState, user: userState, plan: planState });
    setSettingsAlert(error.message || 'No se pudo guardar el cambio.', 'error');
  } finally {
    root.dataset.saving = 'false';
  }
}

function saveLocalSetting(control) {
  const key = control.dataset.localSetting;
  const storageKey = LOCAL_SETTINGS[key];
  if (!storageKey) return;
  const value = control.value.trim();
  if (value) localStorage.setItem(storageKey, value);
  setSettingsAlert(key === 'api_url' ? 'Endpoint Laravel guardado.' : 'Preferencia local guardada.', 'ok');
}

async function loadSettings() {
  const root = document.getElementById('settingsAppRoot');
  if (!root) return;
  restoreSettingsTemplate(root);

  try {
    const payload = await configRequest();
    setSettingsAlert('');
    applySettings(payload);
  } catch (error) {
    console.error(error);
    if (error.code === 'UNAUTHORIZED') sessionStorage.removeItem(AUTH_STORAGE_KEY);
    renderSettingsError(root, error);
  }
}

function bindSettingsEvents(root) {
  if (root.dataset.settingsBound === 'true') return;
  root.dataset.settingsBound = 'true';

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-settings-tab]');
    if (!tab) return;
    const target = tab.dataset.settingsTab;

    root.querySelectorAll('[data-settings-tab]').forEach((button) => {
      button.classList.toggle('is-active', button === tab);
    });
    root.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.settingsPanel === target);
    });
  });

  root.addEventListener('input', (event) => {
    if (event.target.matches('textarea[data-setting]')) {
      updateTextCounts(root);
      renderQrPreviews();
    }
  });

  root.addEventListener('change', (event) => {
    if (isApplyingSettings) return;

    const localControl = event.target.closest('[data-local-setting]');
    if (localControl) {
      saveLocalSetting(localControl);
      return;
    }

    const listControl = event.target.closest('[data-setting-list]');
    if (listControl) {
      const payload = listPayload(root, listControl.dataset.settingList);
      saveSetting(payload.key, payload.value);
      return;
    }

    const control = event.target.closest('[data-setting]');
    const payload = controlPayload(control);
    if (payload) saveSetting(payload.key, payload.value);
  });
}

export function initConfiguracion() {
  const root = document.getElementById('settingsAppRoot');
  if (!root) return;
  if (!settingsTemplate) settingsTemplate = root.innerHTML;
  bindSettingsEvents(root);
  loadSettings();
}
