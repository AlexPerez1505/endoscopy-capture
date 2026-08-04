import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from './laravel.js';
import { authHeader } from './auth.js';
import { escapeHtml } from './html.js';
import {
  STUDY_PATIENT_ID_STORAGE_KEY,
  STUDY_PATIENT_NAME_STORAGE_KEY,
  STUDY_ID_STORAGE_KEY,
  STUDY_LABEL_STORAGE_KEY,
} from './storage-keys.js';

const PATIENTS_ENDPOINT =
  `${apiBaseUrl()}/api/tauri/pacientes`;

const GALLERY_ENDPOINT =
  `${apiBaseUrl()}/api/tauri/galeria`;

const REPORTS_ENDPOINT =
  `${apiBaseUrl()}/api/tauri/reportes`;

const STUDY_EMAIL_ENDPOINT =
  `${apiBaseUrl()}/api/tauri/estudios`;

const MEDIA_URL_FIELDS = [
  'src',
  'url',
  'public_url',
  'temporary_url',
  'signed_url',
  'full_url',
  'original_url',
  'preview_url',
  'thumb_url',
  'thumbnail_url',
  'path',
  'ruta',
  'archivo_url',
  'file_url',
  'video_url',
  'imagen_url',
  'foto_url',
];

const PATIENT_PHOTO_FIELDS = [
  'foto_url',
  'photo_url',
  'avatar_url',
  'profile_photo_url',
  'fotografia_url',
  'imagen_url',
  'image_url',
  'foto',
  'photo',
  'avatar',
  'fotografia',
  'imagen',
  'image',
  'foto_path',
  'photo_path',
  'avatar_path',
  'profile_photo_path',
];

let studyState = {
  patient: null,
  selectedStudy: null,
  selectedStudyKey: '',
  groups: [],
  media: [],
  reports: [],
};

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function routeParams() {
  const hashQuery =
    String(window.location.hash || '').split('?')[1] || '';

  return new URLSearchParams(hashQuery);
}

function compactKey(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '');
}

function numericKey(value) {
  const match = String(value || '').match(/\d+/g);
  if (!match) return '';

  const number = Number(match[match.length - 1]);
  return Number.isFinite(number) ? String(number) : '';
}

function keysMatch(left, right) {
  const leftCompact = compactKey(left);
  const rightCompact = compactKey(right);

  if (!leftCompact || !rightCompact) return false;
  if (leftCompact === rightCompact) return true;

  const leftNumber = numericKey(left);
  const rightNumber = numericKey(right);

  return Boolean(leftNumber && rightNumber && leftNumber === rightNumber);
}

function formatDate(value) {
  if (!value) return '--';

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

function initials(name) {
  const parts = String(name || 'Paciente')
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return String(name || 'PX').slice(0, 2).toUpperCase();
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || '--';
}

function showStatus(message) {
  const status = document.getElementById('studyDetailStatus');
  if (!status) return;

  status.hidden = false;
  status.textContent = message;
}

function hideStatus() {
  const status = document.getElementById('studyDetailStatus');
  if (status) status.hidden = true;
}

async function requestJson(url) {
  const authorization = authHeader();
  const headers = {
    Accept: 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };

  const response = await laravelFetch(url, {
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Laravel respondio HTTP ${response.status}.`);
  }

  return response.json();
}

function jsonHeaders() {
  const authorization = authHeader();

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

async function responsePayload(response) {
  const contentType =
    response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return {
    message: await response.text(),
  };
}

function patientPayload(payload) {
  if (!payload || Array.isArray(payload)) return null;

  return (
    payload.paciente ||
    payload.patient ||
    payload.data?.paciente ||
    payload.data?.patient ||
    (
      payload.data &&
      !Array.isArray(payload.data)
        ? payload.data
        : payload
    )
  );
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

function rawStudies(source = {}) {
  return (
    arrayFrom(source.estudios).length
      ? arrayFrom(source.estudios)
      : arrayFrom(source.studies).length
        ? arrayFrom(source.studies)
        : arrayFrom(source.historial).length
          ? arrayFrom(source.historial)
          : arrayFrom(source.history).length
            ? arrayFrom(source.history)
            : arrayFrom(source.estudios_realizados).length
              ? arrayFrom(source.estudios_realizados)
              : arrayFrom(source.study_summaries).length
                ? arrayFrom(source.study_summaries)
                : arrayFrom(source.studySummaries).length
                  ? arrayFrom(source.studySummaries)
                  : arrayFrom(source.study_groups).length
                    ? arrayFrom(source.study_groups)
                    : arrayFrom(source.studyGroups)
  );
}

function studyDate(study = {}) {
  return String(
    study.fecha ||
    study.fecha_estudio ||
    study.study_date ||
    study.date ||
    study.created_at ||
    study.updated_at ||
    ''
  );
}

function normalizeStudy(study = {}, index = 0) {
  const id = String(
    study.id ||
    study.estudio_id ||
    study.study_id ||
    ''
  ).trim();

  const folio = String(
    study.folio ||
    study.codigo ||
    study.code ||
    study.estudio_folio ||
    study.study_folio ||
    (
      id
        ? `E-${String(id).padStart(4, '0')}`
        : ''
    )
  ).trim();

  const label = String(
    study.procedimiento ||
    study.tipo ||
    study.nombre ||
    study.nombre_estudio ||
    study.study_label ||
    study.estudio ||
    'Estudio'
  );

  const key = String(id || folio || `${label}-${index + 1}`);

  return {
    key,
    id,
    folio,
    label,
    date: studyDate(study),
    status: String(study.estado || study.status || study.estatus || ''),
  };
}

function rawReports(source = {}) {
  const reports = [
    ...arrayFrom(source.reportes),
    ...arrayFrom(source.reports),
    ...arrayFrom(source.reportes_ia),
    ...arrayFrom(source.ia_reportes),
    ...arrayFrom(source.informes),
    ...arrayFrom(source.informes_ia),
    ...arrayFrom(source.study_reports),
    ...arrayFrom(source.studyReports),
  ];

  [
    source.reporte,
    source.report,
    source.informe,
  ].forEach((report) => {
    if (report && typeof report === 'object') {
      reports.push(report);
    }
  });

  rawStudies(source).forEach((study, studyIndex) => {
    const studyMeta = normalizeStudy(study, studyIndex);

    rawReports(study).forEach((report) => {
      reports.push({
        ...report,
        estudio_id:
          report.estudio_id ||
          report.study_id ||
          studyMeta.id,
        estudio_folio:
          report.estudio_folio ||
          report.study_folio ||
          studyMeta.folio,
        estudio:
          report.estudio ||
          report.study ||
          studyMeta.label,
        fecha_estudio:
          report.fecha_estudio ||
          report.study_date ||
          studyMeta.date,
      });
    });
  });

  return reports;
}

function reportsPayload(payload = {}) {
  return [
    ...rawReports(payload),
    ...rawReports(payload.data || {}),
  ];
}

function dedupeStudies(studies = []) {
  const seen = new Set();
  const result = [];

  studies.forEach((study) => {
    const key = compactKey(study.key || study.id || study.folio || study.label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(study);
  });

  return result;
}

function findStudy(studies = [], key = '') {
  if (!key) return null;

  return studies.find((study) =>
    [study.key, study.id, study.folio, study.label]
      .some(value => keysMatch(value, key))
  ) || null;
}

function normalizePatient(source = {}) {
  const name = String(
    source.nombre_completo ||
    source.name ||
    source.nombre ||
    'Paciente sin nombre'
  );

  const studies = rawStudies(source).map(normalizeStudy);

  return {
    id: String(source.id || source.patient_id || ''),
    name,
    initials: initials(name),
    folio: String(source.folio || source.identificacion || source.id || '--'),
    age:
      source.edad !== null &&
      source.edad !== undefined &&
      source.edad !== ''
        ? `${source.edad} anos`
        : String(source.age || '--'),
    gender: String(source.sexo || source.gender || '--'),
    birthDate: formatDate(source.fecha_nacimiento || source.dob),
    phone: String(source.telefono || source.phone || '--'),
    email: String(source.email || '--'),
    procedure: String(source.procedimiento || source.procedure || '--'),
    createdAt: formatDate(source.created_at || source.fecha_registro),
    photoUrl: firstLaravelAssetUrl(source, PATIENT_PHOTO_FIELDS),
    studies,
  };
}

function detectMediaType(media = {}) {
  const value = String(
    media.type ||
    media.tipo ||
    media.file_type ||
    media.mime ||
    media.mime_type ||
    media.extension ||
    media.ext ||
    media.src ||
    media.url ||
    media.path ||
    media.ruta ||
    media.file ||
    ''
  ).toLowerCase();

  return (
    value.includes('video') ||
    /\.(mp4|mov|m4v|webm|avi|mkv)(?:[?#].*)?$/i.test(value)
  )
    ? 'video'
    : 'image';
}

function collectMediaItems(source = {}) {
  function withType(item, type) {
    if (item && typeof item === 'object') {
      return {
        ...item,
        type: item.type || type,
      };
    }

    return {
      src: item,
      file: String(item || '').split(/[\\/]/).pop() || 'Captura',
      type,
    };
  }

  const media = [
    ...arrayFrom(source.media).map(item => withType(item, '')),
    ...arrayFrom(source.archivos).map(item => withType(item, '')),
    ...arrayFrom(source.files).map(item => withType(item, '')),
    ...arrayFrom(source.capturas).map(item => withType(item, '')),
    ...arrayFrom(source.captures).map(item => withType(item, '')),
  ];

  arrayFrom(source.imagenes)
    .forEach(item => media.push(withType(item, 'image')));
  arrayFrom(source.images)
    .forEach(item => media.push(withType(item, 'image')));
  arrayFrom(source.fotos)
    .forEach(item => media.push(withType(item, 'image')));
  arrayFrom(source.photos)
    .forEach(item => media.push(withType(item, 'image')));
  arrayFrom(source.videos)
    .forEach(item => media.push(withType(item, 'video')));

  return media;
}

function normalizeMedia(media = {}, index = 0, study = {}) {
  const type = detectMediaType(media);
  const src = firstLaravelAssetUrl(media, MEDIA_URL_FIELDS);
  const studyId = String(
    media.estudio_id ||
    media.study_id ||
    media.session_id ||
    study.id ||
    ''
  ).trim();
  const studyFolio = String(
    media.estudio_folio ||
    media.study_folio ||
    media.folio_estudio ||
    study.folio ||
    ''
  ).trim();
  const studyLabel = String(
    media.study ||
    media.estudio ||
    media.study_label ||
    media.procedimiento ||
    study.label ||
    'Captura del estudio'
  );
  const studyKey = String(
    studyId ||
    studyFolio ||
    study.key ||
    studyLabel
  );
  const baseId = String(
    media.id ??
    media.media_id ??
    media.archivo_id ??
    `${studyKey || 'study'}-${type}-${index + 1}`
  );

  return {
    id: studyKey ? `${studyKey}:${baseId}` : baseId,
    backendId: baseId,
    type,
    file: String(media.file || media.filename || media.nombre_original || media.nombre || 'Captura'),
    date: String(media.date || media.fecha || media.created_at || '--'),
    time: String(media.time || media.hora || media.capture_time || ''),
    src,
    sourceUrl: src,
    studyKey,
    studyId,
    studyFolio,
    studyLabel,
    studyStatus: String(media.study_status || media.estado_estudio || study.status || ''),
  };
}

function normalizeReport(report = {}, index = 0, study = {}) {
  const explicitStudyId = String(
    report.estudio_id ||
    report.study_id ||
    report.session_id ||
    ''
  ).trim();
  const explicitStudyFolio = String(
    report.estudio_folio ||
    report.study_folio ||
    report.folio_estudio ||
    ''
  ).trim();
  const explicitStudyLabel = String(
    report.estudio ||
    report.study ||
    report.procedimiento ||
    report.tipo_estudio ||
    ''
  ).trim();
  const hasExplicitStudyRef = Boolean(
    explicitStudyId ||
    explicitStudyFolio ||
    explicitStudyLabel
  );
  const studyId =
    explicitStudyId ||
    (!hasExplicitStudyRef ? String(study.id || '').trim() : '');
  const studyFolio =
    explicitStudyFolio ||
    (!hasExplicitStudyRef ? String(study.folio || '').trim() : '');
  const studyLabel =
    explicitStudyLabel ||
    (!hasExplicitStudyRef ? String(study.label || 'Estudio') : 'Estudio');
  const id = String(
    report.reporte_id ||
    report.report_id ||
    report.id ||
    `${studyId || studyFolio || studyLabel}-report-${index + 1}`
  );

  return {
    id,
    backendId: id,
    title: String(
      report.titulo ||
      report.title ||
      report.nombre ||
      report.name ||
      `Reporte ${id}`
    ),
    type: String(
      report.tipo_reporte ||
      report.report_type ||
      report.tipo ||
      report.type ||
      'Reporte'
    ),
    status: String(
      report.estado_texto ||
      report.status_text ||
      report.estado ||
      report.status ||
      ''
    ),
    date: String(
      report.fecha_reporte ||
      report.fecha ||
      report.date ||
      report.created_at ||
      ''
    ),
    viewUrl: String(
      report.view_url ||
      report.ver_url ||
      report.pdf_url ||
      report.pdf ||
      report.url ||
      ''
    ),
    downloadUrl: String(
      report.download_url ||
      report.descargar_url ||
      report.pdf_download_url ||
      report.pdf_url ||
      ''
    ),
    editUrl: String(
      report.edit_url ||
      report.editar_url ||
      ''
    ),
    studyKey: String(
      studyId ||
      studyFolio ||
      study.key ||
      studyLabel
    ),
    studyId,
    studyFolio,
    studyLabel,
  };
}

function dedupeReports(reports = []) {
  const seen = new Set();

  return reports.filter((report) => {
    const key = [
      report.id,
      report.studyKey,
      report.title,
      report.date,
    ].map(value => String(value || '')).join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mediaFromSource(source = {}) {
  const studies = rawStudies(source).map(normalizeStudy);
  const nested = rawStudies(source).flatMap((study, studyIndex) => {
    const studyMeta = studies[studyIndex];

    return collectMediaItems(study).map((item, mediaIndex) =>
      normalizeMedia(item, mediaIndex, studyMeta)
    );
  });

  const flat = collectMediaItems(source).map((item, mediaIndex) =>
    normalizeMedia(item, mediaIndex)
  );

  return {
    studies,
    media: [...nested, ...flat],
  };
}

function dedupeMedia(media = []) {
  const seen = new Set();

  return media.filter((item) => {
    const key = [item.id, item.src, item.studyKey, item.type]
      .map(value => String(value || ''))
      .join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mediaMatchesStudy(media, key) {
  return [
    media.studyKey,
    media.studyId,
    media.studyFolio,
    media.studyLabel,
  ].some(value => keysMatch(value, key));
}

function reportMatchesStudy(report, key) {
  return [
    report.studyKey,
    report.studyId,
    report.studyFolio,
    report.studyLabel,
  ].some(value => keysMatch(value, key));
}

function reportMatchesSelectedStudy(report) {
  const selected = studyState.selectedStudy;
  const selectedKeys = [
    studyState.selectedStudyKey,
    selected?.key,
    selected?.id,
    selected?.folio,
  ].filter(Boolean);
  const explicitReportKeys = [
    report.studyId,
    report.studyFolio,
  ].filter(Boolean);

  if (explicitReportKeys.length) {
    return explicitReportKeys.some((reportKey) =>
      selectedKeys.some((selectedKey) =>
        keysMatch(reportKey, selectedKey)
      )
    );
  }

  return selectedKeys.some((selectedKey) =>
    reportMatchesStudy(report, selectedKey)
  );
}

function ensureGroup(map, study = {}) {
  const key = String(study.key || study.id || study.folio || study.label || `study-${map.size + 1}`);

  if (!map.has(key)) {
    map.set(key, {
      key,
      id: study.id || '',
      folio: study.folio || '',
      label: study.label || 'Estudio',
      date: study.date || '',
      status: study.status || '',
      media: [],
    });
  }

  return map.get(key);
}

function buildGroups(studies = [], media = []) {
  const map = new Map();

  studies.forEach(study => ensureGroup(map, study));

  media.forEach((item) => {
    const group = ensureGroup(map, {
      key: item.studyKey,
      id: item.studyId,
      folio: item.studyFolio,
      label: item.studyLabel,
      date: item.date,
      status: item.studyStatus,
    });

    group.media.push(item);
  });

  return [...map.values()].sort((left, right) => {
    const leftDate = new Date(left.date || 0).getTime() || 0;
    const rightDate = new Date(right.date || 0).getTime() || 0;
    return rightDate - leftDate;
  });
}

async function hydrateMedia(media = []) {
  return Promise.all(
    media.map(async (item) => {
      if (!item.src) return item;

      try {
        return {
          ...item,
          src: await authenticatedLaravelAssetUrl(item.src, {
            accept: item.type === 'video' ? 'video/*,*/*' : 'image/*,*/*',
          }),
        };
      } catch {
        return item;
      }
    })
  );
}

function groupMatchesKey(group, key) {
  if (!key) return false;

  return [group.key, group.id, group.folio, group.label]
    .some(value => keysMatch(value, key));
}

function groupMatchesSelected(group) {
  return groupMatchesKey(group, studyState.selectedStudyKey);
}

function groupMatchesSearch(group, search) {
  if (!search) return true;

  return [group.label, group.folio, group.date, group.status]
    .some(value => compactKey(value).includes(compactKey(search)));
}

function mediaMatchesSearch(media, search) {
  if (!search) return true;

  return [media.file, media.studyLabel, media.studyFolio, media.date]
    .some(value => compactKey(value).includes(compactKey(search)));
}

function selectedStudyGroup() {
  return (
    studyState.groups.find(groupMatchesSelected) ||
    studyState.groups[0] ||
    null
  );
}

function selectedStudyMedia() {
  const group = selectedStudyGroup();

  if (group) {
    return Array.isArray(group.media)
      ? group.media
      : [];
  }

  const selectedKeys = [
    studyState.selectedStudyKey,
    studyState.selectedStudy?.key,
    studyState.selectedStudy?.id,
    studyState.selectedStudy?.folio,
  ].filter(Boolean);

  return selectedKeys.length
    ? studyState.media.filter((media) =>
        selectedKeys.some((key) =>
          mediaMatchesStudy(media, key)
        )
      )
    : studyState.media;
}

function selectedStudyReports() {
  return studyState.reports.filter((report) =>
    reportMatchesSelectedStudy(report)
  );
}

function fileExtension(...values) {
  for (const value of values) {
    const match =
      String(value || '')
        .toLowerCase()
        .match(/\.([a-z0-9]+)(?:[?#].*)?$/);

    if (match) {
      return match[1];
    }
  }

  return '';
}

function isShareableImage(media) {
  const extension =
    fileExtension(media.file, media.sourceUrl, media.src);

  return (
    media.type === 'image' &&
    (
      !extension ||
      ['jpg', 'jpeg', 'png'].includes(extension)
    )
  );
}

function selectedShareAssets() {
  const media = selectedStudyMedia();

  return {
    images: media.filter(isShareableImage),
    videos: media.filter(item => item.type === 'video'),
    reports: selectedStudyReports(),
  };
}

function shareAssetsCount(assets = selectedShareAssets()) {
  return (
    assets.images.length +
    assets.videos.length +
    assets.reports.length
  );
}

function setShareText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function updateShareSummary() {
  const assets = selectedShareAssets();
  const total = shareAssetsCount(assets);
  const button = document.getElementById('studyShareBtn');

  setShareText(
    'studyShareReportsCount',
    `${assets.reports.length} reporte(s)`
  );
  setShareText(
    'studyShareImagesCount',
    `${assets.images.length} imagen(es)`
  );
  setShareText(
    'studyShareVideosCount',
    `${assets.videos.length} video(s)`
  );

  if (button) {
    button.disabled = total === 0;
    button.title = total
      ? 'Compartir estudio por correo'
      : 'Este estudio no tiene archivos para compartir';
  }
}

function parseEmails(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function shareStudyIdentifier() {
  const selected = studyState.selectedStudy || {};

  return String(
    selected.id ||
    studyState.selectedStudyKey ||
    selected.folio ||
    ''
  ).trim();
}

function shareEndpointCandidates() {
  const studyId = shareStudyIdentifier();
  const encodedStudyId =
    encodeURIComponent(studyId);
  const candidates = [
    studyId
      ? `${STUDY_EMAIL_ENDPOINT}/${encodedStudyId}/compartir-correo`
      : '',
    studyId
      ? `${STUDY_EMAIL_ENDPOINT}/${encodedStudyId}/compartir`
      : '',
    studyId
      ? `${STUDY_EMAIL_ENDPOINT}/${encodedStudyId}/email`
      : '',
    `${STUDY_EMAIL_ENDPOINT}/compartir-correo`,
    `${GALLERY_ENDPOINT}/compartir-correo`,
    `${REPORTS_ENDPOINT}/compartir-correo`,
    `${apiBaseUrl()}/api/tauri/compartir-estudio-correo`,
    `${apiBaseUrl()}/api/tauri/share-study-email`,
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function shareMediaPayload(media) {
  return {
    id: media.backendId || media.id,
    media_id: media.backendId || media.id,
    archivo_id: media.backendId || media.id,
    type: media.type,
    tipo: media.type === 'video' ? 'video' : 'imagen',
    nombre: media.file,
    filename: media.file,
    extension: fileExtension(media.file, media.sourceUrl, media.src),
    url: media.sourceUrl || media.src || '',
    src: media.sourceUrl || media.src || '',
    estudio_id: media.studyId || studyState.selectedStudy?.id || '',
    estudio_folio: media.studyFolio || studyState.selectedStudy?.folio || '',
  };
}

function shareReportPayload(report) {
  return {
    id: report.backendId || report.id,
    reporte_id: report.backendId || report.id,
    title: report.title,
    titulo: report.title,
    type: report.type,
    tipo: report.type,
    pdf_url: report.downloadUrl || report.viewUrl || '',
    download_url: report.downloadUrl || '',
    view_url: report.viewUrl || '',
    estudio_id: report.studyId || studyState.selectedStudy?.id || '',
    estudio_folio: report.studyFolio || studyState.selectedStudy?.folio || '',
  };
}

function buildSharePayload({ recipients, subject, message }) {
  const assets = selectedShareAssets();
  const patient = studyState.patient || {};
  const study = studyState.selectedStudy || {};
  const images = assets.images.map(shareMediaPayload);
  const videos = assets.videos.map(shareMediaPayload);
  const reports = assets.reports.map(shareReportPayload);
  const files = [...images, ...videos];
  const studyId = shareStudyIdentifier();

  return {
    recipients,
    destinatarios: recipients,
    to: recipients,
    subject,
    asunto: subject,
    message,
    mensaje: message,
    paciente_id: patient.id || '',
    patient_id: patient.id || '',
    paciente_nombre: patient.name || '',
    patient_name: patient.name || '',
    estudio_id: studyId,
    study_id: studyId,
    estudio_folio: study.folio || '',
    procedimiento: study.label || patient.procedure || 'Estudio',
    formatos: {
      imagenes: ['png', 'jpg', 'jpeg'],
      reportes: ['pdf'],
      videos: ['mp4', 'mov', 'webm', 'avi', 'mkv'],
    },
    include: {
      imagenes: true,
      images: true,
      reportes: true,
      reports: true,
      videos: true,
    },
    archivos: files,
    files,
    imagenes: images,
    images,
    videos,
    reportes: reports,
    reports,
    media_ids: files.map(file => file.id).filter(Boolean),
    image_ids: images.map(file => file.id).filter(Boolean),
    imagen_ids: images.map(file => file.id).filter(Boolean),
    video_ids: videos.map(file => file.id).filter(Boolean),
    reporte_ids: reports.map(report => report.id).filter(Boolean),
    report_ids: reports.map(report => report.id).filter(Boolean),
  };
}

function shareStatus(message, mode = 'info') {
  const status = document.getElementById('studyShareStatus');
  if (!status) return;

  status.hidden = false;
  status.textContent = message;
  status.dataset.mode = mode;
}

function clearShareStatus() {
  const status = document.getElementById('studyShareStatus');
  if (!status) return;

  status.hidden = true;
  status.textContent = '';
  delete status.dataset.mode;
}

function setShareBusy(isBusy) {
  const submit = document.getElementById('studyShareSubmitBtn');
  const text = document.getElementById('studyShareSubmitText');
  const form = document.getElementById('studyShareForm');

  if (submit) submit.disabled = isBusy;
  if (form) form.dataset.busy = String(isBusy);
  if (text) text.textContent = isBusy ? 'Enviando...' : 'Enviar correo';
}

function shareDefaultSubject() {
  const patient = studyState.patient || {};
  const study = studyState.selectedStudy || {};
  const studyName =
    study.folio ||
    study.id ||
    studyState.selectedStudyKey ||
    study.label ||
    'estudio';

  return `Estudio ${studyName} - ${patient.name || 'Paciente'}`;
}

function shareDefaultMessage() {
  const patient = studyState.patient || {};

  return (
    `Hola, te comparto el estudio de ${patient.name || 'este paciente'} ` +
    'con sus reportes, capturas y videos.'
  );
}

function openShareModal() {
  const modal = document.getElementById('studyShareModal');
  const recipients = document.getElementById('studyShareRecipients');
  const subject = document.getElementById('studyShareSubject');
  const message = document.getElementById('studyShareMessage');

  if (!modal) return;

  updateShareSummary();
  clearShareStatus();

  if (recipients) recipients.value = '';
  if (subject) subject.value = shareDefaultSubject();
  if (message) message.value = shareDefaultMessage();

  modal.hidden = false;
  recipients?.focus();
}

function closeShareModal() {
  const modal = document.getElementById('studyShareModal');
  if (modal) modal.hidden = true;
  setShareBusy(false);
}

async function postShareEmail(payload) {
  let lastError = null;

  for (const url of shareEndpointCandidates()) {
    const response = await laravelFetch(url, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
      credentials: 'include',
      timeoutSeconds: 60,
    });
    const body = await responsePayload(response);

    if (response.status === 404 || response.status === 405) {
      lastError = new Error(
        body?.message ||
        `Laravel no encontro la ruta ${url}.`
      );
      continue;
    }

    if (!response.ok || body?.ok === false || body?.success === false) {
      throw new Error(
        body?.message ||
        body?.error ||
        `Laravel respondio HTTP ${response.status}.`
      );
    }

    return body;
  }

  throw new Error(
    lastError?.message ||
    'No se encontro una ruta de Laravel para compartir este estudio por correo.'
  );
}

async function submitShareEmail(event) {
  event.preventDefault();

  const recipientsInput = document.getElementById('studyShareRecipients');
  const subjectInput = document.getElementById('studyShareSubject');
  const messageInput = document.getElementById('studyShareMessage');
  const recipients = parseEmails(recipientsInput?.value || '');
  const invalidEmail = recipients.find(email => !isValidEmail(email));
  const assets = selectedShareAssets();

  clearShareStatus();

  if (!recipients.length) {
    shareStatus('Agrega al menos un destinatario.', 'error');
    recipientsInput?.focus();
    return;
  }

  if (invalidEmail) {
    shareStatus(`El correo "${invalidEmail}" no es valido.`, 'error');
    recipientsInput?.focus();
    return;
  }

  if (!shareAssetsCount(assets)) {
    shareStatus('Este estudio no tiene imagenes, videos ni reportes para compartir.', 'error');
    return;
  }

  setShareBusy(true);

  try {
    await postShareEmail(
      buildSharePayload({
        recipients,
        subject: subjectInput?.value?.trim() || shareDefaultSubject(),
        message: messageInput?.value?.trim() || shareDefaultMessage(),
      })
    );

    shareStatus('Correo enviado correctamente desde Laravel.', 'success');
  } catch (error) {
    console.error('No se pudo compartir el estudio por correo:', error);
    shareStatus(
      error?.message ||
      'No se pudo enviar el correo desde Laravel.',
      'error'
    );
  } finally {
    setShareBusy(false);
  }
}

function countText(count) {
  return `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
}

function setActiveTab(tab) {
  const activeTab = tab === 'gallery' ? 'report' : tab;

  document.querySelectorAll('[data-study-tab]').forEach((button) => {
    const active = button.dataset.studyTab === activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  document.getElementById('studyTabPatient')?.classList.toggle('active', activeTab === 'patient');
  document.getElementById('studyTabReport')?.classList.toggle('active', activeTab === 'report');
}

async function renderPatientPhoto(patient) {
  const photo = document.getElementById('studyPatientPhoto');
  if (!photo) return;

  photo.innerHTML = `<span>${escapeHtml(patient.initials)}</span>`;

  if (!patient.photoUrl) return;

  try {
    const src = await authenticatedLaravelAssetUrl(patient.photoUrl, {
      accept: 'image/*,*/*',
    });

    if (src) {
      photo.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(patient.name)}">`;
    }
  } catch {
    photo.innerHTML = `<span>${escapeHtml(patient.initials)}</span>`;
  }
}

function renderPatientInfo() {
  const { patient, selectedStudy } = studyState;
  if (!patient) return;

  const subtitle = selectedStudy
    ? `${selectedStudy.label} - ${formatDate(selectedStudy.date)}`
    : 'Informacion del paciente';

  setText('studyDetailTitle', 'Estudio del paciente');
  setText('studyDetailSubtitle', subtitle);
  setText('studyPatientName', patient.name);
  setText('studyPatientAge', patient.age);
  setText('studyPatientGender', patient.gender);
  setText('studyPatientBirthDate', patient.birthDate);
  setText('studyPatientFolio', patient.folio);
  setText('studyPatientPhone', patient.phone);
  setText('studyPatientEmail', patient.email);
  setText('studyPatientProcedure', selectedStudy?.label || patient.procedure);
  setText('studyPatientCreatedAt', patient.createdAt);
  setText(
    'studySelectedLabel',
    selectedStudy
      ? `${selectedStudy.folio || selectedStudy.id || 'Sin folio'} - ${selectedStudy.label}`
      : '--'
  );

  renderPatientPhoto(patient);
}

function mediaCard(media) {
  const isVideo = media.type === 'video';
  const preview = media.src
    ? isVideo
      ? `<video src="${escapeHtml(media.src)}" muted preload="metadata" playsinline></video>`
      : `<img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.file)}">`
    : '';

  return `
    <button class="study-media-card" type="button" data-open-study-media="${escapeHtml(media.id)}">
      <div class="study-media-thumb">
        ${preview}
        <span class="study-media-badge">${isVideo ? 'VIDEO' : 'IMG'}</span>
      </div>
      <div class="study-media-card-body">
        <strong>${escapeHtml(media.file)}</strong>
        <span>${escapeHtml(media.date)}${media.time ? ` - ${escapeHtml(media.time)}` : ''}</span>
      </div>
    </button>
  `;
}

function mediaColumn(title, media) {
  return `
    <div class="study-media-column">
      <div class="study-media-column-head">
        <h5>${escapeHtml(title)}</h5>
        <span>${escapeHtml(countText(media.length))}</span>
      </div>
      ${
        media.length
          ? `<div class="study-media-grid">${media.map(mediaCard).join('')}</div>`
          : '<p class="study-empty">No hay archivos.</p>'
      }
    </div>
  `;
}

function reportCard(report) {
  const params = new URLSearchParams({
    mode: 'normal',
  });

  if (report.id) {
    params.set('reporte_id', report.id);
  }

  if (report.studyId || report.studyFolio || report.studyKey) {
    params.set(
      'estudio_id',
      report.studyId || report.studyFolio || report.studyKey
    );
  }

  const primaryUrl =
    report.viewUrl ||
    report.editUrl ||
    `#ia-reportes-redactar?${params.toString()}`;

  return `
    <article class="study-report-card">
      <div>
        <strong>${escapeHtml(report.title)}</strong>
        <span>${escapeHtml([
          report.type,
          report.date ? formatDate(report.date) : '',
          report.status,
        ].filter(Boolean).join(' - ') || 'Reporte del estudio')}</span>
      </div>
      <div class="study-report-actions">
        <a href="${escapeHtml(primaryUrl)}" ${primaryUrl.startsWith('#') ? `data-nav="${escapeHtml(primaryUrl.slice(1))}"` : 'target="_blank" rel="noopener noreferrer"'}>Ver</a>
        ${
          report.downloadUrl
            ? `<a href="${escapeHtml(report.downloadUrl)}" target="_blank" rel="noopener noreferrer">Descargar</a>`
            : ''
        }
      </div>
    </article>
  `;
}

function reportColumn(reports) {
  return `
    <section class="study-report-section">
      <div class="study-media-column-head">
        <h5>Reportes</h5>
        <span>${escapeHtml(countText(reports.length))}</span>
      </div>
      ${
        reports.length
          ? `<div class="study-report-list">${reports.map(reportCard).join('')}</div>`
          : '<p class="study-empty">Este estudio no tiene reportes guardados.</p>'
      }
    </section>
  `;
}

function groupHtml(group, reports = []) {
  const videos = group.media.filter(item => item.type === 'video');
  const images = group.media.filter(item => item.type === 'image');
  const meta = [
    group.folio ? `Folio: ${group.folio}` : '',
    group.date ? formatDate(group.date) : '',
    group.status || '',
  ].filter(Boolean);

  return `
    <article class="study-gallery-group${groupMatchesSelected(group) ? ' is-selected' : ''}">
      <div class="study-gallery-group-head">
        <div>
          <h4>${escapeHtml(group.label)}</h4>
          <p>${meta.map(escapeHtml).join(' &middot; ') || 'Sin datos del estudio'}</p>
        </div>
        <span>${escapeHtml(countText(group.media.length))}</span>
      </div>
      <div class="study-media-columns">
        ${mediaColumn('Videos', videos)}
        ${mediaColumn('Imagenes', images)}
      </div>
      ${reportColumn(reports)}
    </article>
  `;
}

function renderGallery() {
  const container = document.getElementById('studyGalleryGroups');
  const empty = document.getElementById('studyGalleryEmpty');
  const subtitle = document.getElementById('studyGallerySubtitle');
  const search = document.getElementById('studyGallerySearch')?.value || '';

  if (!container || !empty) return;

  const selectedGroup =
    studyState.groups.find(groupMatchesSelected) ||
    studyState.groups[0] ||
    null;
  const selectedReports = studyState.reports.filter((report) =>
    reportMatchesSelectedStudy(report)
  );

  if (!selectedGroup && !selectedReports.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
  } else {
    const group =
      selectedGroup || {
        key: studyState.selectedStudyKey,
        id: studyState.selectedStudy?.id || '',
        folio: studyState.selectedStudy?.folio || '',
        label: studyState.selectedStudy?.label || 'Estudio',
        date: studyState.selectedStudy?.date || '',
        status: studyState.selectedStudy?.status || '',
        media: [],
      };
    const media = group.media.filter(item =>
      mediaMatchesSearch(item, search)
    );
    const reports = selectedReports.filter((report) =>
      [
        report.title,
        report.type,
        report.status,
        report.date,
      ].some(value => compactKey(value).includes(compactKey(search)))
    );

    container.innerHTML = groupHtml(
      {
        ...group,
        media,
      },
      reports
    );
    empty.style.display =
      media.length || reports.length || groupMatchesSearch(group, search)
        ? 'none'
        : 'block';
  }

  if (subtitle) {
    const selectedFiles =
      selectedGroup?.media.length || 0;
    const selectedReportCount =
      selectedReports.length;

    subtitle.textContent =
      `${selectedFiles} archivo(s) - ${selectedReportCount} reporte(s)`;
  }

  updateShareSummary();
}

function openMediaViewer(mediaId) {
  const media = studyState.media.find(item => item.id === mediaId);
  const viewer = document.getElementById('studyMediaViewer');
  const body = document.getElementById('studyMediaBody');
  const meta = document.getElementById('studyMediaMeta');

  if (!media || !viewer || !body || !meta) return;

  if (!media.src) {
    showStatus('Este archivo no tiene una URL disponible en Laravel.');
    return;
  }

  body.innerHTML = media.type === 'video'
    ? `<video src="${escapeHtml(media.src)}" controls autoplay playsinline></video>`
    : `<img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.file)}">`;

  meta.textContent =
    `${media.studyLabel} - ${media.file} - ${media.date}`;

  viewer.hidden = false;
}

function closeMediaViewer() {
  const viewer = document.getElementById('studyMediaViewer');
  const body = document.getElementById('studyMediaBody');
  body?.querySelector('video')?.pause();
  if (body) body.innerHTML = '';
  if (viewer) viewer.hidden = true;
}

function startStudy() {
  const { patient, selectedStudy } = studyState;
  if (!patient?.id) return;

  const params = new URLSearchParams({
    patient_id: patient.id,
    patient_name: patient.name,
    study_label: selectedStudy?.label || patient.procedure || 'Endoscopia',
  });

  if (selectedStudy?.id || selectedStudy?.folio) {
    params.set('study_id', selectedStudy.id || selectedStudy.folio);
  }

  sessionStorage.setItem(STUDY_PATIENT_ID_STORAGE_KEY, patient.id);
  sessionStorage.setItem(STUDY_PATIENT_NAME_STORAGE_KEY, patient.name);

  if (selectedStudy?.id || selectedStudy?.folio) {
    sessionStorage.setItem(STUDY_ID_STORAGE_KEY, selectedStudy.id || selectedStudy.folio);
  }

  if (selectedStudy?.label) {
    sessionStorage.setItem(STUDY_LABEL_STORAGE_KEY, selectedStudy.label);
  }

  window.location.href = `./index.html?${params.toString()}`;
}

function bindEvents(signal) {
  document.getElementById('studyBackBtn')?.addEventListener('click', () => {
    if (typeof window.enclaiiNavigate === 'function') {
      window.enclaiiNavigate('pacientes');
      return;
    }

    window.location.hash = 'pacientes';
  });

  document.querySelectorAll('[data-study-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.studyTab || 'patient');
    });
  });

  document.getElementById('studyStartBtn')?.addEventListener('click', startStudy);
  document.getElementById('studyShareBtn')?.addEventListener('click', openShareModal);
  document.getElementById('studyShareForm')?.addEventListener('submit', submitShareEmail);
  document.getElementById('studyShareModal')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-study-share]')) {
      closeShareModal();
    }
  });
  document.getElementById('studyGallerySearch')?.addEventListener('input', renderGallery);
  document.getElementById('studyGalleryGroups')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-study-media]');
    if (button) openMediaViewer(button.dataset.openStudyMedia);
  });

  document.getElementById('studyMediaViewer')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-study-media]')) {
      closeMediaViewer();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMediaViewer();
      closeShareModal();
    }
  }, { signal });
}

async function loadContext(patientId, studyKey) {
  const patientUrl =
    `${PATIENTS_ENDPOINT}/${encodeURIComponent(patientId)}`;
  const encodedPatientId =
    encodeURIComponent(patientId);
  const encodedStudyKey =
    encodeURIComponent(studyKey || '');
  const galleryUrls = [
    studyKey
      ? `${GALLERY_ENDPOINT}?paciente_id=${encodedPatientId}&estudio_id=${encodedStudyKey}`
      : '',
    `${GALLERY_ENDPOINT}?paciente_id=${encodedPatientId}`,
    studyKey
      ? `${GALLERY_ENDPOINT}?estudio_id=${encodedStudyKey}`
      : '',
    GALLERY_ENDPOINT,
  ].filter(Boolean);
  const reportUrls = [
    studyKey
      ? `${REPORTS_ENDPOINT}?estudio_id=${encodedStudyKey}`
      : '',
    studyKey
      ? `${REPORTS_ENDPOINT}/editor?estudio_id=${encodedStudyKey}`
      : '',
    `${REPORTS_ENDPOINT}?paciente_id=${encodedPatientId}`,
  ].filter(Boolean);

  const [patientResult, ...otherResults] = await Promise.allSettled([
    requestJson(patientUrl),
    ...galleryUrls.map(requestJson),
    ...reportUrls.map(requestJson),
  ]);

  const rawPatient =
    patientResult.status === 'fulfilled'
      ? patientPayload(patientResult.value)
      : null;

  const galleryPayloads =
    otherResults
      .slice(0, galleryUrls.length)
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
  const reportPayloads =
    otherResults
      .slice(galleryUrls.length)
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
  const galleryPatients =
    galleryPayloads.flatMap(galleryPatientsPayload);

  const lookupPatient =
    normalizePatient(rawPatient || { id: patientId });
  const lookupKeys = [
    patientId,
    lookupPatient.id,
    lookupPatient.folio,
  ].filter(Boolean);

  const rawGalleryPatient =
    galleryPatients.find((patient) =>
      [patient.id, patient.patient_id, patient.folio, patient.identificacion]
        .some(value =>
          lookupKeys.some(key => keysMatch(value, key))
        )
    ) || null;
  const gallerySources =
    rawGalleryPatient
      ? [rawGalleryPatient]
      : galleryPayloads;

  const patient =
    normalizePatient(rawPatient || rawGalleryPatient || { id: patientId });

  const patientMedia = mediaFromSource(rawPatient || {});
  const galleryMedia = gallerySources
    .map(source => mediaFromSource(source || {}))
    .reduce((acc, item) => ({
      studies: [...acc.studies, ...item.studies],
      media: [...acc.media, ...item.media],
    }), {
      studies: [],
      media: [],
    });
  const studies = dedupeStudies([
    ...patient.studies,
    ...patientMedia.studies,
    ...galleryMedia.studies,
  ]);
  let selectedStudy =
    studyKey
      ? findStudy(studies, studyKey)
      : studies[0] || null;
  let selectedStudyKey =
    studyKey ||
    selectedStudy?.key ||
    selectedStudy?.id ||
    selectedStudy?.folio ||
    '';

  const media = dedupeMedia([
    ...patientMedia.media,
    ...galleryMedia.media,
  ]);
  const reportStudy =
    selectedStudy || {
      key: selectedStudyKey,
      id: selectedStudyKey,
      folio: '',
      label: 'Estudio',
      date: '',
      status: '',
    };
  const reports = dedupeReports([
    ...rawReports(rawPatient || {}).map((report, index) =>
      normalizeReport(report, index, reportStudy)
    ),
    ...gallerySources.flatMap(source =>
      rawReports(source || {}).map((report, index) =>
        normalizeReport(report, index, reportStudy)
      )
    ),
    ...reportPayloads.flatMap(payload =>
      reportsPayload(payload).map((report, index) =>
        normalizeReport(report, index, reportStudy)
      )
    ),
  ]);
  const hydratedMedia = await hydrateMedia(media);
  let groups = buildGroups(studies, hydratedMedia);

  if (!selectedStudy && selectedStudyKey) {
    selectedStudy =
      groups.find(group => groupMatchesKey(group, selectedStudyKey)) ||
      null;
  }

  if (!selectedStudy) {
    selectedStudy = studies[0] || groups[0] || null;
    selectedStudyKey =
      selectedStudy?.key ||
      selectedStudy?.id ||
      selectedStudy?.folio ||
      '';
  }

  if (
    selectedStudy &&
    !groups.some(group => groupMatchesKey(group, selectedStudyKey))
  ) {
    groups = buildGroups([selectedStudy, ...studies], hydratedMedia);
  }

  studyState = {
    patient,
    selectedStudy,
    selectedStudyKey,
    groups,
    media: hydratedMedia,
    reports,
  };
}

export async function initEstudioPaciente({ signal } = {}) {
  bindEvents(signal);
  setActiveTab('patient');
  hideStatus();

  const params = routeParams();
  const patientId =
    params.get('paciente') ||
    params.get('paciente_id') ||
    params.get('patient_id') ||
    sessionStorage.getItem(STUDY_PATIENT_ID_STORAGE_KEY) ||
    '';
  const studyKey =
    params.get('estudio_id') ||
    params.get('study_id') ||
    sessionStorage.getItem(STUDY_ID_STORAGE_KEY) ||
    '';

  if (!patientId) {
    showStatus('No se recibio el paciente del estudio.');
    return;
  }

  setText('studyDetailSubtitle', 'Cargando informacion...');

  try {
    await loadContext(patientId, studyKey);

    if (signal?.aborted) return;

    renderPatientInfo();
    renderGallery();
    hideStatus();
  } catch (error) {
    console.error('No se pudo cargar el estudio del paciente:', error);
    showStatus(error?.message || 'No se pudo cargar el estudio del paciente.');
  }
}
