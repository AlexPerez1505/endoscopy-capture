const ONLINE_API_BASE_URL = 'http://127.0.0.1:8000/api';

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

const pairCodeInput = document.getElementById('pairCodeInput');
const pairBtn = document.getElementById('pairBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
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

let livePushTimer = null;
let isSendingLiveFrame = false;

let connection = {
  token: '',
  tenantId: '',
  userId: '',
  pacienteId: '',
  estudioId: '',
  deviceId: '',
  sessionId: '',
};

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

function saveConnection() {
  localStorage.setItem('tauri_capture_connection', JSON.stringify(connection));
}

function loadConnection() {
  try {
    const saved = localStorage.getItem('tauri_capture_connection');

    if (!saved) {
      renderConnection();
      return;
    }

    connection = JSON.parse(saved);
    renderConnection();

    if (connection.token && connection.sessionId) {
      setStatus('Conectado', 'live');
      addLog('Conexión anterior restaurada.', 'success');
    }
  } catch (error) {
    console.error(error);
    clearConnection();
  }
}

function clearConnection() {
  connection = {
    token: '',
    tenantId: '',
    userId: '',
    pacienteId: '',
    estudioId: '',
    deviceId: '',
    sessionId: '',
  };

  localStorage.removeItem('tauri_capture_connection');
  renderConnection();
  setStatus('Sin conectar', 'warning');
}

function renderConnection() {
  const connected = Boolean(connection.token && connection.sessionId);

  pairStatusText.textContent = connected ? 'Conectado' : 'Sin conectar';
  tenantText.textContent = connection.tenantId || '-';
  patientText.textContent = connection.pacienteId || '-';
  studyText.textContent = connection.estudioId || '-';
  sessionText.textContent = connection.sessionId || '-';

  captureBtn.disabled = !currentStream || !connected;
  recordBtn.disabled = !currentStream || !connected;
}

function getDeviceName() {
  return navigator.userAgent.includes('Windows')
    ? 'Windows Endoscopy Capture'
    : 'Endoscopy Capture';
}

function getDeviceUid() {
  let uid = localStorage.getItem('tauri_capture_device_uid');

  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem('tauri_capture_device_uid', uid);
  }

  return uid;
}

async function pairWithLaravel() {
  try {
    const code = pairCodeInput.value.trim().replace(/\D/g, '');

    if (code.length !== 6) {
      throw new Error('Escribe el código de 6 dígitos que generó Laravel.');
    }

    setStatus('Conectando...', 'warning');
    addLog('Validando código con Laravel...');

    const response = await fetch(`${ONLINE_API_BASE_URL}/tauri/pair/redeem`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        device_name: getDeviceName(),
        device_uid: getDeviceUid(),
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || 'No se pudo vincular el dispositivo.');
    }

    connection = {
      token: data.data.token,
      tenantId: data.data.tenant_id ?? '',
      userId: data.data.user_id ?? '',
      pacienteId: data.data.paciente_id ?? '',
      estudioId: data.data.estudio_id ?? '',
      deviceId: data.data.device_id,
      sessionId: data.data.session_id,
    };

    saveConnection();
    renderConnection();

    pairCodeInput.value = '';

    setStatus('Conectado', 'live');
    addLog('Tauri vinculado correctamente con Laravel.', 'success');

    if (currentStream) {
      startLivePush();
    }
  } catch (error) {
    console.error(error);
    setStatus('Error de conexión', 'error');
    addLog(`Error conectando con Laravel: ${error.message}`, 'error');
  }
}

async function disconnectFromLaravel() {
  try {
    stopLivePush();

    if (connection.token && connection.sessionId) {
      await fetch(`${ONLINE_API_BASE_URL}/tauri/finish-session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: connection.sessionId,
        }),
      }).catch(() => null);
    }

    clearConnection();
    addLog('Dispositivo desconectado.');
  } catch (error) {
    console.error(error);
    clearConnection();
    addLog('Conexión local limpiada.');
  }
}

function assertConnected() {
  if (!connection.token || !connection.sessionId) {
    throw new Error('Primero conecta Tauri con el código de Laravel.');
  }
}

async function requestCameraPermission() {
  const tempStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  tempStream.getTracks().forEach((track) => track.stop());
}

async function detectDevices() {
  try {
    setStatus('Buscando...', 'warning');
    addLog('Solicitando permisos de video...');

    await requestCameraPermission();

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((device) => device.kind === 'videoinput');

    deviceSelect.innerHTML = '';

    if (videoDevices.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No se detectaron capturadores';
      deviceSelect.appendChild(option);

      setStatus('Sin capturador', 'error');
      addLog('No se detectó ningún dispositivo de video.', 'error');
      return;
    }

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Dispositivo de video ${index + 1}`;
      deviceSelect.appendChild(option);
    });

    setStatus(
      connection.token ? 'Conectado' : 'Dispositivo detectado',
      connection.token ? 'live' : 'warning'
    );

    addLog(`Se detectaron ${videoDevices.length} dispositivo(s) de video.`, 'success');
  } catch (error) {
    console.error(error);
    setStatus('Permiso denegado', 'error');
    addLog(`Error detectando dispositivos: ${error.message}`, 'error');
  }
}

async function startVideo() {
  try {
    const selectedDeviceId = deviceSelect.value;

    if (!selectedDeviceId) {
      throw new Error('Selecciona un capturador antes de iniciar.');
    }

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    currentStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: {
          exact: selectedDeviceId,
        },
        width: {
          ideal: 1920,
        },
        height: {
          ideal: 1080,
        },
        frameRate: {
          ideal: 30,
        },
      },
      audio: false,
    });

    preview.srcObject = currentStream;

    const selectedText =
      deviceSelect.options[deviceSelect.selectedIndex]?.textContent ||
      'Capturador activo';

    deviceLabel.textContent = selectedText;
    emptyState.classList.add('is-hidden');

    renderConnection();

    setStatus(
      connection.token ? 'En vivo' : 'Video local',
      connection.token ? 'live' : 'warning'
    );

    addLog('Video iniciado correctamente.', 'success');

    if (connection.token) {
      startLivePush();
    }
  } catch (error) {
    console.error(error);
    setStatus('Error de video', 'error');
    addLog(`No se pudo iniciar el video: ${error.message}`, 'error');
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

function startLivePush() {
  stopLivePush();

  if (!currentStream || !connection.token) {
    return;
  }

  livePushTimer = window.setInterval(sendLiveFrame, 900);
  addLog('Transmisión de frames en vivo iniciada.', 'success');
}

function stopLivePush() {
  if (livePushTimer) {
    clearInterval(livePushTimer);
    livePushTimer = null;
  }
}

async function sendLiveFrame() {
  if (isSendingLiveFrame) {
    return;
  }

  if (!currentStream || !connection.token) {
    return;
  }

  try {
    isSendingLiveFrame = true;

    const blob = await captureFrameBlob(0.55, 960);

    const formData = new FormData();
    formData.append('session_id', connection.sessionId);
    formData.append('frame', blob, 'latest.jpg');

    const response = await fetch(`${ONLINE_API_BASE_URL}/tauri/live-frame`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        Accept: 'application/json',
      },
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.message || 'Laravel rechazó el frame en vivo.');
    }
  } catch (error) {
    console.error(error);
    addLog(`Live frame no enviado: ${error.message}`, 'error');
  } finally {
    isSendingLiveFrame = false;
  }
}

async function captureImage() {
  try {
    assertConnected();

    const blob = await captureFrameBlob(0.95, 1920);

    await uploadImage(blob);

    totalImages += 1;
    imageCount.textContent = totalImages;

    addLog('Imagen capturada y enviada a Laravel.', 'success');
  } catch (error) {
    console.error(error);
    addLog(`Error capturando imagen: ${error.message}`, 'error');
  }
}

async function uploadImage(blob) {
  const formData = new FormData();

  formData.append('session_id', connection.sessionId);
  formData.append('image', blob, makeFileName('endoscopy-capture', 'jpg'));
  formData.append('captured_at', new Date().toISOString());

  const response = await fetch(`${ONLINE_API_BASE_URL}/tauri/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      Accept: 'application/json',
    },
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || 'Laravel rechazó la imagen.');
  }

  return data;
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
    assertConnected();

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

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(recordedChunks, {
          type: mediaRecorder.mimeType || 'video/webm',
        });

        await uploadVideo(blob);

        totalVideos += 1;
        videoCount.textContent = totalVideos;

        addLog('Video grabado y enviado a Laravel.', 'success');
      } catch (error) {
        console.error(error);
        addLog(`Error subiendo video: ${error.message}`, 'error');
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

async function uploadVideo(blob) {
  const formData = new FormData();

  formData.append('session_id', connection.sessionId);
  formData.append('video', blob, makeFileName('endoscopy-video', 'webm'));
  formData.append('ended_at', new Date().toISOString());

  const response = await fetch(`${ONLINE_API_BASE_URL}/tauri/videos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      Accept: 'application/json',
    },
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || 'Laravel rechazó el video.');
  }

  return data;
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

pairBtn.addEventListener('click', pairWithLaravel);
disconnectBtn.addEventListener('click', disconnectFromLaravel);

detectDevicesBtn.addEventListener('click', detectDevices);
startBtn.addEventListener('click', startVideo);
captureBtn.addEventListener('click', captureImage);
recordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', stopRecording);

brightnessInput.addEventListener('input', applyFilters);
contrastInput.addEventListener('input', applyFilters);
saturationInput.addEventListener('input', applyFilters);
resetFiltersBtn.addEventListener('click', resetFilters);

document.addEventListener('keydown', handleRemoteKey);

window.addEventListener('beforeunload', () => {
  stopLivePush();

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});

loadConnection();
setStatus(connection.token ? 'Conectado' : 'Listo', connection.token ? 'live' : 'idle');
addLog('Atajos activos: F8 o Espacio = foto, F9 = grabar, F10 = detener.');