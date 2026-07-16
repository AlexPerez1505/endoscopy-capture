import { apiBaseUrl, laravelFetch } from './laravel.js';

const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
const OPEN_PATIENT_STORAGE_KEY = 'enclaii-open-gallery-patient';
const LOGIN_ENDPOINT = `${apiBaseUrl()}/api/tauri/login`;
const GALLERY_ENDPOINT = `${apiBaseUrl()}/api/tauri/galeria`;

const GALLERY_PAGE_SIZE = 15;

let GALLERY_PATIENTS = [];
let galleryLoadPromise = null;
let galleryCurrentPage = 1;

const DEFAULT_FILTERS = {
  patient: '',
  doctor: '',
  procedure: '',
  dateFrom: '',
  dateTo: '',
  fileType: 'all',
  status: 'all',
};

let appliedFilters = { ...DEFAULT_FILTERS };
let activeDatePreset = 'month';
let dateFilterEnabled = false;
let currentDetailPatient = null;
let currentViewerMedia = null;
let defaultGallerySub = '';
let pendingImageFilter = 'none';
let appliedImageFilter = 'none';
let galleryTemplate = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function safeCssToken(value, fallback) {
  const token = String(value || '');
  return /^[a-z0-9_-]+$/i.test(token) ? token : fallback;
}

function normalizeGalleryMedia(media = {}, index = 0) {
  const type = media.type === 'video' ? 'video' : 'image';

  return {
    id: String(media.id ?? `${type}-${index + 1}`),
    type,
    file: String(media.file || media.filename || media.nombre_original || 'Captura'),
    study: String(media.study || media.estudio || media.study_label || 'Captura del estudio'),
    date: String(media.date || media.fecha || '--'),
    studyDate: String(media.studyDate || media.study_date || media.fecha_estudio || ''),
    time: String(media.time || media.hora || ''),
    theme: String(media.theme || `theme-${(index % 4) + 1}`),
    src: String(media.src || media.url || ''),
  };
}

function normalizeGalleryPatient(patient = {}, index = 0) {
  const media = Array.isArray(patient.media)
    ? patient.media.map((item, mediaIndex) => normalizeGalleryMedia(item, mediaIndex))
    : [];
  const photos = Number(patient.photos ?? patient.fotos ?? media.filter(item => item.type === 'image').length) || 0;
  const videos = Number(patient.videos ?? media.filter(item => item.type === 'video').length) || 0;

  return {
    id: String(patient.id ?? patient.patient_id ?? `P-${String(index + 1).padStart(3, '0')}`),
    name: String(patient.name || patient.nombre || 'Paciente sin nombre'),
    initials: String(patient.initials || patient.ini || 'PX').slice(0, 3),
    age: String(patient.age || patient.edad || '--'),
    gender: String(patient.gender || patient.sexo || '--'),
    lastStudy: String(patient.lastStudy || patient.ultimo || '--'),
    studyDate: String(patient.studyDate || patient.study_date || ''),
    studies: Number(patient.studies ?? patient.estudios) || 0,
    photos,
    videos,
    status: String(patient.status || patient.estado || 'Activo'),
    studyStatus: String(patient.studyStatus || patient.study_status || 'pending'),
    doctor: String(patient.doctor || patient.medico || 'Sin medico'),
    procedure: String(patient.procedure || patient.procedimiento || 'Estudio'),
    tone: String(patient.tone || ['is-purple', 'is-blue', 'is-pink', 'is-mint'][index % 4]),
    phone: String(patient.phone || patient.telefono || ''),
    detailStudies: Number(patient.detailStudies ?? patient.detail_studies ?? patient.studies ?? patient.estudios) || 0,
    media,
  };
}

function setGalleryEmptyText(message) {
  const empty = document.getElementById('galleryEmptyState');
  if (empty) empty.textContent = message;
}

function authHeader() {
  const token = sessionStorage.getItem(AUTH_STORAGE_KEY);
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
    throw new Error(payload?.message || 'No se pudo iniciar sesion con Laravel.');
  }

  return payload.token;
}

function renderLaravelLogin(root, message = 'Inicia sesion con tu usuario de Laravel.') {
  root.innerHTML = `
    <form id="laravelGaleriaLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke,#26314a);border-radius:14px;background:var(--card,#101a33);">
      <strong style="display:block;color:var(--txt,#fff);font-size:16px;margin-bottom:8px;">Conectar Galeria con Laravel</strong>
      <p style="color:var(--txt-soft,#94a3b8);font-size:13px;line-height:1.5;margin:0 0 18px;">${escapeHtml(message)}</p>
      <label style="display:block;margin-bottom:12px;">
        <span style="display:block;font-size:12px;color:var(--txt-soft,#94a3b8);margin-bottom:4px;">Correo</span>
        <input id="laravelGaleriaEmail" type="email" required style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid var(--stroke,#26314a);background:transparent;color:inherit;" />
      </label>
      <label style="display:block;margin-bottom:18px;">
        <span style="display:block;font-size:12px;color:var(--txt-soft,#94a3b8);margin-bottom:4px;">Contrasena</span>
        <input id="laravelGaleriaPassword" type="password" required style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid var(--stroke,#26314a);background:transparent;color:inherit;" />
      </label>
      <button type="submit" class="btn-primary" style="width:100%;padding:10px;border-radius:8px;">Iniciar sesion</button>
    </form>`;

  document.getElementById('laravelGaleriaLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('laravelGaleriaEmail')?.value.trim();
    const password = document.getElementById('laravelGaleriaPassword')?.value || '';
    if (!email || !password) return;

    try {
      const token = await loginToLaravel(email, password);
      sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      if (galleryTemplate) root.innerHTML = galleryTemplate;
      initGaleria();
    } catch (error) {
      console.error(error);
      renderLaravelLogin(root, error.message || 'No se pudo iniciar sesion.');
    }
  });
}

async function loadGalleryData() {
  if (galleryLoadPromise) return galleryLoadPromise;

  galleryLoadPromise = (async () => {
    const headers = { Accept: 'application/json' };
    const authorization = authHeader();
    if (authorization) headers.Authorization = authorization;

    const response = await laravelFetch(GALLERY_ENDPOINT, { headers });

    if (response.status === 401 || response.status === 419) {
      const error = new Error('Ingresa tus credenciales de Laravel para cargar la galeria.');
      error.code = 'UNAUTHORIZED';
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Laravel respondio HTTP ${response.status}`);
    }

    const payload = await response.json();
    const patients = payload.patients || payload.pacientes || payload.data || [];
    GALLERY_PATIENTS = Array.isArray(patients)
      ? patients.map((patient, index) => normalizeGalleryPatient(patient, index))
      : [];
    return true;
  })().catch(error => {
    console.error('No se pudo cargar la galeria desde Laravel:', error);
    GALLERY_PATIENTS = [];

    if (error.code === 'UNAUTHORIZED') {
      const root = document.getElementById('pageContent');
      if (root) renderLaravelLogin(root, error.message);
      return 'unauthorized';
    }

    setGalleryEmptyText('No se pudo cargar la galeria desde Laravel.');
    return false;
  }).finally(() => {
    galleryLoadPromise = null;
  });

  return galleryLoadPromise;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function selectedRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'all';
}

function setRadioValue(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function uniqueValues(key) {
  return [...new Set(GALLERY_PATIENTS.map(patient => patient[key]).filter(Boolean))].sort();
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  if (!select) return;

  const firstOption = select.querySelector('option')?.outerHTML || '';
  select.innerHTML = firstOption;

  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function setDateRange(from, to) {
  const dateFrom = document.getElementById('filterDateFrom');
  const dateTo = document.getElementById('filterDateTo');

  if (dateFrom) dateFrom.value = from;
  if (dateTo) dateTo.value = to;
}

function setDatePreset(preset) {
  activeDatePreset = preset;
  dateFilterEnabled = preset !== 'custom';

  document.querySelectorAll('[data-date-filter]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.dateFilter === preset);
  });

  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  if (preset === 'today') {
    setDateRange(toInputDate(today), toInputDate(today));
  }

  if (preset === 'week') {
    const day = today.getDay() || 7;
    start.setDate(today.getDate() - day + 1);
    end.setDate(start.getDate() + 6);
    setDateRange(toInputDate(start), toInputDate(end));
  }

  if (preset === 'month') {
    start.setDate(1);
    end.setMonth(today.getMonth() + 1, 0);
    setDateRange(toInputDate(start), toInputDate(end));
  }
}

function readFilterForm() {
  const dateFrom = dateFilterEnabled ? document.getElementById('filterDateFrom')?.value || '' : '';
  const dateTo = dateFilterEnabled ? document.getElementById('filterDateTo')?.value || '' : '';

  return {
    patient: document.getElementById('filterPatient')?.value || '',
    doctor: document.getElementById('filterDoctor')?.value || '',
    procedure: document.getElementById('filterProcedure')?.value || '',
    dateFrom,
    dateTo,
    fileType: selectedRadioValue('filterFileType'),
    status: selectedRadioValue('filterStatus'),
  };
}

function hasDateFilter(filters) {
  return Boolean(filters.dateFrom || filters.dateTo);
}

function matchesAppliedFilters(patient) {
  const filters = appliedFilters;

  if (filters.patient && patient.id !== filters.patient) return false;
  if (filters.doctor && patient.doctor !== filters.doctor) return false;
  if (filters.procedure && patient.procedure !== filters.procedure) return false;

  if (filters.fileType === 'images' && patient.photos === 0) return false;
  if (filters.fileType === 'videos' && patient.videos === 0) return false;
  if (filters.status !== 'all' && patient.studyStatus !== filters.status) return false;

  if (hasDateFilter(filters)) {
    if (!patient.studyDate) return false;
    if (filters.dateFrom && patient.studyDate < filters.dateFrom) return false;
    if (filters.dateTo && patient.studyDate > filters.dateTo) return false;
  }

  return true;
}

function matchesSearch(patient, term) {
  if (!term) return true;

  return [patient.name, patient.id, patient.phone]
    .some(value => normalizeText(value).includes(term));
}

function patientRow(patient) {
  const tone = safeCssToken(patient.tone, 'is-purple');
  const patientId = escapeHtml(patient.id);
  const patientName = escapeHtml(patient.name);

  return `
    <article class="gallery-patient-row">
      <div class="gallery-avatar ${tone}">${escapeHtml(patient.initials)}</div>
      <div class="gallery-patient-main">
        <div class="gallery-patient-name">${patientName}</div>
        <div class="gallery-meta">
          <span>ID: ${patientId}</span>
          <span class="gallery-dot">&bull;</span>
          <span>${escapeHtml(patient.age)}</span>
          <span class="gallery-dot">&bull;</span>
          <span>${escapeHtml(patient.gender)}</span>
        </div>
        <div class="gallery-counts">
          <span>&Uacute;ltimo estudio: ${escapeHtml(patient.lastStudy)}</span>
          <span class="gallery-dot">&bull;</span>
          <span>Estudios: <b>${patient.studies}</b></span>
          <span class="gallery-dot">&bull;</span>
          <span>Fotos: <b>${patient.photos}</b></span>
          <span class="gallery-dot">&bull;</span>
          <span>Videos: <b>${patient.videos}</b></span>
        </div>
      </div>
      <div class="gallery-status">${escapeHtml(patient.status)}</div>
      <button class="gallery-open-btn" type="button" data-open-gallery="${patientId}" aria-label="Abrir galeria de ${patientName}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </article>
  `;
}

function renderGalleryPaginationControls(page, totalPages) {
  const container = document.getElementById('galleryPaginationControls');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" data-gallery-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
  const delta = 2;
  const pages = [];

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= delta) pages.push(i);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }

  pages.forEach(p => {
    html += p === '...'
      ? '<button class="page-btn" disabled>&hellip;</button>'
      : `<button class="page-btn${p === page ? ' active' : ''}" data-gallery-page="${p}">${p}</button>`;
  });

  html += `<button class="page-btn" data-gallery-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
  container.innerHTML = html;
}

function renderGalleryPatients(page = galleryCurrentPage) {
  const list = document.getElementById('galleryPatientList');
  const empty = document.getElementById('galleryEmptyState');
  const search = document.getElementById('gallerySearchInput');
  const info = document.getElementById('galleryPaginationInfo');

  if (!list || !empty) return;

  const term = normalizeText(search?.value);
  const patients = GALLERY_PATIENTS.filter(patient =>
    matchesSearch(patient, term) && matchesAppliedFilters(patient)
  );

  const total = patients.length;
  const totalPages = Math.max(Math.ceil(total / GALLERY_PAGE_SIZE), 1);
  galleryCurrentPage = Math.min(Math.max(page, 1), totalPages);

  const start = (galleryCurrentPage - 1) * GALLERY_PAGE_SIZE;
  const end = Math.min(start + GALLERY_PAGE_SIZE, total);
  const pageItems = patients.slice(start, end);

  list.innerHTML = pageItems.map(patientRow).join('');
  empty.classList.toggle('is-visible', total === 0);

  if (info) {
    info.textContent = total === 0
      ? 'Mostrando 0 pacientes'
      : `Mostrando ${start + 1} a ${end} de ${total} pacientes`;
  }

  renderGalleryPaginationControls(galleryCurrentPage, totalPages);
}

function countText(count) {
  return `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
}

function mediaCard(media) {
  const label = media.type === 'video' ? 'VID' : 'IMG';
  const action = media.type === 'video' ? 'Ver video' : 'Ver imagen';
  const assetClass = media.src ? ' has-asset' : '';
  const assetStyle = media.src ? ` style="background-image:url(&quot;${escapeHtml(media.src)}&quot;)"` : '';
  const theme = safeCssToken(media.theme, 'theme-1');

  return `
    <article class="gallery-media-card">
      <div class="gallery-media-thumb gallery-thumb-${theme}${assetClass}"${assetStyle}>
        <span class="gallery-media-badge">${label}</span>
        <span class="gallery-media-time">${escapeHtml(media.time)}</span>
      </div>
      <div class="gallery-media-info">
        <strong>${escapeHtml(media.file)}</strong>
        <span>${escapeHtml(media.study)}</span>
        <span>${escapeHtml(media.date)}</span>
        <button type="button" data-view-media="${escapeHtml(media.id)}">${action}</button>
      </div>
    </article>
  `;
}

function applyMediaVisual(element, media, baseClass) {
  if (!element || !media) return;

  element.className = `${baseClass} gallery-thumb-${safeCssToken(media.theme, 'theme-1')}${media.src ? ' has-asset' : ''}`;
  element.style.backgroundImage = media.src ? `url("${String(media.src).replace(/["\\\n\r]/g, '')}")` : '';
}

function colorFilterValue(mode) {
  if (mode === 'grayscale') return 'grayscale(1)';
  if (mode === 'invert') return 'invert(1)';
  if (mode === 'sepia') return 'sepia(1)';
  return '';
}

function currentAdjustmentFilter() {
  const brightness = document.getElementById('galleryBrightnessInput')?.value || '100';
  const contrast = document.getElementById('galleryContrastInput')?.value || '100';
  const saturation = document.getElementById('gallerySaturationInput')?.value || '100';
  const color = colorFilterValue(appliedImageFilter);
  return [`brightness(${brightness}%)`, `contrast(${contrast}%)`, `saturate(${saturation}%)`, color]
    .filter(Boolean)
    .join(' ');
}

function applyViewerFilter() {
  const image = document.getElementById('galleryViewerImage');
  if (image) image.style.filter = currentAdjustmentFilter();
}

function updateFilterPreviewVisual() {
  const preview = document.getElementById('galleryFilterPreview');
  if (!preview || !currentViewerMedia) return;

  applyMediaVisual(preview, currentViewerMedia, 'gallery-filter-preview');
  preview.style.filter = [
    colorFilterValue(pendingImageFilter),
    `brightness(${document.getElementById('galleryBrightnessInput')?.value || 100}%)`,
    `contrast(${document.getElementById('galleryContrastInput')?.value || 100}%)`,
    `saturate(${document.getElementById('gallerySaturationInput')?.value || 100}%)`,
  ].filter(Boolean).join(' ');
}

function updateAdjustmentLabels() {
  const brightness = document.getElementById('galleryBrightnessInput');
  const contrast = document.getElementById('galleryContrastInput');
  const saturation = document.getElementById('gallerySaturationInput');
  const brightnessValue = document.getElementById('galleryBrightnessValue');
  const contrastValue = document.getElementById('galleryContrastValue');
  const saturationValue = document.getElementById('gallerySaturationValue');

  if (brightness && brightnessValue) brightnessValue.textContent = `${brightness.value}%`;
  if (contrast && contrastValue) contrastValue.textContent = `${contrast.value}%`;
  if (saturation && saturationValue) saturationValue.textContent = `${saturation.value}%`;

  updateFilterPreviewVisual();
}

function currentImageMedia() {
  return (currentDetailPatient?.media || []).filter(item => item.type === 'image');
}

function renderPatientMedia() {
  const videoGrid = document.getElementById('galleryVideoGrid');
  const imageGrid = document.getElementById('galleryImageGrid');
  const videoEmpty = document.getElementById('galleryVideoEmpty');
  const imageEmpty = document.getElementById('galleryImageEmpty');
  const videoCount = document.getElementById('galleryVideoCount');
  const imageCount = document.getElementById('galleryImageCount');
  const search = normalizeText(document.getElementById('galleryDetailSearch')?.value);

  if (!currentDetailPatient || !videoGrid || !imageGrid || !videoEmpty || !imageEmpty) return;

  const media = currentDetailPatient.media || [];
  const filteredMedia = media.filter(item => {
    if (!search) return true;
    return [item.file, item.study, item.date].some(value => normalizeText(value).includes(search));
  });
  const videos = filteredMedia.filter(item => item.type === 'video');
  const images = filteredMedia.filter(item => item.type === 'image');

  videoGrid.innerHTML = videos.map(mediaCard).join('');
  imageGrid.innerHTML = images.map(mediaCard).join('');

  videoEmpty.style.display = videos.length ? 'none' : 'block';
  imageEmpty.style.display = images.length ? 'none' : 'block';

  if (videoCount) videoCount.textContent = countText(videos.length);
  if (imageCount) imageCount.textContent = countText(images.length);
}

function openPatientGallery(patientId) {
  const patient = GALLERY_PATIENTS.find(item => item.id === patientId);
  if (!patient) return;

  currentDetailPatient = patient;

  document.getElementById('galleryListView')?.classList.add('is-hidden');
  document.getElementById('galleryDetailView')?.classList.remove('is-hidden');
  const detailSearch = document.getElementById('galleryDetailSearch');
  if (detailSearch) detailSearch.value = '';

  const avatar = document.getElementById('galleryDetailAvatar');
  const name = document.getElementById('galleryDetailName');
  const meta = document.getElementById('galleryDetailMeta');
  const studies = document.getElementById('galleryDetailStudies');
  const photos = document.getElementById('galleryDetailPhotos');
  const videos = document.getElementById('galleryDetailVideos');
  const media = patient.media || [];
  const imageTotal = media.filter(item => item.type === 'image').length;
  const videoTotal = media.filter(item => item.type === 'video').length;

  if (avatar) {
    avatar.className = `gallery-avatar ${safeCssToken(patient.tone, 'is-purple')}`;
    avatar.textContent = patient.initials;
  }

  if (name) name.textContent = patient.name;
  if (meta) {
    meta.innerHTML = `ID: ${escapeHtml(patient.id)} &middot; ${escapeHtml(patient.age)} &middot; ${escapeHtml(patient.gender)} &middot; &Uacute;ltimo estudio: ${escapeHtml(patient.lastStudy)}`;
  }
  if (studies) studies.textContent = patient.detailStudies ?? patient.studies;
  if (photos) photos.textContent = imageTotal;
  if (videos) videos.textContent = videoTotal;

  const headSub = document.getElementById('headSub');
  if (headSub) headSub.textContent = `Galeria de pacientes > ${patient.name}`;

  renderPatientMedia();
}

function closePatientGallery() {
  currentDetailPatient = null;
  currentViewerMedia = null;

  document.getElementById('galleryImageViewer')?.classList.add('is-hidden');
  document.getElementById('galleryDetailView')?.classList.add('is-hidden');
  document.getElementById('galleryListView')?.classList.remove('is-hidden');

  const headSub = document.getElementById('headSub');
  if (headSub) headSub.textContent = defaultGallerySub;
}

function viewerThumb(media, index, activeId) {
  const style = media.src ? ` style="background-image:url(&quot;${escapeHtml(media.src)}&quot;)"` : '';
  const assetClass = media.src ? ' has-asset' : '';
  const activeClass = media.id === activeId ? ' is-active' : '';
  const theme = safeCssToken(media.theme, 'theme-1');

  return `
    <button class="gallery-study-thumb gallery-thumb-${theme}${assetClass}${activeClass}"${style} type="button" data-select-viewer-media="${escapeHtml(media.id)}">
      <span>${index + 1}</span>
      <em>${escapeHtml(media.time)}</em>
    </button>
  `;
}

function renderImageViewer(mediaId) {
  const images = currentImageMedia();
  if (!images.length) return;

  const index = Math.max(images.findIndex(item => item.id === mediaId), 0);
  const media = images[index];
  currentViewerMedia = media;

  applyMediaVisual(document.getElementById('galleryViewerImage'), media, 'gallery-viewer-image');
  applyMediaVisual(document.getElementById('galleryFilterPreview'), media, 'gallery-filter-preview');
  applyViewerFilter();

  const counter = document.getElementById('galleryViewerCounter');
  const frameTime = document.getElementById('galleryViewerFrameTime');
  const infoId = document.getElementById('galleryInfoId');
  const infoDate = document.getElementById('galleryInfoDate');
  const infoFrame = document.getElementById('galleryInfoFrame');
  const stripTitle = document.getElementById('galleryStudyStripTitle');
  const thumbs = document.getElementById('galleryStudyThumbs');

  if (counter) counter.textContent = `Imagen ${index + 1} de ${images.length}`;
  if (frameTime) frameTime.textContent = media.time;
  if (infoId) infoId.textContent = `IMG-${String(index + 1).padStart(4, '0')}`;
  if (infoDate) infoDate.textContent = `${media.date} - ${media.time}`;
  if (infoFrame) infoFrame.textContent = media.time;
  if (stripTitle) stripTitle.textContent = `Imagenes del estudio (${Math.min(images.length, 3)})`;
  if (thumbs) thumbs.innerHTML = images.slice(0, 3).map((item, thumbIndex) => viewerThumb(item, thumbIndex, media.id)).join('');

  const headSub = document.getElementById('headSub');
  if (headSub && currentDetailPatient) {
    headSub.textContent = `Galeria de pacientes > ${currentDetailPatient.name} > ${media.file}`;
  }
}

function openImageViewer(mediaId) {
  if (!currentDetailPatient) return;

  document.getElementById('galleryDetailView')?.classList.add('is-hidden');
  document.getElementById('galleryImageViewer')?.classList.remove('is-hidden');
  renderImageViewer(mediaId);
}

function openMediaViewer(mediaId) {
  const media = currentDetailPatient?.media?.find(item => item.id === mediaId);
  if (!media) return;

  if (media.type === 'video' && media.src) {
    window.open(media.src, '_blank', 'noopener');
    return;
  }

  openImageViewer(mediaId);
}

function closeImageViewer() {
  document.getElementById('galleryImageViewer')?.classList.add('is-hidden');
  document.getElementById('galleryDetailView')?.classList.remove('is-hidden');
  document.getElementById('galleryDrawingPanel')?.classList.add('is-hidden');
  document.getElementById('galleryImageFiltersPanel')?.classList.add('is-hidden');
  document.getElementById('galleryAnnotateBtn')?.classList.remove('active');
  document.getElementById('galleryImageFiltersBtn')?.classList.remove('active');

  const headSub = document.getElementById('headSub');
  if (headSub && currentDetailPatient) {
    headSub.textContent = `Galeria de pacientes > ${currentDetailPatient.name}`;
  }
}

function moveImageViewer(delta) {
  const images = currentImageMedia();
  if (!images.length || !currentViewerMedia) return;

  const currentIndex = images.findIndex(item => item.id === currentViewerMedia.id);
  const nextIndex = (currentIndex + delta + images.length) % images.length;
  renderImageViewer(images[nextIndex].id);
}

function toggleDrawingTools() {
  const panel = document.getElementById('galleryDrawingPanel');
  const button = document.getElementById('galleryAnnotateBtn');
  const filtersPanel = document.getElementById('galleryImageFiltersPanel');
  const filtersButton = document.getElementById('galleryImageFiltersBtn');
  const isOpen = !panel?.classList.contains('is-hidden');

  panel?.classList.toggle('is-hidden', isOpen);
  button?.classList.toggle('active', !isOpen);
  if (!isOpen) {
    filtersPanel?.classList.add('is-hidden');
    filtersButton?.classList.remove('active');
  }
}

function toggleImageFilters() {
  const panel = document.getElementById('galleryImageFiltersPanel');
  const button = document.getElementById('galleryImageFiltersBtn');
  const drawingPanel = document.getElementById('galleryDrawingPanel');
  const drawingButton = document.getElementById('galleryAnnotateBtn');
  const isOpen = !panel?.classList.contains('is-hidden');

  panel?.classList.toggle('is-hidden', isOpen);
  button?.classList.toggle('active', !isOpen);
  if (!isOpen) {
    drawingPanel?.classList.add('is-hidden');
    drawingButton?.classList.remove('active');
    updateFilterPreviewVisual();
  }
}

function applyImageFilters() {
  appliedImageFilter = pendingImageFilter;
  applyViewerFilter();
}

function resetImageFilters() {
  pendingImageFilter = 'none';
  appliedImageFilter = 'none';
  ['galleryBrightnessInput', 'galleryContrastInput', 'gallerySaturationInput'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '100';
  });
  document.querySelectorAll('[data-color-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.colorFilter === 'none');
  });
  updateAdjustmentLabels();
  applyViewerFilter();
}

function setFilterPanelOpen(isOpen) {
  const shell = document.querySelector('.gallery-shell');
  const panel = document.getElementById('galleryFilterPanel');
  const button = document.getElementById('galleryFilterBtn');

  panel?.classList.toggle('is-open', isOpen);
  shell?.classList.toggle('filters-closed', !isOpen);

  if (button) {
    button.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', String(isOpen));
  }
}

function toggleGalleryFilters() {
  const panel = document.getElementById('galleryFilterPanel');
  setFilterPanelOpen(!panel?.classList.contains('is-open'));
}

function clearFilterForm() {
  const patient = document.getElementById('filterPatient');
  const doctor = document.getElementById('filterDoctor');
  const procedure = document.getElementById('filterProcedure');
  const dateFrom = document.getElementById('filterDateFrom');
  const dateTo = document.getElementById('filterDateTo');

  if (patient) patient.value = '';
  if (doctor) doctor.value = '';
  if (procedure) procedure.value = '';
  if (dateFrom) dateFrom.value = '';
  if (dateTo) dateTo.value = '';

  setRadioValue('filterFileType', 'all');
  setRadioValue('filterStatus', 'all');
  setDatePreset('custom');

  appliedFilters = { ...DEFAULT_FILTERS };
  renderGalleryPatients(1);
}

function applyFilterForm() {
  appliedFilters = readFilterForm();
  renderGalleryPatients(1);

  if (window.matchMedia('(max-width: 1100px)').matches) {
    setFilterPanelOpen(false);
  }
}

function fillPatientSelect() {
  const select = document.getElementById('filterPatient');
  if (!select) return;

  const firstOption = select.querySelector('option')?.outerHTML || '';
  select.innerHTML = firstOption;

  GALLERY_PATIENTS.forEach(patient => {
    const option = document.createElement('option');
    option.value = patient.id;
    option.textContent = `${patient.name} (${patient.id})`;
    select.appendChild(option);
  });
}

export function initGaleria() {
  const root = document.getElementById('pageContent');
  if (root && !galleryTemplate) galleryTemplate = root.innerHTML;

  const search = document.getElementById('gallerySearchInput');
  const patientList = document.getElementById('galleryPatientList');
  const filterButton = document.getElementById('galleryFilterBtn');
  const filterClose = document.getElementById('galleryFilterClose');
  const clearButton = document.getElementById('galleryClearFilters');
  const applyButton = document.getElementById('galleryApplyFilters');
  const backButton = document.getElementById('galleryBackBtn');
  const detailSearch = document.getElementById('galleryDetailSearch');
  const imageGrid = document.getElementById('galleryImageGrid');
  const videoGrid = document.getElementById('galleryVideoGrid');
  const viewerBack = document.getElementById('galleryViewerBack');
  const viewerPrev = document.getElementById('galleryViewerPrev');
  const viewerNext = document.getElementById('galleryViewerNext');
  const viewerThumbs = document.getElementById('galleryStudyThumbs');
  const annotateButton = document.getElementById('galleryAnnotateBtn');
  const imageFiltersButton = document.getElementById('galleryImageFiltersBtn');
  const applyImageFiltersButton = document.getElementById('galleryApplyImageFilters');
  const resetImageFiltersButton = document.getElementById('galleryResetImageFilters');

  appliedFilters = { ...DEFAULT_FILTERS };
  activeDatePreset = 'month';
  dateFilterEnabled = false;
  galleryCurrentPage = 1;
  currentDetailPatient = null;
  currentViewerMedia = null;
  pendingImageFilter = 'none';
  appliedImageFilter = 'none';
  defaultGallerySub = document.getElementById('headSub')?.textContent || '';

  fillPatientSelect();
  fillSelect('filterDoctor', uniqueValues('doctor'));
  fillSelect('filterProcedure', uniqueValues('procedure'));
  setDatePreset('month');
  dateFilterEnabled = false;

  search?.addEventListener('input', () => renderGalleryPatients(1));
  patientList?.addEventListener('click', event => {
    const button = event.target.closest('[data-open-gallery]');
    if (button) openPatientGallery(button.dataset.openGallery);
  });

  document.getElementById('galleryPaginationControls')?.addEventListener('click', event => {
    const button = event.target.closest('[data-gallery-page]');
    if (!button || button.disabled) return;
    renderGalleryPatients(Number(button.dataset.galleryPage));
  });
  filterButton?.addEventListener('click', toggleGalleryFilters);
  filterClose?.addEventListener('click', () => setFilterPanelOpen(false));
  clearButton?.addEventListener('click', clearFilterForm);
  applyButton?.addEventListener('click', applyFilterForm);
  backButton?.addEventListener('click', closePatientGallery);
  detailSearch?.addEventListener('input', renderPatientMedia);

  [imageGrid, videoGrid].forEach(grid => {
    grid?.addEventListener('click', event => {
      const button = event.target.closest('[data-view-media]');
      if (button) openMediaViewer(button.dataset.viewMedia);
    });
  });

  viewerBack?.addEventListener('click', closeImageViewer);
  viewerPrev?.addEventListener('click', () => moveImageViewer(-1));
  viewerNext?.addEventListener('click', () => moveImageViewer(1));
  annotateButton?.addEventListener('click', toggleDrawingTools);
  imageFiltersButton?.addEventListener('click', toggleImageFilters);
  applyImageFiltersButton?.addEventListener('click', applyImageFilters);
  resetImageFiltersButton?.addEventListener('click', resetImageFilters);
  viewerThumbs?.addEventListener('click', event => {
    const button = event.target.closest('[data-select-viewer-media]');
    if (button) {
      renderImageViewer(button.dataset.selectViewerMedia);
    }
  });

  document.querySelectorAll('[data-color-filter]').forEach(button => {
    button.addEventListener('click', () => {
      pendingImageFilter = button.dataset.colorFilter || 'none';
      document.querySelectorAll('[data-color-filter]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      updateFilterPreviewVisual();
    });
  });

  ['galleryBrightnessInput', 'galleryContrastInput', 'gallerySaturationInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateAdjustmentLabels);
  });

  document.querySelectorAll('[data-date-filter]').forEach(button => {
    button.addEventListener('click', () => {
      setDatePreset(button.dataset.dateFilter || 'custom');
      dateFilterEnabled = true;
    });
  });

  ['filterDateFrom', 'filterDateTo'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (activeDatePreset !== 'custom') setDatePreset('custom');
      dateFilterEnabled = true;
    });
  });

  document.getElementById('galleryListView')?.classList.remove('is-hidden');
  document.getElementById('galleryDetailView')?.classList.add('is-hidden');
  document.getElementById('galleryImageViewer')?.classList.add('is-hidden');
  document.getElementById('galleryDrawingPanel')?.classList.add('is-hidden');
  document.getElementById('galleryImageFiltersPanel')?.classList.add('is-hidden');
  setFilterPanelOpen(!window.matchMedia('(max-width: 1100px)').matches);
  updateAdjustmentLabels();
  setGalleryEmptyText('Cargando galeria desde Laravel...');
  renderGalleryPatients();
  loadGalleryData().then(ok => {
    if (ok === 'unauthorized') return;

    if (!ok) {
      renderGalleryPatients();
      return;
    }

    setGalleryEmptyText('No se encontraron pacientes.');
    fillPatientSelect();
    fillSelect('filterDoctor', uniqueValues('doctor'));
    fillSelect('filterProcedure', uniqueValues('procedure'));
    renderGalleryPatients();

    const pendingPatientId = sessionStorage.getItem(OPEN_PATIENT_STORAGE_KEY);
    if (pendingPatientId) {
      sessionStorage.removeItem(OPEN_PATIENT_STORAGE_KEY);
      openPatientGallery(pendingPatientId);
    }
  });
}
