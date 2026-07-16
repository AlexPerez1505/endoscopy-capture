// ================= QR - Inicializador =================
// Los datos se leen desde Laravel. Tauri no se conecta directo a la base.

import { laravelFetch } from './laravel.js';

const DEFAULT_API_BASE_URL = 'https://sistema.enclaii.com';
const LOCAL_LARAVEL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

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
  const saved = (localStorage.getItem('enclaii-api-url') || '').replace(/\/+$/, '');
  const currentOrigin = currentLaravelOrigin();
  if (saved) return currentOrigin && isLocalLaravelUrl(saved) ? currentOrigin : saved;
  return currentOrigin || DEFAULT_API_BASE_URL;
}

const API_BASE_URL = apiBaseUrl();
const QR_ENDPOINT = `${API_BASE_URL}/tauri/qr`;
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';

let qrTemplate = '';
let qrState = null;
let qrHistoryFilter = 'active';

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

async function qrRequest(path = '', options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const authorization = authHeader();

  if (authorization) headers.Authorization = authorization;

  const response = await laravelFetch(`${QR_ENDPOINT}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    credentials: 'include',
  });
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar QR.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvio JSON. Revisa sesion y ruta: ${QR_ENDPOINT}`);
  }

  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status}.`);
  }

  return payload;
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function statusClass(status) {
  return ['active', 'submitted', 'expired', 'revoked', 'pending', 'accepted', 'rejected'].includes(status)
    ? status
    : 'revoked';
}

function setQrAlert(message, type = 'ok') {
  const alert = document.getElementById('qrAlert');
  if (!alert) return;

  alert.textContent = message || '';
  alert.className = `qr-alert ${message ? type : 'is-hidden'}`;
}

function setLoading() {
  setText('[data-qr-bind="activeCount"]', '...');
  setText('[data-qr-bind="pendingCount"]', '...');
  setText('[data-qr-bind="acceptedCount"]', '...');
}

function restoreQrTemplate(root) {
  if (!root.querySelector('#qrCreateForm') && qrTemplate) {
    root.innerHTML = qrTemplate;
    bindQrEvents(root);
  }
}

function renderLaravelLogin(root, message = 'Inicia sesion con tu usuario de Laravel.') {
  root.innerHTML = `
    <form class="qr-login" id="laravelQrLoginForm">
      <strong>Conectar QR con Laravel</strong>
      <p>${escapeHtml(message)}</p>
      <label for="laravelQrEmail">Correo</label>
      <input id="laravelQrEmail" type="email" autocomplete="username" required>
      <label for="laravelQrPassword">Contrasena</label>
      <input id="laravelQrPassword" type="password" autocomplete="current-password" required>
      <button type="submit">Conectar QR</button>
    </form>`;

  document.getElementById('laravelQrLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('laravelQrEmail')?.value.trim();
    const password = document.getElementById('laravelQrPassword')?.value || '';
    if (!email || !password) return;

    sessionStorage.setItem(AUTH_STORAGE_KEY, encodeBasicCredentials(email, password));
    restoreQrTemplate(root);
    await loadQrDashboard();
  });
}

function renderQrError(root, error) {
  if (error.code === 'UNAUTHORIZED') {
    renderLaravelLogin(root, error.message);
    return;
  }

  root.innerHTML = `
    <div class="card" style="padding:42px 20px;text-align:center;color:var(--txt-soft);">
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
      <span>${escapeHtml(error.message || 'No se pudo cargar QR.')}</span>
    </div>`;
}

function setDefaultForm(settings = {}) {
  const expiration = String(settings.default_expiration_hours || '48');
  const input = document.querySelector(`#qrCreateForm input[value="${expiration}"]`);
  const message = document.getElementById('qrPatientMessage');
  if (input) input.checked = true;
  if (message && !message.dataset.touched) message.value = settings.default_patient_message || '';
  updateMessageCount();
}

function renderCurrentLink(link) {
  const preview = document.getElementById('qrPreviewBox');
  const badge = document.getElementById('qrPreviewStatus');
  const info = document.getElementById('qrCurrentInfo');
  const actions = document.querySelectorAll('[data-qr-action="share-whatsapp"], [data-qr-action="copy-link"], [data-qr-action="download-svg"], [data-qr-action="print"]');
  const buttonLabel = document.querySelector('#qrGenerateBtn span');

  actions.forEach((button) => {
    button.disabled = !link;
  });

  if (!link) {
    if (preview) {
      preview.className = 'qr-preview-box unavailable';
      preview.innerHTML = '<div class="qr-empty-preview">Genera tu primer codigo QR para comenzar.</div>';
    }
    if (badge) {
      badge.className = 'qr-status-badge revoked';
      badge.textContent = 'Sin QR';
    }
    info?.classList.add('is-hidden');
    if (buttonLabel) buttonLabel.textContent = 'Generar nuevo codigo';
    return;
  }

  if (preview) {
    preview.className = `qr-preview-box${link.is_available ? '' : ' unavailable'}`;
    preview.innerHTML = link.qr_svg
      ? `<div class="qr-svg-wrap">${link.qr_svg}</div>`
      : '<div class="qr-empty-preview">QR no disponible.</div>';
  }

  if (badge) {
    badge.className = `qr-status-badge ${statusClass(link.status)}`;
    badge.textContent = link.status_text || link.status || 'QR';
  }

  info?.classList.remove('is-hidden');
  setText('#qrCurrentCode', link.code || 'QR');
  setText('#qrCreatedAt', link.created_label || '--');
  setText('#qrExpiresAt', link.expires_label || '--');
  if (buttonLabel) buttonLabel.textContent = link.is_available ? 'Generar nuevo codigo' : 'Generar reemplazo';
}

function renderHistoryTabs(counts = {}) {
  document.querySelectorAll('[data-qr-history]').forEach((button) => {
    const status = button.dataset.qrHistory;
    button.querySelector('span').textContent = counts[status] ?? 0;
    button.classList.toggle('active', status === qrHistoryFilter);
  });
}

function historyRow(link) {
  return `
    <tr data-history-status="${escapeHtml(link.status)}" ${link.status === qrHistoryFilter ? '' : 'hidden'}>
      <td><button class="qr-history-code" type="button" data-qr-select="${escapeHtml(link.id)}">${escapeHtml(link.code)}</button></td>
      <td>${escapeHtml(link.validity_label || '--')}</td>
      <td>${escapeHtml(link.created_date || link.created_label || '--')}</td>
      <td>${escapeHtml(link.expires_date || link.expires_label || '--')}</td>
      <td><span class="qr-status-badge ${statusClass(link.status)}">${escapeHtml(link.status_text || link.status)}</span></td>
      <td>${Number(link.registrations || 0)}</td>
      <td><button class="qr-history-more" type="button" data-qr-select="${escapeHtml(link.id)}" aria-label="Ver codigo">...</button></td>
    </tr>`;
}

function renderHistory(links = []) {
  const body = document.getElementById('qrHistoryBody');
  if (!body) return;
  if (!links.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="qr-empty-row">Todavia no has generado codigos QR.</div></td></tr>';
    return;
  }
  body.innerHTML = links.map(historyRow).join('');
  applyHistoryFilter();
}

function applyHistoryFilter() {
  let visible = 0;
  document.querySelector('[data-history-empty="true"]')?.remove();
  document.querySelectorAll('[data-history-status]').forEach((row) => {
    const show = row.dataset.historyStatus === qrHistoryFilter;
    row.hidden = !show;
    if (show) visible += 1;
  });
  document.querySelectorAll('[data-qr-history]').forEach((button) => {
    button.classList.toggle('active', button.dataset.qrHistory === qrHistoryFilter);
  });
  const body = document.getElementById('qrHistoryBody');
  if (body && visible === 0 && qrState?.links?.length) {
    body.insertAdjacentHTML('beforeend', '<tr data-history-empty="true"><td colspan="7"><div class="qr-empty-row">No hay codigos con este estado.</div></td></tr>');
  }
}

function preregDetails(item) {
  const fields = [
    ['Fecha de nacimiento', `${item.birth_date || '--'}${item.age ? ` (${item.age} anos)` : ''}`],
    ['Sexo', item.sex || 'No indicado'],
    ['Peso / altura', `${item.weight || '--'} kg - ${item.height || '--'} m`],
    ['Direccion', item.address || 'No indicada', true],
    ['Procedimiento', item.procedure || 'No indicado'],
    ['Identificacion', item.identification || 'No indicada'],
    ['Consentimiento', item.consent_label || '--'],
    ['Motivo de consulta', item.reason || 'No indicado', true],
    ['Alergias', item.allergies || 'Ninguna indicada', true],
    ['Enfermedades', item.conditions || 'Ninguna indicada', true],
    ['Medicamentos actuales', item.medications || 'Ninguno indicado', true],
    ['Antecedentes medicos', item.medical_history || 'No indicados', true],
  ];
  if (item.observations) fields.push(['Observaciones', item.observations, true]);

  return fields.map(([label, value, wide]) => `
    <div class="${wide ? 'wide' : ''}">
      <b>${escapeHtml(label)}</b>
      <span>${escapeHtml(value)}</span>
    </div>`).join('');
}

function preregItem(item) {
  const photo = item.photo_url
    ? `<img src="${escapeHtml(item.photo_url)}" alt="Foto de ${escapeHtml(item.name)}">`
    : escapeHtml(item.initials || 'P');
  const actions = item.status === 'pending'
    ? `<div class="qr-review-actions">
        <button class="qr-reject" type="button" data-qr-reject="${escapeHtml(item.id)}">Rechazar</button>
        <button class="qr-accept" type="button" data-qr-accept="${escapeHtml(item.id)}">Aceptar y crear paciente</button>
      </div>`
    : '';

  return `
    <details class="qr-prereg">
      <summary>
        <div class="qr-person">
          <div class="qr-person-avatar">${photo}</div>
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.phone || 'Sin telefono')} - ${escapeHtml(item.email || 'Sin correo')}</span>
          </div>
        </div>
        <div class="qr-received">${escapeHtml(item.received_label || '--')}</div>
        <span class="qr-status-badge ${statusClass(item.status)}">${escapeHtml(item.status_text || item.status)}</span>
      </summary>
      <div class="qr-prereg-detail">
        ${item.possible_duplicate ? '<div class="qr-warning">Existe un paciente con el mismo telefono o correo. Revisa posibles duplicados antes de aceptar.</div>' : ''}
        <div class="qr-data-grid">${preregDetails(item)}</div>
        ${actions}
      </div>
    </details>`;
}

function renderPreregistrations(items = []) {
  const list = document.getElementById('qrPreregList');
  if (!list) return;
  list.innerHTML = items.length
    ? items.map(preregItem).join('')
    : '<div class="qr-empty-row">Los formularios enviados por pacientes apareceran aqui.</div>';
}

function chooseDefaultHistory(counts = {}) {
  if ((counts.active || 0) > 0) return 'active';
  if ((counts.submitted || 0) > 0) return 'submitted';
  if ((counts.expired || 0) > 0) return 'expired';
  return 'revoked';
}

function renderQrDashboard(payload) {
  qrState = payload;
  const kpis = payload.kpis || {};
  setText('[data-qr-bind="activeCount"]', Number(kpis.active || 0).toLocaleString('es-MX'));
  setText('[data-qr-bind="pendingCount"]', Number(kpis.pending || 0).toLocaleString('es-MX'));
  setText('[data-qr-bind="acceptedCount"]', Number(kpis.accepted || 0).toLocaleString('es-MX'));
  qrHistoryFilter = payload.default_history_status || chooseDefaultHistory(payload.history_counts || {});
  setDefaultForm(payload.settings || {});
  renderCurrentLink(payload.current_link || null);
  renderHistoryTabs(payload.history_counts || {});
  renderHistory(payload.links || []);
  renderPreregistrations(payload.preregistrations || []);
}

function updateMessageCount() {
  const message = document.getElementById('qrPatientMessage');
  const count = document.getElementById('qrMessageCount');
  if (message && count) count.textContent = String(message.value.length);
}

async function loadQrDashboard(selectedId = '') {
  const root = document.getElementById('qrAppRoot');
  if (!root) return;
  restoreQrTemplate(root);
  setLoading();

  try {
    const query = selectedId ? `?qr=${encodeURIComponent(selectedId)}` : '';
    const payload = await qrRequest(query);
    setQrAlert('');
    renderQrDashboard(payload);
  } catch (error) {
    console.error(error);
    if (error.code === 'UNAUTHORIZED') sessionStorage.removeItem(AUTH_STORAGE_KEY);
    renderQrError(root, error);
  }
}

async function createQr(event) {
  event.preventDefault();
  const form = event.target;
  const submit = document.getElementById('qrGenerateBtn');
  const data = new FormData(form);
  submit.disabled = true;
  try {
    const payload = await qrRequest('/enlaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_in_hours: Number(data.get('expires_in_hours') || 48),
        patient_message: String(data.get('patient_message') || '').trim(),
      }),
    });
    renderQrDashboard(payload);
    setQrAlert('Codigo QR generado correctamente.', 'ok');
  } catch (error) {
    console.error(error);
    setQrAlert(error.message || 'No se pudo generar el QR.', 'error');
  } finally {
    submit.disabled = false;
  }
}

async function reviewPreregistration(id, action) {
  const label = action === 'accept' ? 'aceptar este pre-registro' : 'rechazar este pre-registro';
  if (!confirm(`Deseas ${label}?`)) return;
  try {
    const path = `/preregistros/${encodeURIComponent(id)}/${action === 'accept' ? 'aceptar' : 'rechazar'}`;
    const payload = await qrRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    renderQrDashboard(payload);
    setQrAlert(action === 'accept' ? 'Pre-registro aceptado y expediente creado.' : 'Pre-registro rechazado.', 'ok');
  } catch (error) {
    console.error(error);
    setQrAlert(error.message || 'No se pudo revisar el pre-registro.', 'error');
  }
}

async function copyValue(value, fallbackLabel = 'valor') {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setQrAlert('Copiado al portapapeles.', 'ok');
  } catch (error) {
    window.prompt(`Copia este ${fallbackLabel}:`, value);
  }
}

function currentLink() {
  return qrState?.current_link || null;
}

function downloadCurrentSvg() {
  const link = currentLink();
  if (!link?.qr_svg) return;
  const blob = new Blob([link.qr_svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${link.code || 'qr-enclaii'}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printCurrentQr() {
  const link = currentLink();
  if (!link?.qr_svg) return;
  const printWindow = window.open('', '_blank', 'width=560,height=680');
  if (!printWindow) return;
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head><title>${escapeHtml(link.code || 'QR')}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Arial,sans-serif;color:#061032}main{text-align:center}svg{width:420px;height:420px}strong{display:block;margin-top:18px;font-size:22px}</style></head>
      <body><main>${link.qr_svg}<strong>${escapeHtml(link.code || 'QR')}</strong></main></body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function bindQrEvents(root) {
  if (root.dataset.qrBound === 'true') return;
  root.dataset.qrBound = 'true';

  root.addEventListener('submit', (event) => {
    if (event.target?.id === 'qrCreateForm') createQr(event);
  });

  root.addEventListener('input', (event) => {
    if (event.target?.id === 'qrPatientMessage') {
      event.target.dataset.touched = 'true';
      updateMessageCount();
    }
  });

  root.addEventListener('click', (event) => {
    const historyButton = event.target.closest('[data-qr-history]');
    if (historyButton) {
      qrHistoryFilter = historyButton.dataset.qrHistory || 'active';
      applyHistoryFilter();
      return;
    }

    const selectButton = event.target.closest('[data-qr-select]');
    if (selectButton) {
      loadQrDashboard(selectButton.dataset.qrSelect);
      return;
    }

    const acceptButton = event.target.closest('[data-qr-accept]');
    if (acceptButton) {
      reviewPreregistration(acceptButton.dataset.qrAccept, 'accept');
      return;
    }

    const rejectButton = event.target.closest('[data-qr-reject]');
    if (rejectButton) {
      reviewPreregistration(rejectButton.dataset.qrReject, 'reject');
      return;
    }

    const actionButton = event.target.closest('[data-qr-action]');
    const link = currentLink();
    if (!actionButton || !link) return;

    const action = actionButton.dataset.qrAction;
    if (action === 'copy-code') copyValue(link.code, 'codigo');
    if (action === 'copy-link') copyValue(link.public_url, 'enlace');
    if (action === 'download-svg') downloadCurrentSvg();
    if (action === 'print') printCurrentQr();
    if (action === 'share-whatsapp' && link.share_text) {
      window.open(`https://wa.me/?text=${encodeURIComponent(link.share_text)}`, '_blank', 'noopener');
    }
  });
}

export function initQr() {
  const root = document.getElementById('qrAppRoot');
  if (!root) return;
  if (!qrTemplate) qrTemplate = root.innerHTML;

  // Check if user is already logged in
  const token = sessionStorage.getItem('enclaii-tauri-basic-auth');
  if (!token) {
    renderLaravelLogin(root, 'Inicia sesión para acceder a los códigos QR.');
    return;
  }

  bindQrEvents(root);
  loadQrDashboard();
}
