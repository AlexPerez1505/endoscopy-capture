// Listeners de focus y visibilitychange: cuando la ventana vuelve
// a estar visible y la ruta es "pacientes", sincroniza la lista
// con Laravel para reflejar cambios hechos fuera de la app.
import { currentRoute } from '../utils/current.js';

function setupFocusSync() {
  window.addEventListener(
    'focus',
    () => {
      if (
        currentRoute() === 'pacientes' &&
        typeof window.syncPatientsFromLaravel === 'function'
      ) {
        window
          .syncPatientsFromLaravel({
            force: true,
          })
          .catch((error) => {
            console.error(
              'Error actualizando pacientes:',
              error
            );
          });
      }
    }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState !==
        'visible'
      ) {
        return;
      }

      if (
        currentRoute() === 'pacientes' &&
        typeof window.syncPatientsFromLaravel === 'function'
      ) {
        window
          .syncPatientsFromLaravel({
            force: true,
          })
          .catch((error) => {
            console.error(
              'Error sincronizando pacientes:',
              error
            );
          });
      }
    }
  );
}

export { setupFocusSync };
