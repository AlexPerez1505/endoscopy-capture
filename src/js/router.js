// ================= Router SPA de ENCLAII =================
// Carga fragmentos HTML desde ./pages y ejecuta
// el inicializador correspondiente a cada sección.

import { initDashboard } from './dashboard.js';
import { initPacientes } from './pacientes.js';
import { initPacienteForm } from './pacientes-form.js';
import { initAgenda } from './agenda/index.js';
import {
  initReports,
  initReportEditor,
} from './reports.js';
import { initGaleria } from './galeria.js';
import { initMensajes } from './mensajes.js';
import { initQr } from './qr.js';
import { initConfiguracion } from './configuracion.js';

/* =========================================================
   AUTENTICACIÓN
========================================================= */

const AUTH_STORAGE_KEY =
  'enclaii-tauri-basic-auth';

const authToken =
  sessionStorage.getItem(AUTH_STORAGE_KEY) ||
  localStorage.getItem(AUTH_STORAGE_KEY);

if (!authToken) {
  window.location.href = './login.html';

  throw new Error(
    'Sin sesión activa, redirigiendo a login.'
  );
}

/* =========================================================
   ENCABEZADOS
========================================================= */

const HEAD = {
  dashboard: {
    title: 'Dashboard',
    sub: 'Resumen general de tu actividad clínica',
  },

  agenda: {
    title: 'Agenda',
    sub: 'Gestiona tus citas y estudios',
  },

  pacientes: {
    title: 'Pacientes',
    sub: 'Expedientes y datos clínicos',
  },

  'pacientes-crear': {
    title: 'Nuevo paciente',
    sub: 'Registra la información del nuevo paciente',
  },

  'pacientes-editar': {
    title: 'Editar paciente',
    sub: 'Actualiza la información del expediente',
  },

  qr: {
    title: 'Pre-registro QR',
    sub: 'Genera códigos seguros y recibe los datos del paciente antes de su cita',
  },

  'ia-reportes': {
    title: 'Reportes',
    sub: 'Genera, analiza y revisa reportes inteligentes impulsados por IA',
  },

  'ia-reportes-redactar': {
    title: 'Reporte',
    sub: 'Redacta y estructura el informe clínico',
  },

  mensajes: {
    title: 'Mensajes',
    sub: 'Gestiona tus conversaciones con pacientes',
  },

  galeria: {
    title: 'Galería de pacientes',
    sub: 'Consulta y administra imágenes y videos de estudios',
  },

  configuracion: {
    title: 'Configuración',
    sub: 'Personaliza tu experiencia y gestiona los ajustes de tu cuenta y sistema',
  },
};

/* =========================================================
   RUTAS DISPONIBLES
========================================================= */

const AVAILABLE = new Set([
  'dashboard',
  'agenda',
  'pacientes',
  'pacientes-crear',
  'pacientes-editar',
  'qr',
  'ia-reportes',
  'ia-reportes-redactar',
  'galeria',
  'mensajes',
  'configuracion',
]);

/* =========================================================
   ARCHIVOS HTML
========================================================= */

/*
 * Debes tener esta estructura:
 *
 * src/pages/pacientes.html
 * src/pages/pacientes/form.html
 *
 * Crear y editar usan el mismo archivo form.html.
 */
const PAGE_FILES = {
  dashboard:
    './pages/dashboard.html',

  agenda:
    './pages/agenda_html/index.blade.html',

  pacientes:
    './pages/pacientes.html',

  'pacientes-crear':
    './pages/pacientes/form.html',

  'pacientes-editar':
    './pages/pacientes/form.html',

  qr:
    './pages/qr.html',

  'ia-reportes':
    './pages/ia-reportes.html',

  'ia-reportes-redactar':
    './pages/ia-reportes-redactar.html',

  galeria:
    './pages/galeria.html',

  mensajes:
    './pages/mensajes.html',

  configuracion:
    './pages/configuracion.html',
};

/* =========================================================
   ELEMENTOS
========================================================= */

const pageContent =
  document.getElementById('pageContent');

const headTitle =
  document.getElementById('headTitle');

const headSub =
  document.getElementById('headSub');

let currentLoadingRoute = null;

/* =========================================================
   UTILIDADES
========================================================= */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeRoute(route) {
  const normalized = String(
    route || 'dashboard'
  )
    .replace(/^#/, '')
    .split('?')[0]
    .trim();

  return normalized || 'dashboard';
}

function currentRoute() {
  return normalizeRoute(
    window.location.hash ||
    '#dashboard'
  );
}

function navRouteFor(route) {
  if (
    route === 'pacientes-crear' ||
    route === 'pacientes-editar'
  ) {
    return 'pacientes';
  }

  if (
    route === 'ia-reportes-redactar'
  ) {
    return 'ia-reportes';
  }

  return route;
}

/* =========================================================
   MENÚ ACTIVO
========================================================= */

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

/* =========================================================
   ENCABEZADO
========================================================= */

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

/* =========================================================
   ESTADO DE CARGA
========================================================= */

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

/* =========================================================
   PLACEHOLDER
========================================================= */

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

/* =========================================================
   ERROR
========================================================= */

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

/* =========================================================
   INICIALIZAR CADA PÁGINA
========================================================= */

async function initializeRoute(route) {
  switch (route) {
    case 'dashboard':
      await initDashboard();
      break;

    case 'pacientes':
      await initPacientes();
      break;

    case 'pacientes-crear':
    case 'pacientes-editar':
      await initPacienteForm();
      break;

    case 'agenda':
      await initAgenda();
      break;

    case 'qr':
      await initQr();
      break;

    case 'ia-reportes':
      await initReports();
      break;

    case 'ia-reportes-redactar':
      await initReportEditor();
      break;

    case 'galeria':
      await initGaleria();
      break;

    case 'mensajes':
      await initMensajes();
      break;

    case 'configuracion':
      await initConfiguracion();
      break;

    default:
      break;
  }
}

/* =========================================================
   LIMPIAR MÓDULOS
========================================================= */

function cleanupModules(nextRoute) {
  /*
   * Detiene el intervalo del listado de pacientes,
   * solo si la función global existe.
   */
  if (
    nextRoute !== 'pacientes' &&
    typeof window.stopPatientsRealtimeSync === 'function'
  ) {
    window.stopPatientsRealtimeSync();
  }

  document.dispatchEvent(
    new CustomEvent(
      'enclaii:route-before-change',
      {
        detail: {
          to: nextRoute,
        },
      }
    )
  );
}

/* =========================================================
   CARGAR PÁGINA
========================================================= */

async function loadPage(route) {
  const normalizedRoute =
    normalizeRoute(route);

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

  currentLoadingRoute =
    normalizedRoute;

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

    /*
     * Si el usuario cambió de pantalla antes de terminar,
     * no sobrescribimos la ruta nueva.
     */
    if (
      currentLoadingRoute !==
      normalizedRoute
    ) {
      return;
    }

    pageContent.innerHTML =
      html;

    await initializeRoute(
      normalizedRoute
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

/* =========================================================
   NAVEGAR
========================================================= */

function navigate(route) {
  const normalizedRoute =
    normalizeRoute(route);

  if (
    currentRoute() === normalizedRoute
  ) {
    loadPage(
      normalizedRoute
    );

    return;
  }

  window.location.hash =
    normalizedRoute;
}

/* =========================================================
   CLICS CON DATA-NAV
========================================================= */

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

/* =========================================================
   CAMBIO DE HASH
========================================================= */

window.addEventListener(
  'hashchange',
  () => {
    loadPage(
      currentRoute()
    );
  }
);

/* =========================================================
   ACTUALIZAR PACIENTES AL VOLVER
========================================================= */

window.addEventListener(
  'focus',
  () => {
    if (
      currentRoute() === 'pacientes' &&
      typeof window.syncPatientsFromLaravel === 'function'
    ) {
      window
        .syncPatientsFromLaravel({
          force: true,
        })
        .catch((error) => {
          console.error(
            'Error actualizando pacientes:',
            error
          );
        });
    }
  }
);

document.addEventListener(
  'visibilitychange',
  () => {
    if (
      document.visibilityState !==
      'visible'
    ) {
      return;
    }

    if (
      currentRoute() === 'pacientes' &&
      typeof window.syncPatientsFromLaravel === 'function'
    ) {
      window
        .syncPatientsFromLaravel({
          force: true,
        })
        .catch((error) => {
          console.error(
            'Error sincronizando pacientes:',
            error
          );
        });
    }
  }
);

/* =========================================================
   EVENTO DE PACIENTE GUARDADO
========================================================= */

document.addEventListener(
  'enclaii:patient-saved',
  () => {
    sessionStorage.setItem(
      'enclaii-patients-refresh',
      String(Date.now())
    );
  }
);

/* =========================================================
   TEMA
========================================================= */

const themeToggle =
  document.getElementById(
    'themeToggle'
  );

if (themeToggle) {
  themeToggle.addEventListener(
    'click',
    () => {
      const currentTheme =
        document.documentElement
          .dataset.theme ||
        'dark';

      const nextTheme =
        currentTheme === 'light'
          ? 'dark'
          : 'light';

      document.documentElement
        .dataset.theme =
        nextTheme;

      localStorage.setItem(
        'enclaii-theme',
        nextTheme
      );
    }
  );
}

/* =========================================================
   PERFIL
========================================================= */

const profileMenu =
  document.getElementById(
    'profileMenu'
  );

const logoutBtn =
  document.getElementById(
    'logoutBtn'
  );

if (profileMenu) {
  profileMenu.addEventListener(
    'click',
    (event) => {
      if (
        event.target.closest(
          '#logoutBtn'
        )
      ) {
        return;
      }

      const isOpen =
        profileMenu.classList.toggle(
          'open'
        );

      profileMenu.setAttribute(
        'aria-expanded',
        isOpen
          ? 'true'
          : 'false'
      );
    }
  );

  document.addEventListener(
    'click',
    (event) => {
      if (
        !profileMenu.contains(
          event.target
        )
      ) {
        profileMenu.classList.remove(
          'open'
        );

        profileMenu.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape'
      ) {
        profileMenu.classList.remove(
          'open'
        );

        profileMenu.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    }
  );
}

/* =========================================================
   RESTAURAR PERFIL
========================================================= */

function restoreHeaderProfile() {
  if (!profileMenu) {
    return;
  }

  const accountName =
    sessionStorage.getItem(
      'enclaii-account-name'
    ) ||
    localStorage.getItem(
      'enclaii-account-name'
    ) ||
    'Doctor';

  const accountRole =
    sessionStorage.getItem(
      'enclaii-account-role'
    ) ||
    localStorage.getItem(
      'enclaii-account-role'
    ) ||
    'Médico';

  const nameElement =
    profileMenu.querySelector(
      'strong'
    );

  const roleElement =
    profileMenu.querySelector(
      '.profile > div > span'
    ) ||
    profileMenu.querySelector(
      'div > span:not(.avatar)'
    );

  const avatar =
    profileMenu.querySelector(
      '.avatar'
    );

  if (nameElement) {
    nameElement.textContent =
      accountName;
  }

  if (roleElement) {
    roleElement.textContent =
      accountRole;
  }

  if (avatar) {
    const parts =
      accountName
        .split(/\s+/)
        .filter(Boolean);

    if (parts.length > 1) {
      avatar.textContent =
        `${parts[0][0]}${parts[1][0]}`
          .toUpperCase();
    } else {
      avatar.textContent =
        accountName
          .slice(0, 2)
          .toUpperCase();
    }
  }
}

/* =========================================================
   CERRAR SESIÓN
========================================================= */

if (logoutBtn) {
  logoutBtn.addEventListener(
    'click',
    () => {
      if (
        typeof window
          .stopPatientsRealtimeSync ===
        'function'
      ) {
        window
          .stopPatientsRealtimeSync();
      }

      sessionStorage.removeItem(
        AUTH_STORAGE_KEY
      );

      localStorage.removeItem(
        AUTH_STORAGE_KEY
      );

      sessionStorage.removeItem(
        'enclaii-account-name'
      );

      localStorage.removeItem(
        'enclaii-account-name'
      );

      sessionStorage.removeItem(
        'enclaii-account-role'
      );

      localStorage.removeItem(
        'enclaii-account-role'
      );

      sessionStorage.removeItem(
        'enclaii-device-token'
      );

      sessionStorage.removeItem(
        'enclaii-device-session-id'
      );

      sessionStorage.removeItem(
        'enclaii-edit-patient-id'
      );

      sessionStorage.removeItem(
        'enclaii-patients-refresh'
      );

      window.location.href =
        './login.html';
    }
  );
}

/* =========================================================
   FUNCIONES GLOBALES
========================================================= */

window.enclaiiNavigate =
  navigate;

window.enclaiiReloadCurrentRoute =
  () => {
    loadPage(
      currentRoute()
    );
  };

/* =========================================================
   ARRANQUE
========================================================= */

restoreHeaderProfile();

loadPage(
  currentRoute()
);