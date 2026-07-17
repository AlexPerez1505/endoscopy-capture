// ================= Configuracion - Inicializador =================
// Tauri lee y guarda preferencias por Laravel. No toca la base de datos.

import { laravelFetch } from './laravel.js';

const DEFAULT_API_BASE_URL = 'https://sistema.enclaii.com';
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
const LOCAL_SETTINGS = {
  language: 'enclaii-lang',
  api_url: 'enclaii-api-url',
};
const LOCAL_LARAVEL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

let settingsTemplate = '';
let settingsState = {};
let userState = {};
let planState = {};
let isApplyingSettings = false;
let alertTimer = null;

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

function apiBaseUrl() {
  const saved = (localStorage.getItem(LOCAL_SETTINGS.api_url) || '').replace(/\/+$/, '');
  const currentOrigin = currentLaravelOrigin();

  if (saved) {
    return currentOrigin && isLocalLaravelUrl(saved) ? currentOrigin : saved;
  }

  return currentOrigin || DEFAULT_API_BASE_URL;
}

function configEndpoint(path = '') {
  const suffix = String(path || '').replace(/^\/+/, '');
  return `${apiBaseUrl()}/tauri/configuracion${suffix ? `/${suffix}` : ''}`;
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
  const token = sessionStorage.getItem('enclaii-tauri-basic-auth');
  return token ? `Bearer ${token}` : '';
}

async function configRequest(options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const authorization = authHeader();
  const endpoint = configEndpoint(options.path);

  if (authorization) headers.Authorization = authorization;

  let response;

  try {
    response = await laravelFetch(endpoint, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      credentials: 'include',
    });
  } catch (error) {
    const networkError = new Error(`No se pudo alcanzar Laravel en ${endpoint}. Revisa que Laravel este corriendo y que el Endpoint Laravel use el mismo host que la app (${window.location.origin}).`);
    networkError.code = 'NETWORK';
    networkError.cause = error;
    throw networkError;
  }
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar configuracion.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!response.ok && !contentType.includes('application/json')) {
    throw new Error(`Laravel respondio HTTP ${response.status} en ${endpoint}. Revisa que esa ruta exista en Laravel y devuelva JSON.`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvio JSON. Revisa sesion y ruta: ${endpoint}`);
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

const DEFAULT_PLAN_OPTIONS = [
  {
    id: 'clinica',
    name: 'Clinica',
    storage_gb: 50,
    accent: 'cyan',
    prices: { monthly: 10000, quarterly: 27000, annual: 96000 },
    features: ['Almacenamiento en la nube', 'IA Reportes basica', 'Soporte por email'],
  },
  {
    id: 'hospital',
    name: 'Hospital',
    storage_gb: 100,
    accent: 'purple',
    prices: { monthly: 25000, quarterly: 67500, annual: 240000 },
    features: ['IA Reportes avanzada', 'Almacenamiento ampliado', 'Soporte prioritario', 'Exportacion de reportes'],
  },
  {
    id: 'red-medica',
    name: 'Red medica',
    storage_gb: 250,
    accent: 'red',
    prices: { monthly: 35000, quarterly: 94500, annual: 336000 },
    features: ['Todo lo del plan Profesional', 'Mas almacenamiento', 'Integraciones avanzadas', 'Soporte 24/7'],
  },
];

const DEFAULT_USAGE_HISTORY = [
  { label: 'Nov 24', value: 25 },
  { label: 'Dic 24', value: 45 },
  { label: 'Ene 25', value: 70 },
  { label: 'Feb 25', value: 80 },
];

const PLAN_ACTIONS = {
  manage: { path: 'plan/portal', method: 'POST', loading: 'Conectando con Laravel...' },
  'storage-detail': { path: 'plan/almacenamiento', method: 'GET', loading: 'Cargando detalle desde Laravel...' },
  invoices: { path: 'plan/facturas', method: 'GET', loading: 'Consultando facturas en Laravel...' },
  'payment-method': { path: 'plan/metodo-pago', method: 'POST', loading: 'Solicitando metodo de pago a Laravel...' },
  recommendations: { path: 'plan/recomendaciones', method: 'GET', loading: 'Cargando recomendaciones desde Laravel...' },
  'change-plan': { path: 'plan/cambiar', method: 'POST', loading: 'Solicitando cambio de plan a Laravel...' },
};

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function numberValue(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function bytesToGb(value) {
  const bytes = numberValue(value, 0);
  return bytes > 0 ? bytes / 1024 / 1024 / 1024 : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits,
  }).format(value);
}

function formatGb(value) {
  const amount = numberValue(value, NaN);
  if (!Number.isFinite(amount)) return '--';
  return `${formatNumber(amount, Number.isInteger(amount) ? 0 : 1)} GB`;
}

function formatMoney(value) {
  if (typeof value === 'string' && value.trim()) return value;
  const amount = numberValue(value, NaN);
  if (!Number.isFinite(amount)) return '--';
  return `$${formatNumber(amount, 0)}`;
}

function formatDate(value) {
  if (!value) return '--';
  if (typeof value === 'string' && value.includes('/') && !value.includes('T')) return value;

  let date = null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function statusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return '';
  if (['active', 'activo', 'paid', 'enabled'].includes(normalized)) return 'Active';
  if (['trial', 'trialing', 'prueba'].includes(normalized)) return 'En prueba';
  if (['past_due', 'overdue', 'vencido'].includes(normalized)) return 'Vencido';
  if (['cancelled', 'canceled', 'cancelado'].includes(normalized)) return 'Cancelado';
  return status;
}

function planLabel() {
  return firstDefined(
    planState.label,
    planState.name,
    planState.plan_name,
    planState.current_plan,
    planState.plan,
    'Plan'
  );
}

function planStatusLabel() {
  return firstDefined(planState.status_label, statusLabel(planState.status), 'Activo');
}

function memberLimitLabel() {
  return firstDefined(
    planState.member_limit,
    planState.members_limit,
    planState.user_limit,
    planState.users_limit,
    planState.included_members,
    '--'
  );
}

function planBilling() {
  return planState.billing || planState.payment || planState.subscription || {};
}

function planStorage() {
  const storage = planState.storage || planState.storage_usage || planState.usage || {};
  const usedGb = firstDefined(
    storage.used_gb,
    storage.used,
    storage.used_storage_gb,
    planState.storage_used_gb,
    planState.used_storage_gb,
    planState.storage_used
  );
  const totalGb = firstDefined(
    storage.total_gb,
    storage.total,
    storage.limit_gb,
    storage.quota_gb,
    planState.storage_total_gb,
    planState.storage_limit_gb,
    planState.storage_quota_gb,
    planState.storage_total
  );
  const usedBytes = firstDefined(storage.used_bytes, planState.storage_used_bytes);
  const totalBytes = firstDefined(storage.total_bytes, storage.limit_bytes, planState.storage_total_bytes, planState.storage_limit_bytes);
  const used = usedGb !== undefined ? numberValue(usedGb, 0) : bytesToGb(usedBytes);
  let total = totalGb !== undefined ? numberValue(totalGb, 0) : bytesToGb(totalBytes);
  if (!total) {
    const currentLabel = String(planLabel()).toLowerCase();
    const defaultPlan = DEFAULT_PLAN_OPTIONS.find((option) => currentLabel.includes(option.name.toLowerCase()));
    total = numberValue(defaultPlan?.storage_gb, 0);
  }
  const rawAvailable = firstDefined(storage.available_gb, storage.available, planState.storage_available_gb);
  const available = rawAvailable !== undefined ? numberValue(rawAvailable, 0) : Math.max(total - used, 0);
  const rawPercent = firstDefined(storage.percent, storage.usage_percent, planState.storage_usage_percent);
  const percent = rawPercent !== undefined ? numberValue(rawPercent, 0) : (total > 0 ? (used / total) * 100 : 0);

  return {
    used,
    total,
    available,
    percent: clamp(percent, 0, 100),
    source: storage,
  };
}

function storageCategoryValue(storage, key) {
  const source = storage.source || {};
  const categories = source.categories || planState.storage_categories || {};
  const aliases = {
    images: ['images', 'image', 'imagenes', 'imagen'],
    videos: ['videos', 'video'],
    other: ['other', 'otros', 'otras', 'files', 'archivos', 'documents', 'documentos'],
  };
  const normalizeKey = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const category = Array.isArray(categories)
    ? categories.find((item) => [item.key, item.type, item.slug, item.name].map(normalizeKey).some((value) => aliases[key].includes(value)))
    : categories[key];

  const flatMap = {
    images: firstDefined(source.images_gb, source.image_gb, source.images, planState.storage_images_gb, planState.images_gb),
    videos: firstDefined(source.videos_gb, source.video_gb, source.videos, planState.storage_videos_gb, planState.videos_gb),
    other: firstDefined(source.other_gb, source.files_gb, source.documents_gb, source.other, planState.storage_other_gb, planState.other_gb),
  };

  const value = firstDefined(category?.used_gb, category?.value_gb, category?.gb, category?.used, flatMap[key]);
  return value === undefined && category?.used_bytes !== undefined ? bytesToGb(category.used_bytes) : numberValue(value, 0);
}

function setPlanBindValue(key, value) {
  document.querySelectorAll(`[data-plan-bind="${key}"]`).forEach((node) => {
    node.textContent = value ?? '--';
  });
}

function setStorageBindValue(key, value) {
  document.querySelectorAll(`[data-storage-bind="${key}"]`).forEach((node) => {
    node.textContent = value ?? '--';
  });
}

function renderStorageDashboard(storage) {
  setPlanBindValue('storageUsedText', formatGb(storage.used));
  setPlanBindValue('storageTotalText', formatGb(storage.total));
  setPlanBindValue('storageAvailableText', formatGb(storage.available));

  document.querySelectorAll('[data-plan-progress="storage"]').forEach((bar) => {
    bar.style.width = `${storage.percent}%`;
  });

  const categories = {
    images: storageCategoryValue(storage, 'images'),
    videos: storageCategoryValue(storage, 'videos'),
    other: storageCategoryValue(storage, 'other'),
  };

  Object.entries(categories).forEach(([key, value]) => {
    const percent = storage.used > 0 ? Math.round((value / storage.used) * 100) : 0;
    setStorageBindValue(`${key}.value`, formatGb(value));
    setStorageBindValue(`${key}.percent`, `${percent}%`);
  });
}

function normalizePlanOption(option, index) {
  option = option && typeof option === 'object' ? option : { name: option };
  const prices = option.prices || {};
  const name = firstDefined(option.name, option.label, option.title, `Plan ${index + 1}`);
  const storage = firstDefined(option.storage_gb, option.storage, option.limit_gb, option.quota_gb);
  const priceMonthly = firstDefined(prices.monthly, option.monthly_price, option.price_monthly, option.price);
  const priceQuarterly = firstDefined(prices.quarterly, option.quarterly_price, option.price_quarterly);
  const priceAnnual = firstDefined(prices.annual, prices.yearly, option.annual_price, option.yearly_price, option.price_annual);
  const features = Array.isArray(option.features)
    ? option.features.map((feature) => firstDefined(feature.label, feature.name, feature.text, feature)).filter(Boolean)
    : [];

  const currentLabel = String(planLabel()).toLowerCase();
  const optionName = String(name).toLowerCase();

  return {
    id: firstDefined(option.id, option.slug, String(name).toLowerCase().replace(/\s+/g, '-')),
    name,
    storage,
    accent: firstDefined(option.accent, ['cyan', 'purple', 'red'][index % 3]),
    current: boolValue(firstDefined(
      option.current,
      option.is_current,
      option.active,
      currentLabel === optionName || currentLabel.includes(optionName) || optionName.includes(currentLabel)
    )),
    prices: {
      monthly: priceMonthly,
      quarterly: firstDefined(priceQuarterly, priceMonthly ? numberValue(priceMonthly, 0) * 3 : undefined),
      annual: firstDefined(priceAnnual, priceMonthly ? numberValue(priceMonthly, 0) * 12 : undefined),
    },
    features: features.length ? features : DEFAULT_PLAN_OPTIONS[index % DEFAULT_PLAN_OPTIONS.length].features,
  };
}

function planIconSvg(accent) {
  if (accent === 'red') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"></path></svg>';
  }
  if (accent === 'purple') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m2 8 4 10h12l4-10-6 4-4-7-4 7-6-4z"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"></path></svg>';
}

function renderPlanOptions() {
  const container = document.querySelector('[data-plan-options]');
  if (!container) return;

  const rawOptions = firstDefined(
    planState.available_plans,
    planState.plans,
    planState.upgrade_options,
    planState.options
  );
  const source = Array.isArray(rawOptions) && rawOptions.length ? rawOptions : DEFAULT_PLAN_OPTIONS;
  const plans = source.map(normalizePlanOption);

  container.innerHTML = plans.map((plan) => {
    const monthly = formatMoney(plan.prices.monthly);
    const quarterly = formatMoney(plan.prices.quarterly);
    const annual = formatMoney(plan.prices.annual);
    const features = plan.features
      .slice(0, 4)
      .map((feature) => `<li>${escapeHtml(feature)}</li>`)
      .join('');
    const storageLabel = plan.storage !== undefined ? formatGb(plan.storage) : 'Incluido';
    const buttonLabel = plan.current ? 'Plan actual' : `Cambiar a ${escapeHtml(plan.name)}`;

    return `
      <article class="settings-plan-option ${plan.current ? 'is-current' : ''}">
        <div class="settings-plan-option-head">
          <div class="settings-plan-option-title">
            <span class="settings-mini-icon ${escapeHtml(plan.accent)}">${planIconSvg(plan.accent)}</span>
            ${plan.current ? '<span class="settings-plan-badge">Plan actual</span>' : ''}
          </div>
          <div>
            <h3>${escapeHtml(plan.name)}</h3>
            <small>${escapeHtml(storageLabel)}</small>
          </div>
        </div>
        <ul class="settings-plan-features">${features}</ul>
        <div class="settings-plan-option-footer">
          <div class="settings-plan-cycle">
            <button class="is-active" type="button" data-plan-cycle="monthly" data-price="${escapeHtml(monthly)}" data-period="/mes">Mensual</button>
            <button type="button" data-plan-cycle="quarterly" data-price="${escapeHtml(quarterly)}" data-period="/trim">Trimestral</button>
            <button type="button" data-plan-cycle="annual" data-price="${escapeHtml(annual)}" data-period="/anio">Anual</button>
          </div>
          <div class="settings-plan-price"><strong data-plan-price-value>${escapeHtml(monthly)}</strong><span data-plan-price-period>/mes</span></div>
          <button class="settings-plan-select ${plan.current ? '' : 'primary'}" type="button" data-plan-action="change-plan" data-plan-id="${escapeHtml(plan.id)}" ${plan.current ? 'disabled' : ''}>${buttonLabel}</button>
        </div>
      </article>
    `;
  }).join('');
}

function normalizeUsageHistory(storage) {
  const rawHistory = firstDefined(
    planState.usage_history,
    planState.storage_history,
    planState.monthly_usage,
    storage.source?.history
  );
  const source = Array.isArray(rawHistory) && rawHistory.length ? rawHistory : DEFAULT_USAGE_HISTORY;

  return source.map((item, index) => ({
    label: firstDefined(item.label, item.month, item.period, item.date, `Mes ${index + 1}`),
    value: numberValue(firstDefined(item.used_gb, item.used, item.value, item.total, item.storage_gb), 0),
  }));
}

function renderUsageChart(storage) {
  const container = document.querySelector('[data-usage-chart]');
  if (!container) return;

  const history = normalizeUsageHistory(storage).slice(-6);
  const maxValue = Math.max(100, Math.ceil(Math.max(...history.map((item) => item.value), storage.total || 0) / 25) * 25);
  const width = 560;
  const height = 220;
  const left = 52;
  const right = 16;
  const top = 14;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const stepX = history.length > 1 ? plotWidth / (history.length - 1) : plotWidth;
  const yFor = (value) => top + plotHeight - (numberValue(value, 0) / maxValue) * plotHeight;
  const points = history.map((item, index) => ({
    x: left + index * stepX,
    y: yFor(item.value),
    label: item.label,
    value: item.value,
  }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaString = `${left},${top + plotHeight} ${pointString} ${left + plotWidth},${top + plotHeight}`;
  const grid = [maxValue, maxValue * .75, maxValue * .5, maxValue * .25, 0]
    .map((value) => {
      const y = yFor(value);
      return `<line class="grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text x="0" y="${y + 4}">${formatNumber(value, 0)} GB</text>`;
    })
    .join('');
  const labels = points
    .map((point) => `<text x="${point.x}" y="${height - 10}" text-anchor="middle">${escapeHtml(point.label)}</text>`)
    .join('');
  const circles = points
    .map((point) => `<circle class="usage-point" cx="${point.x}" cy="${point.y}" r="6"><title>${escapeHtml(point.label)}: ${formatGb(point.value)}</title></circle>`)
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Historial de uso de almacenamiento">
      ${grid}
      <polygon class="usage-area" points="${areaString}"></polygon>
      <polyline class="usage-line" points="${pointString}"></polyline>
      ${circles}
      ${labels}
    </svg>
  `;
}

function recommendationText(storage) {
  const recommendations = planState.recommendations;
  const firstRecommendation = Array.isArray(recommendations) ? recommendations[0] : recommendations;
  const text = firstDefined(
    planState.recommendation_text,
    planState.storage_recommendation,
    firstRecommendation?.message,
    firstRecommendation?.text
  );

  if (text) return text;
  if (storage.percent >= 90) return 'Estas por llegar al limite de tu almacenamiento. Considera liberar espacio o actualizar tu plan para evitar interrupciones.';
  if (storage.percent >= 75) return 'Tu almacenamiento esta creciendo rapido. Revisa videos pesados y considera ampliar tu plan.';
  return 'Tu almacenamiento se mantiene estable. Revisa periodicamente los archivos mas grandes para conservar espacio disponible.';
}

function renderPlanDashboard() {
  const storage = planStorage();
  const billing = planBilling();
  const renewal = firstDefined(
    planState.renewal_date,
    planState.renews_at,
    planState.next_renewal_at,
    planState.current_period_end,
    billing.renewal_date
  );
  const nextCharge = firstDefined(
    billing.next_charge_date,
    billing.next_payment_at,
    billing.next_invoice_at,
    planState.next_charge_date,
    renewal
  );

  setPlanBindValue('renewalDate', formatDate(renewal));
  setPlanBindValue('nextChargeDate', formatDate(nextCharge));
  setPlanBindValue('recommendationText', recommendationText(storage));
  renderStorageDashboard(storage);
  renderPlanOptions();
  renderUsageChart(storage);
}

function renderMetadata() {
  const displayName = userState.account_name || userState.name || 'Doctor';
  const initials = userState.initials || initialsFromName(displayName);
  const role = userState.role || 'Medico';

  setBindValue('userInitials', initials);
  setBindValue('userName', displayName);
  setBindValue('userRole', role);
  setBindValue('userEmail', userState.email || '');
  setBindValue('clinicName', userState.clinic || 'ENCLAII');
  setBindValue('specialty', userState.specialty || role);
  setBindValue('professionalLicense', userState.professional_license || '');
  setBindValue('planLabel', planLabel());
  setBindValue('planStatus', planStatusLabel());
  setBindValue('memberLimit', memberLimitLabel());
  setBindValue('signatureStatus', userState.has_signature ? 'Firma configurada' : 'Sin firma registrada');
  setBindValue('signatureUpdated', userState.signature_updated_at || '--');

  const headerProfile = document.querySelector('.profile');
  if (headerProfile) {
    const avatar = headerProfile.querySelector('.avatar');
    const name = headerProfile.querySelector('strong');
    const sub = headerProfile.querySelector('span:not(.avatar)');
    if (avatar) avatar.textContent = initials;
    if (name) name.textContent = displayName;
    if (sub) sub.textContent = role;
  }
}

function applyLocalSettings(root) {
  root.querySelectorAll('[data-local-setting]').forEach((control) => {
    const key = control.dataset.localSetting;
    const storageKey = LOCAL_SETTINGS[key];
    if (key === 'api_url') {
      control.value = apiBaseUrl();
      return;
    }
    control.value = localStorage.getItem(storageKey) || 'es';
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
  renderPlanDashboard();
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

function selectedPlanCycle(button) {
  const card = button.closest('.settings-plan-option');
  return card?.querySelector('[data-plan-cycle].is-active')?.dataset.planCycle || 'monthly';
}

function planActionPayload(action, button) {
  if (action !== 'change-plan') return null;

  return {
    plan_id: button.dataset.planId || '',
    billing_cycle: selectedPlanCycle(button),
  };
}

function mergePlanResponse(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const nextPlan = firstDefined(payload.plan, data.plan, payload.subscription, data.subscription, {});
  const planPatch = nextPlan && typeof nextPlan === 'object' ? { ...nextPlan } : { label: nextPlan };
  const storage = firstDefined(payload.storage, data.storage, payload.storage_usage, data.storage_usage);
  const billing = firstDefined(payload.billing, data.billing, payload.payment, data.payment);
  const recommendations = firstDefined(payload.recommendations, data.recommendations);
  const recommendationText = firstDefined(payload.recommendation_text, data.recommendation_text);
  const usageHistory = firstDefined(payload.usage_history, data.usage_history, payload.storage_history, data.storage_history);
  const availablePlans = firstDefined(payload.available_plans, data.available_plans, payload.plans, data.plans);

  if (storage) planPatch.storage = storage;
  if (billing) planPatch.billing = billing;
  if (recommendations) planPatch.recommendations = recommendations;
  if (recommendationText) planPatch.recommendation_text = recommendationText;
  if (usageHistory) planPatch.usage_history = usageHistory;
  if (availablePlans) planPatch.available_plans = availablePlans;

  if (Object.keys(planPatch).length) {
    planState = { ...planState, ...planPatch };
  }

  if (payload.user || data.user) userState = { ...userState, ...(payload.user || data.user) };
  if (payload.settings || payload.security) {
    settingsState = {
      ...settingsState,
      ...(payload.settings || {}),
      ...(payload.security || {}),
    };
  }

  renderMetadata();
  renderPlanDashboard();
}

function normalizeLaravelUrl(value) {
  if (!value) return '';
  try {
    return new URL(value, apiBaseUrl()).toString();
  } catch (_) {
    return '';
  }
}

function openLaravelUrl(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const url = normalizeLaravelUrl(firstDefined(
    payload.url,
    payload.redirect_url,
    payload.portal_url,
    payload.checkout_url,
    payload.invoice_url,
    data.url,
    data.redirect_url,
    data.portal_url,
    data.checkout_url,
    data.invoice_url
  ));

  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

function successPlanMessage(action, payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const backendMessage = firstDefined(payload.message, data.message);
  if (backendMessage) return backendMessage;

  const messages = {
    manage: 'Gestion de plan abierta desde Laravel.',
    'storage-detail': 'Detalle de almacenamiento actualizado desde Laravel.',
    invoices: 'Facturas consultadas desde Laravel.',
    'payment-method': 'Metodo de pago solicitado a Laravel.',
    recommendations: 'Recomendaciones actualizadas desde Laravel.',
    'change-plan': 'Solicitud de cambio de plan enviada a Laravel.',
  };

  return messages[action] || 'Accion completada desde Laravel.';
}

function updatePlanCycle(button) {
  const card = button.closest('.settings-plan-option');
  if (!card) return;

  card.querySelectorAll('[data-plan-cycle]').forEach((cycleButton) => {
    cycleButton.classList.toggle('is-active', cycleButton === button);
  });

  const price = card.querySelector('[data-plan-price-value]');
  const period = card.querySelector('[data-plan-price-period]');
  if (price) price.textContent = button.dataset.price || '--';
  if (period) period.textContent = button.dataset.period || '';
}

async function handlePlanAction(button) {
  if (button.disabled) return;

  const action = button.dataset.planAction;
  const actionConfig = PLAN_ACTIONS[action];
  if (!actionConfig) return;

  const root = document.getElementById('settingsAppRoot');
  const wasDisabled = button.disabled;
  const body = planActionPayload(action, button);
  const request = {
    path: actionConfig.path,
    method: actionConfig.method,
  };

  if (body) {
    request.headers = { 'Content-Type': 'application/json' };
    request.body = JSON.stringify(body);
  }

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setSettingsAlert(actionConfig.loading, 'ok');

  try {
    const payload = await configRequest(request);
    mergePlanResponse(payload);
    const opened = openLaravelUrl(payload);
    setSettingsAlert(opened ? 'Laravel devolvio un enlace y se abrio en una nueva pestana.' : successPlanMessage(action, payload), 'ok');
  } catch (error) {
    console.error(error);
    if (error.code === 'UNAUTHORIZED') {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      if (root) renderSettingsError(root, error);
      return;
    }
    setSettingsAlert(error.message || 'Laravel no pudo completar la accion del plan.', 'error');
  } finally {
    if (document.contains(button)) {
      button.disabled = wasDisabled;
      button.removeAttribute('aria-busy');
    }
  }
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
    const planCycle = event.target.closest('[data-plan-cycle]');
    if (planCycle) {
      updatePlanCycle(planCycle);
      return;
    }

    const planAction = event.target.closest('[data-plan-action]');
    if (planAction) {
      handlePlanAction(planAction);
      return;
    }

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

  // Check if user is already logged in
  const token = sessionStorage.getItem('enclaii-tauri-basic-auth');
  if (!token) {
    renderLaravelLogin(root, 'Inicia sesión para acceder a la configuración.');
    return;
  }

  bindSettingsEvents(root);
  loadSettings();
}
