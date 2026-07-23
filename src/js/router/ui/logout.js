// Cierre de sesión: detiene la sincronización de pacientes, limpia
// el token y todas las claves de sessionStorage/localStorage y
// redirige a login.html.
import { clearAuthToken } from '../../auth.js';
import {
  ACCOUNT_NAME_STORAGE_KEY,
  ACCOUNT_ROLE_STORAGE_KEY,
  DEVICE_TOKEN_STORAGE_KEY,
  DEVICE_SESSION_STORAGE_KEY,
  EDIT_PATIENT_ID_STORAGE_KEY,
  PATIENTS_REFRESH_STORAGE_KEY,
} from '../../storage-keys.js';

function setupLogout() {
  const logoutBtn =
    document.getElementById(
      'logoutBtn'
    );

  if (logoutBtn) {
    logoutBtn.addEventListener(
      'click',
      () => {
        if (
          typeof window
            .stopPatientsRealtimeSync ===
          'function'
        ) {
          window
            .stopPatientsRealtimeSync();
        }

        clearAuthToken();

        sessionStorage.removeItem(
          ACCOUNT_NAME_STORAGE_KEY
        );

        localStorage.removeItem(
          ACCOUNT_NAME_STORAGE_KEY
        );

        sessionStorage.removeItem(
          ACCOUNT_ROLE_STORAGE_KEY
        );

        localStorage.removeItem(
          ACCOUNT_ROLE_STORAGE_KEY
        );

        sessionStorage.removeItem(
          DEVICE_TOKEN_STORAGE_KEY
        );

        sessionStorage.removeItem(
          DEVICE_SESSION_STORAGE_KEY
        );

        sessionStorage.removeItem(
          EDIT_PATIENT_ID_STORAGE_KEY
        );

        sessionStorage.removeItem(
          PATIENTS_REFRESH_STORAGE_KEY
        );

        window.location.href =
          './login.html';
      }
    );
  }
}

export { setupLogout };
