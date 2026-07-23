// Marca el ítem del sidebar como activo según la ruta actual,
// usando navRouteFor para resolver sub-rutas a su padre.
import { navRouteFor } from '../config/nav-map.js';

function setActiveNav(route) {
  const activeRoute =
    navRouteFor(route);

  document
    .querySelectorAll('.nav-item')
    .forEach((element) => {
      element.classList.toggle(
        'active',
        element.dataset.nav === activeRoute
      );
    });
}

export { setActiveNav };
