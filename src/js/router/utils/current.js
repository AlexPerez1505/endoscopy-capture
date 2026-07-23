// Devuelve la ruta actual leyendo window.location.hash.
// Usa normalizeRoute para limpiar el valor.
import { normalizeRoute } from '../utils/normalize.js';

function currentRoute() {
  return normalizeRoute(
    window.location.hash ||
    '#dashboard'
  );
}

export { currentRoute };
