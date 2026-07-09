// ================= Pacientes · Inicializador =================
// Migrado desde pacientes/index.blade.php. Los datos vienen de un arreglo de
// ejemplo (SAMPLE); se reemplazará por el API de Laravel más adelante.

export let SAMPLE_PATIENTS = [
  { id:1, name:'María González', initials:'MG', age:'45 años', gender:'Femenino', folio:'P-00045', dob:'16/04/1979', phone:'+52 722 162 0815', email:'maria@gmail.com', address:'Toluca, Centro 01', medico:'Dr. Domínguez', study_date:'15 Jul 2025', study_type:'Endoscopía alta', status:'completado', tiene_estudios:false, estudios:[], proxima_cita:null },
  { id:2, name:'Carlos Ramírez', initials:'CR', age:'52 años', gender:'Masculino', folio:'P-00046', dob:'03/11/1972', phone:'+52 722 555 1020', email:'carlos@gmail.com', address:'Metepec, Las Flores 22', medico:'Dra. Pérez', study_date:'02 Jul 2025', study_type:'Colonoscopía', status:'en_proceso', tiene_estudios:false, estudios:[], proxima_cita:null },
  { id:3, name:'Ana Torres', initials:'AT', age:'38 años', gender:'Femenino', folio:'P-00047', dob:'27/02/1987', phone:'+52 722 333 4455', email:'ana@gmail.com', address:'Toluca, Universidad 5', medico:'Dr. Domínguez', study_date:'', study_type:'', status:'', tiene_estudios:false, estudios:[], proxima_cita:null },
  { id:4, name:'Luis Hernández', initials:'LH', age:'60 años', gender:'Masculino', folio:'P-00048', dob:'09/09/1965', phone:'+52 722 777 8899', email:'luis@gmail.com', address:'Lerma, Reforma 8', medico:'Dra. Pérez', study_date:'28 Jun 2025', study_type:'Gastroscopía', status:'cancelado', tiene_estudios:false, estudios:[], proxima_cita:null },
  { id:5, name:'Sofía Martínez', initials:'SM', age:'29 años', gender:'Femenino', folio:'P-00049', dob:'14/05/1996', phone:'+52 722 111 2233', email:'sofia@gmail.com', address:'Toluca, Sor Juana 14', medico:'Dr. Domínguez', study_date:'10 Jun 2025', study_type:'Endoscopía alta', status:'completado', tiene_estudios:false, estudios:[], proxima_cita:null },
];

const statusTexts = { completed:'Completado', waiting:'En espera', cancelled:'Cancelado' };
const estadosMap = { 'en_proceso':'waiting', 'completado':'completed', 'cancelado':'cancelled', 'archivado':'completed' };
const PAGE_SIZE = 15;

let patientsData = [];
let patientsDataFiltered = [];
let currentPage = 1;
let _deleteIndex = null;
let _currentPanelIndex = null;

function rowHTML(patient, globalIndex) {
  const st = patient.status ? (estadosMap[patient.status] || patient.status) : '';
  const stText = st ? (statusTexts[st] || st) : '';
  return `<div class="patient-row" onclick="openPanel(${globalIndex})" data-index="${globalIndex}" data-status="${st || 'none'}">
    <div class="patient-info">
      <div class="patient-avatar">${patient.foto_url ? `<img src="${patient.foto_url}" alt="${patient.name}">` : (patient.initials || 'PX')}</div>
      <div>
        <div class="patient-name">${patient.name || 'Paciente sin nombre'}</div>
        <div class="patient-meta">${patient.age || 'Sin edad'} · ${patient.gender || 'No especificado'}</div>
      </div>
    </div>
    <div class="cell">${patient.folio || 'Sin folio'}</div>
    <div class="cell cell-fecha cell-muted">${patient.dob || 'Sin fecha'}</div>
    <div class="cell-study">
      ${patient.study_date ? `<span class="date study-date">${patient.study_date}</span>` : ''}
      ${patient.study_type ? `<span class="type">${patient.study_type}</span>` : ''}
    </div>
    <div class="col-status">${st ? `<span class="status ${st}">${stText}</span>` : ''}</div>
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
        <a href="#" onclick="event.stopPropagation(); window.location.href='./index.html'; return false;">
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
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.5A9.9 9.9 0 1 0 12.04 2z"/></svg>
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
  set('panelFolio', 'Folio: ' + p.folio);
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
        item.innerHTML = `<div class="historial-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/></svg></div><div class="historial-info"><div class="historial-title">${est.tipo || 'Estudio'}</div><div class="historial-doctor">${p.medico || 'Sin médico'}</div></div><div class="historial-right"><div class="historial-date">${est.fecha || 'Sin fecha'}</div></div>`;
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
  if (_deleteIndex === null) return;
  patientsData.splice(_deleteIndex, 1);
  patientsDataFiltered = [...patientsData];
  _deleteIndex = null;
  document.getElementById('modalEliminar').style.display = 'none';
  closePanel();
  const totalPages = Math.ceil(patientsData.length / PAGE_SIZE);
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
  renderPage(currentPage || 1);
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
    p.name.toLowerCase().includes(term) || p.folio.toLowerCase().includes(term) ||
    (p.phone && p.phone.toLowerCase().includes(term)) || (p.email && p.email.toLowerCase().includes(term)));
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

// Exponer funciones globalmente para los onclick inline del HTML
Object.assign(window, {
  renderPage, openPanel, closePanel, showTab, toggleMenu, deletePatient,
  cancelarEliminar, confirmarEliminar, openFilters, closeFilters, clearFilters,
  applyFilters, filterPatients, toggleEstadoFilter, filterByEstado, toggleOrdenar, ordenarPor,
});

export function initPacientes() {
  patientsData = SAMPLE_PATIENTS.map(p => ({ ...p }));
  patientsDataFiltered = [...patientsData];
  currentPage = 1;

  // Poblar select de médicos
  const medicoSelect = document.getElementById('fMedico');
  if (medicoSelect) {
    [...new Set(patientsData.map(p => p.medico).filter(m => m && m !== 'Sin médico'))].sort().forEach(m => {
      const opt = document.createElement('option'); opt.value = m; opt.textContent = m; medicoSelect.appendChild(opt);
    });
  }

  ['fNombre','fMedico','fEstado','fUltimoEstudio','fFechaNacimiento','fFolio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('change', updateFilterCount); el.addEventListener('input', updateFilterCount); }
  });

  document.removeEventListener('click', onDocClick);
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFilters(); });

  renderPage(1);
}

function editarPaciente(index) {
  const p = patientsData[index];
  if (!p) return;
  sessionStorage.setItem('enclaii-editar-paciente', JSON.stringify(p));
  window.location.hash = 'editar-paciente';
}
window.editarPaciente = editarPaciente;
