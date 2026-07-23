// Listener de hashchange: cuando cambia el hash de la URL,
// dispara loadPage con la nueva ruta actual.
import { loadPage } from '../loader/load-page.js';
import { currentRoute } from '../utils/current.js';

function setupHashChange() {
  window.addEventListener(
    'hashchange',
    () => {
      loadPage(
        currentRoute()
      );
    }
  );
}

export { setupHashChange };
