import { laravelFetch } from './laravel.js';

const DEFAULT_API_BASE_URL =
  'https://sistema.enclaii.com';

const AUTH_STORAGE_KEY =
  'enclaii-tauri-basic-auth';

const PAGE_SIZE = 15;
const PATIENTS_SYNC_INTERVAL_MS = 3000;

let patients = [];
let filteredPatients = [];
let currentPage = 1;
let patientToDelete = null;
let selectedPatient = null;

let patientsSyncTimer = null;
let patientsSyncRunning = false;
let patientsFingerprint = '';
let patientsModuleActive = false;
let openMenuPatientId = null;

function apiBaseUrl() {
  return String(
    localStorage.getItem('enclaii-api-url') ||
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/, '');
}

function endpoint(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '');

  return `${apiBaseUrl()}/api/tauri/pacientes${
    cleanPath ? `/${cleanPath}` : ''
  }`;
}

function token() {
  return String(
    sessionStorage.getItem(AUTH_STORAGE_KEY) ||
    localStorage.getItem(AUTH_STORAGE_KEY) ||
    ''
  )
    .replace(/^Bearer\s+/i, '')
    .trim();
}

async function request(path = '', options = {}) {
  const authToken = token();

  if (!authToken) {
    const error = new Error(
      'No existe una sesión activa.'
    );

    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const response = await laravelFetch(endpoint(path), {
    ...options,

    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(options.headers || {}),
    },

    credentials: 'include',
  });

  const contentType =
    response.headers.get('content-type') || '';

  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};

  if (
    response.status === 401 ||
    response.status === 419
  ) {
    const error = new Error(
      'Tu sesión terminó.'
    );

    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (
    !response.ok ||
    payload?.ok === false ||
    payload?.success === false
  ) {
    throw new Error(
      payload?.message ||
      `Laravel respondió HTTP ${response.status}.`
    );
  }

  return payload;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.length
    ? words
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase()
    : 'PX';
}

function formatDate(value) {
  if (!value) {
    return 'Sin fecha';
  }

  const date = new Date(
    String(value).length === 10
      ? `${value}T00:00:00`
      : value
  );

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function normalizeStudy(study = {}) {
  return {
    id: study.id,
    tipo:
      study.procedimiento ||
      study.tipo ||
      'Estudio',
    fecha:
      study.fecha ||
      study.created_at ||
      '',
    estado:
      study.estado ||
      study.status ||
      '',
  };
}

function normalizePatient(patient = {}) {
  const name =
    patient.nombre_completo ||
    patient.name ||
    'Paciente sin nombre';

  const latest =
    patient.ultimo_estudio ||
    patient.latest_study ||
    null;

  const studies = Array.isArray(patient.estudios)
    ? patient.estudios.map(normalizeStudy)
    : latest
      ? [normalizeStudy(latest)]
      : [];

  return {
    ...patient,

    id:
      patient.id ||
      patient.patient_id,

    name,
    initials: initials(name),

    folio:
      patient.folio ||
      patient.identificacion ||
      'Sin folio',

    age:
      patient.edad !== null &&
      patient.edad !== undefined
        ? `${patient.edad} años`
        : 'Sin edad',

    gender:
      patient.sexo ||
      patient.gender ||
      'No especificado',

    dob:
      formatDate(
        patient.fecha_nacimiento ||
        patient.dob
      ),

    birth_date:
      patient.fecha_nacimiento ||
      patient.dob ||
      '',

    phone:
      patient.telefono ||
      patient.phone ||
      'Sin teléfono',

    email:
      patient.email ||
      'Sin correo',

    address:
      patient.direccion ||
      patient.address ||
      'Sin dirección',

    medico:
      patient.medico ||
      'Sin médico',

    procedimiento:
      patient.procedimiento ||
      '',

    foto_url:
      patient.foto_url ||
      patient.photo_url ||
      '',

    status:
      latest?.estado ||
      patient.estado ||
      patient.status ||
      '',

    study_date:
      latest?.fecha ||
      latest?.created_at ||
      '',

    study_type:
      latest?.procedimiento ||
      latest?.tipo ||
      patient.procedimiento ||
      '',

    estudios: studies,

    estudios_count:
      patient.estudios_count ??
      studies.length,

    updated_at:
      patient.updated_at ||
      '',
  };
}

function normalizePayload(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.pacientes)
      ? payload.pacientes
      : Array.isArray(payload?.patients)
        ? payload.patients
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

  return list.map(normalizePatient);
}

// Algunas fotos de Laravel llegan con URLs firmadas (token/expiración que
// cambia en cada respuesta) aunque la imagen sea la misma. Si se incluyera
// esa URL completa en el fingerprint, cada polling de 3s detectaria un
// "cambio" falso y forzaria un re-render completo de la tabla, recargando
// los avatares y cerrando cualquier menu de opciones abierto. Por eso aqui
// se ignoran query string/hash antes de comparar.
function stableUrl(value) {
  return String(value || '').split(/[?#]/)[0];
}

function createFingerprint(list = []) {
  return JSON.stringify(
    list.map((patient) => ({
      id: patient.id,
      folio: patient.folio,
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      phone: patient.phone,
      email: patient.email,
      medico: patient.medico,
      procedimiento: patient.procedimiento,
      foto_url: stableUrl(patient.foto_url),
      estudios_count: patient.estudios_count,
      study_date: patient.study_date,
      study_type: patient.study_type,
      status: patient.status,
      updated_at: patient.updated_at,
    }))
  );
}

function currentRouteIsPatients() {
  return (
    window.location.hash
      .replace(/^#/, '')
      .split('?')[0] === 'pacientes'
  );
}

function showLoading() {
  const body =
    document.getElementById('patientsTableBody');

  if (body) {
    body.innerHTML = `
      <div style="
        padding:40px;
        text-align:center;
        color:var(--txt-soft);
      ">
        Cargando pacientes desde Laravel...
      </div>
    `;
  }
}

function showError(error) {
  const body =
    document.getElementById('patientsTableBody');

  if (body) {
    body.innerHTML = `
      <div style="
        padding:40px;
        text-align:center;
        color:var(--txt-soft);
      ">
        <strong style="
          display:block;
          color:var(--txt);
          margin-bottom:8px;
        ">
          No se pudieron cargar los pacientes
        </strong>

        ${escapeHtml(error.message)}
      </div>
    `;
  }
}

async function loadPatients({
  silent = false,
} = {}) {
  if (!silent) {
    showLoading();
  }

  try {
    const payload = await request();
    const nextPatients = normalizePayload(payload);

    patients = nextPatients;
    filteredPatients = [...nextPatients];

    patientsFingerprint =
      createFingerprint(nextPatients);

    currentPage = 1;

    fillDoctorFilter();
    renderPage(1);
  } catch (error) {
    console.error(error);

    if (!silent) {
      showError(error);
    }
  }
}

async function syncPatientsFromLaravel({
  force = false,
} = {}) {
  if (
    patientsSyncRunning ||
    !patientsModuleActive ||
    !currentRouteIsPatients() ||
    !navigator.onLine
  ) {
    return;
  }

  patientsSyncRunning = true;

  try {
    const payload = await request();
    const nextPatients = normalizePayload(payload);

    const nextFingerprint =
      createFingerprint(nextPatients);

    if (
      !force &&
      nextFingerprint === patientsFingerprint
    ) {
      return;
    }

    const selectedId =
      selectedPatient?.id || null;

    const searchValue =
      document
        .getElementById('searchInput')
        ?.value
        .trim() || '';

    patients = nextPatients;
    patientsFingerprint = nextFingerprint;

    fillDoctorFilter();

    if (searchValue) {
      filterPatients();
    } else {
      filteredPatients = [...patients];
      renderPage(currentPage);
    }

    if (selectedId) {
      const index = patients.findIndex(
        (patient) =>
          String(patient.id) ===
          String(selectedId)
      );

      if (index >= 0) {
        openPanel(index);
      } else {
        closePanel();
      }
    }

    document.dispatchEvent(
      new CustomEvent('enclaii:patients-updated', {
        detail: {
          patients: [...patients],
        },
      })
    );
  } catch (error) {
    console.error(
      'Error sincronizando pacientes:',
      error
    );
  } finally {
    patientsSyncRunning = false;
  }
}

function startRealtimeSync() {
  stopRealtimeSync();

  patientsModuleActive = true;

  patientsSyncTimer = window.setInterval(() => {
    syncPatientsFromLaravel();
  }, PATIENTS_SYNC_INTERVAL_MS);
}

function stopRealtimeSync() {
  if (patientsSyncTimer) {
    window.clearInterval(patientsSyncTimer);
    patientsSyncTimer = null;
  }
}

function normalizeStatus(status) {
  const value = String(status || '')
    .toLowerCase()
    .trim();

  const statuses = {
    completado: 'completed',
    completed: 'completed',
    espera: 'waiting',
    esperando: 'waiting',
    waiting: 'waiting',
    cancelado: 'cancelled',
    cancelled: 'cancelled',
  };

  return statuses[value] || '';
}

function statusLabel(status) {
  return {
    completed: 'Completado',
    waiting: 'En espera',
    cancelled: 'Cancelado',
  }[status] || '';
}

function rowHtml(patient, index) {
  const status = normalizeStatus(patient.status);

  const avatar = patient.foto_url
    ? `
      <img
        src="${escapeHtml(patient.foto_url)}"
        alt="${escapeHtml(patient.name)}"
      >
    `
    : escapeHtml(patient.initials);

  return `
    <div
      class="patient-row"
      data-index="${index}"
      data-patient-id="${escapeHtml(patient.id)}"
      onclick="openPanel(${index})"
    >
      <div class="patient-info">
        <div class="patient-avatar">
          ${avatar}
        </div>

        <div>
          <div class="patient-name">
            ${escapeHtml(patient.name)}
          </div>

          <div class="patient-meta">
            ${escapeHtml(patient.age)}
            ·
            ${escapeHtml(patient.gender)}
          </div>
        </div>
      </div>

      <div class="cell">
        ${escapeHtml(patient.folio)}
      </div>

      <div class="cell cell-fecha cell-muted">
        ${escapeHtml(patient.dob)}
      </div>

      <div class="cell-study">
        <span class="date study-date">
          ${
            patient.study_date
              ? escapeHtml(
                  formatDate(patient.study_date)
                )
              : ''
          }
        </span>

        <span class="type">
          ${escapeHtml(
            patient.study_type ||
            'Sin estudios'
          )}
        </span>
      </div>

      <div class="col-status">
        ${
          status
            ? `
              <span class="status ${status}">
                ${statusLabel(status)}
              </span>
            `
            : ''
        }
      </div>

      <div class="actions-wrapper">
        <button
          type="button"
          class="btn-more"
          onclick="
            event.stopPropagation();
            toggleMenu(this);
          "
        >
          ⋮
        </button>

        <div
          class="actions-dropdown"
          onclick="event.stopPropagation()"
        >
          <a
            href="#"
            onclick="
              openPatientEdit(${index});
              return false;
            "
          >
            Editar información
          </a>

          <a
            href="#"
            onclick="
              startPatientStudy(${index});
              return false;
            "
          >
            Iniciar estudio
          </a>

          <a
            href="#"
            data-nav="ia-reportes"
            onclick="
              openPatientReport(${index});
              return false;
            "
          >
            Crear informe
          </a>

          <a
            href="#"
            class="danger"
            onclick="
              deletePatient(${index});
              return false;
            "
          >
            Eliminar paciente
          </a>
        </div>
      </div>
    </div>
  `;
}

function renderPage(page = 1) {
  const total = filteredPatients.length;

  const totalPages = Math.max(
    Math.ceil(total / PAGE_SIZE),
    1
  );

  currentPage = Math.min(
    Math.max(page, 1),
    totalPages
  );

  const start =
    (currentPage - 1) * PAGE_SIZE;

  const end = Math.min(
    start + PAGE_SIZE,
    total
  );

  const items =
    filteredPatients.slice(start, end);

  const body =
    document.getElementById('patientsTableBody');

  if (body) {
    body.innerHTML = items.length
      ? items
          .map((patient) => {
            const index =
              patients.findIndex(
                (item) =>
                  String(item.id) ===
                  String(patient.id)
              );

            return rowHtml(patient, index);
          })
          .join('')
      : `
        <div style="
          padding:40px;
          text-align:center;
          color:var(--txt-soft);
        ">
          No se encontraron pacientes.
        </div>
      `;
  }

  const info =
    document.getElementById('paginationInfo');

  if (info) {
    info.textContent =
      total === 0
        ? 'Mostrando 0 pacientes'
        : `Mostrando ${start + 1} a ${end} de ${total} pacientes`;
  }

  renderPagination(totalPages);
  restoreOpenMenu();
}

function renderPagination(totalPages) {
  const container =
    document.getElementById(
      'paginationControls'
    );

  if (!container) {
    return;
  }

  let html = `
    <button
      class="page-btn"
      onclick="renderPage(${currentPage - 1})"
      ${currentPage <= 1 ? 'disabled' : ''}
    >
      ‹
    </button>
  `;

  for (
    let page = 1;
    page <= totalPages;
    page += 1
  ) {
    html += `
      <button
        class="page-btn ${
          page === currentPage ? 'active' : ''
        }"
        onclick="renderPage(${page})"
      >
        ${page}
      </button>
    `;
  }

  html += `
    <button
      class="page-btn"
      onclick="renderPage(${currentPage + 1})"
      ${currentPage >= totalPages ? 'disabled' : ''}
    >
      ›
    </button>
  `;

  container.innerHTML = html;
}

function navigateToPatientCreate() {
  sessionStorage.removeItem(
    'enclaii-edit-patient-id'
  );

  window.location.hash =
    'pacientes-crear';
}

function openPatientEdit(index) {
  const patient = patients[index];

  if (!patient?.id) {
    return;
  }

  sessionStorage.setItem(
    'enclaii-edit-patient-id',
    String(patient.id)
  );

  window.location.hash =
    'pacientes-editar';
}

function openPatientReport(index) {
  const patient = patients[index];

  if (!patient?.id) {
    return;
  }

  sessionStorage.setItem(
    'enclaii-report-patient-id',
    String(patient.id)
  );

  window.location.hash = 'ia-reportes';
}

function setPanelText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value ?? '—';
  }
}

function openPanel(index) {
  const patient = patients[index];

  if (!patient) {
    return;
  }

  selectedPatient = patient;

  const avatar =
    document.getElementById('panelAvatar');

  if (avatar) {
    avatar.innerHTML = patient.foto_url
      ? `
        <img
          src="${escapeHtml(patient.foto_url)}"
          alt="${escapeHtml(patient.name)}"
          style="
            width:100%;
            height:100%;
            object-fit:cover;
            border-radius:inherit;
          "
        >
      `
      : escapeHtml(patient.initials);
  }

  setPanelText('panelName', patient.name);
  setPanelText('panelFolio', `Folio: ${patient.folio}`);
  setPanelText('panelAge', patient.age);
  setPanelText('panelGender', patient.gender);
  setPanelText('panelDob', patient.dob);
  setPanelText('panelPhone', patient.phone);
  setPanelText('panelEmail', patient.email);
  setPanelText('panelAddress', patient.address);
  setPanelText('panelMedicoInfo', patient.medico);
  setPanelText(
    'panelStatus',
    statusLabel(normalizeStatus(patient.status)) ||
    'Sin estado'
  );
  setPanelText(
    'panelLastStudy',
    patient.study_type || 'Sin estudios'
  );
  setPanelText(
    'panelTotalStudies',
    patient.estudios_count
  );

  setPanelText('reportPanelName', patient.name);
  setPanelText('reportPanelFolio', `Folio: ${patient.folio}`);
  setPanelText(
    'reportPanelMeta',
    `${patient.age} · ${patient.gender} · ${patient.dob}`
  );
  setPanelText('reportPanelAvatar', patient.initials);

  renderHistory(patient);

  document
    .getElementById('contentWrapper')
    ?.classList.add('panel-open');
}

function renderHistory(patient) {
  const list =
    document.getElementById('historialList');

  const empty =
    document.getElementById('historialEmpty');

  if (!list || !empty) {
    return;
  }

  if (!patient.estudios.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  list.innerHTML = patient.estudios
    .slice(0, 5)
    .map((study) => `
      <div class="historial-item">
        <div class="historial-info">
          <div class="historial-title">
            ${escapeHtml(study.tipo)}
          </div>

          <div class="historial-doctor">
            ${escapeHtml(patient.medico)}
          </div>
        </div>

        <div class="historial-date">
          ${escapeHtml(formatDate(study.fecha))}
        </div>
      </div>
    `)
    .join('');
}

function closePanel() {
  document
    .getElementById('contentWrapper')
    ?.classList.remove('panel-open');

  selectedPatient = null;
}

function showTab(tabName) {
  document
    .querySelectorAll('.tab-btn')
    .forEach((button) => {
      button.classList.remove('active');
    });

  document
    .querySelectorAll('.tab-content')
    .forEach((content) => {
      content.classList.remove('active');
    });

  document
    .getElementById(`tab-${tabName}`)
    ?.classList.add('active');
}

function toggleMenu(button) {
  const menu = button
    .closest('.actions-wrapper')
    ?.querySelector('.actions-dropdown');

  if (!menu) {
    return;
  }

  document
    .querySelectorAll('.actions-dropdown.active')
    .forEach((element) => {
      if (element !== menu) {
        element.classList.remove('active');
      }
    });

  menu.classList.toggle('active');

  const patientId = button
    .closest('.patient-row')
    ?.dataset.patientId;

  openMenuPatientId = menu.classList.contains('active')
    ? patientId || null
    : null;
}

function restoreOpenMenu() {
  if (!openMenuPatientId) {
    return;
  }

  const row = document.querySelector(
    `.patient-row[data-patient-id="${openMenuPatientId}"]`
  );

  row?.querySelector('.actions-dropdown')?.classList.add('active');
}

function deletePatient(index) {
  patientToDelete = patients[index];

  if (!patientToDelete) {
    return;
  }

  setPanelText(
    'modalEliminarNombre',
    patientToDelete.name
  );

  const modal =
    document.getElementById('modalEliminar');

  if (modal) {
    modal.style.display = 'flex';
  }
}

function cancelarEliminar() {
  patientToDelete = null;

  const modal =
    document.getElementById('modalEliminar');

  if (modal) {
    modal.style.display = 'none';
  }
}

async function confirmarEliminar() {
  if (!patientToDelete?.id) {
    return;
  }

  try {
    await request(
      encodeURIComponent(patientToDelete.id),
      {
        method: 'DELETE',
      }
    );

    cancelarEliminar();

    await syncPatientsFromLaravel({
      force: true,
    });
  } catch (error) {
    window.alert(error.message);
  }
}

function fillDoctorFilter() {
  const select =
    document.getElementById('fMedico');

  if (!select) {
    return;
  }

  const currentValue = select.value;

  const doctors = [
    ...new Set(
      patients
        .map((patient) => patient.medico)
        .filter(
          (doctor) =>
            doctor &&
            doctor !== 'Sin médico'
        )
    ),
  ].sort((a, b) =>
    a.localeCompare(b, 'es')
  );

  select.innerHTML = `
    <option value="">
      Seleccionar médico
    </option>
  `;

  doctors.forEach((doctor) => {
    const option =
      document.createElement('option');

    option.value = doctor;
    option.textContent = doctor;

    select.appendChild(option);
  });

  select.value = currentValue;
}

function filterPatients() {
  const term = String(
    document.getElementById('searchInput')?.value || ''
  )
    .toLowerCase()
    .trim();

  filteredPatients = term
    ? patients.filter((patient) =>
        [
          patient.name,
          patient.folio,
          patient.phone,
          patient.email,
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(term)
        )
      )
    : [...patients];

  renderPage(1);
}

function openFilters() {
  document
    .getElementById('filterPanel')
    ?.classList.add('open');

  document
    .getElementById('filterOverlay')
    ?.classList.add('open');
}

function closeFilters() {
  document
    .getElementById('filterPanel')
    ?.classList.remove('open');

  document
    .getElementById('filterOverlay')
    ?.classList.remove('open');
}

function clearFilters() {
  [
    'fNombre',
    'fMedico',
    'fEstado',
    'fUltimoEstudio',
    'fFechaNacimiento',
    'fFolio',
  ].forEach((id) => {
    const field = document.getElementById(id);

    if (field) {
      field.value = '';
    }
  });

  filteredPatients = [...patients];
  renderPage(1);
}

function applyFilters() {
  const name = String(
    document.getElementById('fNombre')?.value || ''
  ).toLowerCase();

  const doctor = String(
    document.getElementById('fMedico')?.value || ''
  ).toLowerCase();

  const folio = String(
    document.getElementById('fFolio')?.value || ''
  ).toLowerCase();

  const birthDate =
    document.getElementById(
      'fFechaNacimiento'
    )?.value || '';

  filteredPatients = patients.filter((patient) => {
    if (
      name &&
      !patient.name.toLowerCase().includes(name)
    ) {
      return false;
    }

    if (
      doctor &&
      patient.medico.toLowerCase() !== doctor
    ) {
      return false;
    }

    if (
      folio &&
      !patient.folio.toLowerCase().includes(folio)
    ) {
      return false;
    }

    if (
      birthDate &&
      patient.birth_date !== birthDate
    ) {
      return false;
    }

    return true;
  });

  closeFilters();
  renderPage(1);
}

function toggleEstadoFilter() {
  document
    .getElementById('estadoFilterDropdown')
    ?.classList.toggle('active');
}

function filterByEstado(status) {
  if (status === 'all') {
    filteredPatients = [...patients];
  } else {
    const map = {
      completado: 'completed',
      espera: 'waiting',
      cancelado: 'cancelled',
    };

    filteredPatients = patients.filter(
      (patient) =>
        normalizeStatus(patient.status) ===
        map[status]
    );
  }

  renderPage(1);
}

function toggleOrdenar(type) {
  const id =
    type === 'paciente'
      ? 'ordenarPacienteDropdown'
      : 'ordenarEstudioDropdown';

  document
    .getElementById(id)
    ?.classList.toggle('active');
}

function ordenarPor(type, criterion) {
  if (criterion === 'default') {
    filteredPatients = [...patients];
  }

  if (
    type === 'paciente' &&
    criterion === 'nombre-asc'
  ) {
    filteredPatients.sort((a, b) =>
      a.name.localeCompare(b.name, 'es')
    );
  }

  if (
    type === 'paciente' &&
    criterion === 'nombre-desc'
  ) {
    filteredPatients.sort((a, b) =>
      b.name.localeCompare(a.name, 'es')
    );
  }

  if (
    type === 'estudio' &&
    criterion === 'fecha-reciente'
  ) {
    filteredPatients.sort(
      (a, b) =>
        new Date(b.study_date || 0) -
        new Date(a.study_date || 0)
    );
  }

  if (
    type === 'estudio' &&
    criterion === 'fecha-antigua'
  ) {
    filteredPatients.sort(
      (a, b) =>
        new Date(a.study_date || 0) -
        new Date(b.study_date || 0)
    );
  }

  renderPage(1);
}

function startPatientStudy(index) {
  const patient = patients[index];

  if (!patient?.id) {
    return;
  }

  const params = new URLSearchParams({
    patient_id: String(patient.id),
    patient_name: patient.name,
    study_label:
      patient.study_type ||
      patient.procedimiento ||
      'Endoscopia',
  });

  sessionStorage.setItem(
    'enclaii-patient_id',
    String(patient.id)
  );

  sessionStorage.setItem(
    'enclaii-patient_name',
    patient.name
  );

  window.location.href =
    `./index.html?${params.toString()}`;
}

function bindRealtimeEvents() {
  if (
    document.documentElement.dataset
      .patientsRealtimeBound === 'true'
  ) {
    return;
  }

  document.documentElement.dataset
    .patientsRealtimeBound = 'true';

  window.addEventListener('focus', () => {
    syncPatientsFromLaravel({
      force: true,
    });
  });

  window.addEventListener('online', () => {
    syncPatientsFromLaravel({
      force: true,
    });
  });

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState === 'visible'
      ) {
        syncPatientsFromLaravel({
          force: true,
        });
      }
    }
  );

  document.addEventListener(
    'enclaii:route-loaded',
    (event) => {
      if (
        event.detail?.route === 'pacientes'
      ) {
        patientsModuleActive = true;
        startRealtimeSync();

        syncPatientsFromLaravel({
          force: true,
        });
      } else {
        patientsModuleActive = false;
        stopRealtimeSync();
      }
    }
  );

  document.addEventListener(
    'enclaii:patient-saved',
    () => {
      syncPatientsFromLaravel({
        force: true,
      });
    }
  );
}

function bindPageEvents() {
  document
    .getElementById('btnNuevoPaciente')
    ?.addEventListener('click', (event) => {
      event.preventDefault();
      navigateToPatientCreate();
    });

  document.addEventListener('click', (event) => {
    if (
      !event.target.closest('.actions-wrapper')
    ) {
      document
        .querySelectorAll(
          '.actions-dropdown.active'
        )
        .forEach((menu) => {
          menu.classList.remove('active');
        });

      openMenuPatientId = null;
    }
  });
}

export async function initPacientes() {
  patientsModuleActive = true;

  bindPageEvents();
  bindRealtimeEvents();

  await loadPatients();

  startRealtimeSync();

  if (
    sessionStorage.getItem(
      'enclaii-patients-refresh'
    )
  ) {
    sessionStorage.removeItem(
      'enclaii-patients-refresh'
    );

    await syncPatientsFromLaravel({
      force: true,
    });
  }
}

Object.assign(window, {
  renderPage,
  openPanel,
  closePanel,
  showTab,
  toggleMenu,

  navigateToPatientCreate,
  openPatientEdit,
  openPatientReport,

  deletePatient,
  cancelarEliminar,
  confirmarEliminar,

  openFilters,
  closeFilters,
  clearFilters,
  applyFilters,
  filterPatients,

  toggleEstadoFilter,
  filterByEstado,

  toggleOrdenar,
  ordenarPor,

  startPatientStudy,

  syncPatientsFromLaravel,
  startPatientsRealtimeSync: startRealtimeSync,
  stopPatientsRealtimeSync: stopRealtimeSync,
});