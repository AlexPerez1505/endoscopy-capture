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
const videoToast = document.getElementById('videoToast');
const configPanel = document.getElementById('configPanel');
const configPanelToggle = document.getElementById('configPanelToggle');
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

function addCaptureThumbnail(url, label, type) {
  capturedItems.push({ url, label, type });

  if (!captureThumbnails || !url) return;

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
  button.addEventListener('click', () => openCaptureMediaModal(url, type));

  if (type === 'video') {
    button.textContent = `Video: ${label}`;
    button.style.padding = '8px';
    button.style.fontSize = '12px';
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
const CONFIG_PANEL_STORAGE_KEY = 'enclaii-config-panel-collapsed';

function setConfigPanelCollapsed(collapsed) {
  configPanel.classList.toggle('is-collapsed', collapsed);
  localStorage.setItem(CONFIG_PANEL_STORAGE_KEY, String(collapsed));
}

configPanelToggle.addEventListener('click', () => {
  setConfigPanelCollapsed(!configPanel.classList.contains('is-collapsed'));
});

setConfigPanelCollapsed(localStorage.getItem(CONFIG_PANEL_STORAGE_KEY) === 'true');

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
    // Solo se escala horizontalmente (scaleX): el transform-origin del
    // <video> esta anclado a la izquierda (ver .video-preview en
    // styles.css), asi que agrandar el ancho empuja el excedente hacia la
    // derecha, donde el wrapper con overflow:hidden lo recorta. Un
    // scale() uniforme tambien agranda el alto y termina recortando
    // arriba/abajo, que es justo lo que no queremos.
    const scale = 1 / (1 - focusCropRatio());
    preview.style.transform = `scaleX(${scale})`;
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
    showVideoToast('● Grabación iniciada', 'success');
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
        button.textContent = `Video: ${item.label}`;
        button.style.padding = '10px';
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

// El modal de "Estudio finalizado" vive fuera de videoFrame, asi que en
// pantalla completa nativa no se veria (el navegador solo muestra el
// elemento en fullscreen y sus hijos). Por eso primero se sale de
// fullscreen y despues se dispara finishStudy().
fullscreenFinishStudyBtn?.addEventListener('click', async () => {
  await setVideoFullscreen(false);
  finishStudy();
});

finishStudyGalleryBtn?.addEventListener('click', () => {
  finishStudyModal?.classList.add('is-hidden');
  if (activeStudyContext.patientId) {
    sessionStorage.setItem('enclaii-open-gallery-patient', String(activeStudyContext.patientId));
  }
  window.location.href = './app.html#galeria';
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
// re-ajustar esto a mano cada vez, la ventana se auto-calibra:
//   - Si un "doble clic" cae dentro de la ventana actual, esta se ajusta para
//     ceñirse al intervalo real observado (+ colchon), tanto para achicarse
//     si el switch responde mas rapido como para agrandarse si responde mas
//     lento.
//   - Si un clic llega un poco tarde (justo fuera de la ventana pero dentro
//     de un margen de "casi doble clic"), se interpreta como una foto normal
//     (no se adivina la intencion retroactivamente) pero se ensancha la
//     ventana para que el siguiente intento si sea reconocido.
// El valor aprendido se persiste en localStorage para no perderlo al
// reiniciar la app.
const DOUBLE_CLICK_WINDOW_DEFAULT_MS = 2000;
const DOUBLE_CLICK_WINDOW_MIN_MS = 1200;
const DOUBLE_CLICK_WINDOW_MAX_MS = 6000;
const DOUBLE_CLICK_NEAR_MISS_MARGIN_MS = 1500;
const DOUBLE_CLICK_WINDOW_STORAGE_KEY = 'enclaii-double-click-window-ms';
// Rebote de contacto del switch: muy por debajo de DOUBLE_CLICK_WINDOW_MIN_MS,
// asi que nunca se confunde con un doble clic deliberado.
const CLICK_BOUNCE_IGNORE_MS = 250;

function clampDoubleClickWindow(value) {
  return Math.min(DOUBLE_CLICK_WINDOW_MAX_MS, Math.max(DOUBLE_CLICK_WINDOW_MIN_MS, Math.round(value)));
}

let doubleClickWindowMs = (() => {
  const stored = Number(localStorage.getItem(DOUBLE_CLICK_WINDOW_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampDoubleClickWindow(stored) : DOUBLE_CLICK_WINDOW_DEFAULT_MS;
})();

function setDoubleClickWindow(value) {
  doubleClickWindowMs = clampDoubleClickWindow(value);
  localStorage.setItem(DOUBLE_CLICK_WINDOW_STORAGE_KEY, String(doubleClickWindowMs));
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

  const isDoubleClick = elapsedSinceLastClick !== null && elapsedSinceLastClick <= doubleClickWindowMs;

  if (isDoubleClick) {
    lastCaptureClickAt = 0;
    const previousWindow = doubleClickWindowMs;
    setDoubleClickWindow(elapsedSinceLastClick + 300);

    if (isRecording) {
      addLog(
        `Doble clic detectado (${elapsedSinceLastClick}ms, ventana ${previousWindow}ms → ${doubleClickWindowMs}ms): deteniendo grabación...`
      );
      stopRecording();
    } else {
      addLog(
        `Doble clic detectado (${elapsedSinceLastClick}ms, ventana ${previousWindow}ms → ${doubleClickWindowMs}ms): iniciando grabación...`
      );
      startRecording();
    }
    return;
  }

  const isNearMissDoubleClick =
    elapsedSinceLastClick !== null && elapsedSinceLastClick <= doubleClickWindowMs + DOUBLE_CLICK_NEAR_MISS_MARGIN_MS;

  if (isNearMissDoubleClick) {
    const previousWindow = doubleClickWindowMs;
    setDoubleClickWindow(elapsedSinceLastClick + 300);
    addLog(
      `Clic un poco lento para doble clic (${elapsedSinceLastClick}ms): ventana ampliada de ${previousWindow}ms a ${doubleClickWindowMs}ms para el próximo intento.`
    );
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
