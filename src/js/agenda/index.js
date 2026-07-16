const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

// Los datos se leen desde Laravel. Tauri no se conecta directo a la base.
import { laravelFetch } from '../laravel.js';

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
const AGENDA_ENDPOINT = `${API_BASE_URL}/api/tauri/agenda`;
const LOGIN_ENDPOINT = `${API_BASE_URL}/api/tauri/login`;
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';

let appointmentsData = [];
let visibleDate = new Date();
let agendaTemplate = '';

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

function agendaEndpointForVisibleMonth() {
  const params = new URLSearchParams({
    year: String(visibleDate.getFullYear()),
    month: String(visibleDate.getMonth() + 1).padStart(2, '0'),
  });

  return `${AGENDA_ENDPOINT}?${params.toString()}`;
}

function normalizeDate(value) {
  if (!value) return '';

  const raw = String(value).trim();
  const dateOnly = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTime(value, dateValue) {
  const raw = String(value || dateValue || '').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return '--:--';

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function isFutureAppointment(date, time) {
  if (!date) return false;

  const safeTime = time && time !== '--:--' ? time : '23:59';
  const parsed = new Date(`${date}T${safeTime}:00`);
  return !Number.isNaN(parsed.getTime()) && parsed >= new Date();
}

function normalizeStatus(value, date, time) {
  const direct = String(value || '').trim().toLowerCase();
  if (['ev-done', 'ev-wait', 'ev-cancel', 'ev-soon'].includes(direct)) return direct;
  if (['ev-done', 'ev-wait', 'ev-cancel', 'ev-soon'].includes(direct.replaceAll('_', '-'))) {
    return direct.replaceAll('_', '-');
  }

  const key = direct
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  const statusMap = {
    completado: 'ev-done',
    completed: 'ev-done',
    done: 'ev-done',
    finalizado: 'ev-done',
    terminado: 'ev-done',
    atendido: 'ev-done',
    cancelado: 'ev-cancel',
    cancelled: 'ev-cancel',
    canceled: 'ev-cancel',
    anulado: 'ev-cancel',
    en_espera: 'ev-wait',
    espera: 'ev-wait',
    waiting: 'ev-wait',
    wait: 'ev-wait',
    pendiente: 'ev-wait',
    en_proceso: 'ev-wait',
    programado: 'ev-soon',
    programada: 'ev-soon',
    agendado: 'ev-soon',
    agendada: 'ev-soon',
    proximo: 'ev-soon',
    proxima: 'ev-soon',
    upcoming: 'ev-soon',
    scheduled: 'ev-soon',
    soon: 'ev-soon',
  };

  return statusMap[key] || (isFutureAppointment(date, time) ? 'ev-soon' : 'ev-wait');
}

function normalizeAppointment(item, index) {
  const dateValue =
    item?.date ??
    item?.fecha ??
    item?.start_date ??
    item?.fecha_cita ??
    item?.dia ??
    item?.inicio;
  const date = normalizeDate(dateValue);
  if (!date) return null;

  const time = normalizeTime(
    item?.time ?? item?.hora ?? item?.start_time ?? item?.hora_inicio,
    dateValue
  );

  return {
    id: item?.id ?? item?.cita_id ?? index,
    date,
    time,
    patient:
      item?.patient ??
      item?.paciente ??
      item?.patient_name ??
      item?.nombre_paciente ??
      item?.nombre ??
      'Paciente sin nombre',
    type:
      item?.type ??
      item?.procedimiento ??
      item?.estudio ??
      item?.tipo_estudio ??
      item?.tipo ??
      'Procedimiento',
    status: normalizeStatus(item?.status ?? item?.estado ?? item?.class ?? item?.css_class, date, time),
  };
}

function flattenAppointmentsSource(source) {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];

  return Object.entries(source).flatMap(([date, items]) => {
    const normalizedDate = normalizeDate(date);
    if (!normalizedDate) return [];
    if (!Array.isArray(items)) return [];
    return items.map((item) => (
      item && typeof item === 'object'
        ? { fecha: normalizedDate, ...item }
        : { fecha: normalizedDate, paciente: item }
    ));
  });
}

function normalizeAppointmentsPayload(payload) {
  const candidates = [
    payload,
    payload?.appointments,
    payload?.citas,
    payload?.agenda?.appointments,
    payload?.agenda?.citas,
    payload?.data?.appointments,
    payload?.data?.citas,
    payload?.data?.data,
    payload?.agenda,
    payload?.data,
  ];

  let source = [];
  for (const candidate of candidates) {
    const items = flattenAppointmentsSource(candidate);
    if (Array.isArray(candidate) || items.length) {
      source = items;
      break;
    }
  }

  return source
    .map((item, index) => normalizeAppointment(item, index))
    .filter(Boolean)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function setAgendaLoading() {
  const calendarBody = document.getElementById('calBody');
  if (calendarBody) {
    calendarBody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:32px 20px;color:var(--txt-soft)">Cargando agenda desde Laravel...</td></tr>';
  }

  const list = document.getElementById('proxList');
  if (list) {
    list.innerHTML =
      '<div style="text-align:center;padding:20px;color:var(--txt-soft);font-size:12px">Conectando con Laravel</div>';
  }
}

function restoreAgendaShell(root) {
  if (!root.querySelector('#calBody') && agendaTemplate) {
    root.innerHTML = agendaTemplate;
    bindMonthNavigation(root);
  }
}

function renderLaravelLogin(root, message = 'Inicia sesion con tu usuario de Laravel.') {
  root.innerHTML = `
    <form id="laravelAgendaLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
      <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar Agenda con Laravel</strong>
      <p style="color:var(--txt-soft);font-size:13px;line-height:1.5;margin:0 0 18px;">${escapeHtml(message)}</p>
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Correo</label>
      <input id="laravelAgendaEmail" type="email" autocomplete="username" required style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Contrasena</label>
      <input id="laravelAgendaPassword" type="password" autocomplete="current-password" required style="width:100%;margin-bottom:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <button type="submit" style="width:100%;padding:11px 14px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;cursor:pointer;">Conectar agenda</button>
    </form>`;

  document.getElementById('laravelAgendaLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('laravelAgendaEmail')?.value.trim();
    const password = document.getElementById('laravelAgendaPassword')?.value || '';

    if (!email || !password) return;

    try {
      const token = await loginToLaravel(email, password);
      sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      restoreAgendaShell(root);
      await loadAgendaFromLaravel(root);
    } catch (error) {
      console.error(error);
      renderLaravelLogin(root, error.message || 'No se pudo iniciar sesion.');
    }
  });
}

function renderAgendaError(root, error) {
  if (error.code === 'UNAUTHORIZED') {
    renderLaravelLogin(root, error.message);
    return;
  }

  root.innerHTML = `
    <div style="padding:42px 20px;text-align:center;color:var(--txt-soft);">
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
      <span>${escapeHtml(error.message || 'No se pudieron cargar las citas de agenda.')}</span>
    </div>`;
}

async function fetchLaravelAgenda() {
  const headers = {
    Accept: 'application/json',
  };
  const authorization = authHeader();

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await laravelFetch(agendaEndpointForVisibleMonth(), {
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar la agenda.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvio JSON. Revisa sesion y ruta: ${AGENDA_ENDPOINT}`);
  }

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status}.`);
  }

  return normalizeAppointmentsPayload(payload);
}

function getMonthAppointments(year, month) {
  return appointmentsData.filter((appointment) => {
    const date = new Date(`${appointment.date}T00:00:00`);
    return date.getFullYear() === year && date.getMonth() === month;
  }).map((appointment) => ({
    ...appointment,
    day: new Date(`${appointment.date}T00:00:00`).getDate(),
  }));
}

function renderUpcoming(appointments) {
  const list = document.getElementById('proxList');
  if (!list) return;

  if (!appointments.length) {
    list.innerHTML =
      '<div style="text-align:center;padding:20px;color:var(--txt-soft);font-size:12px">No hay citas proximas agendadas</div>';
    return;
  }

  list.innerHTML = appointments
    .slice(0, 4)
    .map(
      (appointment) => `
        <div class="prox-item">
          <div class="prox-time">
            <span class="h">${escapeHtml(appointment.time)}</span>
            <span class="m">${String(appointment.day).padStart(2, '0')}</span>
          </div>
          <div class="prox-info">
            <div class="prox-name">${escapeHtml(appointment.patient)}</div>
            <div class="prox-study">${escapeHtml(appointment.type)}</div>
          </div>
        </div>
      `
    )
    .join('');
}

function renderMonth() {
  const monthLabel = document.getElementById('mesActual');
  const yearLabel = document.getElementById('anioActual');
  const calendarBody = document.getElementById('calBody');
  if (!calendarBody) return;

  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();
  const today = new Date();
  const appointments = getMonthAppointments(year, month);
  const appointmentsByDay = new Map();

  appointments.forEach((appointment) => {
    const items = appointmentsByDay.get(appointment.day) || [];
    items.push(appointment);
    appointmentsByDay.set(appointment.day, items);
  });

  if (monthLabel) monthLabel.textContent = MONTHS[month];
  if (yearLabel) yearLabel.textContent = year;

  const firstDay = new Date(year, month, 1);
  const startDow = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  let html = '';
  for (let cell = 0; cell < totalCells; cell += 1) {
    if (cell % 7 === 0) html += '<tr>';

    const day = cell - startDow + 1;
    const isCurrentMonth = day >= 1 && day <= daysInMonth;
    const displayDay = isCurrentMonth
      ? day
      : day < 1
        ? previousMonthDays + day
        : day - daysInMonth;
    const isToday =
      isCurrentMonth &&
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day;
    const dayAppointments = isCurrentMonth ? appointmentsByDay.get(day) || [] : [];

    html += `<td class="${isCurrentMonth ? '' : 'off-month'} ${isToday ? 'today-cell' : ''}">
      <span class="day-num">${displayDay}</span>
      ${dayAppointments
        .map(
          (appointment) => `
            <div class="cal-event ${appointment.status}">
              <div class="ce-line1">${escapeHtml(appointment.time)} ${escapeHtml(appointment.patient)}</div>
              <div class="ce-line2">${escapeHtml(appointment.type)}</div>
            </div>
          `
        )
        .join('')}
    </td>`;

    if (cell % 7 === 6) html += '</tr>';
  }

  calendarBody.innerHTML = html;
  renderUpcoming(appointments);
  applyAgendaFilters();
}

function applyAgendaFilters() {
  document.querySelectorAll('[data-filter]').forEach((checkbox) => {
    document.querySelectorAll(`.${checkbox.dataset.filter}`).forEach((event) => {
      event.style.display = checkbox.checked ? '' : 'none';
    });
  });
}

async function loadAgendaFromLaravel(root) {
  restoreAgendaShell(root);
  setAgendaLoading();

  try {
    appointmentsData = await fetchLaravelAgenda();
    renderMonth();
  } catch (error) {
    console.error(error);

    if (error.code === 'UNAUTHORIZED') {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }

    renderAgendaError(root, error);
  }
}

function bindMonthNavigation(root) {
  document.getElementById('prevMonth')?.addEventListener('click', async () => {
    visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() - 1, 1);
    await loadAgendaFromLaravel(root);
  });

  document.getElementById('nextMonth')?.addEventListener('click', async () => {
    visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() + 1, 1);
    await loadAgendaFromLaravel(root);
  });

  document.querySelectorAll('[data-filter]').forEach((checkbox) => {
    checkbox.addEventListener('change', applyAgendaFilters);
  });
}

export async function initAgenda() {
  const root = document.getElementById('pageContent');
  if (!root) return;

  visibleDate = new Date();
  visibleDate.setDate(1);
  appointmentsData = [];
  agendaTemplate = root.innerHTML;
  bindMonthNavigation(root);
  await loadAgendaFromLaravel(root);
}
