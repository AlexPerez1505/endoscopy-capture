// Vinculacion por codigo de 6 digitos, reutilizable desde cualquier pagina
// del shell (app.html/pacientes) sin depender de main.js (que solo se carga
// en index.html, la pantalla de captura). Guarda los mismos valores en
// sessionStorage que espera main.js para reconocer que el dispositivo ya
// esta vinculado y saltarse su propia tarjeta/modal de codigo.
import { apiBaseUrl, laravelFetch } from './laravel.js';
import {
  DEVICE_TOKEN_STORAGE_KEY,
  DEVICE_SESSION_STORAGE_KEY,
  DEVICE_UID_STORAGE_KEY,
  STUDY_PATIENT_ID_STORAGE_KEY,
  STUDY_PATIENT_NAME_STORAGE_KEY,
  STUDY_ID_STORAGE_KEY,
  STUDY_LABEL_STORAGE_KEY,
} from './storage-keys.js';

const PAIR_ENDPOINT = `${apiBaseUrl()}/api/tauri/pair/redeem`;

function getDeviceUid() {
  let uid = localStorage.getItem(DEVICE_UID_STORAGE_KEY);
  if (!uid) {
    uid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(DEVICE_UID_STORAGE_KEY, uid);
  }
  return uid;
}

function persistPairing(data) {
  sessionStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, data.token);
  sessionStorage.setItem(DEVICE_SESSION_STORAGE_KEY, String(data.session_id));

  if (data.paciente_id) sessionStorage.setItem(STUDY_PATIENT_ID_STORAGE_KEY, String(data.paciente_id));
  if (data.paciente_nombre) sessionStorage.setItem(STUDY_PATIENT_NAME_STORAGE_KEY, data.paciente_nombre);
  if (data.estudio_id || data.study_id) sessionStorage.setItem(STUDY_ID_STORAGE_KEY, String(data.estudio_id || data.study_id));
  if (data.estudio_tipo) sessionStorage.setItem(STUDY_LABEL_STORAGE_KEY, data.estudio_tipo);
}

/**
 * Redime el codigo de 6 digitos ante Laravel y persiste la vinculacion en
 * sessionStorage. Lanza un Error con mensaje legible si falla.
 */
export async function pairWithCode(code) {
  const response = await laravelFetch(PAIR_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      device_name: 'Endoscopy Capture Desktop',
      device_uid: getDeviceUid(),
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `El servidor respondio HTTP ${response.status} al vincular el dispositivo.`);
  }

  const data = payload.data || {};
  persistPairing(data);
  return data;
}

/* =========================================================
   MODAL FLOTANTE GLOBAL (definido en app.html)
========================================================= */

let modalRoot = null;
let formEl = null;
let inputEl = null;
let statusEl = null;
let submitBtn = null;
let onSuccessCallback = null;

function bindOnce() {
  if (modalRoot) return true;

  modalRoot = document.getElementById('pairCodeModal');
  formEl = document.getElementById('pairCodeModalForm');
  inputEl = document.getElementById('pairCodeModalInput');
  statusEl = document.getElementById('pairCodeModalStatus');
  submitBtn = document.getElementById('pairCodeModalSubmit');

  if (!modalRoot || !formEl || !inputEl) return false;

  document.getElementById('pairCodeModalClose')?.addEventListener('click', closePairCodeModal);
  document.getElementById('pairCodeModalBackdrop')?.addEventListener('click', closePairCodeModal);

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const code = (inputEl.value || '').trim();
    if (code.length !== 6) {
      if (statusEl) statusEl.textContent = 'Ingresa los 6 digitos del codigo.';
      return;
    }

    if (statusEl) statusEl.textContent = 'Vinculando dispositivo...';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const data = await pairWithCode(code);
      if (statusEl) statusEl.textContent = '';
      closePairCodeModal();
      onSuccessCallback?.(data);
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || 'No se pudo vincular el dispositivo.';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  return true;
}

export function openPairCodeModal(onSuccess) {
  if (!bindOnce()) return;

  onSuccessCallback = onSuccess || null;
  if (inputEl) inputEl.value = '';
  if (statusEl) statusEl.textContent = '';

  modalRoot.classList.add('is-open');
  inputEl?.focus();
}

export function closePairCodeModal() {
  modalRoot?.classList.remove('is-open');
}
