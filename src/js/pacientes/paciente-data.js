import {
  EDIT_PATIENT_ID_STORAGE_KEY,
} from '../storage-keys.js';
import { state } from './state.js';
import { request } from './api.js';
import { setField } from './utils.js';
import { extractFolio, updateFolio } from './folio.js';
import { showMainPhoto } from './foto.js';
import { renderExistingFiles } from './archivos.js';
import { updateAge } from './edad.js';

function fillPatient(
  patient = {}
) {
  state.currentPatient = patient;

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

  state.currentPhotoDataUrl =
    patient.foto_url || '';

  showMainPhoto(
    state.currentPhotoDataUrl
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
      'Laravel no devolvió el folio del nuevo paciente.'
    );
  }

  updateFolio(folio);

  state.currentPatient = null;
  state.currentPatientId = null;
}

async function loadEdit() {
  state.currentPatientId =
    sessionStorage.getItem(
      EDIT_PATIENT_ID_STORAGE_KEY
    );

  if (!state.currentPatientId) {
    throw new Error(
      'No se encontró el paciente que deseas editar.'
    );
  }

  const payload =
    await request(
      `${encodeURIComponent(
        state.currentPatientId
      )}/edit`
    );

  const patient =
    payload.paciente ||
    payload.patient ||
    payload.data ||
    {};

  fillPatient(patient);
}

export {
  fillPatient,
  loadCreate,
  loadEdit,
};
