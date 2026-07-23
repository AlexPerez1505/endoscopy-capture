// ================= Agendar cita (pantalla completa) =================
// Port 1:1 del flujo de Laravel (resources/views/agenda/agendar) a la SPA de Tauri.

import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from '../../laravel.js';
import { authHeader } from '../../auth.js';
import { escapeHtml } from '../../html.js';
import {
  AGENDAR_PREFILL_STORAGE_KEY,
  OPEN_PATIENT_ID_STORAGE_KEY,
} from '../../storage-keys.js';

const CITAS_ENDPOINT = `${apiBaseUrl()}/api/tauri/agenda/citas`;
const AGENDA_ENDPOINT = `${apiBaseUrl()}/api/tauri/agenda`;
const SALAS_ENDPOINT = `${apiBaseUrl()}/api/tauri/agenda/salas`;
const PATIENTS_ENDPOINT = `${apiBaseUrl()}/api/tauri/pacientes`;

const MESES_AG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_AG = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const DIAS_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

const DAY_START = 8;
const DAY_END = 24;
const TIMELINE_SEGMENTS = 32;

let timeStepInterval = null;

function jsonHeaders() {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;
  return headers;
}

function plainHeaders() {
  const headers = { Accept: 'application/json' };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;
  return headers;
}

/* =========================================================
   ESTADO
========================================================= */

const state = {
  patients: [],
  selectedPatientId: null,
  selectedPatientName: '',
  salas: [],
  monthEvents: {}, // key `y-m-d` -> [{hora, duracion, sala, id}]
  loadedMonthKey: '',
  agY: new Date().getFullYear(),
  agM: new Date().getMonth(),
  agSelected: null, // {y,m,d}
  selectedTime: null, // minutos desde 00:00
  editing: null, // { id, update_url } cuando se reprograma una cita existente
};

/* =========================================================
   DATOS: pacientes, salas, citas del mes
========================================================= */

function normalizePatient(raw = {}) {
  const nombre = String(raw.nombre_completo || raw.nombre || raw.name || 'Paciente sin nombre').trim();
  const partes = nombre.split(/\s+/).filter(Boolean);
  const iniciales = partes.length >= 2
    ? (partes[0][0] + partes[1][0]).toUpperCase()
    : nombre.slice(0, 2).toUpperCase();

  return {
    id: raw.id,
    nombre,
    folio: raw.folio || '',
    edad: raw.edad || '',
    genero: raw.sexo ? String(raw.sexo).charAt(0).toUpperCase() + String(raw.sexo).slice(1) : 'No especificado',
    nac: raw.fecha_nacimiento || '',
    tel: raw.telefono || '',
    email: raw.email || '',
    dir: raw.direccion || '',
    foto_url: firstLaravelAssetUrl(raw, [
      'foto_url',
      'photo_url',
      'avatar_url',
      'profile_photo_url',
      'fotografia_url',
      'imagen_url',
      'image_url',
      'foto_perfil_url',
      'url_foto',
      'url_imagen',
      'foto',
      'photo',
      'avatar',
      'fotografia',
      'imagen',
      'image',
      'foto_perfil',
      'profile_photo',
      'profile_photo_path',
      'avatar_path',
      'photo_path',
      'foto_path',
      'ruta_foto',
      'ruta_imagen',
    ]),
    iniciales,
    medico: raw.medico || '',
    procedimiento: raw.procedimiento || '',
  };
}

async function fetchPatients() {
  const response = await laravelFetch(`${PATIENTS_ENDPOINT}?per_page=100`, {
    headers: plainHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const list = Array.isArray(payload?.pacientes)
    ? payload.pacientes
    : Array.isArray(payload?.patients)
      ? payload.patients
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return list.map(normalizePatient);
}

async function fetchSalas() {
  try {
    const response = await laravelFetch(SALAS_ENDPOINT, { headers: plainHeaders(), credentials: 'include' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.salas) ? payload.salas : [];
  } catch (_) {
    return [];
  }
}

function monthKeyFor(y, m) {
  return `${y}-${m}`;
}

async function fetchAgendaMonth(y, m) {
  const key = monthKeyFor(y, m);
  if (state.loadedMonthKey === key) return;

  const params = new URLSearchParams({ year: String(y), month: String(m + 1) });
  const response = await laravelFetch(`${AGENDA_ENDPOINT}?${params.toString()}`, {
    headers: plainHeaders(),
    credentials: 'include',
  });
  if (!response.ok) return;
  const payload = await response.json();
  const citas = payload?.citas || payload?.appointments || [];

  const map = {};
  citas.forEach((cita) => {
    if (!cita.fecha_key) return;
    map[cita.fecha_key] = map[cita.fecha_key] || [];
    map[cita.fecha_key].push({
      id: cita.id,
      hora: cita.hora_label || cita.hora || '00:00',
      duracion: cita.duracion_minutos ?? 60,
      sala: cita.sala || 'Sala 3',
      cls: cita.cls || 'ev-soon',
    });
  });

  state.monthEvents = map;
  state.loadedMonthKey = key;
}

function getDayEvents(y, m, d) {
  const key = `${y}-${m + 1}-${d}`;
  const events = state.monthEvents[key] || [];
  const currentId = state.editing?.id ? String(state.editing.id) : null;
  return events.filter((ev) => !(currentId && String(ev.id || '') === currentId));
}

function parseEventRange(ev) {
  const [h, m] = String(ev.hora || '00:00').split(':').map(Number);
  const start = (h || 0) * 60 + (m || 0);
  const duration = parseInt(ev.duracion || 60, 10);
  return { start, end: start + duration, sala: ev.sala, cls: ev.cls };
}

/* =========================================================
   PASO 1: PACIENTE
========================================================= */

function normalizeSearch(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findPatients(query) {
  if (!query || query.trim().length < 1) return [];
  const q = normalizeSearch(query.trim());
  return state.patients.filter((p) => (
    normalizeSearch(p.nombre).includes(q)
    || normalizeSearch(p.folio).includes(q)
    || normalizeSearch(p.tel).includes(q)
    || normalizeSearch(p.email).includes(q)
  ));
}

function findPatientByName(query) {
  return findPatients(query)[0] || state.patients.find((p) => p.nombre === query) || null;
}

function fillSelect(select, rawValue, fallbackLabel) {
  if (!select) return;
  select.innerHTML = '';
  const values = rawValue
    ? String(rawValue).split(/[,;]+/).map((v) => v.trim()).filter(Boolean)
    : [];
  if (values.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = fallbackLabel;
    opt.value = '';
    select.appendChild(opt);
  } else {
    values.forEach((val, i) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      if (i === 0) opt.selected = true;
      select.appendChild(opt);
    });
  }
  select.dispatchEvent(new Event('change'));
}

function updateCitaFromPatient(pac) {
  fillSelect(document.getElementById('citaEspecialista'), pac?.medico, 'Sin médico asignado');
  fillSelect(document.getElementById('citaProcedimiento'), pac?.procedimiento, 'Sin procedimiento asignado');
}

async function renderPatientAvatar(avatar, pac) {
  if (!avatar) {
    return;
  }

  const initials =
    pac?.iniciales || 'PX';

  if (!pac?.foto_url) {
    avatar.textContent = initials;
    return;
  }

  const requestId =
    `${Date.now()}-${Math.random()}`;

  avatar.dataset.photoRequestId =
    requestId;
  avatar.textContent =
    initials;

  try {
    const localUrl =
      await authenticatedLaravelAssetUrl(
        pac.foto_url,
        {
          accept: 'image/*,*/*',
        }
      );

    if (
      avatar.dataset.photoRequestId !==
      requestId
    ) {
      return;
    }

    avatar.innerHTML = `
      <img
        src="${escapeHtml(localUrl)}"
        alt="${escapeHtml(pac.nombre || 'Paciente')}"
      >
    `;
  } catch (error) {
    console.warn(
      'No se pudo cargar la foto del paciente:',
      error
    );

    if (
      avatar.dataset.photoRequestId ===
      requestId
    ) {
      avatar.textContent =
        initials;
    }
  }
}

function updatePacResult(pac) {
  if (!pac) return;
  state.selectedPatientId = pac.id || null;
  state.selectedPatientName = pac.nombre || '';

  const avatar = document.getElementById('pacAvatar');
  renderPatientAvatar(avatar, pac);

  document.getElementById('pacName').textContent = pac.nombre || 'Paciente';
  document.getElementById('pacFolio').textContent = `Folio: ${pac.folio || 'Sin folio'}`;
  document.getElementById('pacAge').textContent = pac.edad ? `${pac.edad} años` : 'Sin edad';
  document.getElementById('pacGenero').textContent = pac.genero || 'No especificado';
  document.getElementById('pacNac').textContent = pac.nac || 'Sin fecha';

  const telEl = document.getElementById('pacTel');
  const emailEl = document.getElementById('pacEmail');
  const dirEl = document.getElementById('pacDir');
  if (telEl) telEl.value = pac.tel || '';
  if (emailEl) emailEl.value = pac.email || '';
  if (dirEl) dirEl.value = pac.dir || '';

  updateCitaFromPatient(pac);

  const cfmPaciente = document.getElementById('cfmPaciente');
  if (cfmPaciente) cfmPaciente.textContent = pac.nombre || 'Paciente';
}

function renderSuggestions(list, suggestionsEl, onSelect) {
  suggestionsEl.innerHTML = '';
  if (!list.length) {
    suggestionsEl.classList.remove('open');
    return;
  }
  list.slice(0, 20).forEach((p) => {
    const div = document.createElement('div');
    div.className = 'pac-suggestion';
    div.innerHTML = `<span>${escapeHtml(p.nombre)}</span><span class="sug-folio">Folio ${escapeHtml(p.folio || 'S/F')}</span>`;
    div.addEventListener('click', () => onSelect(p));
    suggestionsEl.appendChild(div);
  });
  suggestionsEl.classList.add('open');
}

function selectPatient(pac, searchInput, suggestionsEl) {
  updatePacResult(pac);
  if (searchInput) searchInput.value = pac.nombre;
  suggestionsEl.classList.remove('open');
}

function bindPacienteStep() {
  const chevron = document.getElementById('pacChevron');
  const fields = document.getElementById('pacFields');
  let expanded = true;
  chevron?.addEventListener('click', () => {
    expanded = !expanded;
    fields.style.display = expanded ? '' : 'none';
    chevron.style.transform = expanded ? 'rotate(180deg)' : '';
  });

  const searchInput = document.getElementById('pacSearch');
  const suggestions = document.getElementById('pacSuggestions');

  searchInput?.addEventListener('input', () => {
    renderSuggestions(findPatients(searchInput.value), suggestions, (p) => selectPatient(p, searchInput, suggestions));
    const cfmPaciente = document.getElementById('cfmPaciente');
    if (cfmPaciente) cfmPaciente.textContent = searchInput.value || 'Paciente';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pac-search-wrap')) suggestions.classList.remove('open');
  });

  const historyLink = document.getElementById('pacHistoryLink');
  historyLink?.addEventListener('click', () => {
    if (state.selectedPatientId) {
      sessionStorage.setItem(OPEN_PATIENT_ID_STORAGE_KEY, String(state.selectedPatientId));
    }
  });
}

/* =========================================================
   PASO 2: CITA (doctor, procedimiento, sala)
========================================================= */

function hora12ToMinutes(hora) {
  const value = String(hora || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : '';
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function overlapsRoom(start, end, ranges, salaNombre) {
  return ranges.some((r) => {
    if (String(r.sala || '') !== String(salaNombre || '')) return false;
    return start < r.end && end > r.start;
  });
}

function updateSalasDisponibles() {
  const select = document.getElementById('citaSala');
  const fechaInput = document.getElementById('citaFecha');
  const horaInput = document.getElementById('citaHora');
  const duracionInput = document.getElementById('citaDuracion');
  if (!select || !state.agSelected) return;

  const start = hora12ToMinutes(horaInput?.value);
  if (start === null) return;
  const duracion = parseInt(duracionInput?.value, 10) || 60;
  const end = start + duracion;
  const ranges = getDayEvents(state.agSelected.y, state.agSelected.m, state.agSelected.d).map(parseEventRange);

  Array.from(select.options).forEach((opt) => {
    if (!opt.value) return;
    const ocupada = overlapsRoom(start, end, ranges, opt.textContent.trim());
    opt.disabled = ocupada;
    if (ocupada && select.value === opt.value) select.value = '';
  });
}

async function populateSalas() {
  const select = document.getElementById('citaSala');
  if (!select) return;
  state.salas = await fetchSalas();
  select.innerHTML = '<option value="">Seleccione una sala</option>';
  state.salas.forEach((sala) => {
    const opt = document.createElement('option');
    opt.value = sala.nombre;
    opt.textContent = sala.nombre;
    select.appendChild(opt);
  });
  if (!state.salas.length) {
    const opt = document.createElement('option');
    opt.value = 'Sala 3';
    opt.textContent = 'Sala 3';
    select.appendChild(opt);
  }
}

function bindCitaStep() {
  document.getElementById('citaEspecialista')?.addEventListener('change', function onChange() {
    document.getElementById('cfmEspecialista').textContent = this.value || 'Especialista';
  });
  document.getElementById('citaProcedimiento')?.addEventListener('change', function onChange() {
    document.getElementById('cfmProcedimiento').textContent = this.value || 'Procedimiento';
  });
  document.getElementById('citaSala')?.addEventListener('change', function onChange() {
    const selected = this.options[this.selectedIndex];
    document.getElementById('cfmSala').textContent = selected?.textContent?.trim() || 'Sala';
  });
}

/* =========================================================
   PASO 3: CALENDARIO Y HORARIO
========================================================= */

function formatTime24(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime12(minutes) {
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isSelectedToday() {
  const today = new Date();
  return state.agSelected
    && state.agSelected.y === today.getFullYear()
    && state.agSelected.m === today.getMonth()
    && state.agSelected.d === today.getDate();
}

function getMinSelectableMinutes() {
  return isSelectedToday() ? Math.max(DAY_START * 60, getNowMinutes()) : DAY_START * 60;
}

function getSelectedMinutes() {
  let hh = parseInt(document.getElementById('timeHour')?.value, 10);
  let mm = parseInt(document.getElementById('timeMin')?.value, 10);
  if (Number.isNaN(hh)) hh = DAY_START;
  if (Number.isNaN(mm)) mm = 0;
  hh = Math.max(DAY_START, Math.min(23, hh));
  mm = Math.max(0, Math.min(59, mm));
  return Math.max(hh * 60 + mm, getMinSelectableMinutes());
}

function setSelectedMinutes(minutes) {
  const min = getMinSelectableMinutes();
  const max = 23 * 60 + 59;
  const clamped = Math.max(min, Math.min(max, minutes));
  const h24 = Math.floor(clamped / 60);
  const mm = clamped % 60;
  const hourInput = document.getElementById('timeHour');
  const minInput = document.getElementById('timeMin');
  if (hourInput) hourInput.value = String(h24).padStart(2, '0');
  if (minInput) minInput.value = String(mm).padStart(2, '0');
}

function getDuration() {
  const start = getSelectedMinutes();
  const d = parseInt(document.getElementById('citaDuracion')?.value, 10);
  const raw = Number.isFinite(d) && d > 0 ? d : 60;
  const maxDur = DAY_END * 60 - start;
  return Math.max(1, Math.min(maxDur, raw));
}

function changeDuration(delta) {
  const input = document.getElementById('citaDuracion');
  if (!input) return;
  const start = getSelectedMinutes();
  const maxDur = DAY_END * 60 - start;
  let val = parseInt(input.value, 10) || 60;
  val = Math.max(1, Math.min(maxDur, val + delta));
  input.value = val;
  onTimeOrDurationChanged();
}

function overlapsAny(start, end, ranges) {
  return ranges.some((r) => start < r.end && end > r.start);
}

function validateTime() {
  const start = getSelectedMinutes();
  const end = start + getDuration();
  const ranges = state.agSelected ? getDayEvents(state.agSelected.y, state.agSelected.m, state.agSelected.d).map(parseEventRange) : [];
  const statusEl = document.getElementById('timeStatus');
  if (!statusEl) return true;

  if (start < getMinSelectableMinutes()) {
    statusEl.className = 'time-status bad';
    statusEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Horario pasado';
    return false;
  }
  if (overlapsAny(start, end, ranges)) {
    statusEl.className = 'time-status bad';
    statusEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Horario ocupado';
    return false;
  }
  statusEl.className = 'time-status ok';
  statusEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>¡Horario disponible!';
  return true;
}

function updateEndTime() {
  const end = getSelectedMinutes() + getDuration();
  const el = document.getElementById('timeEnd');
  if (el) el.textContent = formatTime24(end);
}

function updateTimelineCursor() {
  const start = getSelectedMinutes();
  const total = (DAY_END - DAY_START) * 60;
  const left = Math.max(0, Math.min(100, ((start - DAY_START * 60) / total) * 100));
  const cursor = document.getElementById('timelineCursor');
  if (cursor) cursor.style.left = `${left}%`;
}

function updateTimelineSelection() {
  const sel = document.getElementById('timelineSelection');
  if (!sel) return;
  const start = getSelectedMinutes();
  const end = start + getDuration();
  const dayStart = DAY_START * 60;
  const dayEnd = DAY_END * 60;
  const visibleStart = Math.max(dayStart, start);
  const visibleEnd = Math.min(dayEnd, end);
  if (visibleStart >= visibleEnd) {
    sel.style.display = 'none';
    return;
  }
  sel.style.display = 'block';
  const total = dayEnd - dayStart;
  sel.style.left = `${((visibleStart - dayStart) / total) * 100}%`;
  sel.style.width = `${((visibleEnd - visibleStart) / total) * 100}%`;
}

function getSegmentStatus(midMinutes, ranges) {
  const hit = ranges.find((r) => midMinutes >= r.start && midMinutes < r.end);
  return hit ? 'busy' : 'free';
}

function renderTimelineLabels() {
  const el = document.getElementById('timelineLabels');
  if (!el) return;
  el.innerHTML = '';
  for (let h = DAY_START; h <= DAY_END; h += 2) {
    const span = document.createElement('span');
    span.textContent = h === 24 ? '0:00' : `${h}:00`;
    el.appendChild(span);
  }
}

function renderTimeline(y, m, d) {
  const bar = document.getElementById('timelineBar');
  const cursor = document.getElementById('timelineCursor');
  if (!bar) return;
  bar.querySelectorAll('.timeline-segment').forEach((el) => el.remove());
  renderTimelineLabels();

  const ranges = getDayEvents(y, m, d).map(parseEventRange);
  const segmentMinutes = ((DAY_END - DAY_START) * 60) / TIMELINE_SEGMENTS;
  const minMinutes = getMinSelectableMinutes();

  for (let i = 0; i < TIMELINE_SEGMENTS; i += 1) {
    const segStart = DAY_START * 60 + i * segmentMinutes;
    const mid = segStart + segmentMinutes / 2;
    let status = getSegmentStatus(mid, ranges);
    if (segStart < minMinutes) status = 'past';
    const seg = document.createElement('div');
    seg.className = `timeline-segment ${status}`;
    seg.title = `${formatTime24(segStart)} – ${formatTime24(segStart + segmentMinutes)}`;
    bar.insertBefore(seg, cursor);
  }
}

function syncTimeToForm() {
  const label = formatTime12(state.selectedTime);
  const horaInput = document.getElementById('citaHora');
  if (horaInput) horaInput.value = label;
  const cfmHora = document.getElementById('cfmHora');
  if (cfmHora) cfmHora.textContent = label;
  updateSalasDisponibles();
}

function renderTimeSection(day) {
  const title = document.getElementById('timeSectionTitle');
  if (title) title.textContent = `Horarios disponibles — ${DIAS_FULL[new Date(state.agY, state.agM, day).getDay()]} ${day} de ${MESES_AG[state.agM]}`;

  renderTimeline(state.agY, state.agM, day);

  const defaultTime = Math.max(10 * 60, getMinSelectableMinutes());
  setSelectedMinutes(state.selectedTime || defaultTime);
  state.selectedTime = getSelectedMinutes();
  updateEndTime();
  updateTimelineCursor();
  updateTimelineSelection();
  validateTime();
  syncTimeToForm();

  const fechaInput = document.getElementById('citaFecha');
  if (fechaInput) {
    fechaInput.value = `${String(day).padStart(2, '0')}/${String(state.agM + 1).padStart(2, '0')}/${state.agY}`;
  }
  const cfmFecha = document.getElementById('cfmFecha');
  if (cfmFecha) cfmFecha.textContent = fechaInput?.value || 'Fecha';
}

function onTimeOrDurationChanged() {
  state.selectedTime = getSelectedMinutes();
  updateEndTime();
  updateTimelineCursor();
  updateTimelineSelection();
  if (state.agSelected) renderTimeline(state.agY, state.agM, state.agSelected.d);
  validateTime();
  syncTimeToForm();
}

async function selectCalendarDay(d) {
  state.agSelected = { y: state.agY, m: state.agM, d };
  await fetchAgendaMonth(state.agY, state.agM);
  renderCalAg();
  renderTimeSection(d);
}

function renderCalAg() {
  const yearLabel = document.getElementById('calAgYear');
  const monthLabel = document.getElementById('calAgMonth');
  if (yearLabel) yearLabel.textContent = state.agY;
  if (monthLabel) monthLabel.textContent = MESES_AG[state.agM];

  const grid = document.getElementById('calAgGrid');
  if (!grid) return;
  grid.innerHTML = '';

  DIAS_AG.forEach((d) => {
    const h = document.createElement('div');
    h.className = 'cal-ag-dow';
    h.textContent = d;
    grid.appendChild(h);
  });

  const first = new Date(state.agY, state.agM, 1);
  const startDow = (first.getDay() + 6) % 7;
  const dim = new Date(state.agY, state.agM + 1, 0).getDate();
  const prevDim = new Date(state.agY, state.agM, 0).getDate();
  const today = new Date();

  for (let i = 0; i < startDow; i += 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-ag-day other-month';
    b.textContent = prevDim - startDow + 1 + i;
    grid.appendChild(b);
  }

  for (let d = 1; d <= dim; d += 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-ag-day';
    b.textContent = d;
    const isToday = today.getFullYear() === state.agY && today.getMonth() === state.agM && today.getDate() === d;
    const isPast = new Date(state.agY, state.agM, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (isToday) b.classList.add('today');
    if (isPast) {
      b.classList.add('past');
      b.disabled = true;
      b.title = 'No puedes agendar en días pasados';
    }
    if (state.agSelected && state.agSelected.y === state.agY && state.agSelected.m === state.agM && state.agSelected.d === d) {
      b.classList.add('selected');
    }
    b.addEventListener('click', () => selectCalendarDay(d));
    grid.appendChild(b);
  }

  const cells = startDow + dim;
  const rem = cells % 7 === 0 ? 0 : 7 - (cells % 7);
  for (let i = 1; i <= rem; i += 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-ag-day other-month';
    b.textContent = i;
    grid.appendChild(b);
  }
}

function bindCalendarStep() {
  document.getElementById('calAgYearPrev')?.addEventListener('click', async () => { state.agY -= 1; await fetchAgendaMonth(state.agY, state.agM); renderCalAg(); });
  document.getElementById('calAgYearNext')?.addEventListener('click', async () => { state.agY += 1; await fetchAgendaMonth(state.agY, state.agM); renderCalAg(); });
  document.getElementById('calAgMonthPrev')?.addEventListener('click', async () => { state.agM -= 1; if (state.agM < 0) { state.agM = 11; state.agY -= 1; } await fetchAgendaMonth(state.agY, state.agM); renderCalAg(); });
  document.getElementById('calAgMonthNext')?.addEventListener('click', async () => { state.agM += 1; if (state.agM > 11) { state.agM = 0; state.agY += 1; } await fetchAgendaMonth(state.agY, state.agM); renderCalAg(); });

  const hourInput = document.getElementById('timeHour');
  const minInput = document.getElementById('timeMin');
  hourInput?.addEventListener('input', () => { hourInput.value = hourInput.value.replace(/[^0-9]/g, ''); onTimeOrDurationChanged(); });
  minInput?.addEventListener('input', () => { minInput.value = minInput.value.replace(/[^0-9]/g, ''); onTimeOrDurationChanged(); });
  document.getElementById('citaDuracion')?.addEventListener('input', onTimeOrDurationChanged);
  document.getElementById('durMinus')?.addEventListener('click', () => changeDuration(-5));
  document.getElementById('durPlus')?.addEventListener('click', () => changeDuration(5));

  document.querySelector('.timeline-wrap')?.addEventListener('wheel', (e) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY * 1.5;
  }, { passive: false });

  if (timeStepInterval) {
    clearInterval(timeStepInterval);
  }

  timeStepInterval = setInterval(() => {
    if (!isSelectedToday()) return;
    const min = getMinSelectableMinutes();
    if (getSelectedMinutes() < min) {
      state.selectedTime = min;
      setSelectedMinutes(min);
      onTimeOrDurationChanged();
    } else if (state.agSelected) {
      renderTimeline(state.agY, state.agM, state.agSelected.d);
    }
  }, 60000);
}

function renderReprogramInfo() {
  const box = document.getElementById('reprogramInfo');
  if (!box) return;
  if (!state.editing) {
    box.classList.remove('open');
    return;
  }
  box.classList.add('open');
  box.innerHTML = `<strong>Estaba programada:</strong> ${escapeHtml(state.editing.fechaTexto || '')} a las ${escapeHtml(state.editing.horaTexto || '')}. Selecciona otra fecha y otro horario disponible.`;
}

/* =========================================================
   PASO 4: MOTIVO
========================================================= */

function bindMotivoStep() {
  const ta = document.getElementById('motivoText');
  const cnt = document.getElementById('motivoCount');
  ta?.addEventListener('input', () => { if (cnt) cnt.textContent = ta.value.length; });
}

/* =========================================================
   PASO 5: CONFIRMACIÓN Y ENVÍO
========================================================= */

function fechaDdMmYyyyToIso(fecha) {
  const match = String(fecha || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
}

function horaTextoTo24(hora) {
  const value = String(hora || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return '';
  let h = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3] ? match[3].toUpperCase() : '';
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

async function submitCita() {
  const btn = document.getElementById('cfmAgendar');
  const paciente = document.getElementById('cfmPaciente')?.textContent.trim() || document.getElementById('pacSearch')?.value?.trim() || 'Paciente';
  const procedimiento = document.getElementById('cfmProcedimiento')?.textContent.trim() || document.getElementById('citaProcedimiento')?.value || 'Procedimiento';
  const fechaTexto = document.getElementById('citaFecha')?.value || '';
  const horaTexto = document.getElementById('citaHora')?.value || '';
  const sala = document.getElementById('citaSala')?.value || '';
  const notas = document.getElementById('motivoText')?.value || '';
  const duracion = document.getElementById('citaDuracion')?.value || '60';

  const payload = {
    paciente_id: state.selectedPatientId || null,
    paciente_nombre: paciente,
    procedimiento,
    fecha: fechaDdMmYyyyToIso(fechaTexto),
    hora: horaTextoTo24(horaTexto),
    duracion_minutos: parseInt(duracion, 10) || 60,
    sala: sala || null,
    notas,
  };

  if (!payload.fecha) { window.alert('Selecciona una fecha válida.'); return; }
  if (!payload.hora) { window.alert('Selecciona una hora válida.'); return; }
  if (!validateTime()) { window.alert('El horario seleccionado no está disponible.'); return; }

  const isEditing = Boolean(state.editing?.id);

  try {
    if (btn) { btn.disabled = true; btn.style.opacity = '.65'; }

    const url = isEditing ? `${CITAS_ENDPOINT}/${state.editing.id}` : CITAS_ENDPOINT;
    const method = isEditing ? 'PUT' : 'POST';

    const response = await laravelFetch(url, {
      method,
      headers: jsonHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || 'No se pudo guardar la cita. Revisa los campos.');
    }

    const overlay = document.getElementById('successOverlay');
    const txt = document.getElementById('successText');
    if (txt) {
      txt.textContent = isEditing
        ? `La cita de ${paciente} se reprogramó correctamente.`
        : `La cita de ${paciente} se guardó correctamente en la agenda. Se enviará una notificación al paciente.`;
    }
    overlay?.classList.add('open');
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Error al guardar la cita.');
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

function bindConfirmacionStep() {
  document.getElementById('cfmCancelar')?.addEventListener('click', () => { window.location.hash = 'agenda'; });
  document.getElementById('cfmAgendar')?.addEventListener('click', submitCita);
}

/* =========================================================
   PREFILL (crear con fecha/hora sugerida, o reprogramar cita)
========================================================= */

function readPrefill() {
  const raw = sessionStorage.getItem(AGENDAR_PREFILL_STORAGE_KEY);
  sessionStorage.removeItem(AGENDAR_PREFILL_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function applyPrefill() {
  const prefill = readPrefill();
  const title = document.getElementById('agendarTitle');
  const btnAgendar = document.getElementById('cfmAgendar');

  if (prefill?.mode === 'edit' && prefill.cita) {
    const cita = prefill.cita;
    let fechaTexto = cita.fechaTexto || '';
    if (!fechaTexto && cita.fecha) {
      const [y, m, d] = String(cita.fecha).split('-').map(Number);
      if (y && m && d) fechaTexto = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
    state.editing = {
      id: cita.id,
      fechaTexto,
      horaTexto: cita.horaTexto || '',
    };
    if (title) title.textContent = 'Reprogramar CITA';
    if (btnAgendar) btnAgendar.innerHTML = 'Guardar cambios';

    state.selectedPatientId = cita.pacienteId || null;
    const searchInput = document.getElementById('pacSearch');
    if (searchInput) searchInput.value = cita.pacienteNombre || '';
    const cfmPaciente = document.getElementById('cfmPaciente');
    if (cfmPaciente) cfmPaciente.textContent = cita.pacienteNombre || 'Paciente';

    const pac = cita.pacienteNombre ? findPatientByName(cita.pacienteNombre) : null;
    if (pac) updatePacResult(pac);
    else {
      fillSelect(document.getElementById('citaProcedimiento'), cita.procedimiento, 'Procedimiento');
    }

    if (cita.procedimiento) {
      const selProc = document.getElementById('citaProcedimiento');
      if (selProc) {
        const exists = Array.from(selProc.options).some((opt) => opt.value === cita.procedimiento);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = cita.procedimiento;
          opt.textContent = cita.procedimiento;
          selProc.appendChild(opt);
        }
        selProc.value = cita.procedimiento;
        selProc.dispatchEvent(new Event('change'));
      }
    }

    if (cita.sala) {
      const selSala = document.getElementById('citaSala');
      if (selSala) {
        const exists = Array.from(selSala.options).some((opt) => opt.value === cita.sala);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = cita.sala;
          opt.textContent = cita.sala;
          selSala.appendChild(opt);
        }
        selSala.value = cita.sala;
        selSala.dispatchEvent(new Event('change'));
      }
    }

    const duracionInput = document.getElementById('citaDuracion');
    if (duracionInput) duracionInput.value = cita.duracion || 60;

    const motivo = document.getElementById('motivoText');
    if (motivo) { motivo.value = cita.notas || ''; motivo.dispatchEvent(new Event('input')); }

    if (cita.fecha) {
      const [y, m, d] = String(cita.fecha).split('-').map(Number);
      state.agY = y;
      state.agM = m - 1;
      state.agSelected = { y, m: m - 1, d };
    }
    if (cita.hora) {
      state.selectedTime = hora12ToMinutes(cita.horaTexto) ?? hora12ToMinutes(`${cita.hora}`);
    }

    renderReprogramInfo();
  } else if (prefill?.mode === 'create') {
    if (prefill.fecha) {
      const [y, m, d] = String(prefill.fecha).split('-').map(Number);
      state.agY = y;
      state.agM = m - 1;
      state.agSelected = { y, m: m - 1, d };
    }
    if (prefill.hora) {
      const [h, mi] = String(prefill.hora).split(':').map(Number);
      state.selectedTime = (h || DAY_START) * 60 + (mi || 0);
    }
  }
}

/* =========================================================
   INICIALIZACIÓN
========================================================= */

export async function initAgendar({ signal } = {}) {
  document.getElementById('agBack')?.addEventListener('click', () => { window.location.hash = 'agenda'; });

  bindPacienteStep();
  bindCitaStep();
  bindCalendarStep();
  bindMotivoStep();
  bindConfirmacionStep();

  document.getElementById('successOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'successOverlay') e.target.classList.remove('open');
  });

  const today = new Date();
  state.agY = today.getFullYear();
  state.agM = today.getMonth();
  state.agSelected = null;
  state.selectedTime = null;
  state.editing = null;
  state.selectedPatientId = null;

  try {
    state.patients = await fetchPatients();
  } catch (error) {
    console.error('No se pudieron cargar los pacientes para agendar:', error);
    state.patients = [];
  }

  await populateSalas();
  await applyPrefill();
  await fetchAgendaMonth(state.agY, state.agM);

  renderCalAg();
  const initialDay = state.agSelected ? state.agSelected.d : today.getDate();
  renderTimeSection(initialDay);
  if (!state.agSelected) state.agSelected = { y: state.agY, m: state.agM, d: initialDay };
  renderCalAg();

  signal?.addEventListener('abort', () => {
    if (timeStepInterval) {
      clearInterval(timeStepInterval);
      timeStepInterval = null;
    }
  });
}
