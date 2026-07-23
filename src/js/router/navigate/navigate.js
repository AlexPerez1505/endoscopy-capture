// Cambia la ruta: si el hash es el mismo recarga directamente,
// si no, actualiza window.location.hash para que hashchange dispare loadPage.
import { normalizeRoute } from '../utils/normalize.js';
import { currentRoute } from '../utils/current.js';
import { loadPage } from '../loader/load-page.js';

function navigate(route) {
  const requestedRoute =
    String(route || 'dashboard')
      .replace(/^#/, '')
      .trim() ||
    'dashboard';

  const normalizedRoute =
    normalizeRoute(requestedRoute);

  const currentHash =
    String(window.location.hash || '')
      .replace(/^#/, '');

  if (
    currentHash === requestedRoute ||
    (!requestedRoute.includes('?') &&
      currentRoute() === normalizedRoute)
  ) {
    loadPage(
      normalizedRoute
    );

    return;
  }

  window.location.hash =
    requestedRoute;
}

export { navigate };
