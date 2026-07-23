import { escapeHtml } from '../html.js';
import { state } from './state.js';

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
    state.selectedStudyFiles.length > 0
  );

  grid.innerHTML =
    state.selectedStudyFiles
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

export {
  formatBytes,
  fileType,
  fileIcon,
  openFileViewer,
  closeFileViewer,
  renderPendingFiles,
  renderExistingFiles,
};
