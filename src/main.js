import { apiBaseUrl, laravelFetch } from './js/laravel.js';
import { authHeader as userAuthHeader } from './js/auth.js';
import { createDoubleClickCalibrator } from './js/double-click-calibrator.js';
import {
  DEVICE_TOKEN_STORAGE_KEY as DEVICE_TOKEN_KEY,
  DEVICE_SESSION_STORAGE_KEY as DEVICE_SESSION_KEY,
  DEVICE_UID_STORAGE_KEY as DEVICE_UID_KEY,
  CONFIG_PANEL_COLLAPSED_STORAGE_KEY,
  FOCUS_MODE_ENABLED_STORAGE_KEY,
  FOCUS_MODE_ROI_STORAGE_KEY,
  FOCUS_MODE_SELECTED_DEVICE_STORAGE_KEY,
  DOUBLE_CLICK_WINDOW_STORAGE_KEY,
  DOUBLE_CLICK_ENABLED_STORAGE_KEY,
  STUDY_PATIENT_ID_STORAGE_KEY,
  STUDY_PATIENT_NAME_STORAGE_KEY,
  STUDY_ID_STORAGE_KEY,
  STUDY_LABEL_STORAGE_KEY,
  OPEN_GALLERY_PATIENT_STORAGE_KEY,
} from './js/storage-keys.js';

const PAIR_ENDPOINT = `${apiBaseUrl()}/api/tauri/pair/redeem`;
const START_SESSION_ENDPOINT = `${apiBaseUrl()}/api/tauri/estudios/iniciar`;
const IMAGES_ENDPOINT = `${apiBaseUrl()}/api/tauri/images`;
const VIDEOS_ENDPOINT = `${apiBaseUrl()}/api/tauri/videos`;
const FINISH_SESSION_ENDPOINT = `${apiBaseUrl()}/api/tauri/finish-session`;

// El boton fisico del capturador puede generar clics repetidos/rebotados al
// conectarse (rebote de contacto). Sin un limite, cada uno de esos clics
// dispara una captura y bloquea el hilo principal, lo que se percibe como si
// el mouse "se trabara" mientras el capturador esta conectado.
const REMOTE_CAPTURE_COOLDOWN_MS = 900;
let lastRemoteCaptureAt = 0;

const preview = document.getElementById('preview');
const videoFrame = document.getElementById('videoFrame');
const captureLayoutSection = document.getElementById('captureLayout');
const halfScreenBtn = document.getElementById('halfScreenBtn');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const exitFullScreenBtn = document.getElementById('exitFullScreenBtn');
const videoCropWrapper = document.getElementById('videoCropWrapper');
const focusModeToggleBtn = document.getElementById('focusModeToggleBtn');
const focusModeCalibrateBtn = document.getElementById('focusModeCalibrateBtn');
const focusModeHelp = document.getElementById('focusModeHelp');
const focusCropCanvas = document.getElementById('focusCropCanvas');
const videoToast = document.getElementById('videoToast');
const configPanel = document.getElementById('configPanel');
const configPanelToggle = document.getElementById('configPanelToggle');
const emptyState = document.getElementById('emptyState');
const deviceSelect = document.getElementById('deviceSelect');
const detectDevicesBtn = document.getElementById('detectDevicesBtn');
const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const recordBtn = document.getElementById('recordBtn');
const doubleClickToggle = document.getElementById('doubleClickToggle');
const snapshotCanvas = document.getElementById('snapshotCanvas');
const logBox = document.getElementById('logBox');
const connectionStatus = document.getElementById('connectionStatus');
const recordingIndicator = document.getElementById('recordingIndicator');
const recordingIndicatorText = document.getElementById('recordingIndicatorText');
const recordingTimer = document.getElementById('recordingTimer');
const deviceLabel = document.getElementById('deviceLabel');
const backToAppBtn = document.getElementById('backToAppBtn');

const pairCard = document.getElementById('pairCard');
const captureLayout = document.getElementById('captureLayout');
const pairForm = document.getElementById('pairForm');
const pairCodeInput = document.getElementById('pairCodeInput');
const pairBackBtn = document.getElementById('pairBackBtn');
const pairStatusMsg = document.getElementById('pairStatusMsg');

const pairStatusText = document.getElementById('pairStatusText');
const tenantText = document.getElementById('tenantText');
const patientText = document.getElementById('patientText');
const studyText = document.getElementById('studyText');
const sessionText = document.getElementById('sessionText');

const brightnessInput = document.getElementById('brightnessInput');
const contrastInput = document.getElementById('contrastInput');
const saturationInput = document.getElementById('saturationInput');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');

const imageCount = document.getElementById('imageCount');
const videoCount = document.getElementById('videoCount');
const captureThumbnails = document.getElementById('captureThumbnails');
const captureMediaModal = document.getElementById('captureMediaModal');
const captureMediaModalBackdrop = document.getElementById('captureMediaModalBackdrop');
const captureMediaModalClose = document.getElementById('captureMediaModalClose');
const captureMediaModalImage = document.getElementById('captureMediaModalImage');
const captureMediaModalVideo = document.getElementById('captureMediaModalVideo');
const finishStudyBtn = document.getElementById('finishStudyBtn');
const fullscreenFinishStudyBtn = document.getElementById('fullscreenFinishStudyBtn');
const finishStudyModal = document.getElementById('finishStudyModal');
const finishStudyThumbnails = document.getElementById('finishStudyThumbnails');
const finishStudySummary = document.getElementById('finishStudySummary');
const finishStudyGalleryBtn = document.getElementById('finishStudyGalleryBtn');
const finishStudyReportBtn = document.getElementById('finishStudyReportBtn');

let currentStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartedAt = 0;
let recordingTimerIntervalId = null;

let totalImages = 0;
let totalVideos = 0;
let activeStudyContext = {};
let isDevicePaired = false;
let captureAuthMode = null; // 'device' (codigo de 6 digitos) o 'user' (sesion directa)
let capturedItems = [];
// Promesas de subidas de video en curso. No bloquean "Finalizar estudio":
// el video ya aparece en capturedItems apenas se detiene la grabacion, y
// esta lista solo se usa para saber si aun hay subidas pendientes.
let pendingVideoUploads = [];
// Se resuelve cuando el handler onstop del MediaRecorder ya agrego el video
// a capturedItems (no cuando termina de subirse). mediaRecorder.stop() es
// asincrono: sin esto, finishStudy() podia revisar capturedItems antes de
// que el video recien grabado apareciera ahi.
let recordingStopHandled = Promise.resolve();

const DEFAULT_CAMERA_VALUE = '__default_camera__';

function goBackToApp() {
  finishActiveSession();

  // Navegacion explicita en vez de history.back(): en el WebView de Tauri
  // el boton regresar no siempre responde con back() tras un location.href
  // desde app.html (data-nav="nuevo-estudio" -> index.html). replace()
  // evita dejar index.html como entrada muerta en el historial.
  window.location.replace('./app.html#dashboard');
}

function addLog(message, type = 'info') {
  const line = document.createElement('p');
  const date = new Date().toLocaleTimeString();

  line.textContent = `[${date}] ${message}`;

  if (type === 'error') {
    line.classList.add('is-error');
  }

  if (type === 'success') {
    line.classList.add('is-success');
  }

  logBox.prepend(line);
}

// En media pantalla o pantalla completa el panel lateral (con el log) queda
// oculto, asi que el doctor no tiene forma de saber si una foto se tomo o si
// la grabacion inicio/paro. Este aviso flotante se dibuja encima del video
// (unico elemento visible en esos modos) para cubrir ese hueco.
let videoToastTimer = null;

function showVideoToast(message, type = 'info') {
  if (!(isVideoFullscreen() || captureLayoutSection.classList.contains('is-half-screen'))) return;

  clearTimeout(videoToastTimer);

  videoToast.textContent = message;
  videoToast.classList.remove('is-error', 'is-success', 'is-photo');

  if (type === 'error') videoToast.classList.add('is-error');
  if (type === 'success') videoToast.classList.add('is-success');
  if (type === 'photo') videoToast.classList.add('is-photo');

  videoToast.classList.add('is-visible');

  videoToastTimer = setTimeout(() => {
    videoToast.classList.remove('is-visible');
  }, 2200);
}

function setStatus(text, mode = 'idle') {
  connectionStatus.textContent = text;
  connectionStatus.classList.remove('is-live', 'is-error', 'is-warning');

  if (mode === 'live') {
    connectionStatus.classList.add('is-live');
  }

  if (mode === 'error') {
    connectionStatus.classList.add('is-error');
  }

  if (mode === 'warning') {
    connectionStatus.classList.add('is-warning');
  }
}

function renderConnection() {
  renderLaravelConnection();
}

function contextValue(names) {
  const queryParams = new URLSearchParams(window.location.search);
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : '';
  const hashParams = new URLSearchParams(hashQuery);

  for (const name of names) {
    const value =
      queryParams.get(name) ||
      hashParams.get(name) ||
      sessionStorage.getItem(`enclaii-${name}`);

    if (value) return value;
  }

  return '';
}

function firstText(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== '');
  return value === undefined ? '' : String(value).trim();
}

function captureContext() {
  return {
    patientId: firstText(contextValue(['patient_id', 'paciente_id', 'patientId']), activeStudyContext.patientId),
    studyId: firstText(contextValue(['study_id', 'estudio_id', 'studyId']), activeStudyContext.studyId),
    sessionId: firstText(contextValue(['session_id', 'sesion_id', 'sessionId']), activeStudyContext.sessionId),
    patientName: firstText(contextValue(['patient_name', 'paciente_nombre', 'patientName']), activeStudyContext.patientName),
    studyLabel: firstText(contextValue(['study_label', 'estudio_label', 'studyLabel']), activeStudyContext.studyLabel),
  };
}

function renderLaravelConnection() {
  const context = captureContext();

  if (pairStatusText) pairStatusText.textContent = isDevicePaired ? 'Vinculado' : 'Sin vincular';
  if (tenantText) tenantText.textContent = apiBaseUrl();
  if (patientText) patientText.textContent = context.patientName || (context.patientId ? `ID ${context.patientId}` : 'Sin paciente');
  if (studyText) studyText.textContent = context.studyLabel || (context.studyId ? `ID ${context.studyId}` : 'Sin estudio');
  if (sessionText) sessionText.textContent = context.sessionId || 'Sin sesion';

  captureBtn.disabled = !currentStream;
  recordBtn.disabled = !currentStream;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(blob);
  });
}

function getDeviceUid() {
  let uid = localStorage.getItem(DEVICE_UID_KEY);
  if (!uid) {
    uid = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    localStorage.setItem(DEVICE_UID_KEY, uid);
  }
  return uid;
}

function deviceAuthHeader() {
  const token = sessionStorage.getItem(DEVICE_TOKEN_KEY);
  return token ? `Bearer ${token}` : '';
}

function activeCaptureAuthHeader() {
  return captureAuthMode === 'device' ? deviceAuthHeader() : userAuthHeader();
}

function persistPairing(data) {
  sessionStorage.setItem(DEVICE_TOKEN_KEY, data.token);
  sessionStorage.setItem(DEVICE_SESSION_KEY, String(data.session_id));

  if (data.paciente_id) sessionStorage.setItem(STUDY_PATIENT_ID_STORAGE_KEY, String(data.paciente_id));
  if (data.paciente_nombre) sessionStorage.setItem(STUDY_PATIENT_NAME_STORAGE_KEY, data.paciente_nombre);
  if (data.estudio_id || data.study_id) sessionStorage.setItem(STUDY_ID_STORAGE_KEY, String(data.estudio_id || data.study_id));
  if (data.estudio_tipo) sessionStorage.setItem(STUDY_LABEL_STORAGE_KEY, data.estudio_tipo);

  activeStudyContext = {
    patientId: firstText(data.paciente_id, activeStudyContext.patientId),
    studyId: firstText(data.estudio_id, data.study_id, activeStudyContext.studyId),
    sessionId: String(data.session_id),
    patientName: firstText(data.paciente_nombre, activeStudyContext.patientName),
    studyLabel: firstText(data.estudio_tipo, activeStudyContext.studyLabel),
  };

  captureAuthMode = 'device';
  isDevicePaired = true;
}

async function pairWithCode(code) {
  const response = await laravelFetch(PAIR_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      device_name: 'Endoscopy Capture Desktop',
      device_uid: getDeviceUid(),
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `El servidor respondio HTTP ${response.status} al vincular el dispositivo.`);
  }

  persistPairing(payload.data || {});
  return payload.data;
}

/**
 * Inicia una sesion de captura directamente con el token de usuario ya
 * logueado en Tauri, usando el paciente_id que llego desde "Iniciar estudio"
 * en Pacientes. No requiere el codigo de 6 digitos generado en la web.
 */
async function startDirectSession() {
  const authorization = userAuthHeader();
  const context = captureContext();

  if (!authorization || !context.patientId) {
    return null;
  }

  const response = await laravelFetch(START_SESSION_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      paciente_id: context.patientId,
      estudio_id: context.studyId || undefined,
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `El servidor respondio HTTP ${response.status} al iniciar la sesion de captura.`);
  }

  const data = payload.data || {};

  sessionStorage.setItem(DEVICE_SESSION_KEY, String(data.session_id));

  activeStudyContext = {
    patientId: firstText(data.paciente_id, activeStudyContext.patientId),
    studyId: firstText(data.estudio_id, activeStudyContext.studyId),
    sessionId: String(data.session_id),
    patientName: firstText(data.paciente_nombre, activeStudyContext.patientName),
    studyLabel: firstText(data.estudio_tipo, activeStudyContext.studyLabel),
  };

  captureAuthMode = 'user';
  isDevicePaired = true;

  return data;
}

// Ver una captura (foto o video) dentro de la misma app, en vez de un <a
// target="_blank">: en Tauri eso abre el navegador del sistema por fuera de
// la ventana de la app, sacando al doctor de la pantalla de captura.
function openCaptureMediaModal(url, type) {
  if (!captureMediaModal) return;

  if (type === 'video') {
    captureMediaModalImage?.classList.add('is-hidden');
    if (captureMediaModalVideo) {
      captureMediaModalVideo.src = url;
      captureMediaModalVideo.classList.remove('is-hidden');
    }
  } else {
    captureMediaModalVideo?.classList.add('is-hidden');
    if (captureMediaModalVideo) {
      captureMediaModalVideo.pause();
      captureMediaModalVideo.removeAttribute('src');
      captureMediaModalVideo.load();
    }
    if (captureMediaModalImage) {
      captureMediaModalImage.src = url;
      captureMediaModalImage.classList.remove('is-hidden');
    }
  }

  captureMediaModal.classList.remove('is-hidden');
}

function closeCaptureMediaModal() {
  if (!captureMediaModal) return;

  captureMediaModal.classList.add('is-hidden');

  if (captureMediaModalVideo) {
    captureMediaModalVideo.pause();
    captureMediaModalVideo.removeAttribute('src');
    captureMediaModalVideo.load();
  }

  if (captureMediaModalImage) {
    captureMediaModalImage.removeAttribute('src');
  }
}

captureMediaModalClose?.addEventListener('click', closeCaptureMediaModal);
captureMediaModalBackdrop?.addEventListener('click', closeCaptureMediaModal);

function addCaptureThumbnail(url, label, type, remoteUrl = '', status = 'done') {
  // El item se agrega a capturedItems de inmediato, sin esperar a que la
  // subida al servidor termine. Asi "Finalizar estudio" nunca se bloquea
  // ni depende de la subida del video (ver uploadVideoInChunks/onstop).
  const item = { url, remoteUrl, label, type, status };
  capturedItems.push(item);

  if (!captureThumbnails || !url) return item;

  const button = document.createElement('button');
  button.type = 'button';
  button.title = label;
  button.style.display = 'block';
  button.style.width = '100%';
  button.style.padding = '0';
  button.style.border = '1px solid var(--border, #ccc)';
  button.style.borderRadius = '8px';
  button.style.background = 'none';
  button.style.cursor = 'pointer';
  button.style.position = 'relative';
  button.addEventListener('click', () => openCaptureMediaModal(url, type));

  if (type === 'video') {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.preload = 'metadata';
    video.style.width = '100%';
    video.style.borderRadius = '8px';
    video.style.aspectRatio = '1 / 1';
    video.style.objectFit = 'cover';
    button.appendChild(video);

    const caption = document.createElement('span');
    caption.textContent = `Video: ${label}`;
    caption.style.display = 'block';
    caption.style.padding = '8px';
    caption.style.fontSize = '12px';
    button.appendChild(caption);

    if (status === 'uploading') {
      const badge = document.createElement('span');
      badge.className = 'capture-upload-badge';
      badge.textContent = 'Subiendo...';
      button.appendChild(badge);
      item._badgeEl = badge;
    }
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = label;
    img.style.width = '100%';
    img.style.borderRadius = '8px';
    img.style.aspectRatio = '1 / 1';
    img.style.objectFit = 'cover';
    button.appendChild(img);
  }

  captureThumbnails.prepend(button);

  return item;
}

function showCaptureLayout() {
  pairCard?.classList.add('is-hidden');
  captureLayout?.classList.remove('is-hidden');
  renderConnection();
}

async function finishActiveSession() {
  const sessionId = sessionStorage.getItem(DEVICE_SESSION_KEY);
  const authorization = activeCaptureAuthHeader();
  if (!sessionId || !authorization) return;

  try {
    await laravelFetch(FINISH_SESSION_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({ session_id: Number(sessionId) }),
    });
  } catch (error) {
    console.error('No se pudo finalizar la sesion de captura.', error);
  }
}

// Reintentos con backoff exponencial para la subida de capturas.
//
// Un fallo de red/timeout (por ejemplo, el timeout de 30s del cliente
// HTTP en Rust ante un video grande) o un error 5xx del servidor suelen
// ser transitorios: reintentar despues de una pausa puede salvar la
// captura sin que el usuario tenga que hacer nada. Un 401/419 (token
// invalido) o un 4xx (payload rechazado) NUNCA se arreglan reintentando
// el mismo request, asi que esos se propagan de inmediato.
const UPLOAD_RETRY_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUploadError(status) {
  // Sin status HTTP (el request nunca llego a tener respuesta: error de
  // red, timeout, dispositivo desconectado) se trata como transitorio.
  if (!Number.isFinite(status)) return true;
  return status >= 500;
}

async function performCaptureUploadRequest(endpoint, authorization, body) {
  const response = await laravelFetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (response.status === 401 || response.status === 419) {
    const error = new Error('El dispositivo no esta vinculado o el token expiro. Vuelve a ingresar el codigo.');
    error.status = response.status;
    throw error;
  }

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.message || `El servidor respondio HTTP ${response.status} al guardar la captura.`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function uploadCaptureWithRetry(endpoint, authorization, body, captureType) {
  let lastError;

  for (let attempt = 1; attempt <= UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await performCaptureUploadRequest(endpoint, authorization, body);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= UPLOAD_RETRY_ATTEMPTS;

      if (isLastAttempt || !isRetryableUploadError(error.status)) {
        throw error;
      }

      const waitMs = UPLOAD_RETRY_BASE_DELAY_MS * attempt;
      const label = captureType === 'video' ? 'video' : 'foto';

      addLog(
        `No se pudo guardar el ${label} (intento ${attempt}/${UPLOAD_RETRY_ATTEMPTS}): ${error.message} Reintentando en ${Math.round(waitMs / 1000)}s...`,
        'error'
      );

      await delay(waitMs);
    }
  }

  throw lastError;
}

// Subida de video por partes (chunks): en vez de mandar el video completo
// en un solo request (limitado por memoria y por timeouts, ver
// storeVideo() en el backend), se corta en pedazos pequenos y se sube cada
// uno por separado. Si un pedazo falla, solo se reintenta ese pedazo, no
// el video completo. Requiere los endpoints /videos/init, /videos/{id}/
// chunk/{index} y /videos/{id}/finalize del backend Laravel.
const VIDEO_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
const VIDEO_CHUNK_RETRY_ATTEMPTS = 5;
// Numero de chunks que se suben al mismo tiempo. Subir uno por uno deja
// "huecos" esperando la ida y vuelta de cada request; subir varios en
// paralelo aprovecha mejor el ancho de banda. 4 es un limite prudente para
// no saturar el hosting compartido (Hostinger) con demasiadas conexiones
// simultaneas por sesion de grabacion.
const VIDEO_CHUNK_CONCURRENCY = 4;

// Ejecuta `worker(index)` para indices 0..total-1 usando un pool de como
// maximo `limit` tareas concurrentes, en vez de esperar cada una antes de
// empezar la siguiente.
async function runWithConcurrency(total, limit, worker) {
  let nextIndex = 0;

  async function runNext() {
    if (nextIndex >= total) return;
    const index = nextIndex;
    nextIndex += 1;
    await worker(index);
    await runNext();
  }

  const workerCount = Math.max(1, Math.min(limit, total));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
}

async function performChunkUploadRequest(endpoint, authorization, chunkBlob) {
  const response = await laravelFetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': chunkBlob.type || 'application/octet-stream',
      Authorization: authorization,
    },
    body: chunkBlob,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (response.status === 401 || response.status === 419) {
    const error = new Error('El dispositivo no esta vinculado o el token expiro. Vuelve a ingresar el codigo.');
    error.status = response.status;
    throw error;
  }

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.message || `El servidor respondio HTTP ${response.status} al subir una parte del video.`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function withUploadRetries(label, task) {
  let lastError;

  for (let attempt = 1; attempt <= VIDEO_CHUNK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= VIDEO_CHUNK_RETRY_ATTEMPTS;

      if (isLastAttempt || !isRetryableUploadError(error.status)) {
        throw error;
      }

      const waitMs = UPLOAD_RETRY_BASE_DELAY_MS * attempt;

      addLog(
        `${label} (intento ${attempt}/${VIDEO_CHUNK_RETRY_ATTEMPTS}): ${error.message} Reintentando en ${Math.round(waitMs / 1000)}s...`,
        'error'
      );

      await delay(waitMs);
    }
  }

  throw lastError;
}

async function uploadVideoInChunks(blob, filename) {
  const authorization = activeCaptureAuthHeader();
  const sessionId = sessionStorage.getItem(DEVICE_SESSION_KEY);

  if (!authorization || !sessionId) {
    throw new Error('Vincula el dispositivo con el codigo (o selecciona un paciente desde Pacientes) para guardar las capturas en la base de datos.');
  }

  const mimeType = blob.type || 'video/webm';
  const totalChunks = Math.max(1, Math.ceil(blob.size / VIDEO_CHUNK_SIZE_BYTES));

  addLog(`Subiendo video en ${totalChunks} parte(s) (${(blob.size / (1024 * 1024)).toFixed(1)}MB)...`);

  const initBody = JSON.stringify({
    session_id: Number(sessionId),
    filename,
    mime_type: mimeType,
    total_size: blob.size,
    total_chunks: totalChunks,
    ended_at: new Date().toISOString(),
  });

  const initPayload = await withUploadRetries(
    'No se pudo iniciar la subida del video',
    () => performCaptureUploadRequest(`${VIDEOS_ENDPOINT}/init`, authorization, initBody)
  );

  const uploadId = initPayload.data?.upload_id;

  if (!uploadId) {
    throw new Error('El servidor no devolvio un identificador de subida.');
  }

  // Los chunks se suben en paralelo (hasta VIDEO_CHUNK_CONCURRENCY a la
  // vez) en vez de uno por uno: el backend acepta chunks en cualquier
  // orden porque los rastrea por indice en `received_chunks`, asi que no
  // hay que esperar a que termine el anterior para mandar el siguiente.
  await runWithConcurrency(totalChunks, VIDEO_CHUNK_CONCURRENCY, async (index) => {
    const start = index * VIDEO_CHUNK_SIZE_BYTES;
    const end = Math.min(start + VIDEO_CHUNK_SIZE_BYTES, blob.size);
    const chunkBlob = blob.slice(start, end, mimeType);
    const chunkEndpoint = `${VIDEOS_ENDPOINT}/${uploadId}/chunk/${index}`;

    await withUploadRetries(
      `No se pudo subir la parte ${index + 1}/${totalChunks} del video`,
      () => performChunkUploadRequest(chunkEndpoint, authorization, chunkBlob)
    );
  });

  const finalizePayload = await withUploadRetries(
    'No se pudo finalizar la subida del video',
    () => performCaptureUploadRequest(`${VIDEOS_ENDPOINT}/${uploadId}/finalize`, authorization, JSON.stringify({}))
  );

  return finalizePayload;
}

async function uploadCaptureToLaravel(blob, filename, captureType) {
  const authorization = activeCaptureAuthHeader();
  const sessionId = sessionStorage.getItem(DEVICE_SESSION_KEY);

  if (!authorization || !sessionId) {
    throw new Error('Vincula el dispositivo con el codigo (o selecciona un paciente desde Pacientes) para guardar las capturas en la base de datos.');
  }

  const endpoint = captureType === 'video' ? VIDEOS_ENDPOINT : IMAGES_ENDPOINT;
  const fileField = captureType === 'video' ? 'filename' : 'filename';
  const timestampField = captureType === 'video' ? 'ended_at' : 'captured_at';

  // El Blob se codifica UNA sola vez antes de reintentar: es lo mas
  // costoso de esta operacion (sobre todo en videos grandes) y no cambia
  // entre intentos, asi que repetirlo en cada retry seria puro desperdicio.
  const body = JSON.stringify({
    session_id: Number(sessionId),
    [fileField]: filename,
    mime_type: blob.type || 'application/octet-stream',
    data_base64: await blobToBase64(blob),
    [timestampField]: new Date().toISOString(),
  });

  const payload = await uploadCaptureWithRetry(endpoint, authorization, body, captureType);

  addCaptureThumbnail(
    URL.createObjectURL(blob),
    filename,
    captureType,
    payload.data?.url || ''
  );

  return payload;
}

// Pedir una resolucion/frameRate "ideal" explicito puede obligar a Chromium
// a convertir/reescalar internamente si no coincide con el modo nativo del
// sensor, lo que agrega buffering y desfasa el video (la app Camara de
// Windows no fuerza esto, por eso se ve fluida). Por eso el primer intento
// va SIN constraints de resolucion/framerate, dejando que el driver use su
// modo nativo/por defecto; solo si eso falla se intenta forzar 1920x1080.
function nativeVideoConstraints(deviceId) {
  if (!deviceId || deviceId === DEFAULT_CAMERA_VALUE) {
    return { video: true, audio: false };
  }

  return {
    video: { deviceId: { exact: deviceId } },
    audio: false,
  };
}

function defaultVideoConstraints() {
  return {
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };
}

function videoConstraintsForDevice(deviceId) {
  if (!deviceId || deviceId === DEFAULT_CAMERA_VALUE) {
    return defaultVideoConstraints();
  }

  return {
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };
}

async function openVideoStream(deviceId = '') {
  const attempts = [
    nativeVideoConstraints(deviceId),
    videoConstraintsForDevice(deviceId),
    defaultVideoConstraints(),
    { video: true, audio: false },
  ];

  let lastError = null;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No se pudo abrir la camara.');
}

function selectPreferredDevice() {
  const options = [...deviceSelect.options];
  const preferred = options.find((option) => /usb|capture|captur|hd video/i.test(option.textContent));
  deviceSelect.value = (preferred || options[0])?.value || '';
}

function cameraErrorMessage(error) {
  const name = error?.name || '';
  const message = error?.message || String(error || 'Error desconocido');

  if (name === 'NotReadableError') {
    return 'Windows tiene el capturador ocupado. Cierra Configuracion/Camara u otra app que lo este usando.';
  }

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Windows bloqueo el permiso de camara para esta app. Revisa Privacidad y seguridad > Camara.';
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No se encontro ese capturador. Se intentara usar la camara predeterminada.';
  }

  return message;
}

async function requestCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('WebView no expone acceso a camara. Actualiza Microsoft Edge WebView2 Runtime.');
  }

  return openVideoStream();
}

async function detectDevices() {
  let tempStream = null;

  try {
    setStatus('Buscando...', 'warning');
    addLog('Solicitando permisos de video...');

    tempStream = await requestCameraPermission();

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((device) => device.kind === 'videoinput');
    const liveTrack = tempStream.getVideoTracks()[0] || null;

    deviceSelect.innerHTML = '';

    if (videoDevices.length === 0) {
      const option = document.createElement('option');
      option.value = DEFAULT_CAMERA_VALUE;
      option.textContent = liveTrack?.label || 'Camara predeterminada';
      deviceSelect.appendChild(option);

      setStatus('Camara lista', 'warning');
      addLog('No se pudo listar el capturador, se usara la camara predeterminada.', 'success');
      return;
    }

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Dispositivo de video ${index + 1}`;
      deviceSelect.appendChild(option);
    });

    selectPreferredDevice();

    setStatus('Listo para capturar', 'warning');
    addLog(`Se detectaron ${videoDevices.length} dispositivo(s) de video.`, 'success');
  } catch (error) {
    console.error(error);
    setStatus('Error de camara', 'error');
    addLog(`Error detectando dispositivos: ${cameraErrorMessage(error)}`, 'error');
  } finally {
    if (tempStream && tempStream !== currentStream) {
      tempStream.getTracks().forEach((track) => track.stop());
    }
  }
}

// Con el modo enfoque, recortar el frame deja menos pixeles reales
// disponibles para ese recorte. Si el capturador soporta nativamente una
// resolucion mayor a la que quedo activa, vale la pena subirla para tener
// mas detalle de sobra antes de recortar. A diferencia del intento inicial
// de conexion (que fuerza constraints ANTES de saber que soporta el
// dispositivo y por eso causaba buffering/lag), esto se hace DESPUES de que
// el video ya esta fluido, usando applyConstraints sobre el track activo
// (reconfiguracion de modo, no una renegociacion completa), y solo pide una
// resolucion que el propio dispositivo reporta soportar via getCapabilities().
async function tryUpgradeToMaxResolution(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) {
    return;
  }

  try {
    const capabilities = track.getCapabilities();
    const settings = track.getSettings();

    const maxWidth = capabilities.width?.max;
    const maxHeight = capabilities.height?.max;

    if (!maxWidth || !maxHeight) {
      return;
    }

    // Solo lo intentamos si el maximo soportado es notablemente mayor al
    // modo que ya quedo activo; si no, no vale la pena arriesgar un cambio
    // de modo sin beneficio real.
    const widthGain = maxWidth / (settings.width || maxWidth);
    const heightGain = maxHeight / (settings.height || maxHeight);

    if (widthGain < 1.15 && heightGain < 1.15) {
      return;
    }

    await track.applyConstraints({
      width: { ideal: maxWidth },
      height: { ideal: maxHeight },
    });

    const updated = track.getSettings();
    addLog(
      `Resolución aumentada a ${updated.width}x${updated.height} (máxima soportada por el capturador).`,
      'success'
    );
  } catch (error) {
    console.warn('No se pudo aumentar la resolución nativa:', error);
  }
}

async function startVideo() {
  try {
    const selectedDeviceId = deviceSelect.value;

    // Si se cambia de camara (o se reinicia el video) a mitad de una
    // grabacion, hay que cerrarla primero: de lo contrario el MediaRecorder
    // y, en modo enfoque, el loop de canvas quedan grabando de un stream que
    // ya se detuvo, huerfanos en segundo plano.
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording();
    }

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    currentStream = await openVideoStream(selectedDeviceId);

    await tryUpgradeToMaxResolution(currentStream);

    preview.srcObject = currentStream;

    const selectedText =
      deviceSelect.options[deviceSelect.selectedIndex]?.textContent ||
      'Capturador activo';

    deviceLabel.textContent = selectedText;
    emptyState.classList.add('is-hidden');

    renderConnection();
    setStatus('Video activo', 'warning');

    setConfigPanelCollapsed(true);

    addLog('Video iniciado correctamente.', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Error de video', 'error');
    addLog(`No se pudo iniciar el video: ${cameraErrorMessage(error)}`, 'error');
  }
}

// Panel "Configuración" (Capturador + Modo enfoque + Mejoras visuales):
// colapsable para liberar espacio en el lateral una vez el video ya esta
// corriendo (ver setConfigPanelCollapsed(true) en startVideo), dejando mas
// espacio visible para el log de capturas y las miniaturas del estudio. El
// doctor puede reabrirlo en cualquier momento con la flecha del encabezado.
function setConfigPanelCollapsed(collapsed) {
  configPanel.classList.toggle('is-collapsed', collapsed);
  localStorage.setItem(CONFIG_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
}

configPanelToggle.addEventListener('click', () => {
  setConfigPanelCollapsed(!configPanel.classList.contains('is-collapsed'));
});

setConfigPanelCollapsed(localStorage.getItem(CONFIG_PANEL_COLLAPSED_STORAGE_KEY) === 'true');

function applyFilters() {
  const brightness = brightnessInput.value;
  const contrast = contrastInput.value;
  const saturation = saturationInput.value;

  preview.style.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
}

function resetFilters() {
  brightnessInput.value = '1';
  contrastInput.value = '1';
  saturationInput.value = '1';

  applyFilters();
  addLog('Filtros visuales restaurados.');
}

// =========================================================
// MODO ENFOQUE (ROI manual)
// =========================================================
// Reemplaza el recorte fijo del lado derecho por una seleccion
// manual de area (Region of Interest) sobre el video. El area se
// guarda por dispositivo y persiste entre sesiones de la app.
let focusModeEnabled = localStorage.getItem(FOCUS_MODE_ENABLED_STORAGE_KEY) === 'true';
let focusRoi = null; // {x, y, width, height} en pixeles reales del stream
let focusRoiSelecting = false;
let focusSelectionStart = null;
let focusSelectionEnd = null;
let focusSelectedDevice = localStorage.getItem(FOCUS_MODE_SELECTED_DEVICE_STORAGE_KEY) || '';
let focusLiveCanvas = null;
let focusLiveCtx = null;
let focusRawCanvas = null;
let focusRawCtx = null;
let focusRafId = null;
let focusResizeHandle = null;
let focusDragOffset = { x: 0, y: 0 };

const FOCUS_HANDLE_SIZE = 12;
const FOCUS_MIN_SELECTION = 40;

async function loadRoiProfile(deviceName) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('load_roi_profile', { deviceName: deviceName || null });
  } catch (error) {
    console.error('No se pudo cargar perfil ROI:', error);
    return null;
  }
}

async function saveRoiProfile(roi, deviceName) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const profile = { ...roi, device_name: deviceName || undefined };
    await invoke('save_roi_profile', { profile });
    return true;
  } catch (error) {
    console.error('No se pudo guardar perfil ROI:', error);
    return false;
  }
}

function normalizeRoi(roi, videoWidth, videoHeight) {
  if (!roi || !videoWidth || !videoHeight) return null;
  const x = Math.max(0, Math.min(roi.x || 0, videoWidth - 2));
  const y = Math.max(0, Math.min(roi.y || 0, videoHeight - 2));
  const width = Math.max(FOCUS_MIN_SELECTION, Math.min(roi.width || videoWidth, videoWidth - x));
  const height = Math.max(FOCUS_MIN_SELECTION, Math.min(roi.height || videoHeight, videoHeight - y));
  return { x, y, width, height };
}

function deviceNameForRoi() {
  const label = deviceSelect.options[deviceSelect.selectedIndex]?.textContent || '';
  return label || 'default';
}

function canvasToVideoCoordinates(rect) {
  if (!preview.videoWidth || !focusCropCanvas.width) return rect;
  const scaleX = preview.videoWidth / focusCropCanvas.clientWidth;
  const scaleY = preview.videoHeight / focusCropCanvas.clientHeight;
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

function videoToCanvasCoordinates(roi) {
  if (!preview.videoWidth || !focusCropCanvas.clientWidth) return roi;
  const scaleX = focusCropCanvas.clientWidth / preview.videoWidth;
  const scaleY = focusCropCanvas.clientHeight / preview.videoHeight;
  return {
    x: roi.x * scaleX,
    y: roi.y * scaleY,
    width: roi.width * scaleX,
    height: roi.height * scaleY,
  };
}

function focusCropHandleAt(x, y, canvasRect) {
  const handles = [
    { name: 'nw', x: canvasRect.x, y: canvasRect.y },
    { name: 'ne', x: canvasRect.x + canvasRect.width, y: canvasRect.y },
    { name: 'sw', x: canvasRect.x, y: canvasRect.y + canvasRect.height },
    { name: 'se', x: canvasRect.x + canvasRect.width, y: canvasRect.y + canvasRect.height },
    { name: 'n', x: canvasRect.x + canvasRect.width / 2, y: canvasRect.y },
    { name: 's', x: canvasRect.x + canvasRect.width / 2, y: canvasRect.y + canvasRect.height },
    { name: 'w', x: canvasRect.x, y: canvasRect.y + canvasRect.height / 2 },
    { name: 'e', x: canvasRect.x + canvasRect.width, y: canvasRect.y + canvasRect.height / 2 },
  ];
  for (const handle of handles) {
    const dx = x - handle.x;
    const dy = y - handle.y;
    if (Math.abs(dx) <= FOCUS_HANDLE_SIZE && Math.abs(dy) <= FOCUS_HANDLE_SIZE) {
      return handle.name;
    }
  }
  return null;
}

function drawSelectionOverlay() {
  if (!focusCropCanvas || focusCropCanvas.classList.contains('is-hidden')) return;
  const ctx = focusCropCanvas.getContext('2d');
  const width = focusCropCanvas.width;
  const height = focusCropCanvas.height;
  ctx.clearRect(0, 0, width, height);

  const rect = focusSelectionStart && focusSelectionEnd
    ? canvasSelectionRect()
    : focusRoi
      ? videoToCanvasCoordinates(focusRoi)
      : null;

  if (!rect) return;

  // Fondo semitransparente fuera del area
  ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  if (rect.width > 0 && rect.height > 0) {
    ctx.rect(rect.x + rect.width, rect.y, -rect.width, rect.height);
  }
  ctx.fill('evenodd');

  // Marco del area
  ctx.strokeStyle = '#2f7cff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);

  // Handles
  if (focusRoi || focusSelectionStart) {
    ctx.fillStyle = '#2f7cff';
    const handles = [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height],
    ];
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - FOCUS_HANDLE_SIZE / 2, hy - FOCUS_HANDLE_SIZE / 2, FOCUS_HANDLE_SIZE, FOCUS_HANDLE_SIZE);
    }
  }
}

function canvasSelectionRect() {
  const x = Math.min(focusSelectionStart.x, focusSelectionEnd.x);
  const y = Math.min(focusSelectionStart.y, focusSelectionEnd.y);
  const width = Math.abs(focusSelectionEnd.x - focusSelectionStart.x);
  const height = Math.abs(focusSelectionEnd.y - focusSelectionStart.y);
  return { x, y, width, height };
}

function startRoiSelection(event) {
  if (!focusRoiSelecting || !focusCropCanvas) return;
  const rect = focusCropCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (focusRoi) {
    const canvasRect = videoToCanvasCoordinates(focusRoi);
    const handle = focusCropHandleAt(x, y, canvasRect);
    if (handle) {
      focusResizeHandle = handle;
      focusDragOffset = { x, y };
      return;
    }
    if (x >= canvasRect.x && x <= canvasRect.x + canvasRect.width && y >= canvasRect.y && y <= canvasRect.y + canvasRect.height) {
      focusResizeHandle = 'move';
      focusDragOffset = { x: x - canvasRect.x, y: y - canvasRect.y };
      return;
    }
  }

  focusSelectionStart = { x, y };
  focusSelectionEnd = { x, y };
  focusRoi = null;
  drawSelectionOverlay();
}

function moveRoiSelection(event) {
  if (!focusRoiSelecting || !focusCropCanvas) return;
  const rect = focusCropCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const cw = focusCropCanvas.clientWidth;
  const ch = focusCropCanvas.clientHeight;

  if (!focusSelectionStart && !focusResizeHandle) return;

  if (focusResizeHandle && focusRoi) {
    const canvasRect = videoToCanvasCoordinates(focusRoi);
    let { x: nx, y: ny, width: nw, height: nh } = canvasRect;

    if (focusResizeHandle === 'move') {
      nx = x - focusDragOffset.x;
      ny = y - focusDragOffset.y;
    } else {
      if (focusResizeHandle.includes('e')) nw = x - nx;
      if (focusResizeHandle.includes('w')) {
        const right = nx + nw;
        nw = right - x;
        nx = x;
      }
      if (focusResizeHandle.includes('s')) nh = y - ny;
      if (focusResizeHandle.includes('n')) {
        const bottom = ny + nh;
        nh = bottom - y;
        ny = y;
      }
    }

    nx = Math.max(0, Math.min(nx, cw));
    ny = Math.max(0, Math.min(ny, ch));
    nw = Math.max(FOCUS_MIN_SELECTION, Math.min(nw, cw - nx));
    nh = Math.max(FOCUS_MIN_SELECTION, Math.min(nh, ch - ny));

    focusRoi = normalizeRoi(canvasToVideoCoordinates({ x: nx, y: ny, width: nw, height: nh }), preview.videoWidth, preview.videoHeight);
    drawSelectionOverlay();
    return;
  }

  focusSelectionEnd = {
    x: Math.max(0, Math.min(x, cw)),
    y: Math.max(0, Math.min(y, ch)),
  };
  drawSelectionOverlay();
}

function endRoiSelection() {
  if (!focusRoiSelecting) return;
  if (focusResizeHandle) {
    focusResizeHandle = null;
    return;
  }
  if (focusSelectionStart && focusSelectionEnd) {
    const rect = canvasSelectionRect();
    if (rect.width >= FOCUS_MIN_SELECTION && rect.height >= FOCUS_MIN_SELECTION) {
      focusRoi = normalizeRoi(canvasToVideoCoordinates(rect), preview.videoWidth, preview.videoHeight);
    }
    focusSelectionStart = null;
    focusSelectionEnd = null;
    drawSelectionOverlay();
  }
}

function confirmRoiSelection() {
  if (!focusRoi || !focusRoi.width || !focusRoi.height) {
    addLog('Selecciona un área válida antes de confirmar.', 'error');
    return;
  }
  focusRoiSelecting = false;
  focusModeEnabled = true;
  focusCropCanvas?.classList.add('is-hidden');
  focusCropCanvas?.removeEventListener('mousedown', startRoiSelection);
  window.removeEventListener('mousemove', moveRoiSelection);
  window.removeEventListener('mouseup', endRoiSelection);
  saveRoiProfile(focusRoi, focusSelectedDevice);
  localStorage.setItem(FOCUS_MODE_ENABLED_STORAGE_KEY, 'true');
  localStorage.setItem(FOCUS_MODE_ROI_STORAGE_KEY, JSON.stringify(focusRoi));
  startFocusModeLive();
  updateFocusModeUI(true);
  addLog('Área de enfoque guardada y activada.');
}

function cancelRoiSelection() {
  focusRoiSelecting = false;
  focusCropCanvas?.classList.add('is-hidden');
  focusCropCanvas?.removeEventListener('mousedown', startRoiSelection);
  window.removeEventListener('mousemove', moveRoiSelection);
  window.removeEventListener('mouseup', endRoiSelection);
  drawSelectionOverlay();
  if (!focusModeEnabled) stopFocusModeLive();
  updateFocusModeUI(focusModeEnabled);
}

function showRoiSelector() {
  if (!currentStream || !focusCropCanvas) {
    addLog('Primero inicia el video para seleccionar el área.', 'error');
    return;
  }
  focusRoiSelecting = true;
  focusCropCanvas.classList.remove('is-hidden');
  focusCropCanvas.width = focusCropCanvas.clientWidth;
  focusCropCanvas.height = focusCropCanvas.clientHeight;
  drawSelectionOverlay();
  focusCropCanvas.addEventListener('mousedown', startRoiSelection);
  window.addEventListener('mousemove', moveRoiSelection);
  window.addEventListener('mouseup', endRoiSelection);
  addLog('Dibuja el área de la cámara. Arrastra bordes/esquinas para ajustar.');
}

function startFocusModeLive() {
  if (!focusRoi || !currentStream) return;
  stopFocusModeLive();

  focusRawCanvas = document.createElement('canvas');
  focusRawCanvas.width = preview.videoWidth || preview.clientWidth;
  focusRawCanvas.height = preview.videoHeight || preview.clientHeight;
  focusRawCtx = focusRawCanvas.getContext('2d');

  const roi = normalizeRoi(focusRoi, focusRawCanvas.width, focusRawCanvas.height);

  focusLiveCanvas = document.createElement('canvas');
  focusLiveCanvas.width = roi.width;
  focusLiveCanvas.height = roi.height;
  focusLiveCtx = focusLiveCanvas.getContext('2d');

  preview.style.display = 'none';
  if (videoCropWrapper && !videoCropWrapper.querySelector('#focusLiveCanvas')) {
    focusLiveCanvas.id = 'focusLiveCanvas';
    focusLiveCanvas.style.width = '100%';
    focusLiveCanvas.style.height = '100%';
    focusLiveCanvas.style.objectFit = 'contain';
    videoCropWrapper.appendChild(focusLiveCanvas);
  }

  const drawLive = () => {
    if (!focusModeEnabled || !focusRoi || !currentStream) return;
    if (preview.readyState >= 2) {
      focusRawCtx.drawImage(preview, 0, 0, focusRawCanvas.width, focusRawCanvas.height);
      focusLiveCtx.drawImage(focusRawCanvas, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
    }
    focusRafId = requestAnimationFrame(drawLive);
  };
  focusRafId = requestAnimationFrame(drawLive);
}

function stopFocusModeLive() {
  if (focusRafId) {
    cancelAnimationFrame(focusRafId);
    focusRafId = null;
  }
  const existing = document.getElementById('focusLiveCanvas');
  if (existing) existing.remove();
  focusLiveCanvas = null;
  focusLiveCtx = null;
  focusRawCanvas = null;
  focusRawCtx = null;
  preview.style.display = '';
}

function applyFocusModeVisual() {
  if (focusModeEnabled && focusRoi) {
    startFocusModeLive();
  } else {
    stopFocusModeLive();
  }
}

function updateFocusModeUI(enabled) {
  const hasRoi = Boolean(focusRoi && focusRoi.width && focusRoi.height);
  focusModeToggleBtn.textContent = enabled ? 'Desactivar modo enfoque' : (hasRoi ? 'Activar modo enfoque' : 'Seleccionar área de enfoque');
  focusModeToggleBtn.classList.toggle('btn-primary', enabled || !hasRoi);
  focusModeToggleBtn.classList.toggle('btn-outline', !enabled && hasRoi);
  if (focusModeCalibrateBtn) focusModeCalibrateBtn.style.display = hasRoi ? '' : 'none';
  if (focusModeHelp) {
    focusModeHelp.textContent = hasRoi
      ? (enabled ? 'Modo enfoque activo: se recorta el área seleccionada.' : 'Modo enfoque guardado. Presiona Activar para volver a aplicarlo.')
      : 'Selecciona el área de la cámara para recortar el video y las fotos.';
  }
}

async function setFocusModeEnabled(enabled) {
  if (enabled && !focusRoi) {
    showRoiSelector();
    return;
  }
  focusModeEnabled = enabled;
  localStorage.setItem(FOCUS_MODE_ENABLED_STORAGE_KEY, String(enabled));
  updateFocusModeUI(enabled);
  applyFocusModeVisual();
  addLog(enabled ? 'Modo enfoque activado.' : 'Modo enfoque desactivado.');
}

async function recalibrateFocusRoi() {
  if (focusRafId) stopFocusModeLive();
  focusModeEnabled = false;
  focusRoi = null;
  localStorage.removeItem(FOCUS_MODE_ROI_STORAGE_KEY);
  showRoiSelector();
  updateFocusModeUI(false);
}

function handleFocusToggleClick() {
  if (focusRoiSelecting) {
    if (focusRoi && focusRoi.width && focusRoi.height) {
      confirmRoiSelection();
    } else {
      cancelRoiSelection();
    }
    return;
  }
  setFocusModeEnabled(!focusModeEnabled);
}

focusModeToggleBtn.addEventListener('click', handleFocusToggleClick);
focusModeCalibrateBtn?.addEventListener('click', recalibrateFocusRoi);

async function restoreFocusMode() {
  focusSelectedDevice = deviceNameForRoi();
  const savedRoiString = localStorage.getItem(FOCUS_MODE_ROI_STORAGE_KEY);
  if (savedRoiString) {
    try { focusRoi = JSON.parse(savedRoiString); } catch { focusRoi = null; }
  }
  if (!focusRoi) {
    const profile = await loadRoiProfile(focusSelectedDevice);
    if (profile) focusRoi = normalizeRoi(profile, preview.videoWidth, preview.videoHeight);
  }
  if (focusRoi) {
    localStorage.setItem(FOCUS_MODE_ROI_STORAGE_KEY, JSON.stringify(focusRoi));
  }
  updateFocusModeUI(focusModeEnabled);
  if (focusModeEnabled) applyFocusModeVisual();
}

restoreFocusMode();

// Vista del video: "Media pantalla" agranda el panel de video dentro de la
// misma ventana (oculta el lateral), y "Pantalla completa" usa la
// Fullscreen API nativa del navegador para ocupar todo el monitor. Son
// mutuamente excluyentes: activar una desactiva la otra.
function isVideoFullscreen() {
  return document.fullscreenElement === videoFrame;
}

function setHalfScreenMode(enabled) {
  if (enabled && isVideoFullscreen()) {
    document.exitFullscreen?.();
  }

  captureLayoutSection.classList.toggle('is-half-screen', enabled);
  halfScreenBtn.textContent = enabled ? 'Salir de media pantalla' : 'Media pantalla';
  halfScreenBtn.classList.toggle('btn-primary', enabled);
  halfScreenBtn.classList.toggle('btn-ghost', !enabled);
}

async function setVideoFullscreen(enabled) {
  try {
    if (enabled) {
      setHalfScreenMode(false);
      await videoFrame.requestFullscreen?.();
    } else if (isVideoFullscreen()) {
      await document.exitFullscreen?.();
    }
  } catch (error) {
    console.error(error);
    addLog(`No se pudo cambiar a pantalla completa: ${error.message}`, 'error');
  }
}

function updateFullscreenButtonState() {
  const active = isVideoFullscreen();
  fullScreenBtn.textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  fullScreenBtn.classList.toggle('btn-primary', active);
  fullScreenBtn.classList.toggle('btn-ghost', !active);
}

halfScreenBtn.addEventListener('click', () => {
  setHalfScreenMode(!captureLayoutSection.classList.contains('is-half-screen'));
});

fullScreenBtn.addEventListener('click', () => setVideoFullscreen(!isVideoFullscreen()));
exitFullScreenBtn.addEventListener('click', () => setVideoFullscreen(false));

document.addEventListener('fullscreenchange', updateFullscreenButtonState);

function makeFileName(prefix, extension) {
  const now = new Date();
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');

  return `${prefix}-${stamp}.${extension}`;
}

// Dibuja el frame que YA esta renderizado en el elemento <video> en el
// instante exacto del clic, sin esperas adicionales. Se probo usar
// ImageCapture.grabFrame() para leer directo de la pista, pero esa API es
// asincrona y en la practica espera a que llegue un frame "nuevo" desde el
// pipeline de captura, lo que añade latencia en vez de reducirla. drawImage
// sobre el <video> es sincrono: toma de inmediato lo que ya se esta viendo
// en pantalla, que es lo mas cercano posible al instante del pulso del boton.
async function captureFrameBlob(quality = 0.8, maxWidth = 1280) {
  if (!currentStream) {
    throw new Error('Primero inicia el video.');
  }

  const fullSourceWidth = preview.videoWidth;
  let sourceHeight = preview.videoHeight;

  if (!fullSourceWidth || !sourceHeight) {
    throw new Error('El video todavía no está listo.');
  }

  // Modo enfoque activo: dibuja solo la Region de Interes (ROI) definida
  // manualmente, escalada al ancho maximo solicitado. Sin modo enfoque se
  // usa el frame completo como antes.
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = fullSourceWidth;

  if (focusModeEnabled && focusRoi) {
    const roi = normalizeRoi(focusRoi, fullSourceWidth, sourceHeight);
    sourceX = roi.x;
    sourceY = roi.y;
    sourceWidth = roi.width;
    sourceHeight = roi.height;
  }

  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  snapshotCanvas.width = width;
  snapshotCanvas.height = height;

  const ctx = snapshotCanvas.getContext('2d');
  ctx.filter = preview.style.filter || 'none';
  ctx.drawImage(preview, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);

  const blob = await new Promise((resolve) => {
    snapshotCanvas.toBlob(resolve, 'image/jpeg', quality);
  });

  if (!blob) {
    throw new Error('No se pudo generar la imagen.');
  }

  return blob;
}

async function captureImage() {
  try {
    if (!currentStream) {
      throw new Error('Primero inicia el video.');
    }

    const blob = await captureFrameBlob(0.95, 1920);
    const filename = makeFileName('enclaii-captura', 'jpg');

    await uploadCaptureToLaravel(blob, filename, 'image');

    totalImages += 1;
    imageCount.textContent = totalImages;

    addLog('Imagen guardada.', 'success');
    showVideoToast(' Foto tomada', 'photo');
  } catch (error) {
    console.error(error);
    addLog(`Error capturando imagen: ${error.message}`, 'error');
    showVideoToast('No se pudo tomar la foto', 'error');
  }
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

// Con modo enfoque activo, el video no se grava directo del stream crudo de
// la camara (que incluiria el panel derecho), sino de un canvas intermedio
// donde se dibuja, frame por frame, solo la porcion recortada. Sin modo
// enfoque se sigue grabando el stream crudo como antes (sin este overhead).
//
// La condicion de parada del loop de dibujo es UNICAMENTE signal.aborted,
// nunca un evento externo (como 'onstop' del MediaRecorder, que no esta
// garantizado si el dispositivo se desconecta a medio grabar). Cualquier
// camino que necesite terminar la grabacion (stopRecording, un cambio de
// camara, el track que muere solo) aborta el mismo AbortController, asi que
// es imposible que este loop quede corriendo huerfano en segundo plano.
let activeRecordingController = null;

function createFocusModeRecordingStream(signal) {
  const fullSourceWidth = preview.videoWidth;
  const fullSourceHeight = preview.videoHeight;
  const roi = normalizeRoi(focusRoi, fullSourceWidth, fullSourceHeight) || {
    x: 0,
    y: 0,
    width: fullSourceWidth,
    height: fullSourceHeight,
  };

  const canvas = document.createElement('canvas');
  canvas.width = roi.width;
  canvas.height = roi.height;

  const ctx = canvas.getContext('2d');

  const drawFrame = () => {
    if (signal.aborted) return;
    ctx.drawImage(preview, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
    requestAnimationFrame(drawFrame);
  };

  requestAnimationFrame(drawFrame);

  const canvasStream = canvas.captureStream();

  signal.addEventListener('abort', () => {
    canvasStream.getTracks().forEach((track) => track.stop());
  });

  return canvasStream;
}

function startRecording() {
  let controller;

  try {
    if (!currentStream) {
      throw new Error('Primero inicia el video.');
    }

    recordedChunks = [];

    const mimeType = getSupportedMimeType();

    controller = new AbortController();
    const { signal } = controller;

    const recordingStream = focusModeEnabled
      ? createFocusModeRecordingStream(signal)
      : currentStream;

    mediaRecorder = new MediaRecorder(
      recordingStream,
      mimeType ? { mimeType } : undefined
    );

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    let resolveStopHandled;
    recordingStopHandled = new Promise((resolve) => { resolveStopHandled = resolve; });

    mediaRecorder.onstop = () => {
      // Respaldo: si esta es la unica senal de que la grabacion termino
      // (por ejemplo el dispositivo se desconecto), esto igual garantiza el
      // cierre del loop de canvas. abort() en un controller ya abortado no
      // hace nada, asi que es seguro llamarlo aunque stopRecording() ya lo
      // haya hecho.
      controller.abort();

      try {
        const blob = new Blob(recordedChunks, {
          type: mediaRecorder.mimeType || 'video/webm',
        });

        if (!blob.size) {
          throw new Error('La grabacion no genero datos de video.');
        }

        const filename = makeFileName('endoscopy-video', 'webm');

        // La miniatura y el contador se actualizan de inmediato con el
        // blob local, sin esperar la subida al servidor: "Finalizar
        // estudio" ya ve este video en capturedItems aunque la subida
        // siga en curso. La subida real corre en segundo plano abajo.
        totalVideos += 1;
        videoCount.textContent = totalVideos;
        const item = addCaptureThumbnail(URL.createObjectURL(blob), filename, 'video', '', 'uploading');

        addLog(`Video listo (${(blob.size / (1024 * 1024)).toFixed(1)}MB). Subiendo en segundo plano...`);

        const uploadPromise = uploadVideoInChunks(blob, filename)
          .then((finalizePayload) => {
            item.remoteUrl = finalizePayload.data?.url || '';
            item.status = 'done';
            if (item._badgeEl) item._badgeEl.remove();
            addLog('Video guardado.', 'success');
          })
          .catch((error) => {
            item.status = 'error';
            if (item._badgeEl) item._badgeEl.textContent = 'Error al subir';
            console.error(error);
            addLog(`Error guardando video: ${error.message}`, 'error');
          });

        pendingVideoUploads.push(uploadPromise);
      } catch (error) {
        console.error(error);
        addLog(`Error guardando video: ${error.message}`, 'error');
      } finally {
        resolveStopHandled();
      }
    };

    // Si el capturador se desconecta o el track muere sin avisarle al
    // MediaRecorder, este listener es la garantia de que la grabacion (y el
    // loop de canvas, via signal) se cierran igual, en vez de quedar
    // huerfanos en segundo plano.
    currentStream.getVideoTracks()[0]?.addEventListener(
      'ended',
      () => stopRecording(),
      { signal }
    );

    activeRecordingController = controller;

    mediaRecorder.start(1000);

    recordBtn.disabled = false;
    recordBtn.textContent = 'Detener grabación';
    recordBtn.classList.remove('btn-danger-soft');
    recordBtn.classList.add('btn-danger');
    captureBtn.disabled = false;

    recordingIndicator.classList.add('is-recording');
    if (recordingIndicatorText) recordingIndicatorText.textContent = 'Grabando';
    startRecordingTimer();

    addLog('Grabación iniciada.');
    showVideoToast('● Grabación iniciada', 'success');
  } catch (error) {
    controller?.abort();
    activeRecordingController = null;
    console.error(error);
    addLog(`No se pudo iniciar grabación: ${error.message}`, 'error');
  }
}

function formatRecordingDuration(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (value) => String(value).padStart(2, '0');

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function updateRecordingTimerDisplay() {
  if (!recordingTimer) return;
  recordingTimer.textContent = formatRecordingDuration(Date.now() - recordingStartedAt);
}

function startRecordingTimer() {
  recordingStartedAt = Date.now();

  if (recordingTimer) {
    recordingTimer.style.display = '';
    updateRecordingTimerDisplay();
  }

  clearInterval(recordingTimerIntervalId);
  recordingTimerIntervalId = setInterval(updateRecordingTimerDisplay, 1000);
}

function stopRecordingTimer() {
  clearInterval(recordingTimerIntervalId);
  recordingTimerIntervalId = null;
  recordingStartedAt = 0;

  if (recordingTimer) {
    recordingTimer.style.display = 'none';
    recordingTimer.textContent = '00:00';
  }
}

function stopRecording() {
  if (!mediaRecorder) {
    return;
  }

  // Se aborta primero: detiene el loop de canvas (si lo hay) de forma
  // inmediata y garantizada, sin depender de que el MediaRecorder llegue a
  // disparar 'onstop'.
  activeRecordingController?.abort();
  activeRecordingController = null;

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  recordBtn.disabled = false;
  recordBtn.textContent = 'Iniciar grabación';
  recordBtn.classList.remove('btn-danger');
  recordBtn.classList.add('btn-danger-soft');

  recordingIndicator.classList.remove('is-recording');
  if (recordingIndicatorText) recordingIndicatorText.textContent = 'Grabación detenida';
  stopRecordingTimer();

  addLog('Grabación detenida.');
  showVideoToast('■ Grabación detenida', 'error');
}

function canTriggerRemoteCapture() {
  const now = Date.now();
  if (now - lastRemoteCaptureAt < REMOTE_CAPTURE_COOLDOWN_MS) return false;
  lastRemoteCaptureAt = now;
  return true;
}

function handleRemoteKey(event) {
  if (event.code === 'F8' || event.code === 'Space') {
    event.preventDefault();
    if (canTriggerRemoteCapture()) captureImage();
  }

  if (event.code === 'F9') {
    event.preventDefault();
    startRecording();
  }

  if (event.code === 'F10') {
    event.preventDefault();
    stopRecording();
  }
}

// El boton fisico del capturador (remoto) no siempre despacha el clic sobre
// el elemento #captureBtn; a veces cae en cualquier parte de la pagina segun
// donde este el cursor. Por eso la deteccion de pulsacion mantenida vive a
// nivel de document/window y no solo en el boton en pantalla: asi funciona
// igual con el mouse, con el boton en pantalla y con el remoto.
function isRemoteCaptureTarget(target) {
  if (!isDevicePaired || !currentStream || captureLayout?.classList.contains('is-hidden')) return false;

  const interactive = target.closest?.('button, a, input, select, textarea, label');
  // Si el clic cae sobre otro control interactivo que no sea el propio boton
  // de captura, se deja que ese control maneje su propio comportamiento.
  if (interactive && interactive !== captureBtn) return false;

  return true;
}

// Instrumentacion temporal para medir cuanto tiempo real se mantiene
// presionado el boton del remoto (mousedown -> mouseup de UN solo pulso),
// que es distinto al log de "tiempo entre clics" de handleCaptureClick (ese
// mide el intervalo ENTRE dos clics, no la duracion de un solo pulso). Sirve
// para decidir, con datos reales, un umbral de "mantener presionado = grabar".
let remotePressStartAt = 0;

document.addEventListener('mousedown', (event) => {
  if (!isRemoteCaptureTarget(event.target)) return;
  remotePressStartAt = Date.now();
});

document.addEventListener('mouseup', (event) => {
  if (!isRemoteCaptureTarget(event.target) || !remotePressStartAt) return;

  const heldMs = Date.now() - remotePressStartAt;
  remotePressStartAt = 0;

  addLog(`Duración real de la pulsación: ${heldMs}ms.`);
});

pairForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const code = (pairCodeInput?.value || '').trim();
  if (code.length !== 6) {
    if (pairStatusMsg) pairStatusMsg.textContent = 'Ingresa los 6 digitos del codigo.';
    return;
  }

  if (pairStatusMsg) pairStatusMsg.textContent = 'Vinculando dispositivo...';

  try {
    await pairWithCode(code);
    if (pairStatusMsg) pairStatusMsg.textContent = '';
    addLog('Dispositivo vinculado. Ya puedes detectar la camara.', 'success');
    showCaptureLayout();
    detectDevices();
  } catch (error) {
    console.error(error);
    if (pairStatusMsg) pairStatusMsg.textContent = error.message || 'No se pudo vincular el dispositivo.';
  }
});

pairBackBtn?.addEventListener('click', goBackToApp);

async function finishStudy() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    stopRecording();
    // mediaRecorder.stop() es asincrono: espera a que onstop ya haya
    // agregado el video a capturedItems (no a que termine de subirse) para
    // que este chequeo no falle por una condicion de carrera.
    await recordingStopHandled;
  }

  if (capturedItems.length === 0) {
    addLog('Toma al menos una foto o video antes de finalizar el estudio.', 'error');
    return;
  }

  await finishActiveSession();

  if (finishStudySummary) {
    const patientLabel = activeStudyContext.patientName || 'este paciente';
    const uploadingCount = capturedItems.filter((item) => item.status === 'uploading').length;
    const uploadNote = uploadingCount > 0
      ? ` ${uploadingCount} video(s) aun se estan subiendo en segundo plano.`
      : '';
    finishStudySummary.textContent = capturedItems.length
      ? `Se guardaron ${totalImages} foto(s) y ${totalVideos} video(s) para ${patientLabel}.${uploadNote}`
      : `No se tomaron capturas para ${patientLabel} en esta sesion.`;
  }

  if (finishStudyThumbnails) {
    finishStudyThumbnails.innerHTML = '';
    capturedItems.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.display = 'block';
      button.style.width = '100%';
      button.style.padding = '0';
      button.style.border = '1px solid var(--border, #ccc)';
      button.style.borderRadius = '8px';
      button.style.background = 'none';
      button.style.cursor = 'pointer';
      button.addEventListener('click', () => openCaptureMediaModal(item.url, item.type));

      if (item.type === 'video') {
        const video = document.createElement('video');
        video.src = item.url;
        video.muted = true;
        video.preload = 'metadata';
        video.style.width = '100%';
        video.style.aspectRatio = '1 / 1';
        video.style.objectFit = 'cover';
        video.style.borderRadius = '8px';
        button.appendChild(video);

        const caption = document.createElement('span');
        caption.textContent = `Video: ${item.label}`;
        caption.style.display = 'block';
        caption.style.padding = '10px';
        button.appendChild(caption);
      } else {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.label;
        img.style.width = '100%';
        img.style.aspectRatio = '1 / 1';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
        button.appendChild(img);
      }

      finishStudyThumbnails.appendChild(button);
    });
  }

  finishStudyModal?.classList.remove('is-hidden');
}

finishStudyBtn?.addEventListener('click', finishStudy);

fullscreenFinishStudyBtn?.addEventListener('click', async () => {
  await setVideoFullscreen(false);
  finishStudy();
});

finishStudyGalleryBtn?.addEventListener('click', () => {
  finishStudyModal?.classList.add('is-hidden');
  if (activeStudyContext.patientId) {
    sessionStorage.setItem(OPEN_GALLERY_PATIENT_STORAGE_KEY, String(activeStudyContext.patientId));
  }
  window.location.href = './app.html#galeria';
});

finishStudyReportBtn?.addEventListener('click', () => {
  finishStudyModal?.classList.add('is-hidden');
  const params = new URLSearchParams();
  params.set('mode', 'normal');
  if (activeStudyContext.studyId) params.set('estudio_id', String(activeStudyContext.studyId));
  if (activeStudyContext.patientId) params.set('paciente_id', String(activeStudyContext.patientId));
  window.location.href = `./app.html#ia-reportes-redactar?${params.toString()}`;
});

// Flujo de captura (funciona igual con el mouse, el boton en pantalla y el
// remoto del capturador):
//   - Un clic    -> toma una foto al instante (sin retraso), sin importar si
//     ya se esta grabando un video (permite fotos durante la grabacion).
//   - Doble clic -> si no se esta grabando, inicia la grabacion; si ya se
//     esta grabando, la detiene. Es decir, el doble clic es el unico gesto
//     que arranca/detiene el video; un solo clic nunca detiene la grabacion.
//
// El evento nativo "dblclick" del navegador NO sirve aqui: solo se dispara
// cuando ambos clics vienen de un mismo puntero de mouse real (cuenta
// event.detail). Los clics del remoto llegan como "click" sueltos (via
// teclado emulado o click() sintetico) y nunca incrementan ese contador, asi
// que "dblclick" jamas se disparaba. Por eso el doble clic se detecta a mano
// comparando el timestamp entre dos "click" consecutivos.
//
// El switch fisico del remoto tambien genera rebote de contacto: un solo
// pulso fisico puede disparar dos eventos "click" casi simultaneos (unos
// pocos ms de diferencia). Sin filtrarlo, ese segundo clic "fantasma" caia
// justo dentro de la ventana de doble clic y arrancaba una grabacion no
// pedida; el siguiente clic real la detenia de inmediato en vez de tomar una
// foto, dando la sensacion de que el remoto "se traba" y deja de responder.
// Por eso, antes de cualquier otra logica, se ignoran por completo (sin
// registrar su timestamp) los clics que llegan a menos de
// CLICK_BOUNCE_IGNORE_MS del clic anterior aceptado.
//
// El switch fisico soldado al remoto no tiene un timing 100% estable: el
// intervalo real entre los dos clics de un "doble clic" deliberado se ha
// observado que se va corriendo con el uso (desgaste/oxidacion del contacto),
// por lo que una ventana fija se queda corta con el tiempo. Para no tener que
// re-ajustar esto a mano cada vez, la ventana se auto-calibra usando la
// mediana de los ultimos intervalos observados (con rechazo de valores
// atipicos): ver double-click-calibrator.js para el detalle del algoritmo.
//   - Si un "doble clic" (o un clic "casi doble clic", justo fuera de la
//     ventana pero dentro de un margen razonable) cae dentro de rango, su
//     intervalo se registra en el calibrador para ajustar la ventana.
//   - Un clic "casi doble clic" se sigue interpretando como una foto normal
//     (no se adivina la intencion retroactivamente), pero ayuda a ensanchar
//     la ventana para que el siguiente intento si sea reconocido.
// El valor aprendido (y el historial usado para la mediana) se persiste en
// localStorage para no perderlo al reiniciar la app.
const DOUBLE_CLICK_WINDOW_DEFAULT_MS = 2000;
const DOUBLE_CLICK_WINDOW_MIN_MS = 1200;
const DOUBLE_CLICK_WINDOW_MAX_MS = 6000;
const DOUBLE_CLICK_NEAR_MISS_MARGIN_MS = 1500;
// Rebote de contacto del switch: muy por debajo de DOUBLE_CLICK_WINDOW_MIN_MS,
// asi que nunca se confunde con un doble clic deliberado.
const CLICK_BOUNCE_IGNORE_MS = 250;

const doubleClickCalibrator = createDoubleClickCalibrator({
  min: DOUBLE_CLICK_WINDOW_MIN_MS,
  max: DOUBLE_CLICK_WINDOW_MAX_MS,
  defaultWindowMs: DOUBLE_CLICK_WINDOW_DEFAULT_MS,
  storage: localStorage,
  storageKey: DOUBLE_CLICK_WINDOW_STORAGE_KEY,
});

// Habilitado por defecto (comportamiento historico) salvo que el usuario lo
// haya desactivado explicitamente desde el panel de Configuracion.
let doubleClickEnabled = localStorage.getItem(DOUBLE_CLICK_ENABLED_STORAGE_KEY) !== 'false';

if (doubleClickToggle) {
  doubleClickToggle.checked = doubleClickEnabled;

  doubleClickToggle.addEventListener('change', () => {
    doubleClickEnabled = doubleClickToggle.checked;
    localStorage.setItem(DOUBLE_CLICK_ENABLED_STORAGE_KEY, String(doubleClickEnabled));
    addLog(
      doubleClickEnabled
        ? 'Doble clic para iniciar/detener video activado.'
        : 'Doble clic para iniciar/detener video desactivado.'
    );
  });
}

let lastCaptureClickAt = 0;

function handleCaptureClick(event) {
  if (!isRemoteCaptureTarget(event.target)) return;

  const now = Date.now();
  const elapsedSinceLastClick = lastCaptureClickAt ? now - lastCaptureClickAt : null;

  // Rebote de contacto: se ignora por completo, sin tocar lastCaptureClickAt,
  // para que no cuente como un nuevo clic ni distorsione el intervalo usado
  // en la deteccion de doble clic.
  if (elapsedSinceLastClick !== null && elapsedSinceLastClick < CLICK_BOUNCE_IGNORE_MS) {
    addLog(`Clic ignorado por rebote de contacto (+${elapsedSinceLastClick}ms).`);
    return;
  }

  // Log de diagnostico: cuantos ms pasaron desde el clic anterior, para
  // poder seguir observando el comportamiento real del remoto/mouse fisico.
  addLog(
    elapsedSinceLastClick !== null
      ? `Clic recibido (+${elapsedSinceLastClick}ms desde el anterior).`
      : 'Clic recibido (primero de la sesión).'
  );

  const isRecording = mediaRecorder && mediaRecorder.state !== 'inactive';

  const isDoubleClick =
    doubleClickEnabled &&
    elapsedSinceLastClick !== null &&
    doubleClickCalibrator.isDoubleClick(elapsedSinceLastClick);

  if (isDoubleClick) {
    lastCaptureClickAt = 0;
    const previousWindow = doubleClickCalibrator.getWindow();
    const { windowMs, rejectedAsOutlier } = doubleClickCalibrator.recordInterval(elapsedSinceLastClick);
    const windowLog = rejectedAsOutlier
      ? `ventana sin cambios en ${windowMs}ms (intervalo descartado como valor atípico)`
      : `ventana ${previousWindow}ms → ${windowMs}ms`;

    if (isRecording) {
      addLog(`Doble clic detectado (${elapsedSinceLastClick}ms, ${windowLog}): deteniendo grabación...`);
      stopRecording();
    } else {
      addLog(`Doble clic detectado (${elapsedSinceLastClick}ms, ${windowLog}): iniciando grabación...`);
      startRecording();
    }
    return;
  }

  const isNearMissDoubleClick =
    doubleClickEnabled &&
    elapsedSinceLastClick !== null &&
    doubleClickCalibrator.isNearMiss(elapsedSinceLastClick, DOUBLE_CLICK_NEAR_MISS_MARGIN_MS);

  if (isNearMissDoubleClick) {
    const previousWindow = doubleClickCalibrator.getWindow();
    const { windowMs, rejectedAsOutlier } = doubleClickCalibrator.recordInterval(elapsedSinceLastClick);

    if (rejectedAsOutlier) {
      addLog(
        `Clic un poco lento para doble clic (${elapsedSinceLastClick}ms): descartado como valor atípico, ventana sin cambios (${windowMs}ms).`
      );
    } else {
      addLog(
        `Clic un poco lento para doble clic (${elapsedSinceLastClick}ms): ventana ampliada de ${previousWindow}ms a ${windowMs}ms para el próximo intento.`
      );
    }
  }

  lastCaptureClickAt = now;

  const elapsedSinceLastCapture = lastRemoteCaptureAt ? now - lastRemoteCaptureAt : null;

  if (canTriggerRemoteCapture()) {
    captureImage();
  } else {
    // Aviso para que quede claro que el clic no se ignoro en silencio:
    // llego demasiado rapido despues de la captura anterior (rebote).
    addLog(
      `Clic ignorado: ${elapsedSinceLastCapture}ms desde la última captura (cooldown ${REMOTE_CAPTURE_COOLDOWN_MS}ms).`,
      'error'
    );
  }
}

document.addEventListener('click', handleCaptureClick);

detectDevicesBtn.addEventListener('click', detectDevices);
startBtn.addEventListener('click', startVideo);
recordBtn.addEventListener('click', () => {
  const isRecording = mediaRecorder && mediaRecorder.state !== 'inactive';
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});
backToAppBtn?.addEventListener('click', goBackToApp);

brightnessInput.addEventListener('input', applyFilters);
contrastInput.addEventListener('input', applyFilters);
saturationInput.addEventListener('input', applyFilters);
resetFiltersBtn.addEventListener('click', resetFilters);

document.addEventListener('keydown', handleRemoteKey);

let deviceChangeTimer = null;
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  // Al conectar el capturador, Windows puede emitir varios eventos
  // "devicechange" mientras el dispositivo termina de enumerarse.
  // Se agrupan en uno solo para no relanzar detectDevices() en cadena
  // y evitar que la UI (y el mouse) se sienta trabada mientras negocia.
  if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
  deviceChangeTimer = setTimeout(() => {
    deviceChangeTimer = null;
    detectDevices();
  }, 600);
});

window.addEventListener('beforeunload', () => {
  finishActiveSession();
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});

async function bootstrap() {
  renderConnection();
  setStatus('Listo', 'idle');
  addLog('Atajos activos: F8 o Espacio = foto, F9 = grabar, F10 = detener. El boton fisico del endoscopio (mouse) tambien toma foto.');

  // Si llegamos desde "Vincular con código" en Pacientes, se fuerza mostrar
  // la tarjeta de vinculacion aunque haya un patient_id residual guardado en
  // sessionStorage de una sesion directa anterior.
  const forcePairCard = new URLSearchParams(window.location.search).get('pair') === '1';

  // Un patient_id explicito en la URL (clic fresco en "Iniciar estudio")
  // siempre tiene prioridad sobre cualquier vinculacion de dispositivo
  // residual de una sesion anterior con otro paciente.
  const explicitPatientId = new URLSearchParams(window.location.search).get('patient_id');

  // Si llegamos desde "Iniciar estudio" en Pacientes (patient_id en la URL),
  // se salta la pantalla de vinculacion por codigo y se va directo a
  // captura, usando la sesion del usuario ya logueado en Tauri.
  const context = captureContext();

  if (explicitPatientId && !forcePairCard) {
    // Se limpia cualquier vinculacion de dispositivo anterior para no
    // mezclar capturas de un paciente distinto bajo el mismo token/sesion.
    sessionStorage.removeItem(DEVICE_TOKEN_KEY);
    sessionStorage.removeItem(DEVICE_SESSION_KEY);
  } else {
    // Si el dispositivo ya se vinculo con el codigo desde el modal flotante
    // en Pacientes (app.html), el token y la sesion ya estan en
    // sessionStorage. Se reconoce esa vinculacion y se salta directo a
    // captura sin volver a pedir el codigo ni llamar de nuevo al backend.
    const deviceToken = sessionStorage.getItem(DEVICE_TOKEN_KEY);
    const deviceSessionId = sessionStorage.getItem(DEVICE_SESSION_KEY);

    if (deviceToken && deviceSessionId) {
      captureAuthMode = 'device';
      isDevicePaired = true;
      showCaptureLayout();
      addLog('Dispositivo vinculado. Ya puedes detectar la camara.', 'success');
      detectDevices();
      return;
    }
  }

  if (context.patientId && !forcePairCard) {
    // Se oculta la tarjeta de vinculacion de inmediato (antes del await) para
    // que no se llegue a mostrar ni un instante mientras se inicia la sesion.
    showCaptureLayout();

    try {
      await startDirectSession();
      addLog(`Sesion iniciada. Las capturas se guardaran en el registro de ${context.patientName || `ID ${context.patientId}`}.`, 'success');
    } catch (error) {
      addLog(`No se pudo iniciar la sesion directa: ${error.message}`, 'error');
    }

    detectDevices();
    return;
  }

  addLog('Ingresa el codigo para vincular este equipo, o detecta la camara sin vincular.');
}

bootstrap();
