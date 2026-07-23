// Listener del evento "enclaii:patient-saved": guarda un timestamp
// en sessionStorage para que la lista de pacientes sepa que debe
// recargar al volver a esa sección.
import {
  PATIENTS_REFRESH_STORAGE_KEY,
} from '../../storage-keys.js';

function setupPatientSavedListener() {
  document.addEventListener(
    'enclaii:patient-saved',
    () => {
      sessionStorage.setItem(
        PATIENTS_REFRESH_STORAGE_KEY,
        String(Date.now())
      );
    }
  );
}

export { setupPatientSavedListener };
