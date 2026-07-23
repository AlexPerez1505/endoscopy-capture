// Listener global de clics en elementos [data-nav]: llama a
// navigate() con el valor de data-nav para cambiar de ruta.
import { navigate } from '../navigate/navigate.js';

function setupDataNavClick() {
  document.addEventListener(
    'click',
    (event) => {
      const element =
        event.target.closest(
          '[data-nav]'
        );

      if (!element) {
        return;
      }

      event.preventDefault();

      const route =
        element.dataset.nav;

      if (!route) {
        return;
      }

      navigate(route);
    }
  );
}

export { setupDataNavClick };
