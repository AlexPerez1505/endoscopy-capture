// Expone funciones del router en window (enclaiiNavigate y
// enclaiiReloadCurrentRoute) para que otros módulos puedan navegar
// o recargar la ruta actual sin importar el router directamente.
import { navigate } from './navigate/navigate.js';
import { loadPage } from './loader/load-page.js';
import { currentRoute } from './utils/current.js';

function setupGlobals() {
  window.enclaiiNavigate =
    navigate;

  window.enclaiiReloadCurrentRoute =
    () => {
      loadPage(
        currentRoute()
      );
    };
}

export { setupGlobals };
