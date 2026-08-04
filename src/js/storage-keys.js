// Única fuente de verdad para las claves de localStorage/sessionStorage
// usadas en toda la app. Antes estaban repetidas como strings sueltos
// ('enclaii-...') en más de diez módulos distintos; un typo en una sola
// copia rompía silenciosamente esa persistencia en particular (la lectura
// nunca encontraba nada, sin ningún error visible).
//
// Uso: importa la constante que necesites en vez de escribir el string a
// mano.
//   import { EDIT_PATIENT_ID_STORAGE_KEY } from './storage-keys.js';
//   sessionStorage.setItem(EDIT_PATIENT_ID_STORAGE_KEY, String(id));

/* ---- Autenticación ---- */
export const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';
export const ACCOUNT_NAME_STORAGE_KEY = 'enclaii-account-name';
export const ACCOUNT_ROLE_STORAGE_KEY = 'enclaii-account-role';
export const ACCOUNT_PHOTO_URL_STORAGE_KEY = 'enclaii-account-photo-url';

/* ---- Configuración / conexión con Laravel ---- */
export const API_URL_STORAGE_KEY = 'enclaii-api-url';
export const THEME_STORAGE_KEY = 'enclaii-theme';
export const READING_MODE_STORAGE_KEY = 'enclaii-pref-reading_mode';
export const ANIMATIONS_STORAGE_KEY = 'enclaii-pref-animations';
export const COMPACT_MODE_STORAGE_KEY = 'enclaii-pref-compact';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'enclaii-sidebar-collapsed';

/* ---- Dispositivo de captura (pairing con main.js) ---- */
export const DEVICE_TOKEN_STORAGE_KEY = 'enclaii-device-token';
export const DEVICE_SESSION_STORAGE_KEY = 'enclaii-device-session-id';
export const DEVICE_UID_STORAGE_KEY = 'enclaii-device-uid';

/* ---- Preferencias de captura (main.js) ---- */
export const CONFIG_PANEL_COLLAPSED_STORAGE_KEY = 'enclaii-config-panel-collapsed';
export const FOCUS_MODE_ENABLED_STORAGE_KEY = 'enclaii-focus-mode-enabled';
export const FOCUS_MODE_ROI_STORAGE_KEY = 'enclaii-focus-mode-roi';
export const FOCUS_MODE_SELECTED_DEVICE_STORAGE_KEY = 'enclaii-focus-mode-selected-device';
export const DOUBLE_CLICK_WINDOW_STORAGE_KEY = 'enclaii-double-click-window-ms';
export const DOUBLE_CLICK_ENABLED_STORAGE_KEY = 'enclaii-double-click-enabled';

/* ---- Contexto de estudio activo (main.js <-> pacientes/galería) ---- */
export const STUDY_PATIENT_ID_STORAGE_KEY = 'enclaii-patient_id';
export const STUDY_PATIENT_NAME_STORAGE_KEY = 'enclaii-patient_name';
export const STUDY_ID_STORAGE_KEY = 'enclaii-study_id';
export const STUDY_LABEL_STORAGE_KEY = 'enclaii-study_label';
export const OPEN_GALLERY_PATIENT_STORAGE_KEY = 'enclaii-open-gallery-patient';
export const OPEN_GALLERY_STUDY_STORAGE_KEY = 'enclaii-open-gallery-study';

/* ---- Navegación entre pantallas de pacientes/agenda ---- */
export const EDIT_PATIENT_ID_STORAGE_KEY = 'enclaii-edit-patient-id';
export const REPORT_PATIENT_ID_STORAGE_KEY = 'enclaii-report-patient-id';
export const OPEN_PATIENT_ID_STORAGE_KEY = 'enclaii-open-patient-id';
export const PATIENTS_REFRESH_STORAGE_KEY = 'enclaii-patients-refresh';
export const AGENDAR_PREFILL_STORAGE_KEY = 'enclaii-agendar-prefill';
