// Núcleo del router: hace fetch del HTML de la ruta, gestiona el
// AbortController para cancelar cargas anteriores, inyecta el HTML
// en #pageContent y dispara el inicializador del módulo correspondiente.
import { pageContent } from '../state.js';
import {
  getCurrentLoadingRoute,
  setCurrentLoadingRoute,
  getCurrentPageAbortController,
  setCurrentPageAbortController,
} from '../state.js';
import { normalizeRoute } from '../utils/normalize.js';
import { cleanupModules } from './cleanup.js';
import { initializeRoute } from './initialize.js';
import { updateHeader } from '../navigate/header.js';
import { setActiveNav } from '../navigate/nav-active.js';
import { AVAILABLE, PAGE_FILES } from '../config/routes.js';
import { renderLoading } from '../render/loading.js';
import { renderPlaceholder } from '../render/placeholder.js';
import { renderError } from '../render/error.js';

async function loadPage(route) {
  const normalizedRoute =
    normalizeRoute(route);

  getCurrentPageAbortController()?.abort();

  const pageAbortController =
    new AbortController();

  setCurrentPageAbortController(
    pageAbortController
  );

  cleanupModules(
    normalizedRoute
  );

  updateHeader(
    normalizedRoute
  );

  document.body.dataset.route =
    normalizedRoute;

  setActiveNav(
    normalizedRoute
  );

  if (
    normalizedRoute ===
    'nuevo-estudio'
  ) {
    window.location.href =
      './index.html';

    return;
  }

  if (
    !AVAILABLE.has(normalizedRoute)
  ) {
    renderPlaceholder(
      normalizedRoute
    );

    return;
  }

  if (!pageContent) {
    console.error(
      'No se encontró el contenedor #pageContent.'
    );

    return;
  }

  setCurrentLoadingRoute(
    normalizedRoute
  );

  renderLoading(
    normalizedRoute
  );

  try {
    const pageUrl =
      PAGE_FILES[normalizedRoute];

    if (!pageUrl) {
      throw new Error(
        `No existe archivo configurado para la ruta ${normalizedRoute}.`
      );
    }

    const response =
      await fetch(pageUrl, {
        method: 'GET',
        cache: 'no-store',
      });

    if (!response.ok) {
      throw new Error(
        `No se pudo abrir ${pageUrl}. HTTP ${response.status}.`
      );
    }

    const html =
      await response.text();

    if (
      getCurrentLoadingRoute() !==
      normalizedRoute
    ) {
      return;
    }

    pageContent.innerHTML =
      html;

    await initializeRoute(
      normalizedRoute,
      pageAbortController.signal
    );

    document.dispatchEvent(
      new CustomEvent(
        'enclaii:route-loaded',
        {
          detail: {
            route:
              normalizedRoute,

            pageUrl,
          },
        }
      )
    );
  } catch (error) {
    console.error(
      `Error cargando ${normalizedRoute}:`,
      error
    );

    renderError(
      normalizedRoute,
      error
    );
  }
}

export { loadPage };
