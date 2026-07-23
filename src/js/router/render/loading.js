// Inyecta un spinner de carga en #pageContent mientras se
// obtiene el HTML de la ruta solicitada.
import { pageContent } from '../state.js';
import { HEAD } from '../config/head.js';
import { escapeHtml } from '../../html.js';

function renderLoading(route) {
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
        min-height:260px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:12px;
        padding:48px 24px;
        text-align:center;
      "
    >
      <div
        style="
          width:34px;
          height:34px;
          border:3px solid rgba(56,199,244,.2);
          border-top-color:var(--cyan, #38c7f4);
          border-radius:50%;
          animation:routerSpin .8s linear infinite;
        "
      ></div>

      <strong
        style="
          color:var(--txt);
          font-size:14px;
        "
      >
        Cargando ${escapeHtml(meta.title)}...
      </strong>
    </div>

    <style>
      @keyframes routerSpin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  `;
}

export { renderLoading };
