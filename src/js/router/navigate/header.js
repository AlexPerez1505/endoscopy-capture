// Actualiza el título y subtítulo del encabezado de la app
// y el document.title según la metadata de HEAD.
import { headTitle, headSub } from '../state.js';
import { HEAD } from '../config/head.js';

function updateHeader(route) {
  const meta =
    HEAD[route] || {
      title: route,
      sub: '',
    };

  if (headTitle) {
    headTitle.textContent =
      meta.title || route;
  }

  if (headSub) {
    headSub.textContent =
      meta.sub || '';
  }

  document.title =
    `${meta.title || 'ENCLAII'} — ENCLAII`;
}

export { updateHeader };
