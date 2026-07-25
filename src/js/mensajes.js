import { apiBaseUrl, laravelFetch } from './laravel.js';
import { authHeader, getAuthToken } from './auth.js';
import { escapeHtml } from './html.js';

const API_BASE_URL = apiBaseUrl();
const PATIENTS_ENDPOINT = `${API_BASE_URL}/tauri/pacientes`;

const FALLBACK_MESSAGE_PATIENTS = [
  { id: 'kevin', initials: 'KM', name: 'Kevin Martinez', tone: 'avatar-blue', message: 'Sin mensajes todavia', online: true },
  { id: 'prueba-nueve', initials: 'PN', name: 'Prueba Nueve', tone: 'avatar-purple', message: 'Sin mensajes todavia', online: true },
  { id: 'prueba-siete', initials: 'PS', name: 'Prueba Siete', tone: 'avatar-cyan', message: 'Sin mensajes todavia', online: true },
  { id: 'ricardo-regino', initials: 'RM', name: 'Ricardo Martinez Regino', tone: 'avatar-amber', message: 'Sin mensajes todavia', online: true },
  { id: 'ricardo-prueba3', initials: 'RP', name: 'Ricardo Prueba3', tone: 'avatar-red', message: 'Sin mensajes todavia', online: true },
  { id: 'ricardo-prueba5', initials: 'RP', name: 'Ricardo Prueba5', tone: 'avatar-green', message: 'Sin mensajes todavia', online: true },
];

const AVATAR_TONES = ['avatar-blue', 'avatar-purple', 'avatar-cyan', 'avatar-amber', 'avatar-red', 'avatar-green'];

let messagePatients = [...FALLBACK_MESSAGE_PATIENTS];
let activeMessagePatientId = 'kevin';
let currentTab = 'all';
const draftMessages = new Map();

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function normalizePatientsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.patients)) return payload.patients;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return 'PX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function patientId(patient, index) {
  return String(patient.id || patient.folio || patient.patient_id || `patient-${index + 1}`);
}

function conversationFromPatient(patient, index) {
  const name = patient.name || patient.nombre || patient.full_name || patient.paciente || 'Paciente sin nombre';
  return {
    id: patientId(patient, index),
    initials: patient.initials || patient.iniciales || initialsFromName(name),
    name,
    tone: AVATAR_TONES[index % AVATAR_TONES.length],
    message: 'Sin mensajes todavia',
    online: true,
  };
}

async function fetchLaravelPatients() {
  const headers = { Accept: 'application/json' };
  const authorization = authHeader();

  if (authorization) {
    headers.Authorization = authorization;
  }

  const response = await laravelFetch(PATIENTS_ENDPOINT, {
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error('Pacientes no disponibles.');
  }

  const payload = await response.json();
  if (payload?.ok === false) {
    throw new Error(payload?.message || 'No se devolvieron pacientes.');
  }

  return normalizePatientsPayload(payload);
}

async function loadPatientsFromLaravel() {
  try {
    const patients = await fetchLaravelPatients();
    const conversations = patients.map(conversationFromPatient);

    if (!conversations.length) return;

    messagePatients = conversations;
    if (!messagePatients.some(patient => patient.id === activeMessagePatientId)) {
      activeMessagePatientId = messagePatients[0].id;
    }
    updateActiveChat();
  } catch (error) {
    messagePatients = [...FALLBACK_MESSAGE_PATIENTS];
    if (!messagePatients.some(patient => patient.id === activeMessagePatientId)) {
      activeMessagePatientId = messagePatients[0].id;
    }
    updateActiveChat();
  }
}

function activePatient() {
  return messagePatients.find(patient => patient.id === activeMessagePatientId) || messagePatients[0];
}

function conversationButton(patient) {
  const activeClass = patient.id === activeMessagePatientId ? ' is-active' : '';
  const id = escapeHtml(patient.id);
  const initials = escapeHtml(patient.initials);
  const name = escapeHtml(patient.name);
  const message = escapeHtml(patient.message);
  return `
    <button class="messages-conversation${activeClass}" type="button" data-message-patient="${id}">
      <span class="messages-avatar ${patient.tone}">${initials}</span>
      <span class="messages-conversation-main">
        <strong>${name}</strong>
        <span>${message}</span>
      </span>
      <span class="messages-status-dot" aria-label="${patient.online ? 'En linea' : 'Sin conexion'}"></span>
    </button>
  `;
}

function filteredPatients() {
  const search = normalizeText(document.getElementById('messagesSearchInput')?.value);

  return messagePatients.filter(patient => {
    const matchesSearch = !search || normalizeText(patient.name).includes(search) || normalizeText(patient.initials).includes(search);
    if (!matchesSearch) return false;
    if (currentTab === 'archived') return false;
    return true;
  });
}

function renderConversationList() {
  const list = document.getElementById('messagesConversationList');
  if (!list) return;

  const patients = filteredPatients();
  list.innerHTML = patients.length
    ? patients.map(conversationButton).join('')
    : '<p class="messages-empty-state">No hay conversaciones.</p>';
}

function renderChatBody() {
  const body = document.getElementById('messagesChatBody');
  if (!body) return;

  const messages = draftMessages.get(activeMessagePatientId) || [];
  body.classList.toggle('has-messages', messages.length > 0);

  if (!messages.length) {
    body.innerHTML = '<p class="messages-empty-state">Todavia no hay mensajes con este paciente.</p>';
    return;
  }

  body.innerHTML = messages
    .map(message => `<p class="messages-bubble is-own">${escapeHtml(message)}</p>`)
    .join('');
  body.scrollTop = body.scrollHeight;
}

function updateActiveChat() {
  const patient = activePatient();
  const avatar = document.getElementById('messagesActiveAvatar');
  const name = document.getElementById('messagesActiveName');

  if (avatar) {
    avatar.className = `messages-avatar ${patient.tone}`;
    avatar.textContent = patient.initials;
  }

  if (name) name.textContent = patient.name;
  renderConversationList();
  renderChatBody();
}

function setActivePatient(patientId) {
  if (!messagePatients.some(patient => patient.id === patientId)) return;
  activeMessagePatientId = patientId;
  updateActiveChat();
}

function sendMessage(event) {
  event.preventDefault();
  const input = document.getElementById('messagesComposerInput');
  const text = input?.value.trim();
  if (!input || !text) return;

  const messages = draftMessages.get(activeMessagePatientId) || [];
  messages.push(text);
  draftMessages.set(activeMessagePatientId, messages);
  input.value = '';
  renderChatBody();
}

export function initMensajes() {
  // Check if user is already logged in
  const token = getAuthToken();
  if (!token) {
    const root = document.getElementById('pageContent');
    if (root) {
      renderLaravelLogin(root, 'Inicia sesión para acceder a los mensajes.');
    }
    return;
  }

  const list = document.getElementById('messagesConversationList');
  const search = document.getElementById('messagesSearchInput');
  const composer = document.getElementById('messagesComposer');

  activeMessagePatientId = 'kevin';
  currentTab = 'all';
  messagePatients = [...FALLBACK_MESSAGE_PATIENTS];

  list?.addEventListener('click', event => {
    const button = event.target.closest('[data-message-patient]');
    if (button) setActivePatient(button.dataset.messagePatient);
  });

  search?.addEventListener('input', renderConversationList);
  composer?.addEventListener('submit', sendMessage);

  document.querySelectorAll('[data-message-tab]').forEach(button => {
    button.addEventListener('click', () => {
      currentTab = button.dataset.messageTab || 'all';
      document.querySelectorAll('[data-message-tab]').forEach(tab => {
        tab.classList.toggle('is-active', tab === button);
      });
      renderConversationList();
    });
  });

  updateActiveChat();
  loadPatientsFromLaravel();
}
