import { apiBaseUrl, laravelFetch } from './js/laravel.js';

const PAIR_ENDPOINT = `${apiBaseUrl()}/api/tauri/pair/redeem`;
const START_SESSION_ENDPOINT = `${apiBaseUrl()}/api/tauri/estudios/iniciar`;
const IMAGES_ENDPOINT = `${apiBaseUrl()}/api/tauri/images`;
const VIDEOS_ENDPOINT = `${apiBaseUrl()}/api/tauri/videos`;
const FINISH_SESSION_ENDPOINT = `${apiBaseUrl()}/api/tauri/finish-session`;
const DEVICE_TOKEN_KEY = 'enclaii-device-token';
const DEVICE_SESSION_KEY = 'enclaii-device-session-id';
const DEVICE_UID_KEY = 'enclaii-device-uid';
const USER_TOKEN_KEY = 'enclaii-tauri-basic-auth';

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
const focusCropField = document.getElementById('focusCropField');
const focusCropInput = document.getElementById('focusCropInput');
const focusCropValue = document.getElementById('focusCropValue');
const emptyState = document.getElementById('emptyState');
const deviceSelect = document.getElementById('deviceSelect');
const detectDevicesBtn = document.getElementById('detectDevicesBtn');
const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const snapshotCanvas = document.getElementById('snapshotCanvas');
const logBox = document.getElementById('logBox');
const connectionStatus = document.getElementById('connectionStatus');
const recordingIndicator = document.getElementById('recordingIndicator');
const deviceLabel = document.getElementById('deviceLabel');
const backToAppBtn = document.getElementById('backToAppBtn');

const pairCard = document.getElementById('pairCard');
const captureLayout = document.getElementById('captureLayout');
const pairForm = document.getElementById('pairForm');
const pairCodeInput = document.getElementById('pairCodeInput');
const pairSkipBtn = document.getElementById('pairSkipBtn');
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
const finishStudyBtn = document.getElementById('finishStudyBtn');
const finishStudyModal = document.getElementById('finishStudyModal');
const finishStudyThumbnails = document.getElementById('finishStudyThumbnails');
const finishStudySummary = document.getElementById('finishStudySummary');
const finishStudyGalleryBtn = document.getElementById('finishStudyGalleryBtn');

let currentStream = null;
let mediaRecorder = null;
let recordedChunks = [];

let totalImages = 0;
let totalVideos = 0;
let activeStudyContext = {};
let isDevicePaired = false;
let captureAuthMode = null; // 'device' (codigo de 6 digitos) o 'user' (sesion directa)
let capturedItems = [];

const DEFAULT_CAMERA_VALUE = '__default_camera__';

function goBackToApp() {
  finishActiveSession();

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  window.location.href = './app.html#dashboard';
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

  if (pairStatusText) pairStatusText.textContent = isDevicePaired ? 'Vinculado a Laravel' : 'Sin vincular';
  if (tenantText) tenantText.textContent = apiBaseUrl();
  if (patientText) patientText.textContent = context.patientName || (context.patientId ? `ID ${context.patientId}` : 'Sin paciente');
  if (studyText) studyText.textContent = context.studyLabel || (context.studyId ? `ID ${context.studyId}` : 'Sin estudio');
  if (sessionText) sessionText.textContent = context.sessionId || 'Sin sesion';

  captureBtn.disabled = !currentStream;
  recordBtn.disabled = !currentStream;
  stopRecordBtn.disabled = !mediaRecorder || mediaRecorder.state === 'inactive';
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

function userAuthHeader() {
  const token = sessionStorage.getItem(USER_TOKEN_KEY);
  return token ? `Bearer ${token}` : '';
}

function activeCaptureAuthHeader() {
  return captureAuthMode === 'device' ? deviceAuthHeader() : userAuthHeader();
}

function persistPairing(data) {
  sessionStorage.setItem(DEVICE_TOKEN_KEY, data.token);
  sessionStorage.setItem(DEVICE_SESSION_KEY, String(data.session_id));

  if (data.paciente_id) sessionStorage.setItem('enclaii-patient_id', String(data.paciente_id));
  if (data.paciente_nombre) sessionStorage.setItem('enclaii-patient_name', data.paciente_nombre);
  if (data.estudio_id || data.study_id) sessionStorage.setItem('enclaii-study_id', String(data.estudio_id || data.study_id));
  if (data.estudio_tipo) sessionStorage.setItem('enclaii-study_label', data.estudio_tipo);

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
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status} al vincular el dispositivo.`);
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
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status} al iniciar la sesion de captura.`);
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

function addCaptureThumbnail(url, label, type) {
  capturedItems.push({ url, label, type });

  if (!captureThumbnails || !url) return;

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = label;
  link.style.display = 'block';

  if (type === 'video') {
    link.textContent = `Video: ${label}`;
    link.style.padding = '8px';
    link.style.fontSize = '12px';
    link.style.border = '1px solid var(--border, #ccc)';
    link.style.borderRadius = '8px';
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = label;
    img.style.width = '100%';
    img.style.borderRadius = '8px';
    img.style.aspectRatio = '1 / 1';
    img.style.objectFit = 'cover';
    link.appendChild(img);
  }

  captureThumbnails.prepend(link);
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

async function uploadCaptureToLaravel(blob, filename, captureType) {
  const authorization = activeCaptureAuthHeader();
  const sessionId = sessionStorage.getItem(DEVICE_SESSION_KEY);

  if (!authorization || !sessionId) {
    throw new Error('Vincula el dispositivo con el codigo de Laravel (o selecciona un paciente desde Pacientes) para guardar las capturas en la base de datos.');
  }

  const endpoint = captureType === 'video' ? VIDEOS_ENDPOINT : IMAGES_ENDPOINT;
  const fileField = captureType === 'video' ? 'filename' : 'filename';
  const timestampField = captureType === 'video' ? 'ended_at' : 'captured_at';

  const response = await laravelFetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      session_id: Number(sessionId),
      [fileField]: filename,
      mime_type: blob.type || 'application/octet-stream',
      data_base64: await blobToBase64(blob),
      [timestampField]: new Date().toISOString(),
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (response.status === 401 || response.status === 419) {
    throw new Error('El dispositivo no esta vinculado o el token expiro. Vuelve a ingresar el codigo.');
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status} al guardar la captura.`);
  }

  if (payload.data?.url) {
    addCaptureThumbnail(payload.data.url, filename, captureType);
  }

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

async function startVideo() {
  try {
    const selectedDeviceId = deviceSelect.value;

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    currentStream = await openVideoStream(selectedDeviceId);

    preview.srcObject = currentStream;

    const selectedText =
      deviceSelect.options[deviceSelect.selectedIndex]?.textContent ||
      'Capturador activo';

    deviceLabel.textContent = selectedText;
    emptyState.classList.add('is-hidden');

    renderConnection();
    setStatus('Video activo', 'warning');

    addLog('Video iniciado correctamente.', 'success');
  } catch (error) {
    console.error(error);
    setStatus('Error de video', 'error');
    addLog(`No se pudo iniciar el video: ${cameraErrorMessage(error)}`, 'error');
  }
}

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

// Modo enfoque: recorta el panel de informacion de la derecha que muestra el
// procesador del endoscopio (ajustes, miniaturas, datos del scope), dejando
// solo la imagen circular del endoscopio. El recorte se aplica en vivo con
// un transform CSS (barato, sin afectar el rendimiento del video), y ademas
// se usa el mismo porcentaje al tomar fotos (recortando el canvas de origen)
// y al grabar video (ver startRecording, que en este modo dibuja en un
// canvas intermedio en vez de grabar el stream crudo).
const FOCUS_MODE_STORAGE_KEY = 'enclaii-focus-mode-enabled';
const FOCUS_CROP_STORAGE_KEY = 'enclaii-focus-mode-crop-percent';

let focusModeEnabled = localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === 'true';
let focusCropPercent = Number(localStorage.getItem(FOCUS_CROP_STORAGE_KEY)) || 28;

function focusCropRatio() {
  return Math.min(Math.max(focusCropPercent, 0), 50) / 100;
}

function applyFocusModeVisual() {
  if (focusModeEnabled && focusCropRatio() > 0) {
    const scale = 1 / (1 - focusCropRatio());
    preview.style.transform = `scale(${scale})`;
  } else {
    preview.style.transform = 'none';
  }
}

function updateFocusModeUI(enabled) {
  focusModeToggleBtn.textContent = enabled ? 'Desactivar modo enfoque' : 'Activar modo enfoque';
  focusModeToggleBtn.classList.toggle('btn-primary', enabled);
  focusModeToggleBtn.classList.toggle('btn-outline', !enabled);
  focusCropField.style.display = enabled ? '' : 'none';

  applyFocusModeVisual();
}

function setFocusModeEnabled(enabled) {
  focusModeEnabled = enabled;
  localStorage.setItem(FOCUS_MODE_STORAGE_KEY, String(enabled));
  updateFocusModeUI(enabled);
  addLog(enabled ? 'Modo enfoque activado: se ocultará el panel derecho.' : 'Modo enfoque desactivado.');
}

function setFocusCropPercent(percent) {
  focusCropPercent = Math.min(Math.max(Number(percent) || 0, 0), 50);
  localStorage.setItem(FOCUS_CROP_STORAGE_KEY, String(focusCropPercent));
  focusCropValue.textContent = String(focusCropPercent);
  applyFocusModeVisual();
}

focusModeToggleBtn.addEventListener('click', () => setFocusModeEnabled(!focusModeEnabled));
focusCropInput.addEventListener('input', (event) => setFocusCropPercent(event.target.value));

focusCropInput.value = String(focusCropPercent);
focusCropValue.textContent = String(focusCropPercent);
updateFocusModeUI(focusModeEnabled);

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
  const sourceHeight = preview.videoHeight;

  if (!fullSourceWidth || !sourceHeight) {
    throw new Error('El video todavía no está listo.');
  }

  // Modo enfoque activo: solo se dibuja la porcion izquierda del frame de
  // origen (se descarta el panel de informacion de la derecha del
  // procesador), igual que el recorte visual en vivo.
  const sourceWidth = focusModeEnabled
    ? Math.round(fullSourceWidth * (1 - focusCropRatio()))
    : fullSourceWidth;

  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  snapshotCanvas.width = width;
  snapshotCanvas.height = height;

  const ctx = snapshotCanvas.getContext('2d');
  ctx.filter = preview.style.filter || 'none';
  ctx.drawImage(preview, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);

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
    const filename = makeFileName('endoscopy-capture', 'jpg');

    await uploadCaptureToLaravel(blob, filename, 'image');

    totalImages += 1;
    imageCount.textContent = totalImages;

    addLog('Imagen guardada en Laravel.', 'success');
  } catch (error) {
    console.error(error);
    addLog(`Error capturando imagen: ${error.message}`, 'error');
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
let recordingCanvas = null;
let recordingCanvasStream = null;
let recordingDrawLoopId = null;

function startRecordingDrawLoop() {
  const fullSourceWidth = preview.videoWidth;
  const sourceHeight = preview.videoHeight;
  const sourceWidth = Math.round(fullSourceWidth * (1 - focusCropRatio()));

  recordingCanvas = document.createElement('canvas');
  recordingCanvas.width = sourceWidth;
  recordingCanvas.height = sourceHeight;

  const ctx = recordingCanvas.getContext('2d');

  const drawFrame = () => {
    if (!recordingCanvas) return;
    ctx.drawImage(preview, 0, 0, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    recordingDrawLoopId = requestAnimationFrame(drawFrame);
  };

  drawFrame();

  recordingCanvasStream = recordingCanvas.captureStream();
  return recordingCanvasStream;
}

function stopRecordingDrawLoop() {
  if (recordingDrawLoopId) {
    cancelAnimationFrame(recordingDrawLoopId);
    recordingDrawLoopId = null;
  }

  recordingCanvasStream?.getTracks().forEach((track) => track.stop());
  recordingCanvasStream = null;
  recordingCanvas = null;
}

function startRecording() {
  try {
    if (!currentStream) {
      throw new Error('Primero inicia el video.');
    }

    recordedChunks = [];

    const mimeType = getSupportedMimeType();

    const recordingStream = focusModeEnabled
      ? startRecordingDrawLoop()
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

    mediaRecorder.onstop = () => {
      stopRecordingDrawLoop();

      try {
        const blob = new Blob(recordedChunks, {
          type: mediaRecorder.mimeType || 'video/webm',
        });

        const filename = makeFileName('endoscopy-video', 'webm');

        uploadCaptureToLaravel(blob, filename, 'video')
          .then(() => {
            totalVideos += 1;
            videoCount.textContent = totalVideos;
            addLog('Video guardado en Laravel.', 'success');
          })
          .catch((error) => {
            console.error(error);
            addLog(`Error guardando video: ${error.message}`, 'error');
          });
      } catch (error) {
        console.error(error);
        addLog(`Error guardando video: ${error.message}`, 'error');
      }
    };

    mediaRecorder.start(1000);

    recordBtn.disabled = true;
    stopRecordBtn.disabled = false;
    captureBtn.disabled = false;

    recordingIndicator.classList.add('is-recording');
    recordingIndicator.innerHTML = '<span></span> Grabando';

    addLog('Grabación iniciada.');
  } catch (error) {
    stopRecordingDrawLoop();
    console.error(error);
    addLog(`No se pudo iniciar grabación: ${error.message}`, 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder) {
    return;
  }

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  recordBtn.disabled = false;
  stopRecordBtn.disabled = true;

  recordingIndicator.classList.remove('is-recording');
  recordingIndicator.innerHTML = '<span></span> Grabación detenida';

  addLog('Grabación detenida.');
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

pairSkipBtn?.addEventListener('click', async () => {
  sessionStorage.removeItem(DEVICE_SESSION_KEY);
  sessionStorage.removeItem(DEVICE_TOKEN_KEY);
  captureAuthMode = null;
  isDevicePaired = false;

  const context = captureContext();

  if (context.patientId) {
    try {
      await startDirectSession();
      addLog(`Continuando sin codigo. Las capturas se guardaran en el registro de ${context.patientName || `ID ${context.patientId}`}.`, 'success');
    } catch (error) {
      addLog(`No se pudo iniciar la sesion directa: ${error.message}`, 'error');
    }
  } else {
    addLog('Continuando sin vincular. Selecciona un paciente desde Pacientes para guardar las capturas.', 'error');
  }

  showCaptureLayout();
  detectDevices();
});

async function finishStudy() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    stopRecording();
  }

  if (capturedItems.length === 0) {
    addLog('Toma al menos una foto o video antes de finalizar el estudio.', 'error');
    return;
  }

  await finishActiveSession();

  if (finishStudySummary) {
    const patientLabel = activeStudyContext.patientName || 'este paciente';
    finishStudySummary.textContent = capturedItems.length
      ? `Se guardaron ${totalImages} foto(s) y ${totalVideos} video(s) para ${patientLabel}.`
      : `No se tomaron capturas para ${patientLabel} en esta sesion.`;
  }

  if (finishStudyThumbnails) {
    finishStudyThumbnails.innerHTML = '';
    capturedItems.forEach((item) => {
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener';

      if (item.type === 'video') {
        link.textContent = `Video: ${item.label}`;
        link.style.display = 'block';
        link.style.padding = '10px';
        link.style.border = '1px solid var(--border, #ccc)';
        link.style.borderRadius = '8px';
      } else {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.label;
        img.style.width = '100%';
        img.style.aspectRatio = '1 / 1';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
        link.appendChild(img);
      }

      finishStudyThumbnails.appendChild(link);
    });
  }

  finishStudyModal?.classList.remove('is-hidden');
}

finishStudyBtn?.addEventListener('click', finishStudy);

finishStudyGalleryBtn?.addEventListener('click', () => {
  finishStudyModal?.classList.add('is-hidden');
  if (activeStudyContext.patientId) {
    sessionStorage.setItem('enclaii-open-gallery-patient', String(activeStudyContext.patientId));
  }
  window.location.href = './app.html#galeria';
});

// Flujo de captura (funciona igual con el mouse, el boton en pantalla y el
// remoto del capturador):
//   - Un clic    -> toma una foto al instante (sin retraso).
//   - Doble clic -> inicia la grabacion (mismo procedimiento que el boton
//     "Iniciar grabación": llama directamente a startRecording()).
//   - Un clic mientras se esta grabando -> detiene la grabacion al instante.
//
// El evento nativo "dblclick" del navegador NO sirve aqui: solo se dispara
// cuando ambos clics vienen de un mismo puntero de mouse real (cuenta
// event.detail). Los clics del remoto llegan como "click" sueltos (via
// teclado emulado o click() sintetico) y nunca incrementan ese contador, asi
// que "dblclick" jamas se disparaba. Por eso el doble clic se detecta a mano
// comparando el timestamp entre dos "click" consecutivos.
const DOUBLE_CLICK_WINDOW_MS = 2000;
let lastCaptureClickAt = 0;

function handleCaptureClick(event) {
  if (!isRemoteCaptureTarget(event.target)) return;

  const now = Date.now();
  const elapsedSinceLastClick = lastCaptureClickAt ? now - lastCaptureClickAt : null;

  const isRecording = mediaRecorder && mediaRecorder.state !== 'inactive';

  if (isRecording) {
    lastCaptureClickAt = 0;
    addLog('Clic detectado: deteniendo grabación...');
    stopRecording();
    return;
  }

  const isDoubleClick = elapsedSinceLastClick !== null && elapsedSinceLastClick <= DOUBLE_CLICK_WINDOW_MS;
  lastCaptureClickAt = isDoubleClick ? 0 : now;

  if (isDoubleClick) {
    addLog('Doble clic detectado: iniciando grabación...');
    startRecording();
    return;
  }

  if (canTriggerRemoteCapture()) {
    captureImage();
  } else {
    // Aviso para que quede claro que el clic no se ignoro en silencio:
    // llego demasiado rapido despues de la captura anterior (rebote).
    addLog('Clic ignorado: muy pronto despues de la captura anterior.', 'error');
  }
}

document.addEventListener('click', handleCaptureClick);

detectDevicesBtn.addEventListener('click', detectDevices);
startBtn.addEventListener('click', startVideo);
recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
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

function bootstrap() {
  renderConnection();
  setStatus('Listo', 'idle');
  addLog('Atajos activos: F8 o Espacio = foto, F9 = grabar, F10 = detener. El boton fisico del endoscopio (mouse) tambien toma foto.');
  addLog('Ingresa el codigo de Laravel para vincular este equipo, o detecta la camara sin vincular.');
}

bootstrap();
