// ================= Router SPA de ENCLAII =================
// Carga fragmentos HTML desde ./pages y ejecuta
// el inicializador correspondiente a cada sección.

import { initDashboard } from './dashboard.js';
import { initPacientes } from './pacientes.js';
import { initPacienteForm } from './pacientes-form.js';
import { initAgenda } from './agenda/index.js';
import { initAgendar } from './agenda/agendar/index.js';

import {
  initReports,
  initReportEditor,
} from './reports.js';

import { initGaleria } from './galeria.js';
import { initMensajes } from './mensajes.js';
import { initQr } from './qr.js';
import { initConfiguracion } from './configuracion.js';

import {
  clearAuthToken,
  getAuthToken,
} from './auth.js';

import { escapeHtml } from './html.js';

import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from './laravel.js';

import {
  THEME_STORAGE_KEY,
  ACCOUNT_NAME_STORAGE_KEY,
  ACCOUNT_ROLE_STORAGE_KEY,
  ACCOUNT_PHOTO_URL_STORAGE_KEY,
  DEVICE_TOKEN_STORAGE_KEY,
  DEVICE_SESSION_STORAGE_KEY,
  EDIT_PATIENT_ID_STORAGE_KEY,
  PATIENTS_REFRESH_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from './storage-keys.js';

/* =========================================================
   AUTENTICACIÓN
========================================================= */

const authToken = getAuthToken();

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

  agendar: {
    title: 'Agendar cita',
    sub: 'Programa una nueva cita o reprograma una existente',
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

  /*
   * Esta ruta no se carga dentro del router.
   * Únicamente sirve para mostrar un título correcto
   * durante la redirección hacia index.html.
   */
  'nuevo-estudio': {
    title: 'Iniciar estudio',
    sub: 'Captura imágenes y video del procedimiento endoscópico',
  },
};

/* =========================================================
   RUTAS DISPONIBLES
========================================================= */

/*
 * nuevo-estudio NO se agrega aquí porque no es una página
 * interna de app.html. Su pantalla vive en index.html.
 */
const AVAILABLE = new Set([
  'dashboard',
  'agenda',
  'agendar',
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
 *
 * La captura de endoscopia NO está aquí.
 * Esa pantalla vive directamente en:
 *
 * src/index.html
 */
const PAGE_FILES = {
  dashboard:
    './pages/dashboard.html',

  agenda:
    './pages/agenda_html/index.blade.html',

  agendar:
    './pages/agenda_html/agendar/index.blade.html',

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

/*
 * Controlador de aborto de la página activa.
 *
 * Cada llamada a loadPage() cancela el anterior antes
 * de crear uno nuevo y lo pasa a initializeRoute().
 */
let currentPageAbortController = null;

/* =========================================================
   UTILIDADES
========================================================= */

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

  if (route === 'agendar') {
    return 'agenda';
  }

  if (
    route ===
    'ia-reportes-redactar'
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
    .getElementById(
      'routerRetryButton'
    )
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

async function initializeRoute(
  route,
  signal
) {
  switch (route) {
    case 'dashboard':
      await initDashboard({
        signal,
      });
      break;

    case 'pacientes':
      await initPacientes({
        signal,
      });
      break;

    case 'pacientes-crear':
    case 'pacientes-editar':
      await initPacienteForm({
        signal,
      });
      break;

    case 'agenda':
      await initAgenda({
        signal,
      });
      break;

    case 'agendar':
      await initAgendar({
        signal,
      });
      break;

    case 'qr':
      await initQr({
        signal,
      });
      break;

    case 'ia-reportes':
      await initReports({
        signal,
      });
      break;

    case 'ia-reportes-redactar':
      await initReportEditor({
        signal,
      });
      break;

    case 'galeria':
      await initGaleria({
        signal,
      });
      break;

    case 'mensajes':
      await initMensajes({
        signal,
      });
      break;

    case 'configuracion':
      await initConfiguracion({
        signal,
      });
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
    typeof window
      .stopPatientsRealtimeSync ===
      'function'
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

  /*
   * La captura de endoscopia vive en index.html.
   *
   * No se carga como fragmento dentro de app.html
   * porque contiene su propio main.js, cámara,
   * capturador y estructura independiente.
   */
  if (
    normalizedRoute ===
    'nuevo-estudio'
  ) {
    window.location.href =
      './index.html';

    return;
  }

  currentPageAbortController?.abort();

  const pageAbortController =
    new AbortController();

  currentPageAbortController =
    pageAbortController;

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
    !AVAILABLE.has(
      normalizedRoute
    )
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
      PAGE_FILES[
        normalizedRoute
      ];

    if (!pageUrl) {
      throw new Error(
        `No existe archivo configurado para la ruta ${normalizedRoute}.`
      );
    }

    const response =
      await fetch(
        pageUrl,
        {
          method: 'GET',
          cache: 'no-store',
        }
      );

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
      normalizedRoute,
      pageAbortController.signal
    );

    if (
      pageAbortController.signal.aborted
    ) {
      return;
    }

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
    if (
      pageAbortController.signal.aborted
    ) {
      return;
    }

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
  const requestedRoute =
    String(
      route ||
      'dashboard'
    )
      .replace(/^#/, '')
      .trim() ||
    'dashboard';

  const normalizedRoute =
    normalizeRoute(
      requestedRoute
    );

  /*
   * Nuevo estudio vive en index.html.
   *
   * Se redirige inmediatamente para evitar primero
   * modificar el hash de app.html.
   */
  if (
    normalizedRoute ===
    'nuevo-estudio'
  ) {
    window.location.href =
      './index.html';

    return;
  }

  const currentHash =
    String(
      window.location.hash ||
      ''
    )
      .replace(/^#/, '');

  if (
    currentHash ===
      requestedRoute ||
    (
      !requestedRoute.includes('?') &&
      currentRoute() ===
        normalizedRoute
    )
  ) {
    loadPage(
      normalizedRoute
    );

    return;
  }

  window.location.hash =
    requestedRoute;
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
      currentRoute() ===
        'pacientes' &&
      typeof window
        .syncPatientsFromLaravel ===
        'function'
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
      currentRoute() ===
        'pacientes' &&
      typeof window
        .syncPatientsFromLaravel ===
        'function'
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
      PATIENTS_REFRESH_STORAGE_KEY,
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
        document
          .documentElement
          .dataset.theme ||
        'dark';

      const nextTheme =
        currentTheme ===
        'light'
          ? 'dark'
          : 'light';

      document
        .documentElement
        .dataset.theme =
        nextTheme;

      localStorage.setItem(
        THEME_STORAGE_KEY,
        nextTheme
      );
    }
  );
}

/* =========================================================
   SIDEBAR
   Contraer / expandir
========================================================= */

const sidebarCollapseBtn =
  document.getElementById(
    'sidebarCollapseBtn'
  );

const sidebarEl =
  document.querySelector(
    '.side'
  );

const dashEl =
  document.querySelector(
    '.dash'
  );

function setSidebarCollapsed(
  collapsed
) {
  if (
    !sidebarEl ||
    !dashEl
  ) {
    return;
  }

  sidebarEl.classList.toggle(
    'is-collapsed',
    collapsed
  );

  dashEl.classList.toggle(
    'sidebar-collapsed',
    collapsed
  );

  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.setAttribute(
      'aria-expanded',
      collapsed
        ? 'false'
        : 'true'
    );

    sidebarCollapseBtn.setAttribute(
      'aria-label',
      collapsed
        ? 'Expandir barra lateral'
        : 'Contraer barra lateral'
    );
  }

  localStorage.setItem(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    String(collapsed)
  );
}

if (sidebarCollapseBtn) {
  sidebarCollapseBtn.addEventListener(
    'click',
    () => {
      const isCollapsed =
        sidebarEl?.classList.contains(
          'is-collapsed'
        );

      setSidebarCollapsed(
        !isCollapsed
      );
    }
  );
}

setSidebarCollapsed(
  localStorage.getItem(
    SIDEBAR_COLLAPSED_STORAGE_KEY
  ) === 'true'
);

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
        event.key ===
        'Escape'
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

const ACCOUNT_PHOTO_FIELDS = [
  'profile.photo_url',
  'profile.avatar_url',
  'profile.profile_photo_url',
  'profile.foto_url',
  'profile.image_url',
  'profile.photo',
  'profile.avatar',
  'profile.profile_photo',
  'profile.profile_photo_path',
  'profile.foto',
  'profile.imagen',

  'user.photo_url',
  'user.avatar_url',
  'user.profile_photo_url',
  'user.foto_url',
  'user.image_url',
  'user.photo',
  'user.avatar',
  'user.profile_photo',
  'user.profile_photo_path',
  'user.foto',
  'user.imagen',
];

function initialsForAccount(name) {
  const parts =
    String(
      name ||
      'Doctor'
    )
      .split(/\s+/)
      .filter(Boolean);

  if (
    parts.length >
    1
  ) {
    return `${parts[0][0]}${parts[1][0]}`
      .toUpperCase();
  }

  return String(
    name ||
    'DR'
  )
    .slice(0, 2)
    .toUpperCase();
}

function accountPhotoUrlFromState(
  state = {}
) {
  return firstLaravelAssetUrl(
    state,
    ACCOUNT_PHOTO_FIELDS
  );
}

function setHeaderAvatarInitials(
  avatar,
  accountName
) {
  if (!avatar) {
    return;
  }

  avatar.textContent =
    initialsForAccount(
      accountName
    );
}

async function setHeaderAvatarPhoto(
  avatar,
  photoUrl,
  accountName
) {
  if (
    !avatar ||
    !photoUrl
  ) {
    setHeaderAvatarInitials(
      avatar,
      accountName
    );

    return;
  }

  const requestId =
    `${Date.now()}-${Math.random()}`;

  avatar.dataset.photoRequestId =
    requestId;

  setHeaderAvatarInitials(
    avatar,
    accountName
  );

  try {
    const localUrl =
      await authenticatedLaravelAssetUrl(
        photoUrl,
        {
          accept:
            'image/*,*/*',
        }
      );

    if (
      avatar.dataset
        .photoRequestId !==
      requestId
    ) {
      return;
    }

    if (!localUrl) {
      throw new Error(
        'No se devolvio una imagen de perfil usable.'
      );
    }

    avatar.innerHTML = `
      <img
        src="${escapeHtml(localUrl)}"
        alt="${escapeHtml(accountName)}"
      >
    `;
  } catch (error) {
    console.warn(
      'No se pudo cargar la foto de la cuenta:',
      error
    );

    if (
      avatar.dataset
        .photoRequestId ===
      requestId
    ) {
      setHeaderAvatarInitials(
        avatar,
        accountName
      );
    }
  }
}

function restoreHeaderProfile() {
  if (!profileMenu) {
    return;
  }

  const accountName =
    sessionStorage.getItem(
      ACCOUNT_NAME_STORAGE_KEY
    ) ||
    localStorage.getItem(
      ACCOUNT_NAME_STORAGE_KEY
    ) ||
    'Doctor';

  const accountRole =
    sessionStorage.getItem(
      ACCOUNT_ROLE_STORAGE_KEY
    ) ||
    localStorage.getItem(
      ACCOUNT_ROLE_STORAGE_KEY
    ) ||
    'Médico';

  const nameElement =
    profileMenu.querySelector(
      'strong'
    );

  const accountPhotoUrl =
    sessionStorage.getItem(
      ACCOUNT_PHOTO_URL_STORAGE_KEY
    ) ||
    localStorage.getItem(
      ACCOUNT_PHOTO_URL_STORAGE_KEY
    ) ||
    '';

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
    setHeaderAvatarPhoto(
      avatar,
      accountPhotoUrl,
      accountName
    );
  }
}

/* =========================================================
   GUARDAR PERFIL DESDE LARAVEL
========================================================= */

function storeHeaderProfileFromState(
  state = {}
) {
  const user =
    state.user || {};

  const profile =
    state.profile || {};

  const accountName =
    user.account_name ||
    user.name ||
    profile.name ||
    '';

  const accountRole =
    user.role ||
    user.clinica_rol ||
    profile.role ||
    profile.clinica_rol ||
    '';

  const accountPhotoUrl =
    accountPhotoUrlFromState({
      user,
      profile,
    });

  if (accountName) {
    sessionStorage.setItem(
      ACCOUNT_NAME_STORAGE_KEY,
      accountName
    );
  }

  if (accountRole) {
    sessionStorage.setItem(
      ACCOUNT_ROLE_STORAGE_KEY,
      accountRole
    );
  }

  if (accountPhotoUrl) {
    sessionStorage.setItem(
      ACCOUNT_PHOTO_URL_STORAGE_KEY,
      accountPhotoUrl
    );
  } else {
    sessionStorage.removeItem(
      ACCOUNT_PHOTO_URL_STORAGE_KEY
    );
  }
}

/* =========================================================
   ACTUALIZAR PERFIL DESDE LARAVEL
========================================================= */

async function refreshHeaderProfileFromLaravel() {
  const token =
    getAuthToken();

  if (!token) {
    return;
  }

  try {
    const response =
      await laravelFetch(
        `${apiBaseUrl()}/api/tauri/configuracion`,
        {
          headers: {
            Accept:
              'application/json',

            Authorization:
              `Bearer ${token}`,
          },

          credentials:
            'include',
        }
      );

    const contentType =
      response.headers.get(
        'content-type'
      ) || '';

    if (
      !response.ok ||
      !contentType.includes(
        'application/json'
      )
    ) {
      return;
    }

    const payload =
      await response.json();

    storeHeaderProfileFromState(
      payload?.data ||
      payload ||
      {}
    );

    restoreHeaderProfile();
  } catch (error) {
    console.warn(
      'No se pudo actualizar el perfil del encabezado:',
      error
    );
  }
}

document.addEventListener(
  'enclaiiConfigurationUpdated',
  (event) => {
    storeHeaderProfileFromState(
      event.detail?.state ||
      {}
    );

    restoreHeaderProfile();
  }
);

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

      clearAuthToken();

      sessionStorage.removeItem(
        ACCOUNT_NAME_STORAGE_KEY
      );

      localStorage.removeItem(
        ACCOUNT_NAME_STORAGE_KEY
      );

      sessionStorage.removeItem(
        ACCOUNT_ROLE_STORAGE_KEY
      );

      localStorage.removeItem(
        ACCOUNT_ROLE_STORAGE_KEY
      );

      sessionStorage.removeItem(
        ACCOUNT_PHOTO_URL_STORAGE_KEY
      );

      localStorage.removeItem(
        ACCOUNT_PHOTO_URL_STORAGE_KEY
      );

      sessionStorage.removeItem(
        DEVICE_TOKEN_STORAGE_KEY
      );

      sessionStorage.removeItem(
        DEVICE_SESSION_STORAGE_KEY
      );

      sessionStorage.removeItem(
        EDIT_PATIENT_ID_STORAGE_KEY
      );

      sessionStorage.removeItem(
        PATIENTS_REFRESH_STORAGE_KEY
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

refreshHeaderProfileFromLaravel();

loadPage(
  currentRoute()
);