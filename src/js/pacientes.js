import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from './laravel.js';
import { runWithConcurrencyLimit } from './concurrency.js';
import { getAuthToken } from './auth.js';
import { escapeHtml } from './html.js';
import {
  EDIT_PATIENT_ID_STORAGE_KEY,
  REPORT_PATIENT_ID_STORAGE_KEY,
  STUDY_PATIENT_ID_STORAGE_KEY,
  STUDY_PATIENT_NAME_STORAGE_KEY,
  STUDY_ID_STORAGE_KEY,
  STUDY_LABEL_STORAGE_KEY,
  PATIENTS_REFRESH_STORAGE_KEY,
} from './storage-keys.js';

const PAGE_SIZE = 15;

// El backend (TauriPatientController::index) acepta 'per_page' y 'page'
// pero SIEMPRE lo topa a 100 (min($request->integer('per_page', 100), 100)),
// sin importar que se pida mas. Pedir per_page=1000 no trae 1000 registros:
// trae 100 y el resto queda invisible para el listado local. Por eso aqui
// se respeta ese tope real y, si hay mas de una pagina, se traen todas.
const PATIENTS_SERVER_PAGE_SIZE = 100;
const PATIENTS_MAX_SERVER_PAGES = 50; // limite de seguridad: hasta 5000 pacientes
const PATIENTS_PAGE_FETCH_CONCURRENCY = 4;
const PATIENTS_SYNC_INTERVAL_MS = 3000;

// Paciente no usa soft deletes: un registro eliminado simplemente
// desaparece de la tabla y 'updated_since' jamas se enterara de eso.
// Por eso cada N ciclos de sync incremental se hace una reconciliacion
// completa (fetchAllPatients) para detectar eliminaciones. El resto de
// los ciclos usan delta sync (solo lo que cambio desde el ultimo poll).
const PATIENTS_FULL_RESYNC_EVERY_TICKS = 10; // ~30s con intervalo de 3s

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
let lastSyncedAt = null;
let syncTickCount = 0;

function endpoint(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const base =
    `${apiBaseUrl()}/api/tauri/pacientes`;

  if (cleanPath.startsWith('?')) {
    return `${base}${cleanPath}`;
  }

  return `${base}${cleanPath ? `/${cleanPath}` : ''}`;
}

function galleryEndpoint(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const base =
    `${apiBaseUrl()}/api/tauri/galeria`;

  if (cleanPath.startsWith('?')) {
    return `${base}${cleanPath}`;
  }

  return `${base}${cleanPath ? `/${cleanPath}` : ''}`;
}

async function requestUrl(url, options = {}) {
  const authToken = getAuthToken();

  if (!authToken) {
    const error = new Error(
      'No existe una sesión activa.'
    );

    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const response = await laravelFetch(url, {
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
      `El servidor respondió HTTP ${response.status}.`
    );
  }

  return payload;
}

async function request(path = '', options = {}) {
  return requestUrl(endpoint(path), options);
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

function patientStudyList(patient = {}) {
  if (Array.isArray(patient.estudios)) {
    return patient.estudios;
  }

  if (Array.isArray(patient.estudios?.data)) {
    return patient.estudios.data;
  }

  if (Array.isArray(patient.studies)) {
    return patient.studies;
  }

  if (Array.isArray(patient.studies?.data)) {
    return patient.studies.data;
  }

  if (Array.isArray(patient.historial)) {
    return patient.historial;
  }

  if (Array.isArray(patient.historial?.data)) {
    return patient.historial.data;
  }

  if (Array.isArray(patient.history)) {
    return patient.history;
  }

  if (Array.isArray(patient.history?.data)) {
    return patient.history.data;
  }

  if (Array.isArray(patient.estudios_realizados)) {
    return patient.estudios_realizados;
  }

  if (Array.isArray(patient.estudios_realizados?.data)) {
    return patient.estudios_realizados.data;
  }

  if (Array.isArray(patient.study_summaries)) {
    return patient.study_summaries;
  }

  if (Array.isArray(patient.studySummaries)) {
    return patient.studySummaries;
  }

  if (Array.isArray(patient.study_groups)) {
    return patient.study_groups;
  }

  if (Array.isArray(patient.studyGroups)) {
    return patient.studyGroups;
  }

  return null;
}

function optionalCount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const count = Number(value);

  return Number.isFinite(count) && count >= 0
    ? count
    : null;
}

function patientStudyCount(patient = {}) {
  return (
    optionalCount(patient.estudios_count) ??
    optionalCount(patient.studies_count) ??
    optionalCount(patient.historial_count) ??
    optionalCount(patient.history_count) ??
    optionalCount(patient.detailStudies) ??
    optionalCount(patient.detail_studies) ??
    optionalCount(patient.estudios?.total) ??
    optionalCount(patient.studies?.total) ??
    optionalCount(patient.historial?.total) ??
    optionalCount(patient.history?.total) ??
    optionalCount(patient.estudios_realizados?.total)
  );
}

function arrayFrom(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.data)) {
    return value.data;
  }

  return [];
}

function mediaStudyList(source = {}) {
  const media = [
    ...arrayFrom(source.media),
    ...arrayFrom(source.archivos),
    ...arrayFrom(source.files),
    ...arrayFrom(source.capturas),
    ...arrayFrom(source.captures),
    ...arrayFrom(source.imagenes),
    ...arrayFrom(source.images),
    ...arrayFrom(source.fotos),
    ...arrayFrom(source.photos),
    ...arrayFrom(source.videos),
  ];

  const groups = new Map();

  media.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const id =
      item.estudio_id ||
      item.study_id ||
      item.session_id ||
      '';
    const folio =
      item.estudio_folio ||
      item.study_folio ||
      item.folio_estudio ||
      '';
    const label =
      item.procedimiento ||
      item.study_label ||
      item.estudio ||
      item.study ||
      item.tipo ||
      '';
    const date =
      item.fecha_estudio ||
      item.study_date ||
      item.date ||
      item.fecha ||
      item.created_at ||
      '';
    const key = String(
      id ||
      folio ||
      (
        label || date
          ? `${label}-${date || index}`
          : ''
      )
    ).trim();

    if (!key) {
      return;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        id,
        folio,
        procedimiento: label,
        fecha: date,
        estado:
          item.estado_estudio ||
          item.study_status ||
          item.estado ||
          item.status ||
          '',
        archivos_count: 0,
      });
    }

    groups.get(key).archivos_count += 1;
  });

  return [...groups.values()];
}

function availableStudyList(source = {}) {
  const directStudies = patientStudyList(source);
  const mediaStudies = mediaStudyList(source);

  if (!directStudies?.length) {
    return mediaStudies;
  }

  if (!mediaStudies.length) {
    return directStudies;
  }

  const byKey = new Map();

  [...directStudies, ...mediaStudies].forEach((study, index) => {
    const normalized = normalizeStudy(study);
    const key = String(
      normalized.id ||
      normalized.folio ||
      `${normalized.tipo}-${normalized.fecha || index}`
    );

    if (!byKey.has(key)) {
      byKey.set(key, study);
      return;
    }

    byKey.set(key, {
      ...byKey.get(key),
      ...study,
    });
  });

  return [...byKey.values()];
}

function studyFilesCount(study = {}) {
  const directCount =
    optionalCount(study.archivos_count) ??
    optionalCount(study.files_count) ??
    optionalCount(study.media_count) ??
    optionalCount(study.capturas_count);

  if (directCount !== null) {
    return directCount;
  }

  const imageCount =
    optionalCount(study.imagenes_count) ??
    optionalCount(study.images_count) ??
    optionalCount(study.fotos_count) ??
    optionalCount(study.photos_count) ??
    0;

  const videoCount =
    optionalCount(study.videos_count) ??
    optionalCount(study.video_count) ??
    0;

  if (imageCount + videoCount > 0) {
    return imageCount + videoCount;
  }

  const collections = [
    study.archivos,
    study.files,
    study.media,
    study.capturas,
  ];

  for (const collection of collections) {
    if (Array.isArray(collection)) {
      return collection.length;
    }
  }

  return null;
}

function studyFolio(study = {}) {
  const id =
    study.id ||
    study.estudio_id ||
    study.study_id;

  return (
    study.folio ||
    study.codigo ||
    study.code ||
    study.estudio_folio ||
    study.study_folio ||
    study.numero_folio ||
    study.numero ||
    (
      id
        ? `E-${String(id).padStart(4, '0')}`
        : ''
    )
  );
}

function studyDateValue(study = {}) {
  return (
    study.fecha ||
    study.fecha_estudio ||
    study.study_date ||
    study.date ||
    study.created_at ||
    study.updated_at ||
    ''
  );
}

function studyTimestamp(study = {}) {
  const value = studyDateValue(study);

  if (!value) {
    return 0;
  }

  const date = new Date(
    String(value).length === 10
      ? `${value}T00:00:00`
      : value
  );

  return Number.isNaN(date.getTime())
    ? 0
    : date.getTime();
}

function sortStudiesByDate(studies = []) {
  return [...studies].sort(
    (left, right) =>
      studyTimestamp(right) - studyTimestamp(left)
  );
}

function normalizeStudy(study = {}) {
  return {
    id:
      study.id ||
      study.estudio_id ||
      study.study_id,
    folio: studyFolio(study),
    tipo:
      study.procedimiento ||
      study.procedure ||
      study.nombre ||
      study.nombre_estudio ||
      study.study_label ||
      study.label ||
      study.estudio ||
      study.tipo ||
      'Estudio',
    fecha: studyDateValue(study),
    estado:
      study.estado ||
      study.estado_estudio ||
      study.estatus ||
      study.study_status ||
      study.studyStatus ||
      study.status ||
      '',
    archivos_count: studyFilesCount(study),
    updated_at:
      study.updated_at ||
      '',
  };
}

function patientPhotoUrl(patient = {}) {
  return firstLaravelAssetUrl(patient, [
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
    'fotoUrl',
    'photoUrl',
    'avatarUrl',
    'profilePhotoUrl',
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
    'fotografia_path',
    'imagen_path',
    'image_path',
    'ruta_foto',
    'ruta_imagen',
  ]);
}

function normalizePatient(patient = {}) {
  const name =
    patient.nombre_completo ||
    patient.nombre ||
    patient.name ||
    'Paciente sin nombre';

  const latest =
    patient.ultimo_estudio ||
    patient.latest_study ||
    null;

  const rawStudies = patientStudyList(patient);
  const hasExplicitStudyList = rawStudies !== null;
  const usesLatestStudyFallback =
    !hasExplicitStudyList && Boolean(latest);

  const studies = rawStudies
    ? sortStudiesByDate(
        rawStudies.map(normalizeStudy)
      )
    : latest
      ? [normalizeStudy(latest)]
      : [];

  const latestNormalizedStudy =
    studies[0] || null;

  const explicitStudyCount =
    patientStudyCount(patient);
  const hasExplicitStudyCount =
    explicitStudyCount !== null ||
    patient.studies_count_is_explicit === true;

  const totalStudies =
    explicitStudyCount ??
    studies.length;

  const hasCompleteHistory =
    Boolean(patient.history_loaded) ||
    (
      hasExplicitStudyList &&
      (
        explicitStudyCount === null ||
        studies.length >= totalStudies
      )
    ) ||
    (
      !hasExplicitStudyList &&
      !latest &&
      explicitStudyCount === 0
    );

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
      patientPhotoUrl(patient),

    status:
      latest?.estado ||
      latest?.estatus ||
      patient.estado ||
      patient.status ||
      latestNormalizedStudy?.estado ||
      '',

    study_date:
      latest?.fecha ||
      latest?.fecha_estudio ||
      latest?.study_date ||
      latest?.created_at ||
      latestNormalizedStudy?.fecha ||
      '',

    study_type:
      latest?.procedimiento ||
      latest?.procedure ||
      latest?.nombre ||
      latest?.nombre_estudio ||
      latest?.study_label ||
      latest?.label ||
      latest?.estudio ||
      latest?.tipo ||
      patient.procedimiento ||
      patient.procedure ||
      latestNormalizedStudy?.tipo ||
      '',

    estudios: studies,

    estudios_count: totalStudies,
    studies_count_is_explicit: hasExplicitStudyCount,

    history_loaded: hasCompleteHistory,
    history_from_latest: usesLatestStudyFallback,

    updated_at:
      patient.updated_at ||
      '',
  };
}

// Trae TODAS las paginas del listado de pacientes de la clinica, no solo
// la primera. El backend ya pagina correctamente; el problema historico
// era que el frontend pedia un 'per_page' irreal y asumia que ahi venia
// todo. Con esto, un paciente numero 250 ya no desaparece del listado.
async function fetchAllPatients() {
  const firstPayload = await request(
    `?per_page=${PATIENTS_SERVER_PAGE_SIZE}&page=1`
  );

  let allPatients = normalizePayload(firstPayload);

  const reportedLastPage =
    Number(firstPayload?.pagination?.last_page) || 1;

  const lastPage = Math.min(
    reportedLastPage,
    PATIENTS_MAX_SERVER_PAGES
  );

  if (lastPage > 1) {
    const remainingPages = Array.from(
      { length: lastPage - 1 },
      (_, index) => index + 2
    );

    const pageResults = new Array(remainingPages.length);

    await runWithConcurrencyLimit(
      remainingPages,
      PATIENTS_PAGE_FETCH_CONCURRENCY,
      async (page, index) => {
        const payload = await request(
          `?per_page=${PATIENTS_SERVER_PAGE_SIZE}&page=${page}`
        );

        pageResults[index] = normalizePayload(payload);
      }
    );

    allPatients = allPatients.concat(
      ...pageResults.filter(Boolean)
    );
  }

  if (reportedLastPage > PATIENTS_MAX_SERVER_PAGES) {
    console.warn(
      `Esta clinica tiene mas de ${PATIENTS_MAX_SERVER_PAGES * PATIENTS_SERVER_PAGE_SIZE} pacientes; ` +
      'se muestran solo los primeros. Considera agregar busqueda server-side para listas de este tamano.'
    );
  }

  return {
    patients: allPatients,
    serverTime: firstPayload?.server_time || null,
  };
}

// Sync incremental: solo trae pacientes creados/modificados desde
// 'sinceIso'. Nunca reporta eliminaciones (ver nota de
// PATIENTS_FULL_RESYNC_EVERY_TICKS mas arriba).
async function fetchPatientsDelta(sinceIso) {
  const payload = await request(
    `?per_page=${PATIENTS_SERVER_PAGE_SIZE}&updated_since=${encodeURIComponent(sinceIso)}`
  );

  return {
    patients: normalizePayload(payload),
    serverTime: payload?.server_time || null,
  };
}

function mergePatientsDelta(basePatients, changedPatients) {
  if (!changedPatients.length) {
    return basePatients;
  }

  const merged = [...basePatients];

  changedPatients.forEach((changed) => {
    const index = merged.findIndex(
      (patient) =>
        String(patient.id) === String(changed.id)
    );

    if (index >= 0) {
      merged[index] = changed;
    } else {
      merged.unshift(changed);
    }
  });

  return merged;
}

function normalizePayload(payload) {
  let list = [];

  if (Array.isArray(payload)) {
    list = payload;
  } else if (Array.isArray(payload?.pacientes)) {
    list = payload.pacientes;
  } else if (Array.isArray(payload?.pacientes?.data)) {
    list = payload.pacientes.data;
  } else if (Array.isArray(payload?.patients)) {
    list = payload.patients;
  } else if (Array.isArray(payload?.patients?.data)) {
    list = payload.patients.data;
  } else if (Array.isArray(payload?.data?.data)) {
    list = payload.data.data;
  } else if (Array.isArray(payload?.data)) {
    list = payload.data;
  }

  return list.map(normalizePatient);
}

function galleryPatientsPayload(payload) {
  const list =
    payload?.patients ||
    payload?.pacientes ||
    payload?.data?.patients ||
    payload?.data?.pacientes ||
    payload?.data?.data ||
    payload?.data;

  if (Array.isArray(list)) {
    return list;
  }

  const single =
    payload?.patient ||
    payload?.paciente ||
    payload?.data?.patient ||
    payload?.data?.paciente ||
    null;

  return single ? [single] : [];
}

function compactIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '');
}

function identitiesMatch(left, right) {
  const leftValue = compactIdentity(left);
  const rightValue = compactIdentity(right);

  return Boolean(
    leftValue &&
    rightValue &&
    leftValue === rightValue
  );
}

function patientStrongIdentityValues(patient = {}) {
  return [
    patient.id,
    patient.patient_id,
    patient.paciente_id,
    patient.folio,
    patient.identificacion,
  ].filter(Boolean);
}

function patientNameValue(patient = {}) {
  return (
    patient.nombre_completo ||
    patient.nombre ||
    patient.name ||
    ''
  );
}

function patientPayloadMatches(patient, payload) {
  const patientStrongValues =
    patientStrongIdentityValues(patient);
  const payloadStrongValues =
    patientStrongIdentityValues(payload);

  if (
    patientStrongValues.some((left) =>
      payloadStrongValues.some((right) =>
        identitiesMatch(left, right)
      )
    )
  ) {
    return true;
  }

  return identitiesMatch(
    patientNameValue(patient),
    patientNameValue(payload)
  );
}

function findGalleryPatient(patient, galleryPatients = []) {
  return galleryPatients.find((payload) =>
    patientPayloadMatches(patient, payload)
  ) || null;
}

function patientHistoryNeedsMore(patient = {}) {
  if (!patient?.id) {
    return false;
  }

  const studies = Array.isArray(patient.estudios)
    ? patient.estudios
    : [];

  if (patient.history_from_latest) {
    return !patient.history_loaded;
  }

  const expectedCount =
    optionalCount(patient.estudios_count);

  if (
    expectedCount !== null &&
    patient.studies_count_is_explicit === true
  ) {
    return studies.length < expectedCount;
  }

  return (
    !patient.history_loaded ||
    Boolean(patient.history_from_latest) ||
    (
      studies.length <= 1 &&
      !patient.history_gallery_loaded
    )
  );
}

function studyPayload(payload, patient) {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return {
      ...patient,
      estudios: payload,
      estudios_count: payload.length,
    };
  }

  if (Array.isArray(payload?.data)) {
    return {
      ...patient,
      estudios: payload.data,
      estudios_count:
        patientStudyCount(payload) ??
        payload.data.length,
    };
  }

  if (
    availableStudyList(payload).length ||
    patientStudyList(payload) !== null
  ) {
    return payload;
  }

  return patientDetailPayload(payload);
}

function applyPatientHistoryPayload(patient, payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const studiesFromPayload =
    availableStudyList(payload);
  const hasStudyPayload =
    studiesFromPayload.length > 0 ||
    patientStudyList(payload) !== null;
  const expectedCount =
    patientStudyCount(payload) ??
    (
      patient.studies_count_is_explicit === true
        ? optionalCount(patient.estudios_count)
        : null
    );

  const source = {
    ...patient,
    ...payload,
  };

  if (expectedCount === null) {
    delete source.estudios_count;
    delete source.studies_count;
    delete source.historial_count;
    delete source.history_count;
    delete source.detailStudies;
    delete source.detail_studies;
  }

  const normalized = normalizePatient(source);

  if (hasStudyPayload) {
    normalized.estudios = sortStudiesByDate(
      studiesFromPayload.map(normalizeStudy)
    );
  } else {
    normalized.estudios = Array.isArray(patient.estudios)
      ? patient.estudios
      : [];
  }

  normalized.estudios_count =
    expectedCount ??
    normalized.estudios.length;
  normalized.studies_count_is_explicit =
    expectedCount !== null;

  normalized.history_from_latest =
    !hasStudyPayload &&
    Boolean(patient.history_from_latest);

  normalized.history_loaded =
    optionalCount(normalized.estudios_count) !== null
      ? normalized.estudios.length >= normalized.estudios_count
      : hasStudyPayload;

  Object.assign(patient, normalized);
  selectedPatient = patient;
}

async function loadPatientHistoryFromGallery(patient) {
  const patientId =
    encodeURIComponent(patient.id);
  const patientFolio =
    patient.folio && patient.folio !== 'Sin folio'
      ? encodeURIComponent(patient.folio)
      : '';
  const candidates = [
    galleryEndpoint(`?paciente_id=${patientId}`),
    galleryEndpoint(`?patient_id=${patientId}`),
    `${apiBaseUrl()}/api/tauri/estudios?paciente_id=${patientId}`,
    `${apiBaseUrl()}/api/tauri/estudios?patient_id=${patientId}`,
    endpoint(`${patientId}/estudios`),
    endpoint(`${patientId}/historial`),
    galleryEndpoint(),
  ];

  if (patientFolio) {
    candidates.splice(
      2,
      0,
      galleryEndpoint(`?folio=${patientFolio}`)
    );
  }

  let bestPayload = null;
  let bestCount = Array.isArray(patient.estudios)
    ? patient.estudios.length
    : 0;

  for (const url of candidates) {
    try {
      const payload = await requestUrl(url);
      const galleryPatient =
        findGalleryPatient(
          patient,
          galleryPatientsPayload(payload)
        );
      const candidate =
        studyPayload(galleryPatient || payload, patient);

      if (!candidate) {
        continue;
      }

      const count =
        availableStudyList(candidate).length;

      if (count > bestCount) {
        bestPayload = candidate;
        bestCount = count;
      }

      const expectedCount =
        optionalCount(patient.estudios_count);

      if (
        expectedCount === null ||
        bestCount >= expectedCount
      ) {
        break;
      }
    } catch (error) {
      console.debug(
        'Fuente de historial no disponible:',
        url,
        error
      );
    }
  }

  patient.history_gallery_loaded = true;

  if (bestPayload) {
    applyPatientHistoryPayload(patient, bestPayload);
    patient.history_gallery_loaded = true;
  }
}

function patientDetailPayload(payload) {
  if (!payload || Array.isArray(payload)) {
    return null;
  }

  const withStudyPayload = (detail, source) => {
    if (!detail || Array.isArray(detail)) {
      return detail;
    }

    const sourceStudies = patientStudyList(source);
    const detailStudies = patientStudyList(detail);
    const sourceCount = patientStudyCount(source);
    const detailCount = patientStudyCount(detail);
    const merged = { ...detail };

    if (sourceStudies && !detailStudies) {
      merged.estudios = sourceStudies;
    }

    if (sourceCount !== null && detailCount === null) {
      merged.estudios_count = sourceCount;
    }

    return merged;
  };

  if (payload.paciente) {
    return withStudyPayload(
      payload.paciente,
      payload
    );
  }

  if (payload.patient) {
    return withStudyPayload(
      payload.patient,
      payload
    );
  }

  if (payload.data?.paciente) {
    return withStudyPayload(
      payload.data.paciente,
      payload.data
    );
  }

  if (payload.data?.patient) {
    return withStudyPayload(
      payload.data.patient,
      payload.data
    );
  }

  if (payload.data && !Array.isArray(payload.data)) {
    return withStudyPayload(
      payload.data,
      payload.data
    );
  }

  return withStudyPayload(payload, payload);
}

async function loadFullPatientHistory(patient) {
  if (!patient?.id || !patientHistoryNeedsMore(patient)) {
    return;
  }

  try {
    const payload = await request(
      encodeURIComponent(patient.id)
    );

    if (
      String(selectedPatient?.id || '') !==
      String(patient.id)
    ) {
      return;
    }

    const detail =
      patientDetailPayload(payload);

    if (detail) {
      applyPatientHistoryPayload(patient, detail);
    }
  } catch (error) {
    console.warn(
      'No se pudo cargar el detalle del historial del paciente:',
      error
    );
  }

  if (
    String(selectedPatient?.id || '') !==
    String(patient.id)
  ) {
    return;
  }

  if (patientHistoryNeedsMore(patient)) {
    try {
      await loadPatientHistoryFromGallery(patient);
    } catch (error) {
      console.warn(
        'No se pudo completar el historial desde galeria:',
        error
      );
    }
  }

  if (
    String(selectedPatient?.id || '') !==
    String(patient.id)
  ) {
    return;
  }

  setPanelText(
    'panelLastStudy',
    patient.study_type || 'Sin estudios'
  );
  setPanelText(
    'panelTotalStudies',
    patient.estudios_count
  );
  renderHistory(patient);
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

function bindPatientAvatarFallbacks() {
  if (
    document.documentElement.dataset
      .patientAvatarFallbackBound === 'true'
  ) {
    return;
  }

  document.documentElement.dataset
    .patientAvatarFallbackBound = 'true';

  document.addEventListener(
    'error',
    (event) => {
      const image =
        event.target;

      if (
        image?.tagName !== 'IMG' ||
        image.dataset?.patientAvatarImg !== 'true'
      ) {
        return;
      }

      const container =
        image.closest(
          '.patient-avatar, .panel-avatar, .ia-patient-avatar'
        );

      if (!container) {
        return;
      }

      container.textContent =
        image.dataset.avatarInitials || 'PX';
    },
    true
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
        Cargando pacientes...
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
    const { patients: nextPatients, serverTime } =
      await fetchAllPatients();

    patients = nextPatients;
    filteredPatients = [...nextPatients];

    patientsFingerprint =
      createFingerprint(nextPatients);

    lastSyncedAt = serverTime;
    syncTickCount = 0;

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
    const needsFullResync =
      force ||
      !lastSyncedAt ||
      syncTickCount >= PATIENTS_FULL_RESYNC_EVERY_TICKS;

    let nextPatients;
    let serverTime;

    if (needsFullResync) {
      ({ patients: nextPatients, serverTime } =
        await fetchAllPatients());

      syncTickCount = 0;
    } else {
      const delta = await fetchPatientsDelta(lastSyncedAt);

      nextPatients = mergePatientsDelta(
        patients,
        delta.patients
      );

      serverTime = delta.serverTime;
      syncTickCount += 1;
    }

    if (serverTime) {
      lastSyncedAt = serverTime;
    }

    const nextFingerprint =
      createFingerprint(nextPatients);

    // 'force' solo debe forzar que se consulte al servidor AHORA
    // (saltando el intervalo/el delta), nunca forzar un re-render.
    // Si los datos no cambiaron, no hay razon para reconstruir la tabla
    // ni volver a pedir los avatares (eso es lo que causaba que la foto
    // 'parpadeara'/recargara cada vez que se volvia a la app).
    if (
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
    finalizado: 'completed',
    espera: 'waiting',
    esperando: 'waiting',
    pendiente: 'waiting',
    waiting: 'waiting',
    'en proceso': 'in_progress',
    en_proceso: 'in_progress',
    proceso: 'in_progress',
    procesando: 'in_progress',
    activo: 'in_progress',
    active: 'in_progress',
    progress: 'in_progress',
    in_progress: 'in_progress',
    'in-progress': 'in_progress',
    cancelado: 'cancelled',
    cancelled: 'cancelled',
  };

  return statuses[value] || '';
}

function statusLabel(status) {
  return {
    completed: 'Completado',
    waiting: 'En espera',
    in_progress: 'En proceso',
    cancelled: 'Cancelado',
  }[status] || '';
}

function humanizeStatus(status) {
  const value = String(status || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) {
    return '';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function patientAvatarHtml(patient) {
  if (!patient.foto_url) {
    return escapeHtml(patient.initials);
  }

  return `
    <span data-patient-avatar-fallback="true">
      ${escapeHtml(patient.initials)}
    </span>
    <img
      alt="${escapeHtml(patient.name)}"
      hidden
      data-patient-avatar-img="true"
      data-auth-asset-url="${escapeHtml(patient.foto_url)}"
      data-avatar-initials="${escapeHtml(patient.initials)}"
    >
  `;
}

async function hydratePatientAvatar(image) {
  const remoteUrl =
    image.dataset.authAssetUrl;

  if (
    !remoteUrl ||
    image.dataset.assetHydrated === 'true'
  ) {
    return;
  }

  image.dataset.assetHydrated = 'true';

  const container =
    image.closest(
      '.patient-avatar, .panel-avatar, .ia-patient-avatar'
    );

  try {
    const localUrl =
      await authenticatedLaravelAssetUrl(
        remoteUrl,
        {
          accept: 'image/*,*/*',
        }
      );

    if (!localUrl) {
      throw new Error(
        'No se devolvió una URL de imagen usable.'
      );
    }

    image.onload = () => {
      image.hidden = false;

      const fallback =
        container?.querySelector(
          '[data-patient-avatar-fallback]'
        );

      if (fallback) {
        fallback.hidden = true;
      }
    };

    image.onerror = () => {
      if (container) {
        container.textContent =
          image.dataset.avatarInitials || 'PX';
      }
    };

    image.src = localUrl;
  } catch (error) {
    console.warn(
      'No se pudo cargar la foto del paciente:',
      error
    );

    if (container) {
      container.textContent =
        image.dataset.avatarInitials || 'PX';
    }
  }
}

const AVATAR_HYDRATION_CONCURRENCY = 5;

function hydratePatientAvatars(root = document) {
  const images =
    root.querySelectorAll?.(
      'img[data-patient-avatar-img="true"][data-auth-asset-url]'
    ) || [];

  runWithConcurrencyLimit(
    images,
    AVATAR_HYDRATION_CONCURRENCY,
    (image) => hydratePatientAvatar(image)
  );
}

function rowHtml(patient, index) {
  const status = normalizeStatus(patient.status);

  return `
    <div
      class="patient-row"
      data-index="${index}"
      data-patient-id="${escapeHtml(patient.id)}"
    >
      <div class="patient-info">
        <div class="patient-avatar">
          ${patientAvatarHtml(patient)}
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
          data-patient-menu-toggle="${index}"
          aria-haspopup="true"
          aria-expanded="false"
          aria-label="Opciones de ${escapeHtml(patient.name)}"
        >
          ⋮
        </button>

        <div
          class="actions-dropdown"
          data-patient-menu="${index}"
        >
          <a
            href="#"
            data-patient-action="edit"
            data-patient-index="${index}"
          >
            Editar información
          </a>

          <a
            href="#"
            data-patient-action="study"
            data-patient-index="${index}"
          >
            Iniciar estudio
          </a>

          <a
            href="#"
            data-patient-action="report"
            data-patient-index="${index}"
          >
            Crear informe
          </a>

          <a
            href="#"
            class="danger"
            data-patient-action="delete"
            data-patient-index="${index}"
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

    hydratePatientAvatars(body);
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

function shouldShowPaginationPage(page, totalPages) {
  return (
    totalPages <= 7 ||
    page === 1 ||
    page === totalPages ||
    Math.abs(page - currentPage) <= 1 ||
    (currentPage <= 3 && page <= 4) ||
    (
      currentPage >= totalPages - 2 &&
      page >= totalPages - 3
    )
  );
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
      type="button"
      class="page-btn"
      data-page="${currentPage - 1}"
      onclick="renderPage(${currentPage - 1})"
      ${currentPage <= 1 ? 'disabled' : ''}
      aria-label="Pagina anterior"
    >
      ‹
    </button>
  `;

  let lastRenderedPage = 0;

  for (
    let page = 1;
    page <= totalPages;
    page += 1
  ) {
    if (!shouldShowPaginationPage(page, totalPages)) {
      continue;
    }

    if (
      lastRenderedPage &&
      page - lastRenderedPage > 1
    ) {
      html += '<span class="page-ellipsis">...</span>';
    }

    html += `
      <button
        type="button"
        class="page-btn ${
          page === currentPage ? 'active' : ''
        }"
        data-page="${page}"
        onclick="renderPage(${page})"
        ${page === currentPage ? 'aria-current="page"' : ''}
      >
        ${page}
      </button>
    `;

    lastRenderedPage = page;
  }

  html += `
    <button
      type="button"
      class="page-btn"
      data-page="${currentPage + 1}"
      onclick="renderPage(${currentPage + 1})"
      ${currentPage >= totalPages ? 'disabled' : ''}
      aria-label="Pagina siguiente"
    >
      ›
    </button>
  `;

  container.innerHTML = html;
}

function handlePatientsPaginationClick(event) {
  const button =
    event.target.closest?.(
      '#paginationControls .page-btn[data-page]'
    );

  if (!button || button.disabled) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  renderPage(
    Number(button.dataset.page) || currentPage
  );
}

function bindPaginationEvents() {
  if (
    document.documentElement.dataset
      .patientsPaginationBound === 'true'
  ) {
    return;
  }

  document.documentElement.dataset
    .patientsPaginationBound = 'true';

  document.addEventListener(
    'click',
    handlePatientsPaginationClick,
    true
  );
}

function navigateToPatientCreate() {
  sessionStorage.removeItem(
    EDIT_PATIENT_ID_STORAGE_KEY
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
    EDIT_PATIENT_ID_STORAGE_KEY,
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
    REPORT_PATIENT_ID_STORAGE_KEY,
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
    avatar.innerHTML =
      patientAvatarHtml(patient);

    hydratePatientAvatars(avatar);
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
  const reportAvatar =
    document.getElementById('reportPanelAvatar');

  if (reportAvatar) {
    reportAvatar.innerHTML =
      patientAvatarHtml(patient);

    hydratePatientAvatars(reportAvatar);
  }

  renderHistory(patient);
  loadFullPatientHistory(patient);

  document
    .getElementById('contentWrapper')
    ?.classList.add('panel-open');
}

function studyFilesLabel(count) {
  const value = optionalCount(count);

  if (value === null) {
    return '';
  }

  return `${value} archivo(s)`;
}

function studyStatusText(status) {
  return (
    statusLabel(normalizeStatus(status)) ||
    humanizeStatus(status)
  );
}

function studyStatusClass(status) {
  const normalized = normalizeStatus(status);

  return normalized
    ? `is-${normalized.replace(/_/g, '-')}`
    : '';
}

function studyNavigationKey(study = {}) {
  return String(
    study?.id ||
    study?.estudio_id ||
    study?.study_id ||
    study?.folio ||
    ''
  ).trim();
}

function studyByKeyOrIndex(keyOrIndex, fallbackIndex = null) {
  const studies = Array.isArray(selectedPatient?.estudios)
    ? selectedPatient.estudios
    : [];

  const key = String(keyOrIndex || '').trim();

  if (key) {
    const matchingStudy = studies.find(
      (study) => studyNavigationKey(study) === key
    );

    if (matchingStudy) {
      return matchingStudy;
    }
  }

  if (Number.isInteger(fallbackIndex)) {
    return studies[fallbackIndex] || null;
  }

  const normalizedIndex = Number(keyOrIndex);

  if (Number.isInteger(normalizedIndex)) {
    return studies[normalizedIndex] || null;
  }

  return null;
}

function navigateInsideApp(route) {
  if (typeof window.enclaiiNavigate === 'function') {
    window.enclaiiNavigate(route);
    return;
  }

  window.location.hash = route;
}

function openStudyDetail(keyOrIndex, fallbackIndex = null) {
  if (!selectedPatient?.id) {
    return;
  }

  const study =
    studyByKeyOrIndex(keyOrIndex, fallbackIndex);

  const studyKey =
    studyNavigationKey(study) ||
    String(keyOrIndex || '').trim();

  const params = new URLSearchParams({
    paciente: String(selectedPatient.id),
  });

  if (studyKey) {
    params.set('estudio_id', String(studyKey));
  }

  sessionStorage.setItem(
    STUDY_PATIENT_ID_STORAGE_KEY,
    String(selectedPatient.id)
  );

  sessionStorage.setItem(
    STUDY_PATIENT_NAME_STORAGE_KEY,
    selectedPatient.name
  );

  if (studyKey) {
    sessionStorage.setItem(
      STUDY_ID_STORAGE_KEY,
      String(studyKey)
    );
  } else {
    sessionStorage.removeItem(
      STUDY_ID_STORAGE_KEY
    );
  }

  if (study?.tipo) {
    sessionStorage.setItem(
      STUDY_LABEL_STORAGE_KEY,
      study.tipo
    );
  }

  navigateInsideApp(
    `estudio-paciente?${params.toString()}`
  );
}

function renderHistory(patient) {
  const list =
    document.getElementById('historialList');

  const empty =
    document.getElementById('historialEmpty');

  const studies = Array.isArray(patient.estudios)
    ? patient.estudios
    : [];

  const totalStudies =
    optionalCount(patient.estudios_count) ??
    studies.length;

  setPanelText('panelHistoryCount', totalStudies);

  if (!list || !empty) {
    return;
  }

  if (!studies.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  list.innerHTML = studies
    .map((study, index) => {
      const filesLabel =
        studyFilesLabel(study.archivos_count);
      const statusText =
        studyStatusText(study.estado);
      const statusClass =
        studyStatusClass(study.estado);
      const metaParts = [
        study.folio
          ? `Folio: ${study.folio}`
          : 'Sin folio',
        filesLabel,
      ].filter(Boolean);

      return `
      <button
        type="button"
        class="historial-item"
        data-open-study-gallery="${escapeHtml(studyNavigationKey(study))}"
        data-open-study-index="${index}"
      >
        <div class="historial-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/>
            <path d="M9 22h6"/>
          </svg>
        </div>

        <div class="historial-info">
          <div class="historial-title">
            ${escapeHtml(study.tipo)}
          </div>

          <div class="historial-doctor">
            ${metaParts.map(escapeHtml).join(' &middot; ')}
          </div>
        </div>

        <div class="historial-right">
          <div class="historial-date">
            ${escapeHtml(formatDate(study.fecha))}
          </div>

          ${
            statusText
              ? `<span class="historial-status ${statusClass}">${escapeHtml(statusText)}</span>`
              : ''
          }
        </div>
      </button>
    `;
    })
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

function setMenuContainersOpen(isOpen) {
  document
    .querySelector('.patients-card')
    ?.classList.toggle('menu-open', isOpen);

  document
    .getElementById('contentWrapper')
    ?.classList.toggle('menu-open', isOpen);
}

function closeAllPatientMenus() {
  document
    .querySelectorAll('.actions-dropdown.active')
    .forEach((menu) => {
      menu.classList.remove('active');
    });

  document
    .querySelectorAll('.actions-wrapper.is-open')
    .forEach((wrapper) => {
      wrapper.classList.remove('is-open');
    });

  document
    .querySelectorAll('[data-patient-menu-toggle][aria-expanded="true"]')
    .forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });

  openMenuPatientId = null;
  setMenuContainersOpen(false);
}

function toggleMenu(button) {
  const wrapper =
    button.closest('.actions-wrapper');

  const menu =
    wrapper?.querySelector('.actions-dropdown');

  if (!menu) {
    return;
  }

  const shouldOpen =
    !menu.classList.contains('active');

  closeAllPatientMenus();

  if (!shouldOpen) {
    return;
  }

  menu.classList.add('active');
  wrapper.classList.add('is-open');
  button.setAttribute('aria-expanded', 'true');
  setMenuContainersOpen(true);

  openMenuPatientId =
    button.closest('.patient-row')
      ?.dataset.patientId || null;
}

function restoreOpenMenu() {
  if (!openMenuPatientId) {
    return;
  }

  const row = document.querySelector(
    `.patient-row[data-patient-id="${openMenuPatientId}"]`
  );

  const menu =
    row?.querySelector('.actions-dropdown');

  const button =
    row?.querySelector('[data-patient-menu-toggle]');

  if (!menu || !button) {
    openMenuPatientId = null;
    setMenuContainersOpen(false);
    return;
  }

  menu.classList.add('active');
  row
    .querySelector('.actions-wrapper')
    ?.classList.add('is-open');
  button.setAttribute('aria-expanded', 'true');
  setMenuContainersOpen(true);
}

function handlePatientAction(action, index) {
  if (
    !Number.isInteger(index) ||
    !patients[index]
  ) {
    return;
  }

  closeAllPatientMenus();

  if (action === 'edit') {
    openPatientEdit(index);
    return;
  }

  if (action === 'study') {
    startPatientStudy(index);
    return;
  }

  if (action === 'report') {
    openPatientReport(index);
    return;
  }

  if (action === 'delete') {
    deletePatient(index);
  }
}

function handlePatientMenuClick(event) {
  const target =
    event.target;

  const studyGalleryButton =
    target.closest?.(
      '[data-open-study-gallery]'
    );

  if (studyGalleryButton) {
    event.preventDefault();
    event.stopPropagation();

    openStudyDetail(
      studyGalleryButton.dataset
        .openStudyGallery,
      Number(
        studyGalleryButton.dataset
          .openStudyIndex
      )
    );

    return;
  }

  const toggle =
    target.closest?.(
      '[data-patient-menu-toggle]'
    );

  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu(toggle);
    return;
  }

  const actionLink =
    target.closest?.(
      '[data-patient-action]'
    );

  if (actionLink) {
    event.preventDefault();
    event.stopPropagation();

    handlePatientAction(
      actionLink.dataset.patientAction,
      Number(actionLink.dataset.patientIndex)
    );

    return;
  }

  if (
    target.closest?.('.actions-wrapper')
  ) {
    return;
  }

  closeAllPatientMenus();

  const row =
    target.closest?.(
      '.patient-row[data-index]'
    );

  if (!row) {
    return;
  }

  event.preventDefault();

  openPanel(
    Number(row.dataset.index)
  );
}

function handlePatientMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeAllPatientMenus();
  }
}

function bindPatientMenuEvents() {
  if (
    document.documentElement.dataset
      .patientMenuEventsBound === 'true'
  ) {
    return;
  }

  document.documentElement.dataset
    .patientMenuEventsBound = 'true';

  document.addEventListener(
    'click',
    handlePatientMenuClick,
    true
  );

  document.addEventListener(
    'keydown',
    handlePatientMenuKeydown
  );
}

function handlePatientsControlsClick(event) {
  const target = event.target;

  function handle(action) {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  if (target.closest?.('#filterOverlay')) {
    handle(closeFilters);
    return;
  }

  if (target.closest?.('#btnClearAllFilters')) {
    handle(clearFilters);
    return;
  }

  if (target.closest?.('.filter-btn-cancel')) {
    handle(closeFilters);
    return;
  }

  if (target.closest?.('.filter-btn-apply')) {
    handle(applyFilters);
    return;
  }

  if (target.closest?.('#btnFiltros')) {
    handle(openFilters);
    return;
  }

  if (target.closest?.('#btnVincularCodigo')) {
    handle(() => window.openPairCodeModal?.());
    return;
  }

  if (target.closest?.('.btn-close-panel')) {
    handle(closePanel);
    return;
  }

  const tabButton = target.closest?.('.tab-btn');
  if (tabButton) {
    const label = tabButton.textContent.trim().toLowerCase();
    const tabName =
      label.includes('historial')
        ? 'historial'
        : label.includes('reporte')
          ? 'reportes'
          : 'resumen';

    handle(() => showTab(tabName));
    return;
  }

  const sortButton = target.closest?.('.ordenar-btn');
  if (sortButton) {
    const isStudySort = Boolean(sortButton.closest('span')?.querySelector('#ordenarEstudioDropdown'));
    handle(() => toggleOrdenar(isStudySort ? 'estudio' : 'paciente'));
    return;
  }

  const sortOption = target.closest?.('.ordenar-option');
  if (sortOption) {
    const dropdown = sortOption.closest('.ordenar-dropdown');
    const type = dropdown?.id === 'ordenarEstudioDropdown' ? 'estudio' : 'paciente';
    const text = sortOption.textContent.trim().toLowerCase();
    let criterion = 'default';

    if (type === 'paciente' && text.includes('a-z')) criterion = 'nombre-asc';
    if (type === 'paciente' && text.includes('z-a')) criterion = 'nombre-desc';
    if (type === 'estudio' && text.includes('reciente')) criterion = 'fecha-reciente';
    if (type === 'estudio' && text.includes('antigua')) criterion = 'fecha-antigua';

    handle(() => ordenarPor(type, criterion));
    return;
  }

  if (target.closest?.('.estado-filter-btn')) {
    handle(toggleEstadoFilter);
    return;
  }

  const statusOption = target.closest?.('#estadoFilterDropdown .filter-option');
  if (statusOption) {
    const text = statusOption.textContent.trim().toLowerCase();
    let status = 'all';

    if (text.includes('completado')) status = 'completado';
    if (text.includes('espera')) status = 'espera';
    if (text.includes('cancelado')) status = 'cancelado';

    handle(() => filterByEstado(status));
    return;
  }

  const modalDeleteButton = target.closest?.('#modalEliminar button');
  if (modalDeleteButton) {
    const isDelete = modalDeleteButton.textContent.trim().toLowerCase().includes('eliminar');
    handle(isDelete ? confirmarEliminar : cancelarEliminar);
  }
}

function bindPatientsControlsEvents() {
  if (
    document.documentElement.dataset
      .patientsControlsBound === 'true'
  ) {
    return;
  }

  document.documentElement.dataset
    .patientsControlsBound = 'true';

  document.addEventListener(
    'click',
    handlePatientsControlsClick,
    true
  );
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
    STUDY_PATIENT_ID_STORAGE_KEY,
    String(patient.id)
  );

  sessionStorage.setItem(
    STUDY_PATIENT_NAME_STORAGE_KEY,
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

  bindPatientMenuEvents();
  bindPaginationEvents();
  bindPatientsControlsEvents();
}

export async function initPacientes() {
  patientsModuleActive = true;

  bindPatientAvatarFallbacks();
  bindPageEvents();
  bindRealtimeEvents();

  await loadPatients();

  startRealtimeSync();

  if (
    sessionStorage.getItem(
      PATIENTS_REFRESH_STORAGE_KEY
    )
  ) {
    sessionStorage.removeItem(
      PATIENTS_REFRESH_STORAGE_KEY
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
