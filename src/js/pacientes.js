// ================= Pacientes · Inicializador =================
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
const PATIENTS_ENDPOINT = `${API_BASE_URL}/api/tauri/pacientes`;
const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';

const statusTexts = { completed:'Completado', waiting:'En espera', cancelled:'Cancelado' };
const estadosMap = { 'en_proceso':'waiting', 'completado':'completed', 'cancelado':'cancelled', 'archivado':'completed' };
const PAGE_SIZE = 15;

let patientsData = [];
let patientsDataFiltered = [];
let currentPage = 1;
let _deleteIndex = null;
let _currentPanelIndex = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setPatientsLoading() {
  const body = document.getElementById('patientsTableBody');
  if (body) {
    body.innerHTML = `<div style="padding:32px 20px;text-align:center;color:var(--txt-soft);">Cargando pacientes desde Laravel...</div>`;
  }

  const info = document.getElementById('paginationInfo');
  if (info) info.textContent = 'Conectando con Laravel';

  const pagination = document.getElementById('paginationControls');
  if (pagination) pagination.innerHTML = '';
}

function renderPatientsError(error) {
  if (error.code === 'UNAUTHORIZED') {
    renderLaravelLogin(error.message);
    return;
  }

  const body = document.getElementById('patientsTableBody');
  const message = escapeHtml(error.message || 'No se pudieron cargar los pacientes.');

  if (body) {
    body.innerHTML = `
      <div style="padding:32px 20px;text-align:center;color:var(--txt-soft);">
        <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
        <span>${message}</span>
      </div>`;
  }

  const info = document.getElementById('paginationInfo');
  if (info) info.textContent = 'Sin conexión con Laravel';
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

function renderLaravelLogin(message = 'Inicia sesión con tu usuario de Laravel.') {
  const body = document.getElementById('patientsTableBody');
  const info = document.getElementById('paginationInfo');
  const safeMessage = escapeHtml(message);

  if (body) {
    body.innerHTML = `
      <form id="laravelPatientsLoginForm" style="max-width:420px;margin:32px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
        <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar con Laravel</strong>
        <p style="color:var(--txt-soft);font-size:13px;line-height:1.5;margin:0 0 18px;">${safeMessage}</p>
        <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Correo</label>
        <input id="laravelPatientsEmail" type="email" autocomplete="username" required style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
        <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Contraseña</label>
        <input id="laravelPatientsPassword" type="password" autocomplete="current-password" required style="width:100%;margin-bottom:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
        <button type="submit" style="width:100%;padding:11px 14px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;cursor:pointer;">Conectar pacientes</button>
      </form>`;
  }

  if (info) info.textContent = 'Esperando credenciales de Laravel';

  document.getElementById('laravelPatientsLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('laravelPatientsEmail')?.value.trim();
    const password = document.getElementById('laravelPatientsPassword')?.value || '';

    if (!email || !password) return;

    try {
      const token = await loginToLaravel(email, password);
      sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      await loadPatientsFromLaravel();
    } catch (error) {
      renderLaravelLogin(error.message);
    }
  });
}

function normalizePatientsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.pacientes)) return payload.pacientes;
  if (Array.isArray(payload?.patients)) return payload.patients;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function fetchLaravelPatients() {
  const headers = {
    Accept: 'application/json',
  };
  const authorization = authHeader();

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await laravelFetch(PATIENTS_ENDPOINT, {
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar pacientes.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvió JSON. Revisa sesión y ruta: ${PATIENTS_ENDPOINT}`);
  }

  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondió HTTP ${response.status}.`);
  }

  return normalizePatientsPayload(payload);
}

function fillMedicoSelect() {
  const medicoSelect = document.getElementById('fMedico');
  if (!medicoSelect) return;

  medicoSelect.innerHTML = '<option value="">Seleccionar médico</option>';

  [...new Set(patientsData.map(p => p.medico).filter(m => m && m !== 'Sin médico'))]
    .sort()
    .forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      medicoSelect.appendChild(opt);
    });
}

async function loadPatientsFromLaravel() {
  setPatientsLoading();

  try {
    patientsData = await fetchLaravelPatients();
    patientsDataFiltered = [...patientsData];
    currentPage = 1;
    fillMedicoSelect();
    renderPage(1);
  } catch (error) {
    console.error(error);

    if (error.code === 'UNAUTHORIZED') {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }

    renderPatientsError(error);
  }
}

function rowHTML(patient, globalIndex) {
  const st = patient.status ? (estadosMap[patient.status] || patient.status) : '';
  const stText = st ? (statusTexts[st] || st) : '';
  const name = escapeHtml(patient.name || 'Paciente sin nombre');
  const initials = escapeHtml(patient.initials || 'PX');
  const age = escapeHtml(patient.age || 'Sin edad');
  const gender = escapeHtml(patient.gender || 'No especificado');
  const folio = escapeHtml(patient.folio || 'Sin folio');
  const dob = escapeHtml(patient.dob || 'Sin fecha');
  const studyDate = escapeHtml(patient.study_date || '');
  const studyType = escapeHtml(patient.study_type || '');
  const fotoUrl = escapeHtml(patient.foto_url || '');

  return `<div class="patient-row" onclick="openPanel(${globalIndex})" data-index="${globalIndex}" data-status="${st || 'none'}">
    <div class="patient-info">
      <div class="patient-avatar">${fotoUrl ? `<img src="${fotoUrl}" alt="${name}">` : initials}</div>
      <div>
        <div class="patient-name">${name}</div>
        <div class="patient-meta">${age} · ${gender}</div>
      </div>
    </div>
    <div class="cell">${folio}</div>
    <div class="cell cell-fecha cell-muted">${dob}</div>
    <div class="cell-study">
      ${studyDate ? `<span class="date study-date">${studyDate}</span>` : ''}
      ${studyType ? `<span class="type">${studyType}</span>` : ''}
    </div>
    <div class="col-status">${st ? `<span class="status ${escapeHtml(st)}">${escapeHtml(stText)}</span>` : ''}</div>
    <div class="actions-wrapper">
      <div class="actions">
        <button class="btn-more" aria-label="Más opciones" onclick="event.stopPropagation();toggleMenu(this)">⋮</button>
      </div>
      <div class="actions-dropdown" onclick="event.stopPropagation()">
        <a href="#" onclick="event.stopPropagation(); window.location.hash='ia-reportes'; return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Crear informe
        </a>
        <a href="#" onclick="event.stopPropagation(); editarPaciente(${globalIndex}); return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Editar información
        </a>
        <a href="#" onclick="event.stopPropagation(); startPatientStudy(${globalIndex}); return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="22" x2="15" y2="22"/><line x1="12" y1="17" x2="12" y2="22"/></svg>
          Iniciar estudio
        </a>
        <a href="#" onclick="event.stopPropagation(); window.location.hash='ia-reportes'; return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          Generar reporte IA
        </a>
        <a href="#" onclick="event.stopPropagation(); window.location.hash='agenda'; return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Programar cita
        </a>
        <a href="#" onclick="event.stopPropagation(); window.location.hash='mensajes'; return false;">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.5A9.9 9.9 0 0 1 12.04 2z"/></svg>
          Enviar WhatsApp
        </a>
        <a href="#" onclick="event.stopPropagation(); return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Descargar expediente PDF
        </a>
        <div class="dropdown-separator"></div>
        <a href="#" class="danger" onclick="event.stopPropagation(); deletePatient(${globalIndex}); return false;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Eliminar paciente
        </a>
      </div>
    </div>
  </div>`;
}

function renderPage(page) {
  currentPage = page;
  const total = patientsDataFiltered.length;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  const pageData = patientsDataFiltered.slice(start, end);

  const body = document.getElementById('patientsTableBody');
  if (body) {
    body.innerHTML = pageData.length === 0
      ? `<div style="padding:32px 20px;text-align:center;color:var(--txt-soft);">No se encontraron pacientes.</div>`
      : pageData.map((p, i) => rowHTML(p, start + i)).join('');
  }
  const info = document.getElementById('paginationInfo');
  if (info) info.textContent = total === 0 ? 'Mostrando 0 pacientes' : `Mostrando ${start + 1} a ${end} de ${total} pacientes`;
  renderPaginationControls(page, totalPages);
}

function renderPaginationControls(page, totalPages) {
  const container = document.getElementById('paginationControls');
  if (!container) return;
  let html = `<button class="page-btn" onclick="renderPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>`;
  const delta = 2, pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= delta) pages.push(i);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }
  pages.forEach(p => {
    html += p === '...'
      ? `<button class="page-btn" disabled>…</button>`
      : `<button class="page-btn${p === page ? ' active' : ''}" onclick="renderPage(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" onclick="renderPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>›</button>`;
  container.innerHTML = html;
}

/* ---- Panel de detalle ---- */
function openPanel(index) {
  _currentPanelIndex = index;
  const p = patientsData[index];
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const avatar = document.getElementById('panelAvatar');
  if (avatar) avatar.textContent = p.initials || 'PX';
  set('panelName', p.name);
  set('panelFolio', 'Folio: ' + (p.folio || '—'));
  set('panelAge', p.age); set('panelGender', p.gender); set('panelDob', p.dob);
  set('panelPhone', p.phone); set('panelEmail', p.email); set('panelAddress', p.address);
  set('panelMedicoInfo', p.medico || 'Sin médico');
  set('panelStatus', p.status ? p.status.charAt(0).toUpperCase() + p.status.slice(1) : 'Sin estado');
  const estudios = p.estudios || [];
  set('panelTotalStudies', estudios.length);

  const list = document.getElementById('historialList');
  const empty = document.getElementById('historialEmpty');
  if (list && empty) {
    list.innerHTML = '';
    if (estudios.length) {
      empty.style.display = 'none';
      estudios.slice(0, 5).forEach(est => {
        const item = document.createElement('div');
        item.className = 'historial-item';
        item.innerHTML = `<div class="historial-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/></svg></div><div class="historial-info"><div class="historial-title">${escapeHtml(est.tipo || 'Estudio')}</div><div class="historial-doctor">${escapeHtml(p.medico || 'Sin médico')}</div></div><div class="historial-right"><div class="historial-date">${escapeHtml(est.fecha || 'Sin fecha')}</div></div>`;
        list.appendChild(item);
      });
    } else empty.style.display = 'block';
  }

  // Poblar tab Estudios
  const estList  = document.getElementById('estudiosList');
  const estEmpty = document.getElementById('estudiosEmpty');
  const btnTodos = document.getElementById('btnVerTodosEstudios');
  if (estList && estEmpty) {
    estList.innerHTML = '';
    if (estudios.length) {
      estEmpty.style.display = 'none';
      if (btnTodos) btnTodos.style.display = 'flex';
      estudios.forEach(est => {
        const item = document.createElement('div');
        item.className = 'estudio-item';
        const nombre = est.nombre || (est.tipo ? est.tipo + '.pdf' : 'Estudio');
        const size   = est.size || '';
        const fecha  = est.fecha || '';
        const url    = est.url || '#';
        item.innerHTML = `
          <div class="estudio-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <div class="estudio-info">
            <div class="estudio-name">${nombre}</div>
            <div class="estudio-meta">${size}${size && fecha ? ' · ' : ''}${fecha}</div>
          </div>
          <a href="${url}" target="_blank" class="estudio-view" onclick="event.stopPropagation()">Ver</a>`;
        estList.appendChild(item);
      });
    } else {
      estEmpty.style.display = 'block';
      if (btnTodos) btnTodos.style.display = 'none';
    }
  }

  const rAvatar = document.getElementById('reportPanelAvatar');
  if (rAvatar) rAvatar.textContent = p.initials || 'PX';
  set('reportPanelName', p.name || '—');
  set('reportPanelFolio', 'Folio: ' + (p.folio || '—'));
  set('reportPanelMeta', [p.age, p.gender, p.dob].filter(Boolean).join(' · ') || 'Sin datos');

  document.getElementById('contentWrapper').classList.add('panel-open');  // Mostrar siempre la tab Resumen al abrir
  showTab('resumen');
  document.querySelectorAll('.patient-row').forEach(r => r.classList.remove('active'));
  const activeRow = document.querySelector('[data-index="' + index + '"]');
  if (activeRow) activeRow.classList.add('active');
}

function closePanel() {
  document.getElementById('contentWrapper')?.classList.remove('panel-open');
  document.querySelectorAll('.patient-row').forEach(r => r.classList.remove('active'));
  _currentPanelIndex = null;
}

function showTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick') === `showTab('${tabName}')`);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tabName)?.classList.add('active');
}

/* ---- Menú de acciones ---- */
function toggleMenu(btn) {
  const dropdown = btn.closest('.actions-wrapper').querySelector('.actions-dropdown');
  document.querySelectorAll('.actions-dropdown.active').forEach(m => { if (m !== dropdown) m.classList.remove('active'); });
  dropdown.classList.toggle('active');
  const anyOpen = document.querySelector('.actions-dropdown.active') !== null;
  document.querySelector('.patients-card')?.classList.toggle('menu-open', anyOpen);
  document.querySelector('.content-with-panel')?.classList.toggle('menu-open', anyOpen);
}

/* ---- Eliminar ---- */
function deletePatient(index) {
  _deleteIndex = index;
  const p = patientsData[index];
  if (!p) return;
  document.getElementById('modalEliminarNombre').textContent = p.name;
  document.getElementById('modalEliminar').style.display = 'flex';
}
function cancelarEliminar() {
  _deleteIndex = null;
  document.getElementById('modalEliminar').style.display = 'none';
}
function confirmarEliminar() {
  confirmarEliminarConLaravel();
}

/* ---- Filtros / búsqueda ---- */
function openFilters() {
  document.getElementById('filterPanel').classList.add('open');
  document.getElementById('filterOverlay').classList.add('open');
  document.getElementById('btnFiltros').classList.add('active');
  document.body.style.overflow = 'hidden';
  updateFilterCount();
}
function closeFilters() {
  document.getElementById('filterPanel').classList.remove('open');
  document.getElementById('filterOverlay').classList.remove('open');
  document.getElementById('btnFiltros').classList.remove('active');
  document.body.style.overflow = '';
}
function updateFilterCount() {
  const ids = ['fNombre','fMedico','fEstado','fUltimoEstudio','fFechaNacimiento','fFolio'];
  let count = 0;
  ids.forEach(id => { const el = document.getElementById(id); if (el && el.value.trim() !== '') count++; });
  const txt = `(${count})`;
  ['filterCount','applyFilterCount'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = txt; });
  const btnClear = document.getElementById('btnClearAllFilters');
  if (btnClear) btnClear.style.display = count > 0 ? 'flex' : 'none';
}
function clearFilters() {
  ['fNombre','fMedico','fEstado','fUltimoEstudio','fFechaNacimiento','fFolio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { if (el.tagName === 'SELECT') el.selectedIndex = 0; else el.value = ''; }
  });
  updateFilterCount();
}
function applyFilters() {
  updateFilterCount();
  closeFilters();
  const nombre = (document.getElementById('fNombre')?.value || '').toLowerCase().trim();
  const medico = (document.getElementById('fMedico')?.value || '').toLowerCase().trim();
  const estado = (document.getElementById('fEstado')?.value || '').toLowerCase().trim();
  const folio  = (document.getElementById('fFolio')?.value || '').toLowerCase().trim();
  const statusMap = { 'completado':['completado','completed'], 'en espera':['en espera','waiting','en_proceso'], 'cancelado':['cancelado','cancelled'] };
  patientsDataFiltered = patientsData.filter(p => {
    if (nombre && !(p.name && p.name.toLowerCase().includes(nombre))) return false;
    if (medico && !(p.medico && p.medico.toLowerCase() === medico)) return false;
    if (folio && !(p.folio && p.folio.toLowerCase().includes(folio))) return false;
    if (estado) {
      const variants = statusMap[estado] || [estado];
      if (!variants.some(v => (p.status || '').toLowerCase().includes(v))) return false;
    }
    return true;
  });
  currentPage = 1;
  renderPage(1);
}
function filterPatients() {
  const term = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  patientsDataFiltered = term === '' ? [...patientsData] : patientsData.filter(p =>
    String(p.name || '').toLowerCase().includes(term) ||
    String(p.folio || '').toLowerCase().includes(term) ||
    String(p.phone || '').toLowerCase().includes(term) ||
    String(p.email || '').toLowerCase().includes(term));
  currentPage = 1;
  renderPage(1);
}

/* ---- Orden y filtro por estado (sobre el DOM) ---- */
function toggleEstadoFilter() { document.getElementById('estadoFilterDropdown')?.classList.toggle('active'); }
function filterByEstado(estado) {
  document.getElementById('estadoFilterDropdown')?.classList.remove('active');
  const orden = { completed:1, waiting:2, cancelled:3 };
  const map = { completado:'completed', espera:'waiting', cancelado:'cancelled' };
  const rows = Array.from(document.querySelectorAll('.patient-row'));
  const target = map[estado];
  rows.sort((a, b) => {
    const ea = a.dataset.status || '', eb = b.dataset.status || '';
    if (estado !== 'all') {
      if (ea === target && eb !== target) return -1;
      if (eb === target && ea !== target) return 1;
    }
    return (orden[ea] || 99) - (orden[eb] || 99);
  });
  const parent = document.querySelector('.patients-card');
  rows.forEach(r => parent.appendChild(r));
}
function toggleOrdenar(tipo) {
  const dp = document.getElementById('ordenarPacienteDropdown');
  const de = document.getElementById('ordenarEstudioDropdown');
  if (tipo === 'paciente') { dp.classList.toggle('active'); de.classList.remove('active'); }
  else { de.classList.toggle('active'); dp.classList.remove('active'); }
}
function ordenarPor(tipo, criterio) {
  document.getElementById(tipo === 'paciente' ? 'ordenarPacienteDropdown' : 'ordenarEstudioDropdown')?.classList.remove('active');
  const rows = Array.from(document.querySelectorAll('.patient-row'));
  rows.sort((a, b) => {
    const ia = parseInt(a.dataset.index || 0), ib = parseInt(b.dataset.index || 0);
    if (criterio === 'default') return ia - ib;
    if (tipo === 'paciente') {
      const na = a.querySelector('.patient-name')?.textContent?.toLowerCase() || '';
      const nb = b.querySelector('.patient-name')?.textContent?.toLowerCase() || '';
      return criterio === 'nombre-asc' ? na.localeCompare(nb, 'es') : nb.localeCompare(na, 'es');
    }
    const fa = a.querySelector('.study-date')?.textContent || '';
    const fb = b.querySelector('.study-date')?.textContent || '';
    const t = s => { const d = new Date(s); return isNaN(d) ? 0 : d.getTime(); };
    return criterio === 'fecha-reciente' ? t(fb) - t(fa) : t(fa) - t(fb);
  });
  const parent = document.querySelector('.patients-card');
  rows.forEach(r => parent.appendChild(r));
}

// Cerrar menús/dropdowns al hacer click fuera
function onDocClick(e) {
  if (!e.target.closest('.actions-wrapper')) {
    document.querySelectorAll('.actions-dropdown.active').forEach(m => m.classList.remove('active'));
    document.querySelector('.patients-card')?.classList.remove('menu-open');
    document.querySelector('.content-with-panel')?.classList.remove('menu-open');
  }
  if (!e.target.closest('.estado-filter-container')) document.getElementById('estadoFilterDropdown')?.classList.remove('active');
  if (!e.target.closest('.ordenar-container')) {
    document.getElementById('ordenarPacienteDropdown')?.classList.remove('active');
    document.getElementById('ordenarEstudioDropdown')?.classList.remove('active');
  }
}

async function deletePatientFromLaravel(patient) {
  const headers = {
    Accept: 'application/json',
  };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;

  const id = patient.id || patient.uuid || patient.patient_id;
  const request = id
    ? {
        url: `${PATIENTS_ENDPOINT}/${encodeURIComponent(id)}`,
        options: { method: 'DELETE', headers, credentials: 'include' },
      }
    : {
        url: `${PATIENTS_ENDPOINT}/eliminar`,
        options: {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folio: patient.folio || '',
            email: patient.email || '',
            phone: patient.phone || '',
            name: patient.name || '',
          }),
          credentials: 'include',
        },
      };

  const response = await laravelFetch(request.url, request.options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para eliminar pacientes.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status} al eliminar paciente.`);
  }

  return payload;
}

async function confirmarEliminarConLaravel() {
  if (_deleteIndex === null) return;
  const patient = patientsData[_deleteIndex];
  if (!patient) return;

  const deleteButton = document.querySelector('#modalEliminar button[onclick="confirmarEliminar()"]');
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = 'Eliminando...';
  }

  try {
    await deletePatientFromLaravel(patient);
    patientsData = patientsData.filter((_, index) => index !== _deleteIndex);
    patientsDataFiltered = patientsDataFiltered.filter((item) => item !== patient);
    closePanel();
    renderPage(Math.min(currentPage, Math.max(Math.ceil(patientsDataFiltered.length / PAGE_SIZE), 1)));
  } catch (error) {
    console.error(error);
    alert(error.message || 'Laravel no pudo eliminar el paciente.');
  } finally {
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent = 'Eliminar';
    }
    _deleteIndex = null;
    document.getElementById('modalEliminar').style.display = 'none';
  }
}

function startPatientStudy(index) {
  const patient = patientsData[index];
  if (!patient) return;

  const patientId = patient.patient_id || patient.id;
  if (!patientId) {
    alert('Este paciente no tiene ID de Laravel para iniciar estudio.');
    return;
  }

  const patientName = patient.name || '';
  const studyLabel = patient.study_type || patient.procedimiento || 'Endoscopia';

  const params = new URLSearchParams({
    patient_id: String(patientId),
    patient_name: patientName,
    study_label: studyLabel,
  });

  ['patient_id', 'paciente_id', 'patientId'].forEach((key) => sessionStorage.setItem(`enclaii-${key}`, String(patientId)));
  sessionStorage.setItem('enclaii-patient_name', patientName);
  sessionStorage.setItem('enclaii-study_label', studyLabel);

  // Lleva directo a la pantalla de emparejamiento/captura. Ahi se ingresa
  // el codigo de 6 digitos generado en Laravel (Nuevo estudio > Generar
  // codigo Tauri) para vincular la camara al estudio de este paciente.
  window.location.href = `./index.html?${params.toString()}`;
}

// Exponer funciones globalmente para los onclick inline del HTML
Object.assign(window, {
  renderPage, openPanel, closePanel, showTab, toggleMenu, deletePatient,
  cancelarEliminar, confirmarEliminar: confirmarEliminarConLaravel, openFilters, closeFilters, clearFilters,
  applyFilters, filterPatients, toggleEstadoFilter, filterByEstado, toggleOrdenar, ordenarPor,
  startPatientStudy,
});

export async function initPacientes() {
  patientsData = [];
  patientsDataFiltered = [];
  currentPage = 1;
  setPatientsLoading();

  ['fNombre','fMedico','fEstado','fUltimoEstudio','fFechaNacimiento','fFolio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('change', updateFilterCount); el.addEventListener('input', updateFilterCount); }
  });

  document.removeEventListener('click', onDocClick);
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFilters(); });

  await loadPatientsFromLaravel();
}

function editarPaciente(index) {
  const p = patientsData[index];
  if (!p) return;
  sessionStorage.setItem('enclaii-editar-paciente', JSON.stringify(p));
  window.location.hash = 'editar-paciente';
}
window.editarPaciente = editarPaciente;
