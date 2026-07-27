// ================= Dashboard · Inicializador =================
// Renderiza el calendario del mes, anima contadores y dibuja el gauge de riesgo.
// Los datos se leen desde Laravel. Tauri no se conecta directo a la base.

import { apiBaseUrl, laravelFetch } from './laravel.js';
import { authHeader, getAuthToken, setAuthToken } from './auth.js';
import { escapeHtml } from './html.js';

const API_BASE_URL = apiBaseUrl();
const DASHBOARD_ENDPOINT = `${API_BASE_URL}/api/tauri/dashboard`;
const DASHBOARD_LAYOUT_ENDPOINT = `${API_BASE_URL}/api/tauri/dashboard/layout`;

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let dashboardTemplate = '';

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
    throw new Error(payload?.message || 'No se pudo iniciar sesión.');
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
  setText(root, 'next-patient-name', 'Conectando');
  setText(root, 'next-patient-when', 'Cargando datos del dashboard...');
  setText(root, 'next-patient-proc', '');
}

function renderLaravelLogin(root, message = 'Inicia sesión con tu cuenta.') {
  root.innerHTML = `
    <form id="laravelDashboardLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
      <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar Dashboard</strong>
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
      setAuthToken(token);
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
    const error = new Error('Ingresa tus credenciales para cargar el dashboard.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`El servidor no devolvió JSON. Revisa sesión y ruta: ${DASHBOARD_ENDPOINT}`);
  }

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `El servidor respondió HTTP ${response.status}.`);
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

function drawDonut(root, summary) {
  const svg = root.querySelector('.donut svg');
  if (!svg) return;

  const total = Number(summary?.total_citas) || 0;
  if (!total) return;

  const radius = 50;
  const C = 2 * Math.PI * radius;
  const styles = getComputedStyle(document.documentElement);
  const colors = {
    blue: styles.getPropertyValue('--blue').trim() || '#2E7BF6',
    green: styles.getPropertyValue('--green').trim() || '#22c55e',
    red: styles.getPropertyValue('--red').trim() || '#ef4444',
  };

  svg.querySelectorAll('.donut-segment').forEach((el) => el.remove());

  let offset = 0;
  const segments = [
    { key: 'citas_proximas', color: colors.blue },
    { key: 'citas_completadas', color: colors.green },
    { key: 'citas_canceladas', color: colors.red },
  ];

  segments.forEach(({ key, color }) => {
    const value = Number(summary[key]) || 0;
    if (value <= 0) return;
    const length = (value / total) * C;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'donut-segment');
    circle.setAttribute('cx', '60');
    circle.setAttribute('cy', '60');
    circle.setAttribute('r', String(radius));
    circle.style.fill = 'none';
    circle.style.stroke = color;
    circle.style.strokeWidth = '14px';
    circle.style.strokeLinecap = 'round';
    circle.style.strokeDasharray = `${length} ${C}`;
    circle.style.strokeDashoffset = String(-offset);
    svg.appendChild(circle);
    offset += length;
  });
}

function updateWidgetSizeVars(widget) {
  const rect = widget.getBoundingClientRect();
  widget.style.setProperty('--widget-w-px', String(Math.round(rect.width)));
  widget.style.setProperty('--widget-h-px', String(Math.round(rect.height)));
}

async function fetchDashboardLayout() {
  const token = getAuthToken();
  if (!token) return [];

  try {
    const response = await laravelFetch(DASHBOARD_LAYOUT_ENDPOINT, {
      headers: {
        Accept: 'application/json',
        Authorization: authHeader(),
      },
      credentials: 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) return [];
    const payload = await response.json();
    return payload?.layout ?? [];
  } catch (error) {
    console.error('Error cargando layout', error);
    return [];
  }
}

async function saveDashboardLayout(root) {
  const token = getAuthToken();
  if (!token) return;

  const layout = Array.from(root.querySelectorAll('#widgetGrid .widget')).map((widget) => ({
    widget_id: widget.dataset.widgetId,
    w: Number(widget.dataset.w) || 1,
    h: Number(widget.dataset.h) || 1,
  }));

  try {
    await laravelFetch(DASHBOARD_LAYOUT_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ layout }),
    });
  } catch (error) {
    console.error('Error guardando layout', error);
  }
}

let layoutSaveTimeout;
function scheduleLayoutSave(root) {
  if (layoutSaveTimeout) clearTimeout(layoutSaveTimeout);
  layoutSaveTimeout = setTimeout(() => saveDashboardLayout(root), 800);
}

function applyDashboardLayout(root, layout) {
  const grid = root.querySelector('#widgetGrid');
  if (!grid || !Array.isArray(layout) || !layout.length) return;

  const items = layout.filter((item) => item.widget_id);
  const order = items.map((item) => item.widget_id);
  const widgets = Array.from(grid.querySelectorAll('.widget'));

  widgets.sort((a, b) => {
    const ai = order.indexOf(a.dataset.widgetId);
    const bi = order.indexOf(b.dataset.widgetId);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  widgets.forEach((widget) => {
    const item = items.find((i) => i.widget_id === widget.dataset.widgetId);
    if (item) {
      const w = Math.max(1, Math.min(13, Number(item.w) || 1));
      const h = Math.max(1, Number(item.h) || 1);
      widget.dataset.w = String(w);
      widget.dataset.h = String(h);
      widget.style.gridColumn = `span ${w}`;
      widget.style.gridRow = `span ${h}`;
    }
    grid.appendChild(widget);
  });

  widgets.forEach(updateWidgetSizeVars);
}

function initWidgetResize(root) {
  root.querySelectorAll('.widget-resize-handle').forEach((handle) => {
    handle.addEventListener('mousedown', (startEvent) => {
      startEvent.preventDefault();
      startEvent.stopPropagation();

      const widget = handle.closest('.widget');
      if (!widget) return;

      const grid = document.getElementById('widgetGrid');
      const gridRect = grid.getBoundingClientRect();
      const gap = parseInt(getComputedStyle(grid).gap, 10) || 18;
      const colWidth = (gridRect.width + gap) / 13;

      const rowValue = getComputedStyle(grid).gridAutoRows || '60px';
      const rowMatch = rowValue.match(/(\d+(?:\.\d+)?)px/);
      const rowHeight = parseFloat(rowMatch?.[1] || '60');
      const rowHeightWithGap = rowHeight + gap;

      const startX = startEvent.clientX;
      const startY = startEvent.clientY;
      const startWidth = widget.getBoundingClientRect().width;
      const startHeight = widget.getBoundingClientRect().height;

      function onMove(moveEvent) {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        const rawCols = Math.round((startWidth + deltaX) / colWidth);
        const rawRows = Math.round((startHeight + deltaY) / rowHeightWithGap);
        const newW = Math.max(1, Math.min(13, rawCols));
        const newH = Math.max(1, rawRows);
        widget.dataset.w = String(newW);
        widget.dataset.h = String(newH);
        widget.style.gridColumn = `span ${newW}`;
        widget.style.gridRow = `span ${newH}`;
        updateWidgetSizeVars(widget);
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        scheduleLayoutSave(root);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}

function initWidgetDrag(root) {
  root.querySelectorAll('.widget-drag-handle').forEach((handle) => {
    handle.addEventListener('mousedown', (startEvent) => {
      startEvent.preventDefault();
      startEvent.stopPropagation();

      const widget = handle.closest('.widget');
      const grid = document.getElementById('widgetGrid');
      if (!widget || !grid) return;

      const rect = widget.getBoundingClientRect();
      const offsetX = startEvent.clientX - rect.left;
      const offsetY = startEvent.clientY - rect.top;

      const placeholder = widget.cloneNode(true);
      placeholder.classList.add('drag-placeholder');
      placeholder.style.opacity = '0.3';
      placeholder.style.pointerEvents = 'none';
      widget.parentNode.insertBefore(placeholder, widget);

      widget.style.position = 'fixed';
      widget.style.width = `${rect.width}px`;
      widget.style.height = `${rect.height}px`;
      widget.style.left = `${rect.left}px`;
      widget.style.top = `${rect.top}px`;
      widget.style.zIndex = '1000';
      widget.style.pointerEvents = 'none';
      widget.classList.add('dragging');

      function onMove(moveEvent) {
        widget.style.left = `${moveEvent.clientX - offsetX}px`;
        widget.style.top = `${moveEvent.clientY - offsetY}px`;
      }

      function onUp(upEvent) {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);

        const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('#widgetGrid .widget');
        if (target && target !== placeholder && target !== widget) {
          const targetRect = target.getBoundingClientRect();
          if (upEvent.clientY < targetRect.top + targetRect.height / 2) {
            grid.insertBefore(placeholder, target);
          } else {
            grid.insertBefore(placeholder, target.nextElementSibling);
          }
        }

        widget.style.position = '';
        widget.style.width = '';
        widget.style.height = '';
        widget.style.left = '';
        widget.style.top = '';
        widget.style.zIndex = '';
        widget.style.pointerEvents = '';
        widget.classList.remove('dragging');
        placeholder.replaceWith(widget);

        updateWidgetSizeVars(widget);
        scheduleLayoutSave(root);
      }

      document.body.appendChild(widget);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
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

  drawDonut(root, summary);
  renderPendientesHoy(root, dashboard.pendientes_hoy || []);
  renderProximosEstudios(root, dashboard.proximos_estudios || []);
}

async function loadDashboard(root) {
  restoreDashboardShell(root);
  initWidgetResize(root);
  initWidgetDrag(root);
  setDashboardLoading(root);

  try {
    const [dashboardResult, layoutResult] = await Promise.allSettled([
      fetchLaravelDashboard(),
      fetchDashboardLayout(),
    ]);

    if (layoutResult.status === 'fulfilled' && Array.isArray(layoutResult.value) && layoutResult.value.length) {
      applyDashboardLayout(root, layoutResult.value);
    } else {
      root.querySelectorAll('.widget').forEach(updateWidgetSizeVars);
    }

    if (dashboardResult.status === 'fulfilled') {
      renderDashboardData(root, dashboardResult.value);
      animateCounters(root);
      drawGauge(root);
    } else {
      console.error(dashboardResult.reason);
      if (dashboardResult.reason?.code === 'UNAUTHORIZED') {
        renderLaravelLogin(root, dashboardResult.reason.message);
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export async function initDashboard() {
  const root = document.getElementById('pageContent');
  if (!root) return;
  dashboardTemplate = root.innerHTML;
  renderCalendar(root);
  
  // Check if user is already logged in
  const token = getAuthToken();
  if (!token) {
    renderLaravelLogin(root, 'Inicia sesión para acceder al dashboard.');
    return;
  }
  
  await loadDashboard(root);
}
