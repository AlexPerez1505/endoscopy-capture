const MONTHS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];
const DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const DIAS_ES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19,20,21];

// Los datos se leen desde Laravel. Tauri no se conecta directo a la base.
import { laravelFetch } from '../laravel.js';

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
const AGENDA_ENDPOINT = `${API_BASE_URL}/api/tauri/agenda`;
const CITAS_ENDPOINT = `${API_BASE_URL}/api/tauri/agenda/citas`;
const BLOQUEOS_ENDPOINT = `${API_BASE_URL}/api/tauri/agenda/bloqueos`;
const PATIENTS_ENDPOINT = `${API_BASE_URL}/api/tauri/pacientes`;
const LOGIN_ENDPOINT = `${API_BASE_URL}/api/tauri/login`;
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
const AGENDAR_PREFILL_STORAGE_KEY = 'enclaii-agendar-prefill';

let EVENTS = {};
let BLOCKS = {};
let visibleDate = new Date();
let curView = 'mes';
let agendaTemplate = '';
let popupAnchoredEl = null;
let popupCloseTimer = null;

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
    month: String(visibleDate.getMonth() + 1),
  });

  return `${AGENDA_ENDPOINT}?${params.toString()}`;
}

function displayName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ') || 'Paciente';
}

function initials(name) {
  return displayName(name).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

/* ---- Construye window.__AGENDA_EVENTS-like map desde la respuesta de Laravel ---- */
function buildEventsFromCitas(citas) {
  const map = {};

  (citas || []).forEach((cita) => {
    if (!cita.fecha_key) return;
    map[cita.fecha_key] = map[cita.fecha_key] || [];

    const paciente = cita.paciente || 'Paciente sin nombre';
    const procedimiento = cita.procedimiento || 'Procedimiento';

    map[cita.fecha_key].push({
      id: cita.id,
      paciente_id: cita.paciente_id || null,
      name: paciente,
      proc: procedimiento,
      cls: cita.cls || 'ev-soon',
      h: parseInt(cita.hora_h ?? String(cita.hora_label || cita.hora || '0').substring(0, 2), 10) || 0,
      duracion: cita.duracion_minutos ?? 60,
      hora: cita.hora_label || cita.hora,
      estado: cita.estado,
      estado_texto: cita.estado_texto,
      sala: cita.sala || 'Sala 3',
      notas: cita.notas || '',
      delete_url: cita.delete_url,
      update_url: cita.update_url,
      estado_url: cita.estado_url,
      reprogramar_url: cita.reprogramar_url,
      inits: initials(paciente),
    });
  });

  Object.keys(map).forEach((key) => {
    map[key].sort((a, b) => (a.h - b.h) || String(a.hora || '').localeCompare(String(b.hora || '')));
  });

  return map;
}

function buildBlocksFromBloqueos(bloqueos) {
  const map = {};

  (bloqueos || []).forEach((bloqueo) => {
    if (!bloqueo.fecha_key) return;
    map[bloqueo.fecha_key] = map[bloqueo.fecha_key] || [];
    map[bloqueo.fecha_key].push({
      id: bloqueo.id,
      label: bloqueo.label || 'Bloqueo de tiempo',
      hora: bloqueo.hora,
      hora_fin: bloqueo.hora_fin,
      h: bloqueo.h ?? (parseInt(String(bloqueo.hora || '0').substring(0, 2), 10) || 0),
      duracion: bloqueo.duracion ?? 60,
    });
  });

  Object.keys(map).forEach((key) => {
    map[key].sort((a, b) => (a.h - b.h) || String(a.hora || '').localeCompare(String(b.hora || '')));
  });

  return map;
}

function recomputeClass(ev, dateKey) {
  const now = new Date();
  const [y, m, d] = dateKey.split('-').map(Number);
  const timeStr = ev.hora || (ev.h ? String(ev.h).padStart(2, '0') + ':00' : '00:00');
  const [h, min] = timeStr.split(':').map(Number);
  const start = new Date(y, m - 1, d, h || 0, min || 0);
  const waitStart = new Date(start.getTime() - 15 * 60000);
  const cancelStart = new Date(start.getTime() + 5 * 60000);

  if (ev.cls === 'ev-done' || ev.cls === 'ev-cancel') return ev.cls;
  if (now >= cancelStart) return 'ev-cancel';
  if (ev.cls === 'ev-wait') return 'ev-wait';
  if (now >= waitStart) return 'ev-wait';
  return 'ev-soon';
}

function countEvents(keys) {
  const counts = { 'ev-done': 0, 'ev-wait': 0, 'ev-cancel': 0, 'ev-soon': 0 };
  keys.forEach((k) => {
    (EVENTS[k] || []).forEach((ev) => {
      const cls = recomputeClass(ev, k);
      if (counts[cls] !== undefined) counts[cls] += 1;
    });
  });
  return counts;
}

function updateSumCards(counts) {
  const map = {
    'ev-done': document.getElementById('cntDone'),
    'ev-wait': document.getElementById('cntWait'),
    'ev-cancel': document.getElementById('cntCancel'),
    'ev-soon': document.getElementById('cntSoon'),
  };
  Object.entries(map).forEach(([cls, el]) => {
    if (el) el.textContent = counts[cls] || 0;
  });
}

/* ---- Vista Mes ---- */
function buildCal(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const monthLabel = document.getElementById('mesActual');
  const yearLabel = document.getElementById('anioActual');
  if (monthLabel) monthLabel.textContent = MONTHS[m];
  if (yearLabel) yearLabel.textContent = y;

  const today = new Date();
  let startDow = new Date(y, m, 1).getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const tbody = document.getElementById('calBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let day = 1 - startDow;
  for (let row = 0; row < 6; row += 1) {
    let hasContent = false;
    const tr = document.createElement('tr');

    for (let col = 0; col < 7; col += 1) {
      const td = document.createElement('td');
      const cellDate = new Date(y, m, day);
      const isCurMonth = cellDate.getMonth() === m;
      const isToday = cellDate.toDateString() === today.toDateString();
      if (!isCurMonth) td.classList.add('off-month');
      if (isToday) td.classList.add('today-cell');

      const key = `${cellDate.getFullYear()}-${cellDate.getMonth() + 1}-${cellDate.getDate()}`;
      const evs = EVENTS[key] || [];
      const MAX_VISIBLE = 2;

      const dnRow = document.createElement('div');
      dnRow.className = 'day-num-row';
      const dn = document.createElement('div');
      dn.className = 'day-num';
      dn.textContent = cellDate.getDate();
      dnRow.appendChild(dn);
      td.appendChild(dnRow);

      td.addEventListener('click', (e) => {
        if (e.target.closest('.cal-event, .cal-block, .cal-more-btn')) return;
        const iso = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        openAgendarModal(iso);
      });

      evs.slice(0, MAX_VISIBLE).forEach((ev) => {
        const liveCls = recomputeClass(ev, key);
        const div = document.createElement('div');
        div.className = `cal-event ${liveCls}`;
        const name = ev.name || 'Paciente';
        const proc = ev.proc || 'Procedimiento';
        const dispName = displayName(name);
        div.dataset.name = name;
        div.dataset.proc = proc;
        div.dataset.citaId = ev.id || '';
        div.dataset.pacienteId = ev.paciente_id || '';
        div.dataset.deleteUrl = ev.delete_url || '';
        div.dataset.estado = ev.estado || '';
        div.dataset.estadoUrl = ev.estado_url || '';
        div.dataset.reprogramarUrl = ev.reprogramar_url || '';
        div.dataset.cls = liveCls;
        div.dataset.time = ev.hora || (ev.h ? String(ev.h).padStart(2, '0') + ':00' : '');
        div.dataset.duration = ev.duracion || '60';
        div.dataset.fecha = key;
        div.dataset.sala = ev.sala || '';
        div.dataset.notas = ev.notas || '';
        div.innerHTML = `<div class="ce-line1">${escapeHtml(dispName)}</div><div class="ce-line2">${escapeHtml(proc)}</div>`;
        td.appendChild(div);
      });

      if (evs.length > MAX_VISIBLE) {
        const dayName = DIAS_ES[cellDate.getDay()];
        const moreBtn = document.createElement('button');
        moreBtn.className = 'cal-more-btn';
        moreBtn.textContent = `+${evs.length - MAX_VISIBLE} más`;
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openWeekModal(evs, cellDate, '', dayName);
        });
        td.appendChild(moreBtn);
      }

      (BLOCKS[key] || []).forEach((block) => {
        const div = document.createElement('div');
        div.className = 'cal-block';
        div.dataset.blockId = block.id;
        const timeLabel = block.hora_fin ? `${block.hora} – ${block.hora_fin}` : block.hora;
        div.innerHTML = `<div class="ce-line1">${escapeHtml(block.label)}</div><div class="ce-line2">${escapeHtml(timeLabel)}</div>`;
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmDeleteBlock(block.id);
        });
        td.appendChild(div);
      });

      if (isCurMonth || evs.length) hasContent = true;
      tr.appendChild(td);
      day += 1;
    }

    tbody.appendChild(tr);
    if (row >= 4 && !hasContent) {
      tbody.removeChild(tr);
      break;
    }
  }

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const keys = [];
  for (let d = 1; d <= daysInMonth; d += 1) keys.push(`${y}-${m + 1}-${d}`);
  updateSumCards(countEvents(keys));
}

/* ---- Vista Semana ---- */
function getMondayOf(date) {
  const d = new Date(date);
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildWeek(date) {
  const monday = getMondayOf(date);
  const today = new Date();

  const thead = document.getElementById('weekHead');
  const tbody = document.getElementById('weekBody');
  if (!thead || !tbody) return;
  thead.innerHTML = '';

  const headTr = document.createElement('tr');
  const thHora = document.createElement('th');
  thHora.textContent = 'Hora';
  headTr.appendChild(thHora);

  const weekDays = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDays.push(d);
    const th = document.createElement('th');
    if (d.toDateString() === today.toDateString()) th.classList.add('wk-today');
    th.textContent = `${DIAS_CORTO[i]} ${d.getDate()}`;
    headTr.appendChild(th);
  }
  thead.appendChild(headTr);

  const monthLabel = document.getElementById('mesActual');
  const yearLabel = document.getElementById('anioActual');
  if (monthLabel) monthLabel.textContent = MONTHS[monday.getMonth()];
  if (yearLabel) yearLabel.textContent = monday.getFullYear();

  const weekKeys = weekDays.map((d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
  updateSumCards(countEvents(weekKeys));

  tbody.innerHTML = '';
  HOURS.forEach((hr) => {
    const tr = document.createElement('tr');
    const tdHr = document.createElement('td');
    tdHr.className = 'hr-label';
    tdHr.textContent = `${hr}:00`;
    tr.appendChild(tdHr);

    weekDays.forEach((d, i) => {
      const td = document.createElement('td');
      td.className = 'wk-cell';
      if (d.toDateString() === today.toDateString()) td.classList.add('wk-today-col');
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const cellEvents = (EVENTS[key] || []).filter((ev) => ev.h === hr);
      const MAX_VISIBLE = 2;

      td.addEventListener('click', (e) => {
        if (e.target.closest('.wk-event, .wk-block, .wk-more-btn')) return;
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        openAgendarModal(iso, hr);
      });

      cellEvents.slice(0, MAX_VISIBLE).forEach((ev) => {
        const liveCls = recomputeClass(ev, key);
        const div = document.createElement('div');
        div.className = `wk-event ${liveCls}`;
        const name = ev.name || 'Paciente';
        const proc = ev.proc || 'Procedimiento';
        const dispName = displayName(name);
        div.innerHTML = `<div class="wk-line1">${escapeHtml(dispName)}</div><div class="wk-line2">${escapeHtml(proc)}</div>`;
        div.dataset.name = name;
        div.dataset.proc = proc;
        div.dataset.citaId = ev.id || '';
        div.dataset.pacienteId = ev.paciente_id || '';
        div.dataset.deleteUrl = ev.delete_url || '';
        div.dataset.estado = ev.estado || '';
        div.dataset.estadoUrl = ev.estado_url || '';
        div.dataset.reprogramarUrl = ev.reprogramar_url || '';
        div.dataset.cls = liveCls;
        div.dataset.time = ev.hora || (ev.h ? String(ev.h).padStart(2, '0') + ':00' : '');
        div.dataset.duration = ev.duracion || '60';
        div.dataset.fecha = key;
        div.dataset.sala = ev.sala || '';
        div.dataset.notas = ev.notas || '';
        td.appendChild(div);
      });

      if (cellEvents.length > MAX_VISIBLE) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'wk-more-btn';
        moreBtn.textContent = `+${cellEvents.length - MAX_VISIBLE} más`;
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openWeekModal(cellEvents, d, hr, DIAS_CORTO[i]);
        });
        td.appendChild(moreBtn);
      }

      (BLOCKS[key] || []).filter((block) => block.h === hr).forEach((block) => {
        const div = document.createElement('div');
        div.className = 'wk-block';
        div.dataset.blockId = block.id;
        const timeLabel = block.hora_fin ? `${block.hora} – ${block.hora_fin}` : block.hora;
        div.innerHTML = `<div class="wk-line1">${escapeHtml(block.label)}</div><div class="wk-line2">${escapeHtml(timeLabel)}</div>`;
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmDeleteBlock(block.id);
        });
        td.appendChild(div);
      });

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

/* ---- Modal semana ("+X más") ---- */
const STATUS_LABELS = { 'ev-done': 'Completado', 'ev-wait': 'En espera', 'ev-cancel': 'Cancelado', 'ev-soon': 'Próximos' };
const STATUS_BADGE_CLS = { 'ev-done': 'done', 'ev-wait': 'wait', 'ev-cancel': 'cancel', 'ev-soon': 'soon' };

function minutesTo12h(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function time24To12h(time24) {
  const [h, m] = String(time24 || '00:00').split(':').map(Number);
  return minutesTo12h((h || 0) * 60 + (m || 0));
}

function openWeekModal(events, date, hour, dayName) {
  const overlay = document.getElementById('wkModalOverlay');
  const title = document.getElementById('wkModalTitle');
  const body = document.getElementById('wkModalBody');
  if (!overlay || !title || !body) return;

  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const hourLabel = hour !== '' ? time24To12h(`${String(hour).padStart(2, '0')}:00`) : '';
  title.textContent = hourLabel ? `${dayName} ${date.getDate()} – ${hourLabel}` : `${dayName} ${date.getDate()} – Citas del día`;
  body.innerHTML = '';

  events.forEach((ev) => {
    const liveCls = recomputeClass(ev, key);
    const dispName = displayName(ev.name);
    const inits = dispName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const statusKey = liveCls.replace('ev-', '');

    const item = document.createElement('div');
    item.className = 'wk-modal-item';
    item.dataset.name = ev.name || '';
    item.dataset.proc = ev.proc || '';
    item.dataset.cls = liveCls;
    item.dataset.pacienteId = ev.paciente_id || '';
    item.dataset.citaId = ev.id || '';
    item.dataset.deleteUrl = ev.delete_url || '';
    item.dataset.estado = ev.estado || '';
    item.dataset.estadoUrl = ev.estado_url || '';
    item.innerHTML = `
      <div class="wk-modal-avatar">${inits}</div>
      <div class="wk-modal-info">
        <div class="wk-modal-name">${escapeHtml(dispName)}</div>
        <div class="wk-modal-proc">${escapeHtml(ev.proc || '')}</div>
      </div>
      <div class="wk-modal-badge ${statusKey}">${STATUS_LABELS[liveCls] || statusKey}</div>`;
    item.addEventListener('click', () => {
      closeWeekModal();
      setTimeout(() => showPopupForData(parseEventData(item), { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }, key), 150);
    });
    body.appendChild(item);
  });

  overlay.classList.add('open');
}

function closeWeekModal() {
  document.getElementById('wkModalOverlay')?.classList.remove('open');
}

/* ---- Popup hover/click ---- */
function parseEventData(el) {
  const name = el.dataset.name || 'Paciente';
  const dispName = displayName(name);
  return {
    id: el.dataset.citaId || '',
    pacienteId: el.dataset.pacienteId || '',
    deleteUrl: el.dataset.deleteUrl || '',
    estado: el.dataset.estado || '',
    estadoUrl: el.dataset.estadoUrl || '',
    reprogramarUrl: el.dataset.reprogramarUrl || '',
    fullName: name,
    displayName: dispName,
    initials: dispName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    proc: el.dataset.proc || 'Procedimiento',
    time: el.dataset.time || '00:00',
    duration: el.dataset.duration || '60',
    cls: el.dataset.cls || 'ev-soon',
    fecha: el.dataset.fecha || '',
    sala: el.dataset.sala || '',
    notas: el.dataset.notas || '',
  };
}

function positionPopup(e) {
  const evPopup = document.getElementById('evPopup');
  if (!evPopup) return;
  const pw = evPopup.offsetWidth || 230;
  const ph = evPopup.offsetHeight || 200;
  const isPhone = window.innerWidth < 600;
  if (isPhone) {
    evPopup.style.left = '50%';
    evPopup.style.top = '50%';
    evPopup.style.transform = 'translate(-50%,-50%)';
    evPopup.style.width = `${Math.min(300, window.innerWidth - 32)}px`;
  } else {
    evPopup.style.transform = '';
    evPopup.style.width = '';
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + pw > window.innerWidth - 10) x = e.clientX - pw - 14;
    if (y + ph > window.innerHeight - 10) y = e.clientY - ph - 14;
    evPopup.style.left = `${x}px`;
    evPopup.style.top = `${y}px`;
  }
}

const STATUS_BUTTONS = {
  'ev-done': [{ label: 'Datos del paciente', cls: 'primary' }, { label: 'Reprogramar', cls: 'secondary' }, { label: 'Ver Informe', cls: 'secondary' }],
  'ev-wait': [{ label: 'Iniciar Estudio', cls: 'primary' }, { label: 'Datos del paciente', cls: 'secondary' }, { label: 'Reprogramar', cls: 'secondary' }],
  'ev-cancel': [{ label: 'Reprogramar', cls: 'primary' }, { label: 'Datos del paciente', cls: 'secondary' }],
  'ev-soon': [{ label: 'Reprogramar', cls: 'primary' }, { label: 'Datos del paciente', cls: 'secondary' }],
};

function navigateHash(route) {
  window.location.hash = route;
}

function showPopupForData(d, e, dateKey) {
  const evPopup = document.getElementById('evPopup');
  const evPopAvatar = document.getElementById('evPopAvatar');
  const evPopName = document.getElementById('evPopName');
  const evPopDate = document.getElementById('evPopDate');
  const evPopInfo = document.getElementById('evPopInfo');
  const evPopBadge = document.getElementById('evPopBadge');
  const evPopBtns = document.getElementById('evPopBtns');
  if (!evPopup) return;

  let liveCls = d.cls;
  if (dateKey) {
    const [h] = String(d.time || '00:00').split(':').map(Number);
    liveCls = recomputeClass({ cls: d.cls, estado: d.estado, hora: d.time, h: h || 0 }, dateKey);
  }

  const [h, m] = String(d.time || '00:00').split(':').map(Number);
  const startMin = (h || 0) * 60 + (m || 0);
  const duration = parseInt(d.duration || '60', 10) || 60;
  const timeRange = `${time24To12h(d.time)} – ${minutesTo12h(startMin + duration)}`;

  let fechaTxt = '';
  if (dateKey) {
    const [yy, mm, dd] = dateKey.split('-').map(Number);
    const dObj = new Date(yy, mm - 1, dd);
    fechaTxt = `${DIAS_ES[dObj.getDay()]} ${dd} de ${MONTHS[mm - 1]}`;
  }

  evPopAvatar.textContent = d.initials;
  evPopName.textContent = d.displayName || d.fullName;
  evPopDate.innerHTML = fechaTxt ? `<b>Fecha:</b> ${escapeHtml(fechaTxt)}` : '';
  evPopInfo.innerHTML = `<b>Motivo:</b> ${escapeHtml(d.proc)}<br><b>Tiempo:</b> ${timeRange}<br><b>Habitación:</b> Sala 3`;
  const badgeCls = STATUS_BADGE_CLS[liveCls] || 'done';
  evPopBadge.className = `ev-pop-badge ${badgeCls}`;
  evPopBadge.textContent = STATUS_LABELS[liveCls] || '';
  evPopBadge.style.display = 'inline-flex';
  evPopBtns.innerHTML = '';

  (STATUS_BUTTONS[liveCls] || STATUS_BUTTONS['ev-soon']).forEach((b) => {
    const btn = document.createElement('button');
    btn.className = `ev-pop-btn ${b.cls}`;
    btn.textContent = b.label;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hidePopup();
      if (b.label === 'Datos del paciente') {
        sessionStorage.setItem('enclaii-open-patient-id', d.pacienteId || '');
        navigateHash('pacientes');
      } else if (b.label === 'Iniciar Estudio') {
        sessionStorage.setItem('enclaii-open-patient-id', d.pacienteId || '');
        navigateHash('pacientes');
      } else if (b.label === 'Ver Informe') {
        navigateHash('ia-reportes');
      } else if (b.label === 'Reprogramar') {
        openReprogramarScreen(d);
      }
    });
    evPopBtns.appendChild(btn);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'ev-pop-btn danger';
  const puedeEliminar = ['cancelado', 'completado'].includes(d.estado);
  delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>${puedeEliminar ? 'Eliminar cita' : 'Cancelar cita'}`;
  delBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    hidePopup();
    const url = puedeEliminar ? d.deleteUrl : d.estadoUrl;
    if (!url) return;
    try {
      const headers = { Accept: 'application/json' };
      const authorization = authHeader();
      if (authorization) headers.Authorization = authorization;
      const response = await laravelFetch(url, {
        method: puedeEliminar ? 'DELETE' : 'PATCH',
        headers: puedeEliminar ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: puedeEliminar ? undefined : JSON.stringify({ estado: 'cancelado' }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadAgendaFromLaravel(document.getElementById('pageContent'));
    } catch (error) {
      console.error(error);
      window.alert('No se pudo actualizar la cita. Verifica tu conexión con Laravel.');
    }
  });
  evPopBtns.appendChild(delBtn);

  positionPopup(e);
  evPopup.classList.add('visible');
}

function hidePopup() {
  popupAnchoredEl = null;
  document.getElementById('evPopup')?.classList.remove('visible');
}

function scheduleHidePopup() {
  if (popupCloseTimer) clearTimeout(popupCloseTimer);
  popupCloseTimer = setTimeout(() => {
    const evPopup = document.getElementById('evPopup');
    if (!evPopup?.matches(':hover') && !popupAnchoredEl?.matches(':hover')) hidePopup();
  }, 200);
}

function cancelHidePopup() {
  if (popupCloseTimer) { clearTimeout(popupCloseTimer); popupCloseTimer = null; }
}

function showPopupFromElement(el, e) {
  const d = parseEventData(el);
  const td = el.closest('td');
  let dateKey = null;
  const dn = td?.querySelector('.day-num');
  if (dn && curView === 'mes') {
    const day = parseInt(dn.textContent, 10);
    dateKey = `${visibleDate.getFullYear()}-${visibleDate.getMonth() + 1}-${day}`;
  } else if (curView === 'semana' && td) {
    const tr = td.closest('tr');
    const colIdx = Array.from(tr.children).indexOf(td) - 1;
    const monday = getMondayOf(visibleDate);
    const d2 = new Date(monday);
    d2.setDate(monday.getDate() + colIdx);
    dateKey = `${d2.getFullYear()}-${d2.getMonth() + 1}-${d2.getDate()}`;
  }
  showPopupForData(d, e, dateKey);
}

function initPopupEvents() {
  document.addEventListener('mouseover', (e) => {
    if (window.innerWidth < 600) return;
    const ev = e.target.closest('.cal-event, .wk-event');
    if (ev) {
      cancelHidePopup();
      if (popupAnchoredEl !== ev) { popupAnchoredEl = ev; showPopupFromElement(ev, e); }
      return;
    }
    if (e.target.closest('#evPopup')) { cancelHidePopup(); return; }
    scheduleHidePopup();
  });

  document.getElementById('evPopup')?.addEventListener('mouseenter', cancelHidePopup);
  document.getElementById('evPopup')?.addEventListener('mouseleave', scheduleHidePopup);

  document.addEventListener('click', (e) => {
    const ev = e.target.closest('.cal-event, .wk-event');
    if (ev) {
      e.stopPropagation();
      if (popupAnchoredEl === ev) { hidePopup(); return; }
      popupAnchoredEl = ev;
      showPopupFromElement(ev, e);
      return;
    }
    if (e.target.closest('#evPopup')) return;
    hidePopup();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePopup();
  });
}

/* ---- Sidebar: próximas citas ---- */
function buildProximas() {
  const list = document.getElementById('proxList');
  if (!list) return;

  const now = new Date();
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items = [];

  Object.entries(EVENTS).forEach(([key, evs]) => {
    const [y, m, d] = key.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (dateObj < hoy) return;

    evs.forEach((ev) => {
      const liveCls = recomputeClass(ev, key);
      if (liveCls !== 'ev-wait' && liveCls !== 'ev-soon') return;
      items.push({ dateObj, ev, liveCls, name: ev.name, proc: ev.proc, h: ev.hora || `${ev.h}:00` });
    });
  });

  items.sort((a, b) => (a.dateObj - b.dateObj) || String(a.h).localeCompare(String(b.h)));

  if (!items.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt-soft);font-size:12px">No hay citas próximas agendadas</div>';
    return;
  }

  list.innerHTML = items.slice(0, 6).map((item) => {
    const dispName = displayName(item.name);
    return `
      <div class="prox-item">
        <div class="prox-time">
          <span class="h">${escapeHtml(String(item.h).slice(0, 5))}</span>
          <span class="m">${String(item.dateObj.getDate()).padStart(2, '0')}</span>
        </div>
        <div class="prox-info">
          <div class="prox-name">${escapeHtml(dispName)}</div>
          <div class="prox-study">${escapeHtml(item.proc)}</div>
        </div>
      </div>`;
  }).join('');
}

/* ---- Filtros ---- */
function applyAgendaFilters() {
  const states = {};
  document.querySelectorAll('[data-filter]').forEach((input) => {
    const row = input.closest('[data-filter]');
    const cls = row?.dataset.filter;
    if (!cls) return;
    const checkbox = row.querySelector('input[type=checkbox]');
    if (checkbox) states[cls] = checkbox.checked;
  });
  Object.entries(states).forEach(([cls, checked]) => {
    document.querySelectorAll(`.${cls}`).forEach((el) => {
      el.style.display = checked ? '' : 'none';
    });
    document.querySelectorAll(`[data-filter="${cls}"] input[type=checkbox]`).forEach((cb) => {
      cb.checked = checked;
    });
  });
}

function syncFilterCheckboxes(e) {
  const target = e.target;
  if (target.tagName !== 'INPUT') return;
  const row = target.closest('[data-filter]');
  const cls = row?.dataset.filter;
  if (!cls) return;
  document.querySelectorAll(`[data-filter="${cls}"] input[type=checkbox]`).forEach((cb) => {
    cb.checked = target.checked;
  });
  applyAgendaFilters();
}

/* ---- Render orquestador ---- */
function rebuildCurrentView() {
  if (curView === 'mes') buildCal(visibleDate);
  else buildWeek(visibleDate);
  buildProximas();
  applyAgendaFilters();
}

function setAgendaLoading() {
  const calendarBody = document.getElementById('calBody');
  if (calendarBody) {
    calendarBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px 20px;color:var(--txt-soft)">Cargando agenda desde Laravel...</td></tr>';
  }
  const list = document.getElementById('proxList');
  if (list) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt-soft);font-size:12px">Conectando con Laravel</div>';
  }
}

function restoreAgendaShell(root) {
  if (!root.querySelector('#calBody') && agendaTemplate) {
    root.innerHTML = agendaTemplate;
    bindAgendaEvents(root);
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
      sessionStorage.setItem('enclaii-tauri-basic-auth', token);
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
  const headers = { Accept: 'application/json' };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;

  const response = await laravelFetch(agendaEndpointForVisibleMonth(), { headers, credentials: 'include' });
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

  return { citas: payload.citas || [], bloqueos: payload.bloqueos || [] };
}

async function loadAgendaFromLaravel(root) {
  restoreAgendaShell(root);
  setAgendaLoading();

  try {
    const { citas, bloqueos } = await fetchLaravelAgenda();
    EVENTS = buildEventsFromCitas(citas);
    BLOCKS = buildBlocksFromBloqueos(bloqueos);
    rebuildCurrentView();
  } catch (error) {
    console.error(error);
    if (error.code === 'UNAUTHORIZED') {
      sessionStorage.removeItem('enclaii-tauri-basic-auth');
    }
    renderAgendaError(root, error);
  }
}

/* ---- Bloqueos: eliminar ---- */
async function deleteBlock(blockId) {
  const headers = { Accept: 'application/json' };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;

  const response = await laravelFetch(`${BLOQUEOS_ENDPOINT}/${blockId}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function confirmDeleteBlock(blockId) {
  if (!blockId) return;
  if (!window.confirm('¿Eliminar este bloqueo de horario?')) return;

  deleteBlock(blockId)
    .then(() => loadAgendaFromLaravel(document.getElementById('pageContent')))
    .catch((error) => {
      console.error(error);
      window.alert('No se pudo eliminar el bloqueo. Verifica tu conexión con Laravel.');
    });
}

/* ---- Navegar a la pantalla completa de "Agendar cita" ---- */
function openAgendarModal(prefillDate = null, prefillHour = null) {
  const prefill = { mode: 'create' };
  if (prefillDate) prefill.fecha = prefillDate;
  if (prefillHour !== null && prefillHour !== undefined) {
    prefill.hora = `${String(prefillHour).padStart(2, '0')}:00`;
  }
  sessionStorage.setItem(AGENDAR_PREFILL_STORAGE_KEY, JSON.stringify(prefill));
  navigateHash('agendar');
}

function openReprogramarScreen(d) {
  const prefill = {
    mode: 'edit',
    cita: {
      id: d.id,
      pacienteId: d.pacienteId || null,
      pacienteNombre: d.fullName || d.displayName || '',
      procedimiento: d.proc || '',
      fecha: d.fecha || null,
      hora: d.time || null,
      horaTexto: d.time ? time24To12h(d.time) : '',
      fechaTexto: d.fechaTexto || '',
      duracion: d.duration || 60,
      sala: d.sala || '',
      notas: d.notas || '',
    },
  };
  sessionStorage.setItem(AGENDAR_PREFILL_STORAGE_KEY, JSON.stringify(prefill));
  navigateHash('agendar');
}

/* ---- Modal: Bloquear horario ---- */
function openBloqueoModal() {
  const overlay = document.getElementById('bloqueoModalOverlay');
  const form = document.getElementById('bloqueoForm');
  const errorBox = document.getElementById('bloqueoError');
  if (!overlay || !form) return;
  form.reset();
  errorBox?.classList.remove('visible');
  overlay.classList.add('open');
}

function closeBloqueoModal() {
  document.getElementById('bloqueoModalOverlay')?.classList.remove('open');
}

function datesInRange(start, end) {
  const dates = [];
  const cursor = new Date(start);
  const last = new Date(end);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function handleBloqueoSubmit(event, root) {
  event.preventDefault();
  const errorBox = document.getElementById('bloqueoError');
  const submitBtn = document.getElementById('bloqueoSubmitBtn');
  errorBox.classList.remove('visible');

  const fechaInicio = document.getElementById('bloqueoFechaInicio').value;
  const fechaFin = document.getElementById('bloqueoFechaFin').value || fechaInicio;
  const hora = document.getElementById('bloqueoHoraInicio').value;
  const horaFin = document.getElementById('bloqueoHoraFin').value || null;

  if (!fechaInicio || !hora) {
    errorBox.textContent = 'Selecciona al menos la fecha y la hora de inicio.';
    errorBox.classList.add('visible');
    return;
  }

  const fechas = datesInRange(fechaInicio, fechaFin);
  const body = {
    label: document.getElementById('bloqueoLabel').value.trim() || null,
    fechas,
    hora,
    hora_fin: horaFin,
  };

  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;

  submitBtn.disabled = true;
  try {
    const response = await laravelFetch(BLOQUEOS_ENDPOINT, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.message || `Laravel respondio HTTP ${response.status}.`);
    }
    closeBloqueoModal();
    await loadAgendaFromLaravel(root);
  } catch (error) {
    console.error(error);
    errorBox.textContent = error.message || 'No se pudo registrar el bloqueo.';
    errorBox.classList.add('visible');
  } finally {
    submitBtn.disabled = false;
  }
}

function setView(view, root) {
  curView = view;
  document.getElementById('calWrap')?.classList.toggle('active', view === 'mes');
  document.getElementById('weekGrid')?.classList.toggle('active', view === 'semana');
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  rebuildCurrentView();
}

function bindAgendaEvents(root) {
  document.getElementById('prevMonth')?.addEventListener('click', async () => {
    if (curView === 'mes') {
      visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() - 1, 1);
    } else {
      visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth(), visibleDate.getDate() - 7);
    }
    await loadAgendaFromLaravel(root);
  });

  document.getElementById('nextMonth')?.addEventListener('click', async () => {
    if (curView === 'mes') {
      visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() + 1, 1);
    } else {
      visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth(), visibleDate.getDate() + 7);
    }
    await loadAgendaFromLaravel(root);
  });

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view, root));
  });

  document.querySelectorAll('[data-filter] input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', syncFilterCheckboxes);
  });

  document.getElementById('wkModalClose')?.addEventListener('click', closeWeekModal);
  document.getElementById('wkModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'wkModalOverlay') closeWeekModal();
  });

  document.getElementById('openAgendarBtn')?.addEventListener('click', () => openAgendarModal());

  document.getElementById('openBloqueoBtn')?.addEventListener('click', openBloqueoModal);
  document.getElementById('bloqueoModalClose')?.addEventListener('click', closeBloqueoModal);
  document.getElementById('bloqueoCancelBtn')?.addEventListener('click', closeBloqueoModal);
  document.getElementById('bloqueoModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bloqueoModalOverlay') closeBloqueoModal();
  });
  document.getElementById('bloqueoForm')?.addEventListener('submit', (e) => handleBloqueoSubmit(e, root));

  const toolbarFilterBtn = document.getElementById('toolbarFilterBtn');
  const toolbarFilterDropdown = document.getElementById('toolbarFilterDropdown');
  if (toolbarFilterBtn && toolbarFilterDropdown) {
    toolbarFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toolbarFilterDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => toolbarFilterDropdown.classList.remove('open'));
    toolbarFilterDropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  const mesPicker = document.getElementById('mesPicker');
  const anioPicker = document.getElementById('anioPicker');
  const mesSpan = document.getElementById('mesActual');
  const anioSpan = document.getElementById('anioActual');
  function closePickers() { mesPicker?.classList.remove('open'); anioPicker?.classList.remove('open'); }
  function buildMesPicker() {
    if (!mesPicker) return;
    mesPicker.querySelectorAll('.picker-item').forEach((el) => el.remove());
    MONTHS.forEach((nombre, idx) => {
      const btn = document.createElement('button');
      btn.className = `picker-item${visibleDate.getMonth() === idx ? ' active' : ''}`;
      btn.textContent = nombre;
      btn.addEventListener('click', async () => {
        visibleDate = new Date(visibleDate.getFullYear(), idx, 1);
        closePickers();
        await loadAgendaFromLaravel(root);
      });
      mesPicker.appendChild(btn);
    });
  }
  function buildAnioPicker() {
    if (!anioPicker) return;
    anioPicker.querySelectorAll('.picker-item').forEach((el) => el.remove());
    const currentY = visibleDate.getFullYear();
    for (let y = currentY + 5; y >= currentY - 5; y -= 1) {
      const btn = document.createElement('button');
      btn.className = `picker-item${y === currentY ? ' active' : ''}`;
      btn.textContent = y;
      btn.addEventListener('click', async () => {
        visibleDate = new Date(y, visibleDate.getMonth(), 1);
        closePickers();
        await loadAgendaFromLaravel(root);
      });
      anioPicker.appendChild(btn);
    }
  }
  mesSpan?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = mesPicker?.classList.contains('open');
    closePickers();
    if (!open) { buildMesPicker(); mesPicker?.classList.add('open'); }
  });
  anioSpan?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = anioPicker?.classList.contains('open');
    closePickers();
    if (!open) { buildAnioPicker(); anioPicker?.classList.add('open'); }
  });
  document.addEventListener('click', closePickers);

  const agendaExpandBtn = document.getElementById('agendaExpandBtn');
  const agLeft = document.querySelector('.agenda-left');
  agendaExpandBtn?.addEventListener('click', () => {
    agLeft?.classList.toggle('expanded');
    if (!agLeft?.classList.contains('expanded')) toolbarFilterDropdown?.classList.remove('open');
  });
}

export async function initAgenda() {
  const root = document.getElementById('pageContent');
  if (!root) return;

  const token = sessionStorage.getItem('enclaii-tauri-basic-auth');
  if (!token) {
    renderLaravelLogin(root, 'Inicia sesión para acceder a la agenda.');
    return;
  }

  visibleDate = new Date();
  visibleDate.setDate(1);
  curView = 'mes';
  EVENTS = {};
  agendaTemplate = root.innerHTML;
  bindAgendaEvents(root);
  initPopupEvents();
  await loadAgendaFromLaravel(root);

  setInterval(() => {
    if (!document.getElementById('calBody')) return;
    rebuildCurrentView();
  }, 30000);
}
