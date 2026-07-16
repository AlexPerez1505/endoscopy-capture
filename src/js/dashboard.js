// ================= Dashboard · Inicializador =================
// Renderiza el calendario del mes, anima contadores y dibuja el gauge de riesgo.
// Los datos se leen desde Laravel. Tauri no se conecta directo a la base.

import { laravelFetch } from './laravel.js';

const DEFAULT_API_BASE_URL = 'http://localhost:8000';
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
const DASHBOARD_ENDPOINT = `${API_BASE_URL}/api/tauri/dashboard`;
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let dashboardTemplate = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function authHeader() {
  const token = sessionStorage.getItem(AUTH_STORAGE_KEY);
  return token ? `Bearer ${token}` : '';
}

async function loginToLaravel(email, password) {
  const response = await laravelFetch(`${API_BASE_URL}/api/tauri/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || 'No se pudo iniciar sesión con Laravel.');
  }

  return payload.token;
}

function setText(root, bind, value) {
  const el = root.querySelector(`[data-bind="${bind}"]`);
  if (el) el.textContent = value;
}

function setCounter(root, id, value) {
  const el = root.querySelector(`#${id}`);
  if (!el) return;

  const count = Number(value) || 0;
  el.dataset.target = String(count);
  el.textContent = '0';
}

function setDashboardLoading(root) {
  setText(root, 'next-patient-name', 'Conectando con Laravel');
  setText(root, 'next-patient-when', 'Cargando datos del dashboard...');
  setText(root, 'next-patient-proc', '');
}

function renderLaravelLogin(root, message = 'Inicia sesión con tu usuario de Laravel.') {
  root.innerHTML = `
    <form id="laravelDashboardLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
      <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar Dashboard con Laravel</strong>
      <p style="color:var(--txt-soft);font-size:13px;line-height:1.5;margin:0 0 18px;">${escapeHtml(message)}</p>
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Correo</label>
      <input id="laravelDashboardEmail" type="email" autocomplete="username" required style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Contraseña</label>
      <input id="laravelDashboardPassword" type="password" autocomplete="current-password" required style="width:100%;margin-bottom:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <button type="submit" style="width:100%;padding:11px 14px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;cursor:pointer;">Conectar dashboard</button>
    </form>`;

  document.getElementById('laravelDashboardLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('laravelDashboardEmail')?.value.trim();
    const password = document.getElementById('laravelDashboardPassword')?.value || '';

    if (!email || !password) return;

    try {
      const token = await loginToLaravel(email, password);
      sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      restoreDashboardShell(root);
      await loadDashboard(root);
    } catch (error) {
      renderLaravelLogin(root, error.message);
    }
  });
}

function restoreDashboardShell(root) {
  if (!root.querySelector('#widgetGrid') && dashboardTemplate) {
    root.innerHTML = dashboardTemplate;
    renderCalendar(root);
  }
}

function renderDashboardError(root, error) {
  if (error.code === 'UNAUTHORIZED') {
    renderLaravelLogin(root, error.message);
    return;
  }

  root.innerHTML = `
    <div style="padding:42px 20px;text-align:center;color:var(--txt-soft);">
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
      <span>${escapeHtml(error.message || 'No se pudieron cargar los datos del dashboard.')}</span>
    </div>`;
}

async function fetchLaravelDashboard() {
  const headers = {
    Accept: 'application/json',
  };
  const authorization = authHeader();

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await laravelFetch(DASHBOARD_ENDPOINT, {
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar el dashboard.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvió JSON. Revisa sesión y ruta: ${DASHBOARD_ENDPOINT}`);
  }

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondió HTTP ${response.status}.`);
  }

  return payload.dashboard || {};
}

function renderCalendar(root) {
  const titleEl = root.querySelector('[data-bind="cal-title"]');
  const bodyEl = root.querySelector('[data-bind="cal-body"]');
  if (!bodyEl) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  if (titleEl) titleEl.textContent = `${MESES[month]} ${year}`;

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // 0 = Lunes
  const totalCells = startDow + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < 7; c++) {
      const idx = r * 7 + c;
      const dayNum = idx - startDow + 1;
      const isValid = idx >= startDow && dayNum <= daysInMonth;
      const isToday = dayNum === today && isValid;
      const isPast = isValid && new Date(year, month, dayNum) < new Date(year, month, today);
      if (!isValid) {
        html += `<td class="off">${dayNum > 0 && dayNum <= daysInMonth ? dayNum : ''}</td>`;
      } else if (isPast && !isToday) {
        html += `<td class="past">${dayNum}</td>`;
      } else {
        html += `<td class="${isToday ? 'today' : ''}">${dayNum}</td>`;
      }
    }
    html += '</tr>';
  }
  bodyEl.innerHTML = html;
}

function animateCounters(root) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-target]').forEach(counter => {
    const target = parseInt(counter.dataset.target, 10) || 0;
    if (reduced) { counter.textContent = target.toLocaleString('es-MX'); return; }
    const duration = 1200;
    const start = performance.now();
    function tick(t) {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      counter.textContent = Math.round(target * eased).toLocaleString('es-MX');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function drawGauge(root) {
  const gauge = root.querySelector('.gauge .val');
  if (!gauge) return;
  const pct = parseFloat(gauge.dataset.pct) / 100;
  const C = 314.16;
  setTimeout(() => { gauge.style.strokeDashoffset = C - (C * pct); }, 400);
}

function statusClass(estado) {
  return {
    completado: 'done',
    en_espera: 'wait',
    proximo: 'wait',
    cancelado: 'cancel',
  }[estado] || 'wait';
}

function renderPendientesHoy(root, citas = []) {
  const tbody = root.querySelector('[data-bind="pendientes-hoy"]');
  if (!tbody) return;

  if (!citas.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--txt-soft)">No hay pacientes pendientes para hoy.</td></tr>';
    return;
  }

  tbody.innerHTML = citas.map(cita => `
    <tr>
      <td>${escapeHtml(cita.paciente || 'Paciente sin nombre')}</td>
      <td>${escapeHtml(cita.hora || '--:--')}</td>
      <td>${escapeHtml(cita.procedimiento || 'Procedimiento')}</td>
      <td><span class="chip ${statusClass(cita.estado)}">${escapeHtml(cita.estado_texto || cita.estado || 'Próximo')}</span></td>
      <td>${escapeHtml(cita.medico || 'Sin médico')}</td>
      <td><a href="#" data-nav="pacientes">Ver</a></td>
    </tr>
  `).join('');
}

function renderProximosEstudios(root, citas = []) {
  const container = root.querySelector('[data-bind="proximos-estudios"]');
  if (!container) return;

  if (!citas.length) {
    container.innerHTML = '<div class="next-item" style="opacity:.7"><span class="t">--</span><span class="n">No hay estudios próximos</span></div>';
    return;
  }

  container.innerHTML = citas.map(cita => `
    <div class="next-item">
      <span class="t">${escapeHtml(cita.hora || '--:--')}</span>
      <span class="n">${escapeHtml(cita.paciente || 'Paciente sin nombre')} · ${escapeHtml(cita.procedimiento || 'Procedimiento')}</span>
    </div>
  `).join('');
}

function renderDashboardData(root, dashboard) {
  const next = dashboard.next_patient;

  if (next) {
    setText(root, 'next-patient-name', next.paciente || 'Paciente sin nombre');
    setText(root, 'next-patient-when', `${next.fecha || ''} · ${next.hora || '--:--'}`.trim());
    setText(root, 'next-patient-proc', next.procedimiento || '');
  } else {
    setText(root, 'next-patient-name', 'Sin citas próximas');
    setText(root, 'next-patient-when', 'No hay citas agendadas');
    setText(root, 'next-patient-proc', '');
  }

  const summary = dashboard.summary || {};
  const reportesPendientes = dashboard.reportes_pendientes || 0;
  const totalCitas = summary.total_citas || 0;

  setCounter(root, 'numReportes', reportesPendientes);
  setCounter(root, 'numEstudios', totalCitas);
  setText(root, 'reportes-pendientes', String(reportesPendientes));
  setText(root, 'citas-proximas', String(summary.citas_proximas || 0));
  setText(root, 'citas-completadas', String(summary.citas_completadas || 0));
  setText(root, 'citas-canceladas', String(summary.citas_canceladas || 0));

  renderPendientesHoy(root, dashboard.pendientes_hoy || []);
  renderProximosEstudios(root, dashboard.proximos_estudios || []);
}

async function loadDashboard(root) {
  restoreDashboardShell(root);
  setDashboardLoading(root);

  try {
    const dashboard = await fetchLaravelDashboard();
    renderDashboardData(root, dashboard);
    animateCounters(root);
    drawGauge(root);
  } catch (error) {
    console.error(error);

    if (error.code === 'UNAUTHORIZED') {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }

    renderDashboardError(root, error);
  }
}

export async function initDashboard() {
  const root = document.getElementById('pageContent');
  if (!root) return;
  dashboardTemplate = root.innerHTML;
  renderCalendar(root);
  await loadDashboard(root);
}
