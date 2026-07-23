// Muestra un mensaje de error en #pageContent cuando falla el
// fetch del HTML, con un botón "Reintentar" que vuelve a llamar loadPage.
import { pageContent } from '../state.js';
import { PAGE_FILES } from '../config/routes.js';
import { escapeHtml } from '../../html.js';
import { loadPage } from '../loader/load-page.js';

function renderError(route, error) {
  if (!pageContent) {
    return;
  }

  const file =
    PAGE_FILES[route] ||
    `./pages/${route}.html`;

  pageContent.innerHTML = `
    <div
      class="card rise d1"
      style="
        padding:30px;
      "
    >
      <h3
        style="
          margin:0 0 10px;
          color:var(--txt);
        "
      >
        No se pudo cargar la sección
      </h3>

      <p
        class="muted"
        style="
          margin:0 0 14px;
          line-height:1.6;
        "
      >
        ${escapeHtml(
          error?.message ||
          'Ocurrió un error desconocido.'
        )}
      </p>

      <div
        style="
          padding:11px 13px;
          background:var(--panel-2);
          border:1px solid var(--stroke);
          border-radius:9px;
          color:var(--txt-soft);
          font-family:monospace;
          font-size:11px;
          word-break:break-all;
        "
      >
        Archivo buscado:
        ${escapeHtml(file)}
      </div>

      <button
        type="button"
        id="routerRetryButton"
        style="
          margin-top:16px;
          padding:10px 16px;
          background:rgba(56,199,244,.1);
          border:1px solid var(--cyan);
          border-radius:9px;
          color:var(--cyan);
          font:inherit;
          font-size:12px;
          font-weight:700;
          cursor:pointer;
        "
      >
        Reintentar
      </button>
    </div>
  `;

  document
    .getElementById('routerRetryButton')
    ?.addEventListener(
      'click',
      () => {
        loadPage(route);
      }
    );
}

export { renderError };
