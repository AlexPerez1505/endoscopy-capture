import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from './laravel.js';
import { getAuthToken } from './auth.js';
import { escapeHtml } from './html.js';
import {
  EDIT_PATIENT_ID_STORAGE_KEY,
  PATIENTS_REFRESH_STORAGE_KEY,
} from './storage-keys.js';

let currentPatient = null;
let currentMode = 'create';
let currentPatientId = null;

let currentPhotoFile = null;
let currentPhotoDataUrl = '';
let cameraStream = null;

let miniTargetId = null;
let selectedStudyFiles = [];

let patientFormAbortController = null;

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

/* =========================================================
   API
========================================================= */

function endpoint(path = '') {
  const cleanPath =
    String(path || '')
      .replace(/^\/+/, '');

  return (
    `${apiBaseUrl()}/api/tauri/pacientes` +
    (
      cleanPath
        ? `/${cleanPath}`
        : ''
    )
  );
}

async function request(
  path = '',
  options = {}
) {
  const authToken = getAuthToken();

  if (!authToken) {
    const error = new Error(
      'No existe una sesión activa. Inicia sesión nuevamente.'
    );

    error.code = 'UNAUTHORIZED';

    throw error;
  }

  const response = await laravelFetch(
    endpoint(path),
    {
      ...options,

      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...(options.headers || {}),
      },

      credentials: 'include',
    }
  );

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  let payload = {};

  if (
    contentType.includes(
      'application/json'
    )
  ) {
    payload = await response
      .json()
      .catch(() => ({}));
  } else {
    const responseText = await response
      .text()
      .catch(() => '');

    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = {
          message: responseText,
        };
      }
    }
  }

  if (
    response.status === 401 ||
    response.status === 419
  ) {
    const error = new Error(
      'Tu sesión terminó. Inicia sesión nuevamente.'
    );

    error.code = 'UNAUTHORIZED';

    throw error;
  }

  if (
    !response.ok ||
    payload?.ok === false ||
    payload?.success === false
  ) {
    const validationMessage =
      payload?.errors
        ? Object.values(
            payload.errors
          ).flat()[0]
        : null;

    throw new Error(
      validationMessage ||
      payload?.message ||
      `El servidor respondió HTTP ${response.status}.`
    );
  }

  return payload;
}

/* =========================================================
   UTILIDADES
========================================================= */

function setError(message = '') {
  const element =
    document.getElementById(
      'patientFormError'
    );

  if (!element) {
    return;
  }

  element.textContent = message;

  element.classList.toggle(
    'show',
    Boolean(message)
  );

  if (message) {
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }
}

function setField(id, value) {
  const field =
    document.getElementById(id);

  if (!field) {
    return;
  }

  field.value =
    value === null ||
    value === undefined
      ? ''
      : value;
}

function navigateBack(event) {
  event?.preventDefault?.();

  stopCamera();

  sessionStorage.removeItem(
    EDIT_PATIENT_ID_STORAGE_KEY
  );

  window.location.hash = 'pacientes';
}

function routeMode() {
  const route =
    window.location.hash
      .replace(/^#/, '')
      .split('?')[0];

  return route === 'pacientes-editar'
    ? 'edit'
    : 'create';
}

function cleanNullableValue(value) {
  const normalized = String(
    value ?? ''
  ).trim();

  return normalized === ''
    ? null
    : normalized;
}

/* =========================================================
   FOLIO
========================================================= */

function extractFolio(payload = {}) {
  return String(
    payload.folio ||
    payload.next_folio ||
    payload.siguiente_folio ||
    payload.proximo_folio ||
    payload.data?.folio ||
    payload.data?.next_folio ||
    payload.defaults?.folio ||
    payload.paciente?.folio ||
    payload.patient?.folio ||
    ''
  ).trim();
}

function updateFolio(folio) {
  const normalizedFolio =
    String(folio || '').trim();

  const folioInput =
    document.getElementById(
      'folioInput'
    );

  const identificacionInput =
    document.getElementById(
      'identificacionInput'
    );

  const folioText =
    document.getElementById(
      'patientFolioText'
    );

  if (folioInput) {
    folioInput.value =
      normalizedFolio;
  }

  if (identificacionInput) {
    identificacionInput.value =
      normalizedFolio;
  }

  if (folioText) {
    folioText.textContent =
      normalizedFolio ||
      'Generando...';
  }
}

/* =========================================================
   EDAD
========================================================= */

function calculateAge(value) {
  if (!value) {
    return '';
  }

  const birth = new Date(
    `${value}T00:00:00`
  );

  const today = new Date();

  if (
    Number.isNaN(
      birth.getTime()
    ) ||
    birth > today
  ) {
    return '';
  }

  let age =
    today.getFullYear() -
    birth.getFullYear();

  const month =
    today.getMonth() -
    birth.getMonth();

  if (
    month < 0 ||
    (
      month === 0 &&
      today.getDate() <
        birth.getDate()
    )
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function updateAge() {
  const date =
    document.getElementById(
      'fechaNacimiento'
    );

  const age =
    document.getElementById(
      'edadCalculada'
    );

  if (!age) {
    return;
  }

  age.value =
    calculateAge(
      date?.value
    );
}

/* =========================================================
   FOTOGRAFÍA
========================================================= */

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
    image.onerror = null;
    image.onload = null;
    image.removeAttribute('src');

    if (placeholder) {
      placeholder.hidden = false;
    }

    return;
  }

  const requestId =
    `${Date.now()}-${Math.random()}`;

  image.dataset.photoRequestId =
    requestId;

  image.onerror = () => {
    image.hidden = true;
    image.removeAttribute('src');

    if (placeholder) {
      placeholder.hidden = false;
    }
  };

  image.onload = () => {
    image.hidden = false;

    if (placeholder) {
      placeholder.hidden = true;
    }
  };

  image.hidden = false;

  if (placeholder) {
    placeholder.hidden = true;
  }

  authenticatedLaravelAssetUrl(
    url,
    {
      accept: 'image/*,*/*',
    }
  )
    .then((localUrl) => {
      if (
        image.dataset.photoRequestId !==
        requestId
      ) {
        return;
      }

      image.src = localUrl;
    })
    .catch(() => {
      if (
        image.dataset.photoRequestId !==
        requestId
      ) {
        return;
      }

      image.hidden = true;
      image.removeAttribute('src');

      if (placeholder) {
        placeholder.hidden = false;
      }
    });
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
    image.onerror = null;
    image.onload = null;
    image.removeAttribute('src');

    if (
      !cameraStream &&
      placeholder
    ) {
      placeholder.hidden = false;
    }

    return;
  }

  const requestId =
    `${Date.now()}-${Math.random()}`;

  image.dataset.photoRequestId =
    requestId;

  image.onerror = () => {
    image.hidden = true;
    image.removeAttribute('src');

    if (
      !cameraStream &&
      placeholder
    ) {
      placeholder.hidden = false;
    }
  };

  image.onload = () => {
    image.hidden = false;

    if (placeholder) {
      placeholder.hidden = true;
    }
  };

  image.hidden = false;

  if (video) {
    video.hidden = true;
  }

  if (placeholder) {
    placeholder.hidden = true;
  }

  authenticatedLaravelAssetUrl(
    url,
    {
      accept: 'image/*,*/*',
    }
  )
    .then((localUrl) => {
      if (
        image.dataset.photoRequestId !==
        requestId
      ) {
        return;
      }

      image.src = localUrl;
    })
    .catch(() => {
      if (
        image.dataset.photoRequestId !==
        requestId
      ) {
        return;
      }

      image.hidden = true;
      image.removeAttribute('src');

      if (
        !cameraStream &&
        placeholder
      ) {
        placeholder.hidden = false;
      }
    });
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

  currentPhotoFile = file;

  currentPhotoDataUrl =
    await fileToDataUrl(file);

  showMainPhoto(
    currentPhotoDataUrl
  );

  showModalPhoto(
    currentPhotoDataUrl
  );
}

function openPhotoModal() {
  const modal =
    document.getElementById(
      'patientPhotoModal'
    );

  modal?.classList.add('active');

  modal?.setAttribute(
    'aria-hidden',
    'false'
  );

  if (currentPhotoDataUrl) {
    showModalPhoto(
      currentPhotoDataUrl
    );
  }
}

function closePhotoModal() {
  stopCamera();

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

  cameraStream =
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
    cameraStream;

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
  if (cameraStream) {
    cameraStream
      .getTracks()
      .forEach(
        (track) => track.stop()
      );

    cameraStream = null;
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
    !cameraStream
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

  currentPhotoFile =
    new File(
      [blob],
      `paciente-${Date.now()}.png`,
      {
        type: 'image/png',
      }
    );

  currentPhotoDataUrl =
    canvas.toDataURL(
      'image/png'
    );

  showMainPhoto(
    currentPhotoDataUrl
  );

  showModalPhoto(
    currentPhotoDataUrl
  );

  stopCamera();
}

async function deleteSavedPhoto() {
  if (
    currentMode === 'edit' &&
    currentPatientId &&
    currentPatient?.foto_url
  ) {
    await request(
      `${encodeURIComponent(
        currentPatientId
      )}/foto`,
      {
        method: 'DELETE',
      }
    );
  }

  currentPhotoFile = null;
  currentPhotoDataUrl = '';

  if (currentPatient) {
    currentPatient.foto_url = null;
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

/* =========================================================
   MINI MODAL
========================================================= */

function openMiniModal(button) {
  miniTargetId =
    button.dataset.miniField ||
    null;

  const modal =
    document.getElementById(
      'patientMiniModal'
    );

  const title =
    document.getElementById(
      'patientMiniTitle'
    );

  const description =
    document.getElementById(
      'patientMiniDescription'
    );

  const input =
    document.getElementById(
      'patientMiniInput'
    );

  if (title) {
    title.textContent =
      button.dataset.miniTitle ||
      'Agregar';
  }

  if (description) {
    description.textContent =
      button.dataset
        .miniDescription ||
      'Escribe el valor';
  }

  if (input) {
    input.value = '';
  }

  modal?.classList.add('active');

  modal?.setAttribute(
    'aria-hidden',
    'false'
  );

  window.setTimeout(
    () => input?.focus(),
    50
  );
}

function closeMiniModal() {
  miniTargetId = null;

  const modal =
    document.getElementById(
      'patientMiniModal'
    );

  modal?.classList.remove('active');

  modal?.setAttribute(
    'aria-hidden',
    'true'
  );
}

function confirmMiniModal() {
  const input =
    document.getElementById(
      'patientMiniInput'
    );

  const value =
    String(
      input?.value || ''
    ).trim();

  if (
    !value ||
    !miniTargetId
  ) {
    return;
  }

  const target =
    document.getElementById(
      miniTargetId
    );

  if (target) {
    target.value = value;

    target.dispatchEvent(
      new Event(
        'input',
        {
          bubbles: true,
        }
      )
    );

    target.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true,
        }
      )
    );
  }

  closeMiniModal();
}

/* =========================================================
   ARCHIVOS
========================================================= */

function formatBytes(bytes) {
  const value =
    Number(bytes || 0);

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1048576) {
    return `${(
      value / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    value / 1048576
  ).toFixed(1)} MB`;
}

function fileType(file) {
  const name =
    String(
      file.name || ''
    ).toLowerCase();

  const mime =
    String(
      file.type || ''
    ).toLowerCase();

  if (
    mime.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif)$/
      .test(name)
  ) {
    return 'image';
  }

  if (
    mime === 'application/pdf' ||
    name.endsWith('.pdf')
  ) {
    return 'pdf';
  }

  if (
    mime.startsWith('video/') ||
    /\.(mp4|mov|avi|webm|mkv)$/
      .test(name)
  ) {
    return 'video';
  }

  return 'other';
}

function fileIcon() {
  return `
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
      ></path>

      <polyline
        points="14 2 14 8 20 8"
      ></polyline>
    </svg>
  `;
}

function openFileViewer({
  url,
  name,
  type,
}) {
  const modal =
    document.getElementById(
      'patientFileViewer'
    );

  const title =
    document.getElementById(
      'patientFileViewerTitle'
    );

  const content =
    document.getElementById(
      'patientFileViewerContent'
    );

  if (
    !modal ||
    !content
  ) {
    return;
  }

  if (title) {
    title.textContent =
      name || 'Archivo';
  }

  content.innerHTML = '';

  if (type === 'image') {
    const image =
      document.createElement(
        'img'
      );

    image.src = url;
    image.alt =
      name || 'Imagen';

    content.appendChild(image);
  } else if (
    type === 'pdf'
  ) {
    const iframe =
      document.createElement(
        'iframe'
      );

    iframe.src = url;

    content.appendChild(
      iframe
    );
  } else if (
    type === 'video'
  ) {
    const video =
      document.createElement(
        'video'
      );

    video.src = url;
    video.controls = true;

    content.appendChild(
      video
    );
  } else {
    content.innerHTML = `
      <div
        style="
          padding:48px;
          color:var(--txt-soft);
          text-align:center;
        "
      >
        Vista previa no disponible.
      </div>
    `;
  }

  modal.classList.add('active');

  modal.setAttribute(
    'aria-hidden',
    'false'
  );
}

function closeFileViewer() {
  const modal =
    document.getElementById(
      'patientFileViewer'
    );

  const content =
    document.getElementById(
      'patientFileViewerContent'
    );

  modal?.classList.remove('active');

  modal?.setAttribute(
    'aria-hidden',
    'true'
  );

  if (content) {
    content.innerHTML = '';
  }
}

function renderPendingFiles() {
  const section =
    document.getElementById(
      'patientPendingFilesSection'
    );

  const grid =
    document.getElementById(
      'estudiosArchivosGrid'
    );

  if (
    !section ||
    !grid
  ) {
    return;
  }

  section.classList.toggle(
    'show',
    selectedStudyFiles.length > 0
  );

  grid.innerHTML =
    selectedStudyFiles
      .map(
        (file, index) => {
          const url =
            URL.createObjectURL(
              file
            );

          const type =
            fileType(file);

          return `
            <div
              class="patient-file-card"
              data-pending-file-index="${index}"
              data-file-url="${escapeHtml(url)}"
              data-file-name="${escapeHtml(file.name)}"
              data-file-type="${type}"
            >
              <span
                class="patient-file-icon"
              >
                ${fileIcon()}
              </span>

              <span
                class="patient-file-info"
              >
                <span
                  class="patient-file-name"
                >
                  ${escapeHtml(file.name)}
                </span>

                <span
                  class="patient-file-meta"
                >
                  ${formatBytes(file.size)}
                  · pendiente
                </span>
              </span>

              <button
                type="button"
                class="patient-file-remove"
                data-remove-pending-file="${index}"
                aria-label="Quitar archivo"
              >
                ×
              </button>
            </div>
          `;
        }
      )
      .join('');
}

function renderExistingFiles(
  documents = []
) {
  const section =
    document.getElementById(
      'patientExistingFilesSection'
    );

  const grid =
    document.getElementById(
      'patientExistingFiles'
    );

  if (
    !section ||
    !grid
  ) {
    return;
  }

  const list =
    Array.isArray(documents)
      ? documents
      : [];

  section.classList.toggle(
    'show',
    list.length > 0
  );

  grid.innerHTML =
    list
      .map((document) => {
        const mime =
          String(
            document.mime_type ||
            ''
          );

        const type =
          mime.startsWith('image/')
            ? 'image'
            : mime === 'application/pdf'
              ? 'pdf'
              : mime.startsWith('video/')
                ? 'video'
                : 'other';

        return `
          <div
            class="patient-file-card"
            data-existing-file-id="${document.id}"
            data-file-url="${escapeHtml(document.url || '')}"
            data-file-name="${escapeHtml(document.nombre || 'Documento')}"
            data-file-type="${type}"
          >
            <span
              class="patient-file-icon"
            >
              ${fileIcon()}
            </span>

            <span
              class="patient-file-info"
            >
              <span
                class="patient-file-name"
              >
                ${escapeHtml(
                  document.nombre ||
                  'Documento'
                )}
              </span>

              <span
                class="patient-file-meta"
              >
                ${formatBytes(
                  document.size_bytes
                )}
              </span>
            </span>

            <button
              type="button"
              class="patient-file-remove"
              data-delete-existing-file="${document.id}"
              aria-label="Eliminar archivo"
            >
              ×
            </button>
          </div>
        `;
      })
      .join('');
}

/* =========================================================
   CARGAR DATOS
========================================================= */

function fillPatient(
  patient = {}
) {
  currentPatient = {
    ...patient,
    foto_url: patientPhotoUrl(patient),
  };

  patient = currentPatient;

  updateFolio(
    patient.folio ||
    patient.identificacion
  );

  setField(
    'patientName',
    patient.nombre_completo
  );

  setField(
    'fechaNacimiento',
    patient.fecha_nacimiento
  );

  setField(
    'edadCalculada',
    patient.edad
  );

  setField(
    'patientWeight',
    patient.peso
  );

  setField(
    'patientHeight',
    patient.altura
  );

  setField(
    'patientSex',
    patient.sexo
  );

  setField(
    'patientAddress',
    patient.direccion
  );

  setField(
    'patientPhone',
    patient.telefono
  );

  setField(
    'patientEmail',
    patient.email
  );

  setField(
    'medicoSelectMed',
    patient.medico
  );

  setField(
    'procedimientoSelect',
    patient.procedimiento
  );

  setField(
    'anestesiologoSelect',
    patient.anestesiologo
  );

  setField(
    'referidoSelectMed',
    patient.referido_por
  );

  setField(
    'equipoSelect',
    patient.equipo_utilizado
  );

  setField(
    'patientDiagnosis',
    patient.diagnostico_preliminar
  );

  setField(
    'patientDisease',
    patient.enfermedad
  );

  setField(
    'patientAllergies',
    patient.alergias
  );

  currentPhotoDataUrl =
    patient.foto_url || '';

  showMainPhoto(
    currentPhotoDataUrl
  );

  renderExistingFiles(
    patient.documentos || []
  );

  updateAge();
}

async function loadCreate() {
  updateFolio('');

  const payload =
    await request('create');

  const folio =
    extractFolio(payload);

  if (!folio) {
    console.error(
      'Respuesta de creación sin folio:',
      payload
    );

    throw new Error(
      'No se devolvió el folio del nuevo paciente.'
    );
  }

  updateFolio(folio);

  currentPatient = null;
  currentPatientId = null;
}

async function loadEdit() {
  currentPatientId =
    sessionStorage.getItem(
      EDIT_PATIENT_ID_STORAGE_KEY
    );

  if (!currentPatientId) {
    throw new Error(
      'No se encontró el paciente que deseas editar.'
    );
  }

  const payload =
    await request(
      `${encodeURIComponent(
        currentPatientId
      )}/edit`
    );

  const patient =
    payload.paciente ||
    payload.patient ||
    payload.data ||
    {};

  fillPatient(patient);
}

/* =========================================================
   VALIDACIÓN Y PAYLOAD
========================================================= */

function validateForm(form) {
  const folio =
    String(
      document.getElementById(
        'folioInput'
      )?.value ||
      form.elements.folio?.value ||
      currentPatient?.folio ||
      ''
    ).trim();

  const name =
    String(
      form.elements
        .nombre_completo
        ?.value ||
      ''
    ).trim();

  if (!folio) {
    throw new Error(
      'No se pudo generar el folio. Regresa al listado e intenta nuevamente.'
    );
  }

  if (!name) {
    form.elements
      .nombre_completo
      ?.focus();

    throw new Error(
      'Escribe el nombre completo del paciente.'
    );
  }

  const email =
    String(
      form.elements.email
        ?.value ||
      ''
    ).trim();

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    form.elements.email
      ?.focus();

    throw new Error(
      'Escribe un correo electrónico válido.'
    );
  }
}

function buildPatientPayload(form) {
  const folio =
    String(
      document.getElementById(
        'folioInput'
      )?.value ||
      form.elements.folio?.value ||
      currentPatient?.folio ||
      ''
    ).trim();

  const nombreCompleto =
    String(
      form.elements
        .nombre_completo
        ?.value ||
      ''
    ).trim();

  if (!nombreCompleto) {
    throw new Error(
      'Escribe el nombre completo del paciente.'
    );
  }

  const edadValue =
    String(
      document.getElementById(
        'edadCalculada'
      )?.value ||
      ''
    ).trim();

  const pesoValue =
    String(
      form.elements.peso?.value ||
      ''
    ).trim();

  const alturaValue =
    String(
      form.elements.altura?.value ||
      ''
    ).trim();

  return {
    folio,
    identificacion: folio,

    nombre_completo:
      nombreCompleto,

    fecha_nacimiento:
      cleanNullableValue(
        form.elements
          .fecha_nacimiento
          ?.value
      ),

    edad:
      edadValue === ''
        ? null
        : Number(edadValue),

    peso:
      pesoValue === ''
        ? null
        : Number(pesoValue),

    altura:
      alturaValue === ''
        ? null
        : Number(alturaValue),

    sexo:
      cleanNullableValue(
        form.elements.sexo?.value
      ),

    direccion:
      cleanNullableValue(
        form.elements.direccion?.value
      ),

    telefono:
      cleanNullableValue(
        form.elements.telefono?.value
      ),

    email:
      cleanNullableValue(
        form.elements.email?.value
      ),

    medico:
      cleanNullableValue(
        form.elements.medico?.value
      ),

    procedimiento:
      cleanNullableValue(
        form.elements.procedimiento?.value
      ),

    anestesiologo:
      cleanNullableValue(
        form.elements.anestesiologo?.value
      ),

    referido_por:
      cleanNullableValue(
        form.elements.referido_por?.value
      ),

    equipo_utilizado:
      cleanNullableValue(
        form.elements
          .equipo_utilizado
          ?.value
      ),

    diagnostico_preliminar:
      cleanNullableValue(
        form.elements
          .diagnostico_preliminar
          ?.value
      ),

    enfermedad:
      cleanNullableValue(
        form.elements.enfermedad?.value
      ),

    alergias:
      cleanNullableValue(
        form.elements.alergias?.value
      ),
  };
}

function buildPatientFormData(
  payload
) {
  const data =
    new FormData();

  Object.entries(payload)
    .forEach(([key, value]) => {
      if (
        value !== null &&
        value !== undefined
      ) {
        data.append(
          key,
          String(value)
        );
      }
    });

  if (currentPhotoFile) {
    data.append(
      'foto',
      currentPhotoFile,
      currentPhotoFile.name ||
      'foto-paciente.png'
    );
  }

  selectedStudyFiles.forEach(
    (file) => {
      data.append(
        'estudios_archivos[]',
        file,
        file.name ||
        'documento'
      );
    }
  );

  if (currentMode === 'edit') {
    data.append(
      '_method',
      'PUT'
    );
  }

  return data;
}

function hasPatientFiles() {
  return Boolean(
    currentPhotoFile ||
    selectedStudyFiles.length > 0
  );
}

/* =========================================================
   ÉXITO Y ENVÍO
========================================================= */

function showSuccess(message) {
  const modal =
    document.getElementById(
      'patientSuccessModal'
    );

  const title =
    document.getElementById(
      'patientSuccessTitle'
    );

  const text =
    document.getElementById(
      'patientSuccessMessage'
    );

  if (title) {
    title.textContent =
      currentMode === 'edit'
        ? '¡Paciente actualizado!'
        : '¡Paciente registrado!';
  }

  if (text) {
    text.textContent =
      message ||
      'El paciente ha sido guardado correctamente.';
  }

  modal?.classList.add('active');

  modal?.setAttribute(
    'aria-hidden',
    'false'
  );
}

async function submitForm(event) {
  event.preventDefault();

  const form =
    document.getElementById(
      'pacienteForm'
    );

  const button =
    document.getElementById(
      'btnGuardarPaciente'
    );

  const text =
    document.getElementById(
      'patientSubmitText'
    );

  if (!form) {
    return;
  }

  setError('');

  let patientPayload;

  try {
    validateForm(form);

    patientPayload =
      buildPatientPayload(form);
  } catch (error) {
    setError(
      error.message ||
      'Revisa los datos del formulario.'
    );

    return;
  }

  if (
    currentMode === 'edit' &&
    !currentPatientId
  ) {
    setError(
      'No se encontró el ID del paciente.'
    );

    return;
  }

  if (button) {
    button.disabled = true;
  }

  if (text) {
    text.textContent =
      currentMode === 'edit'
        ? 'Guardando cambios...'
        : 'Guardando paciente...';
  }

  try {
    const path =
      currentMode === 'edit'
        ? encodeURIComponent(
            currentPatientId
          )
        : '';

    let requestOptions;

    /*
     * Sin fotografía ni documentos se envía JSON.
     * Esto evita que nombre_completo llegue vacío.
     */
    if (!hasPatientFiles()) {
      requestOptions = {
        method:
          currentMode === 'edit'
            ? 'PUT'
            : 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify(
            patientPayload
          ),
      };
    } else {
      /*
       * Cuando existen archivos se utiliza FormData.
       */
      const formData =
        buildPatientFormData(
          patientPayload
        );

      requestOptions = {
        method: 'POST',
        body: formData,
      };
    }

    console.log(
      'Datos enviados a Laravel:',
      patientPayload
    );

    const responsePayload =
      await request(
        path,
        requestOptions
      );

    const savedPatient =
      responsePayload.paciente ||
      responsePayload.patient ||
      responsePayload.data ||
      null;

    sessionStorage.setItem(
      PATIENTS_REFRESH_STORAGE_KEY,
      String(Date.now())
    );

    sessionStorage.removeItem(
      EDIT_PATIENT_ID_STORAGE_KEY
    );

    document.dispatchEvent(
      new CustomEvent(
        'enclaii:patient-saved',
        {
          detail: {
            patient:
              savedPatient,
          },
        }
      )
    );

    showSuccess(
      responsePayload.message ||
      (
        currentMode === 'edit'
          ? 'Paciente actualizado correctamente.'
          : 'Paciente registrado correctamente.'
      )
    );
  } catch (error) {
    console.error(
      'Error guardando paciente:',
      error
    );

    setError(
      error.message ||
      'No se pudo guardar el paciente.'
    );
  } finally {
    if (button) {
      button.disabled = false;
    }

    if (text) {
      text.textContent =
        currentMode === 'edit'
          ? 'Guardar cambios'
          : 'Guardar paciente';
    }
  }
}

/* =========================================================
   ELIMINAR DOCUMENTO
========================================================= */

async function deleteExistingDocument(
  documentId
) {
  if (
    !currentPatientId ||
    !documentId
  ) {
    return;
  }

  await request(
    `${encodeURIComponent(
      currentPatientId
    )}/documentos/${encodeURIComponent(
      documentId
    )}`,
    {
      method: 'DELETE',
    }
  );

  await loadEdit();
}

/* =========================================================
   EVENTOS
========================================================= */

function bindEvents() {
  patientFormAbortController
    ?.abort();

  patientFormAbortController =
    new AbortController();

  const signal =
    patientFormAbortController
      .signal;

  document
    .querySelectorAll(
      '[data-patient-back]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        navigateBack,
        {
          signal,
        }
      );
    });

  const birthDate =
    document.getElementById(
      'fechaNacimiento'
    );

  birthDate?.addEventListener(
    'input',
    updateAge,
    {
      signal,
    }
  );

  birthDate?.addEventListener(
    'change',
    updateAge,
    {
      signal,
    }
  );

  document
    .querySelectorAll(
      '[data-mini-field]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          openMiniModal(button);
        },
        {
          signal,
        }
      );
    });

  document
    .getElementById(
      'patientMiniCancel'
    )
    ?.addEventListener(
      'click',
      closeMiniModal,
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientMiniConfirm'
    )
    ?.addEventListener(
      'click',
      confirmMiniModal,
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientMiniInput'
    )
    ?.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Enter'
        ) {
          event.preventDefault();
          confirmMiniModal();
        }

        if (
          event.key === 'Escape'
        ) {
          closeMiniModal();
        }
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientMiniModal'
    )
    ?.addEventListener(
      'click',
      (event) => {
        if (
          event.target.id ===
          'patientMiniModal'
        ) {
          closeMiniModal();
        }
      },
      {
        signal,
      }
    );

  const photoInput =
    document.getElementById(
      'inputFileFoto'
    );

  document
    .getElementById(
      'btnAgregarFoto'
    )
    ?.addEventListener(
      'click',
      openPhotoModal,
      {
        signal,
      }
    );

  document
    .getElementById(
      'btnEliminarFoto'
    )
    ?.addEventListener(
      'click',
      async () => {
        const accepted =
          window.confirm(
            '¿Eliminar la fotografía del paciente?'
          );

        if (!accepted) {
          return;
        }

        try {
          await deleteSavedPhoto();
        } catch (error) {
          setError(
            error.message
          );
        }
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientChooseGallery'
    )
    ?.addEventListener(
      'click',
      () => {
        stopCamera();
        photoInput?.click();
      },
      {
        signal,
      }
    );

  photoInput?.addEventListener(
    'change',
    async () => {
      try {
        await selectPhotoFile(
          photoInput.files?.[0] ||
          null
        );
      } catch (error) {
        setError(
          error.message
        );
      }
    },
    {
      signal,
    }
  );

  document
    .getElementById(
      'patientStartCamera'
    )
    ?.addEventListener(
      'click',
      async () => {
        try {
          await startCamera();
        } catch (error) {
          setError(
            error.message
          );
        }
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientTakePhoto'
    )
    ?.addEventListener(
      'click',
      async () => {
        try {
          await captureCameraPhoto();
        } catch (error) {
          setError(
            error.message
          );
        }
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientPhotoCancel'
    )
    ?.addEventListener(
      'click',
      closePhotoModal,
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientPhotoUse'
    )
    ?.addEventListener(
      'click',
      () => {
        if (
          !currentPhotoDataUrl
        ) {
          setError(
            'Selecciona una imagen o toma una fotografía.'
          );

          return;
        }

        showMainPhoto(
          currentPhotoDataUrl
        );

        closePhotoModal();
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientPhotoModal'
    )
    ?.addEventListener(
      'click',
      (event) => {
        if (
          event.target.id ===
          'patientPhotoModal'
        ) {
          closePhotoModal();
        }
      },
      {
        signal,
      }
    );

  const studiesInput =
    document.getElementById(
      'estudiosArchivos'
    );

  document
    .getElementById(
      'patientUploadFiles'
    )
    ?.addEventListener(
      'click',
      () => {
        studiesInput?.click();
      },
      {
        signal,
      }
    );

  studiesInput?.addEventListener(
    'change',
    () => {
      selectedStudyFiles = [
        ...(
          studiesInput.files ||
          []
        ),
      ];

      renderPendingFiles();
    },
    {
      signal,
    }
  );

  document
    .getElementById(
      'estudiosArchivosGrid'
    )
    ?.addEventListener(
      'click',
      (event) => {
        const removeButton =
          event.target.closest(
            '[data-remove-pending-file]'
          );

        if (removeButton) {
          event.stopPropagation();

          const index =
            Number(
              removeButton.dataset
                .removePendingFile
            );

          selectedStudyFiles.splice(
            index,
            1
          );

          renderPendingFiles();

          return;
        }

        const card =
          event.target.closest(
            '[data-pending-file-index]'
          );

        if (!card) {
          return;
        }

        openFileViewer({
          url:
            card.dataset.fileUrl,

          name:
            card.dataset.fileName,

          type:
            card.dataset.fileType,
        });
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientExistingFiles'
    )
    ?.addEventListener(
      'click',
      async (event) => {
        const deleteButton =
          event.target.closest(
            '[data-delete-existing-file]'
          );

        if (deleteButton) {
          event.stopPropagation();

          const accepted =
            window.confirm(
              '¿Eliminar este documento?'
            );

          if (!accepted) {
            return;
          }

          try {
            await deleteExistingDocument(
              deleteButton.dataset
                .deleteExistingFile
            );
          } catch (error) {
            setError(
              error.message
            );
          }

          return;
        }

        const card =
          event.target.closest(
            '[data-existing-file-id]'
          );

        if (!card) {
          return;
        }

        openFileViewer({
          url:
            card.dataset.fileUrl,

          name:
            card.dataset.fileName,

          type:
            card.dataset.fileType,
        });
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientFileViewerClose'
    )
    ?.addEventListener(
      'click',
      closeFileViewer,
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientFileViewer'
    )
    ?.addEventListener(
      'click',
      (event) => {
        if (
          event.target.id ===
          'patientFileViewer'
        ) {
          closeFileViewer();
        }
      },
      {
        signal,
      }
    );

  document
    .getElementById(
      'pacienteForm'
    )
    ?.addEventListener(
      'submit',
      submitForm,
      {
        signal,
      }
    );

  document
    .getElementById(
      'patientSuccessAccept'
    )
    ?.addEventListener(
      'click',
      navigateBack,
      {
        signal,
      }
    );

  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Escape'
      ) {
        return;
      }

      closeMiniModal();
      closePhotoModal();
      closeFileViewer();
    },
    {
      signal,
    }
  );

  document.addEventListener(
    'enclaii:route-before-change',
    () => {
      stopCamera();
    },
    {
      signal,
    }
  );
}

/* =========================================================
   INICIALIZADOR
========================================================= */

export async function initPacienteForm() {
  const root =
    document.getElementById(
      'patientFormPage'
    );

  if (!root) {
    console.error(
      'No se encontró #patientFormPage.'
    );

    return;
  }

  currentMode =
    routeMode();

  root.dataset.mode =
    currentMode;

  selectedStudyFiles = [];
  currentPhotoFile = null;
  currentPhotoDataUrl = '';
  currentPatient = null;
  currentPatientId = null;

  const submitText =
    document.getElementById(
      'patientSubmitText'
    );

  if (submitText) {
    submitText.textContent =
      currentMode === 'edit'
        ? 'Guardar cambios'
        : 'Guardar paciente';
  }

  bindEvents();
  setError('');

  try {
    if (
      currentMode === 'edit'
    ) {
      await loadEdit();
    } else {
      await loadCreate();
    }

    updateAge();
  } catch (error) {
    console.error(
      'Error cargando formulario:',
      error
    );

    setError(
      error.message ||
      'No se pudo cargar el formulario.'
    );
  }
}
