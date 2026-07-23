// Muestra un mensaje de "sección en migración" cuando la ruta
// no está registrada en AVAILABLE (aún no migrada al router).
import { pageContent } from '../state.js';
import { HEAD } from '../config/head.js';
import { escapeHtml } from '../../html.js';

function renderPlaceholder(route) {
  if (!pageContent) {
    return;
  }

  const meta =
    HEAD[route] || {
      title: route,
    };

  pageContent.innerHTML = `
    <div
      class="card rise d1"
      style="
        padding:48px 24px;
        text-align:center;
      "
    >
      <h3
        style="
          margin:0 0 8px;
          color:var(--txt);
        "
      >
        Sección "${escapeHtml(meta.title)}" en migración
      </h3>

      <p
        class="muted"
        style="margin:0;"
      >
        Esta sección todavía no está registrada en el router de Tauri.
      </p>
    </div>
  `;
}

export { renderPlaceholder };
