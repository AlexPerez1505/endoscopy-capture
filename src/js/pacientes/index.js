import { state } from './state.js';
import { setError, navigateBack, routeMode } from './utils.js';
import { updateAge } from './edad.js';
import {
  openPhotoModal,
  closePhotoModal,
  stopCamera,
  selectPhotoFile,
  startCamera,
  captureCameraPhoto,
  deleteSavedPhoto,
  showMainPhoto,
} from './foto.js';
import {
  openMiniModal,
  closeMiniModal,
  confirmMiniModal,
} from './mini-modal.js';
import {
  openFileViewer,
  closeFileViewer,
  renderPendingFiles,
} from './archivos.js';
import { loadCreate, loadEdit } from './paciente-data.js';
import { submitForm, deleteExistingDocument } from './submit.js';

function bindEvents() {
  state.patientFormAbortController
    ?.abort();

  state.patientFormAbortController =
    new AbortController();

  const signal =
    state.patientFormAbortController
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
          !state.currentPhotoDataUrl
        ) {
          setError(
            'Selecciona una imagen o toma una fotografía.'
          );

          return;
        }

        showMainPhoto(
          state.currentPhotoDataUrl
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
      state.selectedStudyFiles = [
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

          state.selectedStudyFiles.splice(
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

  const medicalPlaceholder =
    root.querySelector(
      '#medicalFormPlaceholder'
    );

  if (medicalPlaceholder) {
    try {
      const response =
        await fetch(
          './pages/pacientes/form-Infor-Med.html',
          {
            cache: 'no-store',
          }
        );

      if (response.ok) {
        const html =
          await response.text();

        medicalPlaceholder.insertAdjacentHTML(
          'beforebegin',
          html
        );

        medicalPlaceholder.remove();
      } else {
        console.error(
          'No se pudo cargar form-Infor-Med.html.'
        );
      }
    } catch (error) {
      console.error(
        'Error cargando form-Infor-Med.html:',
        error
      );
    }
  }

  const photoColPlaceholder =
    root.querySelector(
      '#photoColPlaceholder'
    );

  const photoModalPlaceholder =
    root.querySelector(
      '#photoModalPlaceholder'
    );

  if (
    photoColPlaceholder ||
    photoModalPlaceholder
  ) {
    try {
      const response =
        await fetch(
          './pages/pacientes/form-cap-pac.html',
          {
            cache: 'no-store',
          }
        );

      if (response.ok) {
        const html =
          await response.text();

        const temp =
          document.createElement(
            'div'
          );

        temp.innerHTML = html;

        const photoCol =
          temp.querySelector(
            '.personal-photo-col'
          );

        const photoModal =
          temp.querySelector(
            '#patientPhotoModal'
          );

        if (
          photoCol &&
          photoColPlaceholder
        ) {
          photoColPlaceholder.replaceWith(
            photoCol
          );
        }

        if (
          photoModal &&
          photoModalPlaceholder
        ) {
          photoModalPlaceholder.replaceWith(
            photoModal
          );
        }
      } else {
        console.error(
          'No se pudo cargar form-cap-pac.html.'
        );
      }
    } catch (error) {
      console.error(
        'Error cargando form-cap-pac.html:',
        error
      );
    }
  }

  state.currentMode =
    routeMode();

  root.dataset.mode =
    state.currentMode;

  state.selectedStudyFiles = [];
  state.currentPhotoFile = null;
  state.currentPhotoDataUrl = '';
  state.currentPatient = null;
  state.currentPatientId = null;

  const submitText =
    document.getElementById(
      'patientSubmitText'
    );

  if (submitText) {
    submitText.textContent =
      state.currentMode === 'edit'
        ? 'Guardar cambios'
        : 'Guardar paciente';
  }

  bindEvents();
  setError('');

  try {
    if (
      state.currentMode === 'edit'
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
