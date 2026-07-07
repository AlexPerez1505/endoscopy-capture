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
  pairStatusText.textContent = 'Modo local';
  tenantText.textContent = 'Capturador USB';
  patientText.textContent = 'Descarga local';
  studyText.textContent = 'Laravel opcional';
  sessionText.textContent = 'Sin sesión';

  captureBtn.disabled = !currentStream;
  recordBtn.disabled = !currentStream;
  stopRecordBtn.disabled = !mediaRecorder || mediaRecorder.state === 'inactive';
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

    setStatus('Listo para capturar', 'warning');
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
    setStatus('Video local', 'warning');

    addLog('Video iniciado correctamente.', 'success');
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function captureImage() {
  try {
    if (!currentStream) {
      throw new Error('Primero inicia el video.');
    }

    const blob = await captureFrameBlob(0.95, 1920);
    downloadBlob(blob, makeFileName('endoscopy-capture', 'jpg'));

    totalImages += 1;
    imageCount.textContent = totalImages;

    addLog('Imagen descargada localmente.', 'success');
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

        downloadBlob(blob, makeFileName('endoscopy-video', 'webm'));

        totalVideos += 1;
        videoCount.textContent = totalVideos;

        addLog('Video descargado localmente.', 'success');
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

window.addEventListener('beforeunload', () => {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});

renderConnection();
setStatus('Listo', 'idle');
addLog('Modo local activado. Las capturas se descargan en tu equipo.');
addLog('Atajos activos: F8 o Espacio = foto, F9 = grabar, F10 = detener.');
