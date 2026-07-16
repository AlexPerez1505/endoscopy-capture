// ================= IA Reportes · Inicializador =================
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
const REPORTS_ENDPOINT = `${API_BASE_URL}/api/tauri/reportes`;
const LOGIN_ENDPOINT = `${API_BASE_URL}/api/tauri/login`;
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';

let reportsTemplate = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function authHeader() {
  const token = sessionStorage.getItem('enclaii-tauri-basic-auth');
  return token ? `Bearer ${token}` : '';
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

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || 'No se pudo iniciar sesion.');
  }

  return payload.token;
}

function initialsFromName(name) {
  const initials = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return initials || 'RP';
}

function normalizeReportsPayload(payload) {
  const reports = payload?.reportes || payload?.reports || payload?.data?.reportes || payload?.data?.reports || [];
  const kpis = payload?.kpis || payload?.summary || payload?.data?.kpis || {};
  const findings = payload?.hallazgos || payload?.findings || payload?.data?.hallazgos || [];

  return {
    reports: Array.isArray(reports) ? reports.map(normalizeReport) : [],
    kpis,
    findings: Array.isArray(findings) ? findings.map(normalizeFinding) : [],
  };
}

function normalizeReport(item) {
  const name =
    item?.paciente ||
    item?.patient ||
    item?.patient_name ||
    item?.nombre_paciente ||
    item?.name ||
    'Paciente sin nombre';
  const date = item?.fecha || item?.date || item?.created_date || '';
  const time = item?.hora || item?.time || item?.created_time || '';
  const critical = Boolean(item?.critical ?? item?.critico ?? item?.contiene_hallazgos_criticos);

  return {
    id: item?.id ?? '',
    name,
    initials: item?.initials || item?.iniciales || initialsFromName(name),
    study: item?.estudio || item?.study || item?.procedimiento || item?.tipo || 'Estudio',
    date,
    time,
    critical,
    status: item?.estado_texto || item?.status_text || (critical ? 'Critico' : 'Normal'),
    viewUrl: item?.view_url || item?.ver_url || '',
    downloadUrl: item?.download_url || item?.descargar_url || '',
    editUrl: item?.edit_url || item?.editar_url || '',
  };
}

function normalizeFinding(item, index) {
  return {
    id: item?.id ?? index,
    name: item?.nombre || item?.name || 'Hallazgo',
    percentage: Number(item?.porcentaje ?? item?.percentage ?? 0) || 0,
    critical: Boolean(item?.es_critico ?? item?.critical),
  };
}

function setText(root, selector, value) {
  const el = root.querySelector(selector);
  if (el) el.textContent = value;
}

function setKpi(root, bind, value) {
  const el = root.querySelector(`[data-bind="${bind}"]`);
  if (!el) return;

  const count = Number(value) || 0;
  el.dataset.target = String(count);
  el.textContent = '0';
}

function setTrend(root, bind, value) {
  const el = root.querySelector(`[data-bind="${bind}"]`);
  if (!el) return;

  const trend = Number(value) || 0;
  const isDown = trend < 0;
  el.classList.toggle('is-positive', trend > 0);
  el.classList.toggle('is-negative', isDown);
  el.innerHTML = `
    <svg viewBox="0 0 24 24">
      <polyline points="${isDown ? '22 7 13.5 15.5 8.5 10.5 2 17' : '22 17 13.5 8.5 8.5 13.5 2 7'}"/>
      <polyline points="${isDown ? '16 7 22 7 22 13' : '16 17 22 17 22 11'}"/>
    </svg>
    <span>${Math.abs(trend)}% <b>vs mes anterior</b></span>`;
}

function animateCounters(root) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('.stat .num').forEach((counter) => {
    const target = parseInt(counter.dataset.target, 10) || 0;
    if (reduced) {
      counter.textContent = target.toLocaleString('es-MX');
      return;
    }

    const duration = 900;
    const start = performance.now();
    function tick(time) {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = Math.round(target * eased).toLocaleString('es-MX');
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

function setReportsLoading(root) {
  const tbody = document.getElementById('reportsTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:28px;color:var(--txt-soft)">Cargando reportes desde Laravel...</td>
      </tr>`;
  }

  setText(root, '.rep-hall h3', 'HALLAZGOS');
}

function restoreReportsShell(root) {
  if (!root.querySelector('#reportsTableBody') && reportsTemplate) {
    root.innerHTML = reportsTemplate;
  }
}

function renderLaravelLogin(root, message = 'Inicia sesion con tu usuario de Laravel.') {
  root.innerHTML = `
    <form id="laravelReportsLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
      <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar Reportes con Laravel</strong>
      <p style="color:var(--txt-soft);font-size:13px;line-height:1.5;margin:0 0 18px;">${escapeHtml(message)}</p>
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Correo</label>
      <input id="laravelReportsEmail" type="email" autocomplete="username" required style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Contrasena</label>
      <input id="laravelReportsPassword" type="password" autocomplete="current-password" required style="width:100%;margin-bottom:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <button type="submit" style="width:100%;padding:11px 14px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;cursor:pointer;">Conectar reportes</button>
    </form>`;

  document.getElementById('laravelReportsLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('laravelReportsEmail')?.value.trim();
    const password = document.getElementById('laravelReportsPassword')?.value || '';

    if (!email || !password) return;

    try {
      const token = await loginToLaravel(email, password);
      sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      restoreReportsShell(root);
      await loadReportsFromLaravel(root);
    } catch (error) {
      console.error(error);
      renderLaravelLogin(root, error.message || 'No se pudo iniciar sesion.');
    }
  });
}

function renderReportsError(root, error) {
  if (error.code === 'UNAUTHORIZED') {
    renderLaravelLogin(root, error.message);
    return;
  }

  root.innerHTML = `
    <div style="padding:42px 20px;text-align:center;color:var(--txt-soft);">
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
      <span>${escapeHtml(error.message || 'No se pudieron cargar los reportes.')}</span>
    </div>`;
}

async function fetchLaravelReports() {
  const headers = {
    Accept: 'application/json',
  };
  const authorization = authHeader();

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await laravelFetch(REPORTS_ENDPOINT, {
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar reportes.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvio JSON. Revisa sesion y ruta: ${REPORTS_ENDPOINT}`);
  }

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status}.`);
  }

  return normalizeReportsPayload(payload);
}

function reportRowHTML(report) {
  const viewUrl = report.viewUrl || '#';
  const downloadUrl = report.downloadUrl || viewUrl;
  const editUrl = report.editUrl || '#ia-reportes/redactar';

  return `
    <tr>
      <td><span class="pat"><span class="mini">${escapeHtml(report.initials)}</span>${escapeHtml(report.name)}</span></td>
      <td>${escapeHtml(report.study)}</td>
      <td class="date">${escapeHtml(report.date)} <small>${escapeHtml(report.time)}</small></td>
      <td><span class="chip ${report.critical ? 'urgent' : 'done'}">${escapeHtml(report.status)}</span></td>
      <td>
        <div class="row-actions">
          <a href="${escapeHtml(viewUrl)}" title="Ver" ${report.viewUrl ? 'target="_blank" rel="noreferrer"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
          <a href="${escapeHtml(downloadUrl)}" title="Descargar" ${report.downloadUrl ? 'target="_blank" rel="noreferrer"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
          <a href="${escapeHtml(editUrl)}" ${report.editUrl ? 'target="_blank" rel="noreferrer"' : 'data-nav="ia-reportes-redactar"'} title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></a>
        </div>
      </td>
    </tr>`;
}

function renderReportsTable(reports) {
  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;

  if (!reports.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:28px;color:var(--txt-soft)">No hay reportes generados todavia.</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = reports.map(reportRowHTML).join('');
}

function renderKpis(root, kpis) {
  setKpi(root, 'kpi-reportes', kpis?.reportes?.valor ?? kpis?.reportes ?? 0);
  setKpi(root, 'kpi-pendientes', kpis?.sin_reporte?.valor ?? kpis?.pendientes?.valor ?? kpis?.sin_reporte ?? 0);
  setKpi(root, 'kpi-evidencias', kpis?.evidencias?.valor ?? kpis?.evidencias ?? 0);
  setKpi(root, 'kpi-estudios', kpis?.estudios?.valor ?? kpis?.estudios ?? 0);
  setTrend(root, 'trend-reportes', kpis?.reportes?.trend ?? 0);
  setTrend(root, 'trend-evidencias', kpis?.evidencias?.trend ?? 0);
  setTrend(root, 'trend-estudios', kpis?.estudios?.trend ?? 0);
  animateCounters(root);
}

function findingHTML(finding, index) {
  const percent = Math.max(0, Math.min(100, finding.percentage));
  const barClass = `c${(index % 3) + 1}`;
  const criticalStyle = finding.critical ? 'style="background:rgba(255,90,110,.12)"' : '';
  const innerStyle = finding.critical
    ? `style="width:${percent}%;background:var(--red)"`
    : `style="width:${percent}%"`;

  return `
    <div class="find">
      <div class="top"><span>${escapeHtml(finding.name)}</span><b>${percent}%</b></div>
      <div class="bar ${barClass}" ${criticalStyle}><i ${innerStyle}></i></div>
    </div>`;
}

function renderFindings(root, findings) {
  const panel = root.querySelector('.rep-hall');
  if (!panel) return;

  const title = '<h3>HALLAZGOS</h3>';
  const link = '<a class="reports-link" href="#ia-reportes">Ver todos los hallazgos <span>-></span></a>';
  if (!findings.length) {
    panel.innerHTML = `${title}<div class="find-empty">Sin hallazgos registrados</div>${link}`;
    return;
  }

  panel.innerHTML = title + findings.slice(0, 5).map(findingHTML).join('') + link;
}

function renderPredictive(root, reports) {
  const first = reports[0];
  if (!first) return;

  const initials = root.querySelector('[data-bind="predictive-initials"]');
  const name = root.querySelector('[data-bind="predictive-name"]');
  const study = root.querySelector('[data-bind="predictive-study"]');
  const date = root.querySelector('[data-bind="predictive-date"]');

  if (initials) initials.textContent = first.initials;
  if (name) name.textContent = first.name;
  if (study) study.textContent = first.study;
  if (date) date.textContent = first.date || 'Sin fecha';
}

function renderReportsData(root, data) {
  renderKpis(root, data.kpis);
  renderReportsTable(data.reports);
  renderFindings(root, data.findings);
  renderPredictive(root, data.reports);
}

async function loadReportsFromLaravel(root) {
  restoreReportsShell(root);
  setReportsLoading(root);

  try {
    const data = await fetchLaravelReports();
    renderReportsData(root, data);
  } catch (error) {
    console.error(error);

    if (error.code === 'UNAUTHORIZED') {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }

    renderReportsError(root, error);
  }
}

export async function initReports() {
  const root = document.getElementById('pageContent');
  if (!root) return;

  // Check if user is already logged in
  const token = sessionStorage.getItem('enclaii-tauri-basic-auth');
  if (!token) {
    renderLaravelLogin(root, 'Inicia sesión para acceder a los reportes.');
    return;
  }

  reportsTemplate = root.innerHTML;
  await loadReportsFromLaravel(root);
}

export function initReportEditor() {
  const root = document.getElementById('pageContent');
  if (!root) return;

  const documentEl = root.querySelector('#reportDocument');
  const chatMessages = root.querySelector('.chat-msgs');
  const chatInput = root.querySelector('.chat-input input');
  const chatSend = root.querySelector('.chat-input button');
  const typeSelect = root.querySelector('#reportTypeSelect');
  const procedureText = root.querySelector('[data-bind="doc-procedure"]');

  root.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      documentEl?.focus();
      document.execCommand(button.dataset.command, false, null);
      button.classList.toggle('active', ['bold', 'italic', 'underline', 'strikeThrough'].includes(button.dataset.command));
    });
  });

  typeSelect?.addEventListener('change', () => {
    if (procedureText) procedureText.textContent = typeSelect.value;
  });

  function appendMessage(text, role = 'me') {
    if (!chatMessages || !text.trim()) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-msg ${role}`;
    bubble.textContent = text.trim();
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  root.querySelectorAll('.quick-prompts button').forEach((button) => {
    button.addEventListener('click', () => {
      appendMessage(button.textContent || '', 'me');
      appendMessage('Listo. Puedo ayudarte a convertirlo en texto clínico claro dentro del reporte.', 'ai');
    });
  });

  chatSend?.addEventListener('click', () => {
    appendMessage(chatInput?.value || '', 'me');
    if (chatInput) chatInput.value = '';
  });

  chatInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    chatSend?.click();
  });

  root.querySelectorAll('.template-item').forEach((button) => {
    button.addEventListener('click', () => {
      root.querySelectorAll('.template-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');

      const title = button.querySelector('strong')?.textContent?.trim();
      if (title && typeSelect) {
        typeSelect.value = Array.from(typeSelect.options).some((option) => option.value === title)
          ? title
          : typeSelect.value;
        if (procedureText && title !== 'En blanco') procedureText.textContent = title;
      }
    });
  });
}
