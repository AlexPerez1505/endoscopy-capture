import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  firstLaravelAssetUrl,
  laravelFetch,
} from './laravel.js';
import { getAuthToken } from './auth.js';
import { escapeHtml } from './html.js';
import {
  READING_MODE_STORAGE_KEY,
  ANIMATIONS_STORAGE_KEY,
  COMPACT_MODE_STORAGE_KEY,
  ACCOUNT_PHOTO_URL_STORAGE_KEY,
} from './storage-keys.js';

/* =========================================================
   CONFIGURACIÓN TAURI
   Laravel es la fuente principal de todos los datos.
========================================================= */

const SYNC_INTERVAL_MS = 3000;

let state = {
  settings: {},
  user: {},
  profile: {},
  plan: {},
  clinic: {
    is_owner: false,
    members: [],
    invitations: [],
  },
  backups: [],
};

let applyingLaravelData = false;
let pendingSettings = {};
let settingsTimer = null;
let syncTimer = null;
let syncRunning = false;
let currentFingerprint = '';
let eventsBound = false;

/* =========================================================
   URL Y AUTENTICACIÓN
========================================================= */

function endpoint(path = '') {
  const cleanPath = String(path || '').replace(/^\/+/, '');

  return `${apiBaseUrl()}/api/tauri/configuracion${
    cleanPath ? `/${cleanPath}` : ''
  }`;
}

async function apiRequest(path = '', options = {}) {
  const token = getAuthToken();

  if (!token) {
    const error = new Error(
      'No existe una sesión activa. Inicia sesión nuevamente.'
    );

    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const isFormData = options.body instanceof FormData;

  const response = await laravelFetch(endpoint(path), {
    ...options,

    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,

      ...(isFormData
        ? {}
        : {
            'Content-Type': 'application/json',
          }),

      ...(options.headers || {}),
    },
  });

  const contentType =
    response.headers.get('content-type') || '';

  let payload = {};

  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => ({}));
  }

  if (!response.ok || payload?.ok === false) {
    const validationMessage = payload?.errors
      ? Object.values(payload.errors).flat()[0]
      : null;

    const error = new Error(
      validationMessage ||
      payload?.message ||
      `Laravel respondió HTTP ${response.status}.`
    );

    error.status = response.status;

    if (
      response.status === 401 ||
      response.status === 419
    ) {
      error.code = 'UNAUTHORIZED';
    }

    throw error;
  }

  return payload;
}

/* =========================================================
   UTILIDADES
========================================================= */

function boolValue(value) {
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    value === 'true'
  );
}

function numberValue(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function formatDate(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatStorage(value) {
  if (
    typeof value === 'string' &&
    value.toLowerCase().includes('gb')
  ) {
    return value;
  }

  return `${numberValue(value).toFixed(
    numberValue(value) % 1 === 0 ? 0 : 2
  )} GB`;
}

function formatBytes(value) {
  const bytes = numberValue(value);

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return 'DR';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value ?? '--';
  });
}

function setBinding(name, value) {
  document
    .querySelectorAll(`[data-config-bind="${name}"]`)
    .forEach((element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        element.value = value ?? '';
      } else {
        element.textContent = value ?? '--';
      }
    });
}

function fingerprint(data) {
  return JSON.stringify({
    settings: data?.settings || {},
    user: data?.user || {},
    profile: data?.profile || {},
    plan: data?.plan || {},
    clinic: data?.clinic || {},
    backups: data?.backups || [],
  });
}

/* =========================================================
   MENSAJES
========================================================= */

function toast(message, type = 'success') {
  let element =
    document.getElementById('cfgTauriToast');

  if (!element) {
    element = document.createElement('div');
    element.id = 'cfgTauriToast';
    element.className = 'cfg-tauri-toast';

    document.body.appendChild(element);
  }

  element.textContent = message;
  element.dataset.type = type;
  element.classList.add('show');

  clearTimeout(element._timer);

  element._timer = window.setTimeout(() => {
    element.classList.remove('show');
  }, 2800);
}

function syncStatus(
  message,
  status = 'loading',
  persistent = false
) {
  let element =
    document.getElementById('cfgSyncStatus');

  if (!element) {
    element = document.createElement('div');
    element.id = 'cfgSyncStatus';
    element.className = 'cfg-sync-status';

    document.body.appendChild(element);
  }

  element.textContent = message;
  element.dataset.state = status;
  element.classList.add('show');

  clearTimeout(element._timer);

  if (!persistent) {
    element._timer = window.setTimeout(() => {
      element.classList.remove('show');
    }, 1400);
  }
}

/* =========================================================
   MODO LECTURA, ANIMACIONES Y COMPACTO
========================================================= */

function applyVisualEffects(settings = {}) {
  const readingMode =
    boolValue(settings.reading_mode);

  const animationsEnabled =
    settings.animations === undefined
      ? true
      : boolValue(settings.animations);

  const compactMode =
    boolValue(settings.compact);

  document.documentElement.dataset.reading =
    readingMode ? 'on' : 'off';

  document.documentElement.dataset.animations =
    animationsEnabled ? 'on' : 'off';

  document.documentElement.dataset.compact =
    compactMode ? 'on' : 'off';

  localStorage.setItem(
    READING_MODE_STORAGE_KEY,
    readingMode ? '1' : '0'
  );

  localStorage.setItem(
    ANIMATIONS_STORAGE_KEY,
    animationsEnabled ? '1' : '0'
  );

  localStorage.setItem(
    COMPACT_MODE_STORAGE_KEY,
    compactMode ? '1' : '0'
  );
}

export function applyEarlyVisualPreferences() {
  document.documentElement.dataset.reading =
    localStorage.getItem(
      READING_MODE_STORAGE_KEY
    ) === '1'
      ? 'on'
      : 'off';

  document.documentElement.dataset.animations =
    localStorage.getItem(
      ANIMATIONS_STORAGE_KEY
    ) === '0'
      ? 'off'
      : 'on';

  document.documentElement.dataset.compact =
    localStorage.getItem(
      COMPACT_MODE_STORAGE_KEY
    ) === '1'
      ? 'on'
      : 'off';
}

/* =========================================================
   APLICAR ESTADO RECIBIDO DE LARAVEL
========================================================= */

function mergeState(payload = {}) {
  state = {
    ...state,
    ...payload,

    settings: {
      ...state.settings,
      ...(payload.settings || {}),
    },

    user: {
      ...state.user,
      ...(payload.user || {}),
    },

    profile: {
      ...state.profile,
      ...(payload.profile || {}),
    },

    plan: {
      ...state.plan,
      ...(payload.plan || {}),
    },

    clinic: {
      ...state.clinic,
      ...(payload.clinic || {}),
    },

    backups: Array.isArray(payload.backups)
      ? payload.backups
      : state.backups,
  };
}

function updateState(
  payload,
  root,
  force = false
) {
  const nextFingerprint =
    fingerprint(payload);

  if (
    !force &&
    nextFingerprint === currentFingerprint
  ) {
    return false;
  }

  currentFingerprint = nextFingerprint;

  mergeState(payload);
  applyStateToView(root);

  document.dispatchEvent(
    new CustomEvent('enclaiiConfigurationUpdated', {
      detail: {
        state,
        source: 'laravel',
      },
    })
  );

  return true;
}

function applyStateToView(root) {
  applyingLaravelData = true;

  root
    .querySelectorAll('[data-setting]')
    .forEach((control) => {
      const key =
        control.dataset.setting;

      const value =
        state.settings[key];

      if (
        value === undefined ||
        value === null
      ) {
        return;
      }

      if (control.type === 'checkbox') {
        control.checked =
          boolValue(value);
      } else {
        control.value =
          String(value);
      }
    });

  root
    .querySelectorAll('[data-setting-list]')
    .forEach((control) => {
      const key =
        control.dataset.settingList;

      const values =
        state.settings[key];

      control.checked =
        Array.isArray(values) &&
        values.includes(control.value);
    });

  root
    .querySelectorAll('[data-profile-field]')
    .forEach((control) => {
      const key =
        control.dataset.profileField;

      control.value =
        state.profile[key] ?? '';
    });

  root
    .querySelectorAll(
      '[data-settings-panel="perfil"] input[name], ' +
      '[data-settings-panel="perfil"] select[name], ' +
      '.cfg-panel[data-panel="perfil"] input[name], ' +
      '.cfg-panel[data-panel="perfil"] select[name]'
    )
    .forEach((control) => {
      if (
        control.type === 'file' ||
        !control.name
      ) {
        return;
      }

      const value =
        state.profile[control.name] ??
        state.user[control.name];

      if (
        value !== undefined &&
        value !== null
      ) {
        control.value = value;
      }
    });

  applyVisualEffects(state.settings);

  renderUser();
  renderPlan();
  renderProfileFiles();
  renderMembers();
  renderBackups();
  renderQrPreviews();
  renderCounters();
  renderConnection();

  applyingLaravelData = false;
}

/* =========================================================
   USUARIO Y PERFIL
========================================================= */

function profilePhotoUrl(user = {}, profile = {}) {
  return firstLaravelAssetUrl(
    {
      user,
      profile,
    },
    [
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
    ]
  );
}

async function renderProfilePhoto(
  avatar,
  empty,
  photoUrl,
  name
) {
  if (!avatar || !photoUrl) {
    if (avatar) {
      avatar.removeAttribute('src');
      avatar.style.display = 'none';
    }

    if (empty) {
      empty.style.display = 'grid';

      if (!empty.querySelector('svg')) {
        empty.textContent = initials(name);
      }
    }

    return;
  }

  const requestId =
    `${Date.now()}-${Math.random()}`;

  avatar.dataset.photoRequestId =
    requestId;

  try {
    const localUrl =
      await authenticatedLaravelAssetUrl(
        photoUrl,
        {
          accept: 'image/*,*/*',
        }
      );

    if (
      avatar.dataset.photoRequestId !==
      requestId
    ) {
      return;
    }

    avatar.src = localUrl;
    avatar.style.display = 'block';

    if (empty) {
      empty.style.display = 'none';
    }
  } catch (error) {
    console.warn(
      'No se pudo cargar la foto de perfil:',
      error
    );

    if (
      avatar.dataset.photoRequestId !==
      requestId
    ) {
      return;
    }

    avatar.removeAttribute('src');
    avatar.style.display = 'none';

    if (empty) {
      empty.style.display = 'grid';
      empty.textContent = initials(name);
    }
  }
}

function renderUser() {
  const user = state.user || {};
  const profile = state.profile || {};

  const name =
    user.account_name ||
    user.name ||
    profile.name ||
    'Doctor';

  const role =
    user.role ||
    user.clinica_rol ||
    'Médico';

  setBinding('userInitials', initials(name));
  setBinding('userName', name);
  setBinding('userRole', role);
  setBinding(
    'userEmail',
    user.email || profile.email || ''
  );

  setBinding(
    'clinicName',
    user.clinic ||
    profile.clinica_nombre ||
    'ENCLAII'
  );

  setBinding(
    'specialty',
    user.specialty ||
    profile.specialty ||
    role
  );

  setBinding(
    'professionalLicense',
    user.professional_license ||
    profile.professional_license ||
    ''
  );

  const avatar =
    document.getElementById('pfAva');

  const empty =
    document.getElementById('pfEmpty');

  const photoUrl =
    profilePhotoUrl(user, profile);

  if (photoUrl) {
    sessionStorage.setItem(
      ACCOUNT_PHOTO_URL_STORAGE_KEY,
      photoUrl
    );
  } else {
    sessionStorage.removeItem(
      ACCOUNT_PHOTO_URL_STORAGE_KEY
    );
  }

  renderProfilePhoto(
    avatar,
    empty,
    photoUrl,
    name
  );
}

function renderProfileFiles() {
  const taxUrl =
    state.profile.tax_document_url ||
    state.profile.constancia_fiscal_url ||
    '';

  const taxName =
    state.profile.tax_document_name ||
    state.profile.constancia_fiscal_name ||
    'Constancia fiscal';

  renderTaxDocument(taxUrl, taxName);
}

/* =========================================================
   PLAN Y ALMACENAMIENTO
========================================================= */

function getPlanData() {
  const plan = state.plan || {};
  const storage = plan.storage || {};

  return {
    label:
      plan.label ||
      plan.name ||
      plan.plan_label ||
      'Sin plan',

    status:
      plan.status ||
      plan.subscription_status ||
      'inactive',

    renewal:
      plan.renewal_date ||
      plan.subscription_renews_at ||
      null,

    personCount:
      numberValue(
        plan.person_count ??
        state.clinic.member_count ??
        1,
        1
      ),

    memberLimit:
      numberValue(
        plan.member_limit ??
        state.clinic.member_limit ??
        0
      ),

    storagePerPerson:
      storage.per_person_gb ??
      plan.quota_per_person_gb ??
      plan.storage_per_person_gb ??
      0,

    storageTotal:
      storage.total_gb ??
      plan.quota_gb ??
      plan.storage_total_gb ??
      0,

    storageUsed:
      storage.used_gb ??
      plan.used_gb ??
      0,

    storageAvailable:
      storage.available_gb ??
      plan.available_gb ??
      0,

    storagePercent:
      numberValue(
        storage.percent ??
        plan.used_percent ??
        0
      ),

    images:
      storage.images ||
      plan.storage_categories?.images ||
      {},

    videos:
      storage.videos ||
      plan.storage_categories?.videos ||
      {},

    other:
      storage.other ||
      plan.storage_categories?.other ||
      {},

    paymentBrand:
      plan.payment_brand ||
      plan.pm_brand ||
      '',

    paymentLastFour:
      plan.payment_last_four ||
      plan.pm_last_four ||
      '',

    recommendation:
      plan.recommendation?.message ||
      plan.recommendation_text ||
      'Tu almacenamiento está disponible y funcionando correctamente.',

    history:
      Array.isArray(plan.history)
        ? plan.history
        : Array.isArray(plan.usage_history)
          ? plan.usage_history
          : [],
  };
}

function renderPlan() {
  const plan = getPlanData();

  const isActive =
    String(plan.status).toLowerCase() === 'active' ||
    String(plan.status).toLowerCase() === 'activo';

  const statusText =
    isActive ? 'Activo' : 'Inactivo';

  setBinding(
    'planLabel',
    `Plan ${plan.label}`
  );

  setBinding(
    'planStatus',
    statusText
  );

  setBinding(
    'memberLimit',
    plan.memberLimit || '--'
  );

  setText(
    '[data-plan-bind="planLabel"]',
    `Plan ${plan.label}`
  );

  setText(
    '[data-plan-bind="status"]',
    statusText
  );

  setText(
    '[data-plan-bind="personCount"]',
    plan.personCount
  );

  setText(
    '[data-plan-bind="storagePerPerson"]',
    formatStorage(plan.storagePerPerson)
  );

  setText(
    '[data-plan-bind="storageTotal"]',
    formatStorage(plan.storageTotal)
  );

  setText(
    '[data-plan-bind="storageUsedText"]',
    formatStorage(plan.storageUsed)
  );

  setText(
    '[data-plan-bind="storageAvailableText"]',
    formatStorage(plan.storageAvailable)
  );

  setText(
    '[data-plan-bind="renewalDate"]',
    plan.renewal
      ? formatDate(plan.renewal)
      : '--'
  );

  setText(
    '[data-plan-bind="nextChargeDate"]',
    plan.renewal
      ? formatDate(plan.renewal)
      : '--'
  );

  setText(
    '[data-plan-bind="storageImages"]',
    formatStorage(
      plan.images.gb ??
      plan.images.value ??
      0
    )
  );

  setText(
    '[data-plan-bind="storageVideos"]',
    formatStorage(
      plan.videos.gb ??
      plan.videos.value ??
      0
    )
  );

  setText(
    '[data-plan-bind="storageOther"]',
    formatStorage(
      plan.other.gb ??
      plan.other.value ??
      0
    )
  );

  setText(
    '[data-plan-bind="storageImagesPercent"]',
    `${
      numberValue(plan.images.percent)
    }%`
  );

  setText(
    '[data-plan-bind="storageVideosPercent"]',
    `${
      numberValue(plan.videos.percent)
    }%`
  );

  setText(
    '[data-plan-bind="storageOtherPercent"]',
    `${
      numberValue(plan.other.percent)
    }%`
  );

  setText(
    '[data-plan-bind="recommendation"]',
    plan.recommendation
  );

  document
    .querySelectorAll(
      '[data-plan-progress="storage"]'
    )
    .forEach((element) => {
      element.style.width =
        `${Math.min(
          100,
          Math.max(0, plan.storagePercent)
        )}%`;
    });

  document
    .querySelectorAll(
      '[data-plan-status]'
    )
    .forEach((element) => {
      element.textContent =
        statusText;

      element.classList.toggle(
        'success',
        isActive
      );
    });

  const payment =
    document.querySelector(
      '[data-plan-bind="paymentMethod"]'
    );

  if (payment) {
    payment.textContent =
      plan.paymentLastFour
        ? `${String(
            plan.paymentBrand ||
            'Tarjeta'
          ).toUpperCase()} ····${plan.paymentLastFour}`
        : 'Sin método de pago';
  }

  renderUsageChart(plan.history);
}

function renderUsageChart(history) {
  const chart =
    document.querySelector(
      '[data-plan-usage-chart]'
    );

  if (!chart) {
    return;
  }

  if (!history.length) {
    chart.innerHTML = `
      <div class="settings-chart-empty">
        Todavía no hay historial de almacenamiento.
      </div>
    `;

    return;
  }

  const values = history.map((item) =>
    numberValue(
      item.gb ??
      item.value ??
      item.used_gb
    )
  );

  const maxValue =
    Math.max(...values, 1);

  const width = 300;
  const height = 120;
  const paddingX = 18;
  const paddingY = 14;

  const drawableWidth =
    width - paddingX * 2;

  const drawableHeight =
    height - paddingY * 2;

  const points = history.map((item, index) => {
    const x =
      paddingX +
      (
        index /
        Math.max(history.length - 1, 1)
      ) *
      drawableWidth;

    const value =
      numberValue(
        item.gb ??
        item.value ??
        item.used_gb
      );

    const y =
      height -
      paddingY -
      (value / maxValue) *
      drawableHeight;

    return {
      x,
      y,
      label:
        item.label ||
        item.month ||
        '',
      value,
    };
  });

  const polyline =
    points
      .map((point) =>
        `${point.x},${point.y}`
      )
      .join(' ');

  chart.innerHTML = `
    <svg
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
      aria-label="Historial de almacenamiento"
    >
      <line
        x1="0"
        y1="${height - paddingY}"
        x2="${width}"
        y2="${height - paddingY}"
        stroke="currentColor"
        opacity=".12"
      ></line>

      <polyline
        points="${polyline}"
        fill="none"
        stroke="var(--cyan)"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>

      ${points.map((point) => `
        <circle
          cx="${point.x}"
          cy="${point.y}"
          r="4"
          fill="var(--cyan)"
        ></circle>
      `).join('')}
    </svg>

    <div class="settings-chart-labels">
      ${points.map((point) => `
        <span>${escapeHtml(point.label)}</span>
      `).join('')}
    </div>
  `;
}

/* =========================================================
   QR Y PRE-REGISTRO
========================================================= */

function qrText(value) {
  const clinic =
    state.user.clinic ||
    state.profile.clinica_nombre ||
    'la clínica';

  return String(value || '')
    .replaceAll(
      '{enlace}',
      'https://enclaii.app/registro-paciente/ejemplo'
    )
    .replaceAll(
      '{codigo}',
      'QR-2026-0001'
    )
    .replaceAll(
      '{mensaje}',
      'Por favor completa tus datos.'
    )
    .replaceAll(
      '{clinica}',
      clinic
    );
}

function renderQrPreviews() {
  const whatsapp =
    document.getElementById(
      'cfgQrWhatsapp'
    );

  const consent =
    document.getElementById(
      'cfgQrConsent'
    );

  const whatsappPreview =
    document.getElementById(
      'cfgQrWhatsappPreview'
    );

  const consentPreview =
    document.getElementById(
      'cfgQrConsentPreview'
    );

  if (whatsappPreview) {
    whatsappPreview.textContent =
      qrText(whatsapp?.value) ||
      'Sin plantilla configurada.';
  }

  if (consentPreview) {
    consentPreview.textContent =
      qrText(consent?.value) ||
      'Sin consentimiento configurado.';
  }
}

function renderCounters() {
  document
    .querySelectorAll('[data-count-for]')
    .forEach((counter) => {
      const input =
        document.getElementById(
          counter.dataset.countFor
        );

      counter.textContent =
        String(input?.value.length || 0);
    });
}

/* =========================================================
   MIEMBROS DE LA CLÍNICA
========================================================= */

function renderMembers() {
  const tbody =
    document.getElementById(
      'clinicMembersBody'
    );

  if (!tbody) {
    return;
  }

  const roles = {
    propietario: 'Propietario',
    administrador: 'Administrador',
    medico: 'Médico',
    recepcionista: 'Recepcionista',
    asistente: 'Asistente',
  };

  const members =
    Array.isArray(state.clinic.members)
      ? state.clinic.members
      : [];

  const invitations =
    Array.isArray(
      state.clinic.invitations
    )
      ? state.clinic.invitations
      : [];

  const memberRows =
    members.map((member) => {
      const role =
        member.role ||
        member.clinica_rol ||
        'medico';

      const canRemove =
        state.clinic.is_owner &&
        !member.is_current_user &&
        role !== 'propietario';

      return `
        <tr>
          <td>
            <span class="gp-u">
              ${escapeHtml(member.name)}

              ${
                member.is_current_user
                  ? '<span class="gp-you">Tú</span>'
                  : ''
              }
            </span>

            <small class="gp-member-email">
              ${escapeHtml(member.email)}
            </small>
          </td>

          <td>
            ${escapeHtml(
              roles[role] ||
              role
            )}
          </td>

          <td>
            <span class="gp-st">
              Activo
            </span>
          </td>

          <td>
            ${
              member.is_current_user
                ? 'Ahora'
                : escapeHtml(
                    member.last_activity ||
                    'Sin acceso reciente'
                  )
            }
          </td>

          <td>
            ${
              canRemove
                ? `
                  <button
                    type="button"
                    class="gp-member-remove"
                    data-member-id="${member.id}"
                    data-member-name="${escapeHtml(
                      member.name
                    )}"
                  >
                    Retirar
                  </button>
                `
                : '<span class="gp-no-action">—</span>'
            }
          </td>
        </tr>
      `;
    }).join('');

  const invitationRows =
    invitations.map((invitation) => {
      const role =
        invitation.role ||
        invitation.rol ||
        'medico';

      return `
        <tr>
          <td>
            <span class="gp-u">
              ${escapeHtml(invitation.email)}
            </span>

            <small class="gp-member-email">
              Correo autorizado para crear cuenta
            </small>
          </td>

          <td>
            ${escapeHtml(
              roles[role] || role
            )}
          </td>

          <td>
            <span class="gp-st pending">
              Pendiente
            </span>
          </td>

          <td>
            Esperando registro
          </td>

          <td>
            ${
              state.clinic.is_owner
                ? `
                  <button
                    type="button"
                    class="gp-invite-revoke"
                    data-invitation-id="${invitation.id}"
                  >
                    Cancelar
                  </button>
                `
                : '<span class="gp-no-action">—</span>'
            }
          </td>
        </tr>
      `;
    }).join('');

  tbody.innerHTML =
    memberRows + invitationRows;

  if (!tbody.innerHTML.trim()) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="5"
          class="gp-empty"
        >
          No hay usuarios ni invitaciones.
        </td>
      </tr>
    `;
  }
}

/* =========================================================
   COPIAS DE CONFIGURACIÓN
========================================================= */

function renderBackups() {
  const backups =
    Array.isArray(state.backups)
      ? state.backups
      : [];

  const list =
    document.getElementById(
      'intBackupList'
    ) ||
    document.querySelector(
      '.int-backup-list'
    );

  const count =
    document.getElementById(
      'intBackupCount'
    ) ||
    document.querySelector(
      '.int-backup-count'
    );

  if (count) {
    count.textContent =
      `${backups.length} ${
        backups.length === 1
          ? 'copia'
          : 'copias'
      }`;
  }

  const latestTitle =
    document.getElementById(
      'intBackupLatestTitle'
    ) ||
    document.querySelector(
      '.int-backup-summary-main strong'
    );

  const latestDate =
    document.getElementById(
      'intBackupLatestDate'
    ) ||
    document.querySelector(
      '.int-backup-summary-main div span'
    );

  if (backups.length) {
    if (latestTitle) {
      latestTitle.textContent =
        'Última copia completada';
    }

    if (latestDate) {
      latestDate.textContent =
        formatDateTime(
          backups[0].created_at
        );
    }
  } else {
    if (latestTitle) {
      latestTitle.textContent =
        'Todavía no hay copias';
    }

    if (latestDate) {
      latestDate.textContent =
        'Crea la primera para proteger tu configuración actual.';
    }
  }

  if (!list) {
    return;
  }

  if (!backups.length) {
    list.innerHTML = `
      <div class="int-backup-empty">
        Cuando crees una copia aparecerá aquí.
      </div>
    `;

    return;
  }

  list.innerHTML =
    backups.map((backup) => `
      <div
        class="int-backup-row"
        data-backup-row="${backup.id}"
      >
        <div class="int-backup-info">
          <span class="int-backup-file">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </span>

          <div style="min-width:0">
            <div class="int-backup-name">
              ${escapeHtml(backup.name)}
            </div>

            <div class="int-backup-meta">
              ${formatDateTime(
                backup.created_at
              )}
              · ${formatBytes(backup.size)}
              · ${
                backup.type === 'automatic'
                  ? 'Automática'
                  : 'Manual'
              }
            </div>
          </div>
        </div>

        <div class="int-backup-actions">
          <button
            type="button"
            class="int-backup-action restore"
            data-backup-restore="${backup.id}"
            data-backup-name="${escapeHtml(
              backup.name
            )}"
            title="Restaurar"
          >
            ↻
          </button>

          <button
            type="button"
            class="int-backup-action"
            data-backup-download="${backup.id}"
            title="Descargar"
          >
            ↓
          </button>

          <button
            type="button"
            class="int-backup-action delete"
            data-backup-delete="${backup.id}"
            data-backup-name="${escapeHtml(
              backup.name
            )}"
            title="Eliminar"
          >
            ×
          </button>
        </div>
      </div>
    `).join('');
}

/* =========================================================
   CONEXIÓN
========================================================= */

function renderConnection() {
  const status =
    document.getElementById(
      'cfgConnectionStatus'
    );

  const api =
    document.getElementById(
      'cfgApiEndpoint'
    );

  if (status) {
    status.textContent = 'En línea';
    status.classList.add('cfg-online');
  }

  if (api) {
    api.textContent =
      apiBaseUrl();

    api.title =
      apiBaseUrl();
  }
}

/* =========================================================
   GUARDAR AJUSTES
========================================================= */

function settingValue(control) {
  if (control.type === 'checkbox') {
    return control.checked;
  }

  const numericKeys = [
    'items_per_page',
    'qr_default_expiration_hours',
    'capture_auto_interval',
  ];

  if (
    numericKeys.includes(
      control.dataset.setting
    )
  ) {
    return Number(control.value);
  }

  return control.value;
}

function queueSetting(key, value) {
  pendingSettings[key] = value;

  clearTimeout(settingsTimer);

  settingsTimer =
    window.setTimeout(
      savePendingSettings,
      400
    );
}

async function savePendingSettings() {
  const payload = {
    ...pendingSettings,
  };

  pendingSettings = {};

  if (!Object.keys(payload).length) {
    return;
  }

  try {
    syncStatus(
      'Guardando...',
      'loading',
      true
    );

    const response =
      await apiRequest('', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

    const root =
      document.getElementById(
        'settingsAppRoot'
      );

    if (root) {
      updateState(
        response,
        root,
        true
      );
    }

    syncStatus(
      'Cambios guardados',
      'success'
    );
  } catch (error) {
    console.error(error);

    syncStatus(
      error.message ||
      'No se pudieron guardar los cambios',
      'error'
    );

    await loadConfiguration({
      silent: true,
      force: true,
    });
  }
}

/* =========================================================
   GUARDAR PERFIL
========================================================= */

function profilePayload() {
  const payload = {};

  document
    .querySelectorAll('[data-profile-field]')
    .forEach((control) => {
      payload[
        control.dataset.profileField
      ] = control.value;
    });

  document
    .querySelectorAll(
      '[data-settings-panel="perfil"] input[name], ' +
      '[data-settings-panel="perfil"] select[name], ' +
      '.cfg-panel[data-panel="perfil"] input[name], ' +
      '.cfg-panel[data-panel="perfil"] select[name]'
    )
    .forEach((control) => {
      if (
        control.type !== 'file' &&
        control.name
      ) {
        payload[control.name] =
          control.value;
      }
    });

  return payload;
}

async function saveProfile() {
  const button =
    document.getElementById(
      'pfSaveBtn'
    );

  const text =
    document.getElementById(
      'pfSaveTxt'
    );

  if (button) {
    button.disabled = true;
  }

  if (text) {
    text.textContent =
      'Guardando...';
  }

  try {
    const response =
      await apiRequest('perfil', {
        method: 'PATCH',
        body: JSON.stringify(
          profilePayload()
        ),
      });

    mergeState(response);
    renderUser();

    toast(
      response.message ||
      'Perfil guardado correctamente.'
    );

    if (text) {
      text.textContent =
        '¡Guardado!';
    }
  } catch (error) {
    console.error(error);

    toast(
      error.message,
      'error'
    );

    if (text) {
      text.textContent =
        'Error al guardar';
    }
  } finally {
    window.setTimeout(() => {
      if (button) {
        button.disabled = false;
      }

      if (text) {
        text.textContent =
          'Guardar cambios';
      }
    }, 1600);
  }
}

/* =========================================================
   FOTO DE PERFIL
========================================================= */

async function uploadPhoto(file) {
  if (!file) {
    return;
  }

  const formData =
    new FormData();

  formData.append('foto', file);

  const response =
    await apiRequest('foto', {
      method: 'POST',
      body: formData,
    });

  state.profile.photo_url =
    firstLaravelAssetUrl(
      response,
      [
        'url',
        'photo_url',
        'avatar_url',
        'profile_photo_url',
        'foto_url',
        'image_url',
        'data.url',
        'data.photo_url',
        'data.avatar_url',
        'data.profile_photo_url',
        'data.foto_url',
        'data.image_url',
        'profile.photo_url',
        'user.photo_url',
      ]
    );

  renderUser();
  document.dispatchEvent(
    new CustomEvent('enclaiiConfigurationUpdated', {
      detail: {
        state,
        source: 'profile-photo',
      },
    })
  );

  toast(
    response.message ||
    'Foto actualizada.'
  );
}

async function deletePhoto() {
  const response =
    await apiRequest('foto', {
      method: 'DELETE',
    });

  state.profile.photo_url = null;
  sessionStorage.removeItem(
    ACCOUNT_PHOTO_URL_STORAGE_KEY
  );

  renderUser();
  document.dispatchEvent(
    new CustomEvent('enclaiiConfigurationUpdated', {
      detail: {
        state,
        source: 'profile-photo',
      },
    })
  );

  toast(
    response.message ||
    'Foto eliminada.'
  );
}

/* =========================================================
   CONSTANCIA FISCAL
========================================================= */

function renderTaxDocument(
  url,
  filename = 'Constancia fiscal'
) {
  const preview =
    document.getElementById(
      'csfPreview'
    );

  const uploadArea =
    document.getElementById(
      'csfUploadArea'
    );

  const actions =
    document.getElementById(
      'csfActions'
    );

  if (!preview) {
    return;
  }

  if (!url) {
    preview.innerHTML = '';
    preview.style.display = 'none';

    if (uploadArea) {
      uploadArea.style.display = '';
    }

    if (actions) {
      actions.style.display = 'none';
    }

    return;
  }

  const extension =
    String(filename)
      .split('.')
      .pop()
      .toLowerCase();

  if (
    extension === 'pdf' ||
    String(url).toLowerCase().includes('.pdf')
  ) {
    preview.innerHTML = `
      <div class="csf-pdf-card">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>

        <div class="csf-pdf-info">
          <span>${escapeHtml(filename)}</span>

          <a
            href="${escapeHtml(url)}"
            target="_blank"
            class="csf-view-link"
          >
            Ver documento
          </a>
        </div>
      </div>
    `;
  } else {
    preview.innerHTML = `
      <img
        id="csfImg"
        src="${escapeHtml(url)}"
        alt="Constancia fiscal"
      >
    `;
  }

  preview.style.display = '';

  if (uploadArea) {
    uploadArea.style.display = 'none';
  }

  if (actions) {
    actions.style.display = 'flex';
  }
}

async function uploadTaxDocument(file) {
  if (!file) {
    return;
  }

  const formData =
    new FormData();

  formData.append(
    'constancia',
    file
  );

  const response =
    await apiRequest(
      'constancia-fiscal',
      {
        method: 'POST',
        body: formData,
      }
    );

  const url =
    response.url ||
    response.tax_document_url;

  state.profile.tax_document_url =
    url;

  state.profile.tax_document_name =
    response.name ||
    file.name;

  renderTaxDocument(
    url,
    response.name || file.name
  );

  toast(
    response.message ||
    'Constancia fiscal actualizada.'
  );
}

async function deleteTaxDocument() {
  const response =
    await apiRequest(
      'constancia-fiscal',
      {
        method: 'DELETE',
      }
    );

  state.profile.tax_document_url =
    null;

  state.profile.tax_document_name =
    null;

  renderTaxDocument(null);

  toast(
    response.message ||
    'Constancia fiscal eliminada.'
  );
}

/* =========================================================
   COPIAS
========================================================= */

function openBackupModal() {
  const modal =
    document.getElementById(
      'intBackupModal'
    );

  const input =
    document.getElementById(
      'intBackupName'
    );

  if (
    input &&
    !input.value.trim()
  ) {
    input.value =
      `Configuración principal - ${
        new Intl.DateTimeFormat(
          'es-MX',
          {
            dateStyle: 'short',
            timeStyle: 'short',
          }
        ).format(new Date())
      }`;
  }

  modal?.classList.add('open');

  modal?.setAttribute(
    'aria-hidden',
    'false'
  );
}

function closeBackupModal() {
  const modal =
    document.getElementById(
      'intBackupModal'
    );

  modal?.classList.remove('open');

  modal?.setAttribute(
    'aria-hidden',
    'true'
  );
}

async function createBackup() {
  const name =
    document
      .getElementById(
        'intBackupName'
      )
      ?.value
      .trim();

  const mode =
    document.querySelector(
      'input[name="mode"]:checked'
    )?.value ||
    'complete';

  const scope = [
    ...document.querySelectorAll(
      'input[name="scope[]"]:checked'
    ),
  ].map((input) => input.value);

  const response =
    await apiRequest('copias', {
      method: 'POST',

      body: JSON.stringify({
        name,
        mode,
        scope,
      }),
    });

  closeBackupModal();

  toast(
    response.message ||
    'Copia creada.'
  );

  await loadConfiguration({
    silent: true,
    force: true,
  });
}

async function restoreBackup(id) {
  const response =
    await apiRequest(
      `copias/${id}/restaurar`,
      {
        method: 'POST',
      }
    );

  toast(
    response.message ||
    'Configuración restaurada.'
  );

  await loadConfiguration({
    silent: true,
    force: true,
  });
}

async function removeBackup(id) {
  const response =
    await apiRequest(
      `copias/${id}`,
      {
        method: 'DELETE',
      }
    );

  toast(
    response.message ||
    'Copia eliminada.'
  );

  await loadConfiguration({
    silent: true,
    force: true,
  });
}

async function downloadBackup(id) {
  const response =
    await laravelFetch(
      endpoint(
        `copias/${id}/descargar`
      ),
      {
        headers: {
          Accept:
            'application/octet-stream',

          Authorization:
            `Bearer ${getAuthToken()}`,
        },
      }
    );

  if (!response.ok) {
    throw new Error(
      'No se pudo descargar la copia.'
    );
  }

  const blob =
    await response.blob();

  const objectUrl =
    URL.createObjectURL(blob);

  const link =
    document.createElement('a');

  link.href = objectUrl;
  link.download =
    `configuracion-${id}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(objectUrl);
}

/* =========================================================
   MIEMBROS
========================================================= */

async function removeMember(id) {
  const response =
    await apiRequest(
      `miembros/${id}`,
      {
        method: 'DELETE',
      }
    );

  toast(
    response.message ||
    'Usuario retirado.'
  );

  await loadConfiguration({
    silent: true,
    force: true,
  });
}

async function revokeInvitation(id) {
  const response =
    await apiRequest(
      `invitaciones/${id}`,
      {
        method: 'DELETE',
      }
    );

  toast(
    response.message ||
    'Invitación cancelada.'
  );

  await loadConfiguration({
    silent: true,
    force: true,
  });
}

/* =========================================================
   CARGAR Y SINCRONIZAR
========================================================= */

function showSessionError(
  root,
  message
) {
  root.innerHTML = `
    <div class="settings-card settings-session-error">
      <strong>Sesión requerida</strong>

      <p>${escapeHtml(message)}</p>

      <button
        type="button"
        id="settingsGoLogin"
      >
        Volver a iniciar sesión
      </button>
    </div>
  `;

  document
    .getElementById(
      'settingsGoLogin'
    )
    ?.addEventListener(
      'click',
      () => {
        const redirect =
          encodeURIComponent(
            './app.html#configuracion'
          );

        window.location.href =
          `./login.html?redirect=${redirect}`;
      }
    );
}

export async function loadConfiguration({
  silent = false,
  force = true,
} = {}) {
  const root =
    document.getElementById(
      'settingsAppRoot'
    );

  if (!root) {
    return;
  }

  try {
    if (!silent) {
      syncStatus(
        'Cargando configuración...',
        'loading',
        true
      );
    }

    const response =
      await apiRequest();

    updateState(
      response,
      root,
      force
    );

    if (!silent) {
      syncStatus(
        'Configuración sincronizada',
        'success'
      );
    }
  } catch (error) {
    console.error(error);

    if (
      error.code === 'UNAUTHORIZED'
    ) {
      showSessionError(
        root,
        error.message
      );

      return;
    }

    if (!silent) {
      toast(
        error.message ||
        'No se pudo cargar la configuración.',
        'error'
      );
    }

    const status =
      document.getElementById(
        'cfgConnectionStatus'
      );

    if (status) {
      status.textContent =
        'Sin conexión';

      status.classList.remove(
        'cfg-online'
      );
    }
  }
}

export async function refreshConfiguration({
  silent = true,
  force = false,
} = {}) {
  if (syncRunning) {
    return;
  }

  if (!navigator.onLine) {
    return;
  }

  syncRunning = true;

  try {
    await loadConfiguration({
      silent,
      force,
    });
  } finally {
    syncRunning = false;
  }
}

export function startRealtimeSync() {
  stopRealtimeSync();

  syncTimer =
    window.setInterval(() => {
      if (
        document.visibilityState ===
          'visible' &&
        navigator.onLine
      ) {
        refreshConfiguration({
          silent: true,
          force: false,
        });
      }
    }, SYNC_INTERVAL_MS);
}

export function stopRealtimeSync() {
  if (syncTimer) {
    window.clearInterval(syncTimer);
    syncTimer = null;
  }
}

/* =========================================================
   EVENTOS
========================================================= */

function bindTabs(root) {
  root.addEventListener(
    'click',
    (event) => {
      const tab =
        event.target.closest(
          '[data-settings-tab]'
        );

      if (!tab) {
        return;
      }

      const target =
        tab.dataset.settingsTab;

      root
        .querySelectorAll(
          '[data-settings-tab]'
        )
        .forEach((button) => {
          button.classList.toggle(
            'is-active',
            button === tab
          );
        });

      root
        .querySelectorAll(
          '[data-settings-panel]'
        )
        .forEach((panel) => {
          panel.classList.toggle(
            'is-active',
            panel.dataset.settingsPanel ===
              target
          );
        });
    }
  );
}

function bindEvents(root) {
  if (eventsBound) {
    return;
  }

  eventsBound = true;

  bindTabs(root);

  root.addEventListener(
    'input',
    (event) => {
      if (
        event.target.matches('textarea')
      ) {
        renderQrPreviews();
        renderCounters();
      }
    }
  );

  root.addEventListener(
    'change',
    (event) => {
      if (applyingLaravelData) {
        return;
      }

      const listControl =
        event.target.closest(
          '[data-setting-list]'
        );

      if (listControl) {
        const key =
          listControl.dataset.settingList;

        const values = [
          ...root.querySelectorAll(
            `[data-setting-list="${key}"]:checked`
          ),
        ].map((control) => control.value);

        queueSetting(key, values);
        return;
      }

      const control =
        event.target.closest(
          '[data-setting]'
        );

      if (control) {
        const key =
          control.dataset.setting;

        const value =
          settingValue(control);

        state.settings[key] = value;

        applyVisualEffects(
          state.settings
        );

        queueSetting(key, value);
        return;
      }

      if (
        event.target.id === 'pfPhoto' &&
        event.target.files?.[0]
      ) {
        uploadPhoto(
          event.target.files[0]
        ).catch((error) => {
          console.error(error);
          toast(error.message, 'error');
        });

        return;
      }

      if (
        event.target.id === 'csfInput' &&
        event.target.files?.[0]
      ) {
        uploadTaxDocument(
          event.target.files[0]
        ).catch((error) => {
          console.error(error);
          toast(error.message, 'error');
        });
      }
    }
  );

  root.addEventListener(
    'click',
    async (event) => {
      try {
        if (
          event.target.closest(
            '#pfSaveBtn'
          )
        ) {
          await saveProfile();
          return;
        }

        if (
          event.target.closest(
            '#pfEdit'
          )
        ) {
          document
            .getElementById('pfPhoto')
            ?.click();

          return;
        }

        if (
          event.target.closest(
            '#pfDel'
          )
        ) {
          const accepted =
            window.confirm(
              '¿Eliminar tu foto de perfil?'
            );

          if (accepted) {
            await deletePhoto();
          }

          return;
        }

        if (
          event.target.closest(
            '#csfPickBtn'
          ) ||
          event.target.closest(
            '#csfChangeBtn'
          ) ||
          event.target.closest(
            '#csfUploadArea'
          )
        ) {
          document
            .getElementById('csfInput')
            ?.click();

          return;
        }

        if (
          event.target.closest(
            '#csfDeleteBtn'
          )
        ) {
          const accepted =
            window.confirm(
              '¿Eliminar la constancia fiscal?'
            );

          if (accepted) {
            await deleteTaxDocument();
          }

          return;
        }

        if (
          event.target.closest(
            '#intBackupOpen'
          )
        ) {
          openBackupModal();
          return;
        }

        if (
          event.target.closest(
            '#intBackupClose'
          ) ||
          event.target.closest(
            '#intBackupCancel'
          )
        ) {
          closeBackupModal();
          return;
        }

        const restore =
          event.target.closest(
            '[data-backup-restore]'
          );

        if (restore) {
          const accepted =
            window.confirm(
              `¿Restaurar “${
                restore.dataset.backupName ||
                'esta copia'
              }”?`
            );

          if (accepted) {
            await restoreBackup(
              restore.dataset.backupRestore
            );
          }

          return;
        }

        const backupDelete =
          event.target.closest(
            '[data-backup-delete]'
          );

        if (backupDelete) {
          const accepted =
            window.confirm(
              `¿Eliminar “${
                backupDelete.dataset.backupName ||
                'esta copia'
              }”?`
            );

          if (accepted) {
            await removeBackup(
              backupDelete.dataset.backupDelete
            );
          }

          return;
        }

        const backupDownload =
          event.target.closest(
            '[data-backup-download]'
          );

        if (backupDownload) {
          await downloadBackup(
            backupDownload.dataset.backupDownload
          );

          return;
        }

        const member =
          event.target.closest(
            '[data-member-id]'
          );

        if (member) {
          const accepted =
            window.confirm(
              `¿Retirar a ${
                member.dataset.memberName ||
                'este usuario'
              } de la clínica?`
            );

          if (accepted) {
            await removeMember(
              member.dataset.memberId
            );
          }

          return;
        }

        const invitation =
          event.target.closest(
            '[data-invitation-id]'
          );

        if (invitation) {
          const accepted =
            window.confirm(
              '¿Cancelar esta invitación?'
            );

          if (accepted) {
            await revokeInvitation(
              invitation.dataset.invitationId
            );
          }
        }
      } catch (error) {
        console.error(error);
        toast(error.message, 'error');
      }
    }
  );

  document
    .getElementById(
      'intBackupForm'
    )
    ?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        const button =
          document.getElementById(
            'intBackupSubmit'
          );

        if (button) {
          button.disabled = true;
          button.textContent =
            'Creando...';
        }

        try {
          await createBackup();
        } catch (error) {
          console.error(error);
          toast(error.message, 'error');
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent =
              'Crear copia';
          }
        }
      }
    );

  document
    .getElementById(
      'intBackupModal'
    )
    ?.addEventListener(
      'click',
      (event) => {
        if (
          event.target.id ===
          'intBackupModal'
        ) {
          closeBackupModal();
        }
      }
    );
}

function bindRealtimeEvents() {
  if (
    document.documentElement.dataset
      .configRealtimeBound === 'true'
  ) {
    return;
  }

  document.documentElement.dataset
    .configRealtimeBound = 'true';

  window.addEventListener(
    'focus',
    () => {
      refreshConfiguration({
        silent: true,
        force: false,
      });
    }
  );

  window.addEventListener(
    'online',
    () => {
      syncStatus(
        'Conexión recuperada',
        'success'
      );

      refreshConfiguration({
        silent: false,
        force: true,
      });
    }
  );

  window.addEventListener(
    'offline',
    () => {
      syncStatus(
        'Sin conexión',
        'error',
        true
      );
    }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState ===
        'visible'
      ) {
        refreshConfiguration({
          silent: true,
          force: false,
        });
      }
    }
  );
}

/* =========================================================
   INICIALIZACIÓN
========================================================= */

export async function initConfiguracion({ signal } = {}) {
  const root =
    document.getElementById(
      'settingsAppRoot'
    );

  if (!root) {
    console.warn(
      'No existe #settingsAppRoot.'
    );

    return;
  }

  bindEvents(root);
  bindRealtimeEvents();

  await loadConfiguration({
    silent: false,
    force: true,
  });

  startRealtimeSync();

  signal?.addEventListener('abort', stopRealtimeSync);
}

applyEarlyVisualPreferences();
