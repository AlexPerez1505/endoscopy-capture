import { state } from './state.js';
import { request } from './api.js';

function showMainPhoto(url = '') {
  const image =
    document.getElementById(
      'patientPhoto'
    );

  const placeholder =
    document.getElementById(
      'patientPhotoPlaceholder'
    );

  if (!image) {
    return;
  }

  if (!url) {
    image.hidden = true;
    image.removeAttribute('src');

    if (placeholder) {
      placeholder.hidden = false;
    }

    return;
  }

  image.src = url;
  image.hidden = false;

  if (placeholder) {
    placeholder.hidden = true;
  }
}

function showModalPhoto(url = '') {
  const image =
    document.getElementById(
      'patientModalPhotoPreview'
    );

  const video =
    document.getElementById(
      'patientCameraVideo'
    );

  const placeholder =
    document.getElementById(
      'patientCameraPlaceholder'
    );

  if (!image) {
    return;
  }

  if (!url) {
    image.hidden = true;
    image.removeAttribute('src');

    if (
      !state.cameraStream &&
      placeholder
    ) {
      placeholder.hidden = false;
    }

    return;
  }

  image.src = url;
  image.hidden = false;

  if (video) {
    video.hidden = true;
  }

  if (placeholder) {
    placeholder.hidden = true;
  }
}

function fileToDataUrl(file) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload = () => {
        resolve(
          String(
            reader.result || ''
          )
        );
      };

      reader.onerror = () => {
        reject(
          reader.error ||
          new Error(
            'No se pudo leer la imagen.'
          )
        );
      };

      reader.readAsDataURL(file);
    }
  );
}

async function selectPhotoFile(file) {
  if (!file) {
    return;
  }

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
  ];

  if (
    file.type &&
    !allowedTypes.includes(file.type)
  ) {
    throw new Error(
      'Selecciona una imagen JPG, PNG o WEBP.'
    );
  }

  if (
    file.size >
    4 * 1024 * 1024
  ) {
    throw new Error(
      'La fotografía no puede superar los 4 MB.'
    );
  }

  state.currentPhotoFile = file;

  state.currentPhotoDataUrl =
    await fileToDataUrl(file);

  showModalPhoto(
    state.currentPhotoDataUrl
  );
}

function openPhotoModal() {
  const modal =
    document.getElementById(
      'patientPhotoModal'
    );

  state.photoModalSnapshot = {
    file: state.currentPhotoFile,
    dataUrl: state.currentPhotoDataUrl,
  };

  modal?.classList.add('active');

  modal?.setAttribute(
    'aria-hidden',
    'false'
  );

  if (state.currentPhotoDataUrl) {
    showModalPhoto(
      state.currentPhotoDataUrl
    );
  }
}

function closePhotoModal() {
  stopCamera();

  if (state.photoModalSnapshot) {
    state.currentPhotoFile =
      state.photoModalSnapshot.file;
    state.currentPhotoDataUrl =
      state.photoModalSnapshot.dataUrl;

    state.photoModalSnapshot = null;

    showMainPhoto(
      state.currentPhotoDataUrl
    );
  }

  const modal =
    document.getElementById(
      'patientPhotoModal'
    );

  modal?.classList.remove('active');

  modal?.setAttribute(
    'aria-hidden',
    'true'
  );
}

async function startCamera() {
  const video =
    document.getElementById(
      'patientCameraVideo'
    );

  const placeholder =
    document.getElementById(
      'patientCameraPlaceholder'
    );

  const image =
    document.getElementById(
      'patientModalPhotoPreview'
    );

  if (
    !video ||
    !navigator.mediaDevices
      ?.getUserMedia
  ) {
    throw new Error(
      'Este dispositivo no permite abrir la cámara.'
    );
  }

  stopCamera();

  state.cameraStream =
    await navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'user',

          width: {
            ideal: 1280,
          },

          height: {
            ideal: 720,
          },
        },

        audio: false,
      });

  video.srcObject =
    state.cameraStream;

  video.hidden = false;

  if (image) {
    image.hidden = true;
  }

  if (placeholder) {
    placeholder.hidden = true;
  }

  await video
    .play()
    .catch(() => {});
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream
      .getTracks()
      .forEach(
        (track) => track.stop()
      );

    state.cameraStream = null;
  }

  const video =
    document.getElementById(
      'patientCameraVideo'
    );

  if (video) {
    video.srcObject = null;
    video.hidden = true;
  }
}

async function captureCameraPhoto() {
  const video =
    document.getElementById(
      'patientCameraVideo'
    );

  const canvas =
    document.getElementById(
      'patientCameraCanvas'
    );

  if (
    !video ||
    !canvas ||
    !state.cameraStream
  ) {
    throw new Error(
      'Primero abre la cámara.'
    );
  }

  canvas.width =
    video.videoWidth || 1280;

  canvas.height =
    video.videoHeight || 720;

  const context =
    canvas.getContext('2d');

  if (!context) {
    throw new Error(
      'No se pudo preparar la fotografía.'
    );
  }

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob = await new Promise(
    (resolve) => {
      canvas.toBlob(
        resolve,
        'image/png',
        0.95
      );
    }
  );

  if (!blob) {
    throw new Error(
      'No se pudo generar la fotografía.'
    );
  }

  state.currentPhotoFile =
    new File(
      [blob],
      `paciente-${Date.now()}.png`,
      {
        type: 'image/png',
      }
    );

  state.currentPhotoDataUrl =
    canvas.toDataURL(
      'image/png'
    );

  showModalPhoto(
    state.currentPhotoDataUrl
  );

  stopCamera();
}

async function deleteSavedPhoto() {
  if (
    state.currentMode === 'edit' &&
    state.currentPatientId &&
    state.currentPatient?.foto_url
  ) {
    await request(
      `${encodeURIComponent(
        state.currentPatientId
      )}/foto`,
      {
        method: 'DELETE',
      }
    );
  }

  state.currentPhotoFile = null;
  state.currentPhotoDataUrl = '';

  if (state.currentPatient) {
    state.currentPatient.foto_url = null;
  }

  const input =
    document.getElementById(
      'inputFileFoto'
    );

  if (input) {
    input.value = '';
  }

  showMainPhoto('');
  showModalPhoto('');
}

export {
  showMainPhoto,
  showModalPhoto,
  fileToDataUrl,
  selectPhotoFile,
  openPhotoModal,
  closePhotoModal,
  startCamera,
  stopCamera,
  captureCameraPhoto,
  deleteSavedPhoto,
};
