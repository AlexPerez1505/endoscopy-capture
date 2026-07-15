import { apiBaseUrl, authHeader, laravelFetch } from './js/laravel.js';

const CAPTURE_ENDPOINT = `${apiBaseUrl()}/tauri/capturas`;
const ACTIVE_STUDY_ENDPOINT = `${apiBaseUrl()}/tauri/estudio-activo`;

const preview = document.getElementById('preview');
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

let currentStream = null;
let mediaRecorder = null;
let recordedChunks = [];

let totalImages = 0;
let totalVideos = 0;
let activeStudyContext = {};
let activeStudyLoaded = false;

const DEFAULT_CAMERA_VALUE = '__default_camera__';

function goBackToApp() {
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

  if (pairStatusText) pairStatusText.textContent = 'Conectado a Laravel';
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

function normalizeActiveStudy(payload = {}) {
  const study = payload.study || payload.estudio || payload.data || payload;

  return {
    patientId: firstText(study.patient_id, study.paciente_id, study.patientId),
    studyId: firstText(study.study_id, study.estudio_id, study.id, study.studyId),
    sessionId: firstText(study.session_id, study.sesion_id, study.sessionId),
    patientName: firstText(study.patient_name, study.paciente_nombre, study.patient),
    studyLabel: firstText(study.label, study.study_label, study.estudio_label, [study.tipo || study.type, study.folio].filter(Boolean).join(' ')),
  };
}

async function loadActiveStudyContext({ silent = false } = {}) {
  const headers = { Accept: 'application/json' };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;
  const context = captureContext();
  const params = new URLSearchParams();
  if (context.studyId) params.set('study_id', context.studyId);
  if (context.patientId) params.set('patient_id', context.patientId);
  if (context.sessionId) params.set('session_id', context.sessionId);
  const endpoint = params.toString()
    ? `${ACTIVE_STUDY_ENDPOINT}?${params.toString()}`
    : ACTIVE_STUDY_ENDPOINT;

  try {
    const response = await laravelFetch(endpoint, {
      headers,
      credentials: 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : {};

    activeStudyLoaded = true;

    if (!response.ok || payload?.ok === false) {
      activeStudyContext = {};
      renderConnection();
      if (!silent) addLog(payload?.message || 'No hay estudio activo en Laravel.', 'error');
      return activeStudyContext;
    }

    activeStudyContext = normalizeActiveStudy(payload);
    renderConnection();
    if (!silent && activeStudyContext.studyId) {
      addLog(`Estudio activo conectado: ${activeStudyContext.studyLabel || `ID ${activeStudyContext.studyId}`}.`, 'success');
    }
  } catch (error) {
    activeStudyLoaded = true;
    activeStudyContext = {};
    renderConnection();
    if (!silent) addLog(`No se pudo leer el estudio activo: ${error.message}`, 'error');
  }

  return activeStudyContext;
}

async function ensureCaptureContext() {
  let context = captureContext();
  if (!context.patientId && !context.studyId) {
    await loadActiveStudyContext({ silent: true });
    context = captureContext();
  }
  return context;
}

async function uploadCaptureToLaravel(blob, filename, captureType) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;
  const context = await ensureCaptureContext();

  const response = await laravelFetch(CAPTURE_ENDPOINT, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      ...context,
      capture_type: captureType,
      filename,
      mime_type: blob.type || 'application/octet-stream',
      data_base64: await blobToBase64(blob),
      captured_at: new Date().toISOString(),
      source: 'tauri',
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (response.status === 401 || response.status === 419) {
    throw new Error('Ingresa tus credenciales de Laravel para guardar capturas.');
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status} al guardar la captura.`);
  }

  if (payload.capture) {
    activeStudyContext = {
      ...activeStudyContext,
      patientId: firstText(payload.capture.patient_id, activeStudyContext.patientId),
      studyId: firstText(payload.capture.study_id, activeStudyContext.studyId),
      patientName: firstText(payload.capture.patient_name, activeStudyContext.patientName),
      studyLabel: firstText(payload.capture.study_label, activeStudyContext.studyLabel),
    };
    renderConnection();
  }

  return payload;
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

function makeFileName(prefix, extension) {
  const now = new Date();
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');

  return `${prefix}-${stamp}.${extension}`;
}

async function captureFrameBlob(quality = 0.8, maxWidth = 1280) {
  if (!currentStream) {
    throw new Error('Primero inicia el video.');
  }

  const sourceWidth = preview.videoWidth;
  const sourceHeight = preview.videoHeight;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('El video todavía no está listo.');
  }

  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  snapshotCanvas.width = width;
  snapshotCanvas.height = height;

  const ctx = snapshotCanvas.getContext('2d');

  ctx.filter = preview.style.filter || 'none';
  ctx.drawImage(preview, 0, 0, width, height);

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

function startRecording() {
  try {
    if (!currentStream) {
      throw new Error('Primero inicia el video.');
    }

    recordedChunks = [];

    const mimeType = getSupportedMimeType();

    mediaRecorder = new MediaRecorder(
      currentStream,
      mimeType ? { mimeType } : undefined
    );

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
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

function handleRemoteKey(event) {
  if (event.code === 'F8' || event.code === 'Space') {
    event.preventDefault();
    captureImage();
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

detectDevicesBtn.addEventListener('click', detectDevices);
startBtn.addEventListener('click', startVideo);
captureBtn.addEventListener('click', captureImage);
recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);
backToAppBtn?.addEventListener('click', goBackToApp);

brightnessInput.addEventListener('input', applyFilters);
contrastInput.addEventListener('input', applyFilters);
saturationInput.addEventListener('input', applyFilters);
resetFiltersBtn.addEventListener('click', resetFilters);

document.addEventListener('keydown', handleRemoteKey);
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  detectDevices();
});

window.addEventListener('beforeunload', () => {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});

renderConnection();
setStatus('Listo', 'idle');
addLog('Conexion Laravel activada. Las capturas se guardan por Laravel.');
addLog('Atajos activos: F8 o Espacio = foto, F9 = grabar, F10 = detener.');
loadActiveStudyContext();
detectDevices();
