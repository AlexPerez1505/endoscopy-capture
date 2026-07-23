import {
  EDIT_PATIENT_ID_STORAGE_KEY,
  PATIENTS_REFRESH_STORAGE_KEY,
} from '../storage-keys.js';
import { state } from './state.js';
import { request } from './api.js';
import { setError } from './utils.js';
import {
  validateForm,
  buildPatientPayload,
  buildPatientFormData,
  hasPatientFiles,
} from './validacion.js';
import { loadEdit } from './paciente-data.js';

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
      state.currentMode === 'edit'
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
    state.currentMode === 'edit' &&
    !state.currentPatientId
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
      state.currentMode === 'edit'
        ? 'Guardando cambios...'
        : 'Guardando paciente...';
  }

  try {
    const path =
      state.currentMode === 'edit'
        ? encodeURIComponent(
            state.currentPatientId
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
          state.currentMode === 'edit'
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
        state.currentMode === 'edit'
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
        state.currentMode === 'edit'
          ? 'Guardar cambios'
          : 'Guardar paciente';
    }
  }
}

async function deleteExistingDocument(
  documentId
) {
  if (
    !state.currentPatientId ||
    !documentId
  ) {
    return;
  }

  await request(
    `${encodeURIComponent(
      state.currentPatientId
    )}/documentos/${encodeURIComponent(
      documentId
    )}`,
    {
      method: 'DELETE',
    }
  );

  await loadEdit();
}

export {
  showSuccess,
  submitForm,
  deleteExistingDocument,
};
