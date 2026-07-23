import {
  EDIT_PATIENT_ID_STORAGE_KEY,
} from '../storage-keys.js';
import { state } from './state.js';
import { stopCamera } from './foto.js';

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

export {
  setError,
  setField,
  navigateBack,
  routeMode,
  cleanNullableValue,
};
