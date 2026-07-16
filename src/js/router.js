// ================= Router SPA de ENCLAII =================
// Carga fragmentos HTML desde ./pages y ejecuta el inicializador de cada sección.

const AUTH_STORAGE_KEY = 'enclaii-tauri-basic-auth';

if (!sessionStorage.getItem(AUTH_STORAGE_KEY)) {
  window.location.href = './login.html';
  throw new Error('Sin sesion activa, redirigiendo a login.');
}

import { initDashboard } from './dashboard.js';
import { initPacientes } from './pacientes.js';
import { initAgenda } from './agenda/index.js';
import { initReports, initReportEditor } from './reports.js';
import { initGaleria } from './galeria.js';
import { initMensajes } from './mensajes.js';
import { initQr } from './qr.js';
import { initConfiguracion } from './configuracion.js';

const HEAD = {
  dashboard:      { title: 'Dashboard',      sub: 'Resumen general de tu actividad clínica' },
  agenda:         { title: 'Agenda',         sub: 'Gestiona tus citas y estudios' },
  pacientes:      { title: 'Pacientes',      sub: 'Expedientes y datos clínicos' },
  qr:             { title: 'Pre-registro QR', sub: 'Genera codigos seguros y recibe los datos del paciente antes de su cita' },
  'ia-reportes':  { title: 'Reportes',       sub: 'Genera, analiza y revisa reportes inteligentes impulsados por IA' },
  'ia-reportes-redactar': { title: 'Reporte', sub: 'Redacta y estructura el informe clínico' },
  mensajes:       { title: 'Mensajes',       sub: 'Gestiona tus conversaciones con pacientes' },
  galeria:        { title: 'Galería de pacientes', sub: 'Consulta y administra imágenes y videos de estudios' },
  finanzas:       { title: 'Finanzas',       sub: 'Ingresos y facturación' },
  configuracion:  { title: 'Configuracion', sub: 'Personaliza tu experiencia y gestiona los ajustes de tu cuenta y sistema' },
};

// Secciones ya migradas (tienen fragmento HTML en ./pages)
const AVAILABLE = new Set(['dashboard', 'pacientes', 'agenda', 'qr', 'ia-reportes', 'ia-reportes-redactar', 'galeria', 'mensajes', 'configuracion']);
const PAGE_FILES = {
  agenda: './pages/agenda_html/index.blade.html',
};

const pageContent = document.getElementById('pageContent');
const headTitle   = document.getElementById('headTitle');
const headSub     = document.getElementById('headSub');

function setActiveNav(route) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === route);
  });
}

function renderPlaceholder(route) {
  const meta = HEAD[route] || { title: route };
  pageContent.innerHTML = `
    <div class="card rise d1" style="text-align:center;padding:48px 24px">
      <h3 style="margin-bottom:8px">Sección "${meta.title}" en migración</h3>
      <p class="muted">Esta sección se migrará próximamente. Por ahora está disponible el Dashboard.</p>
    </div>`;
}

async function loadPage(route) {
  const meta = HEAD[route] || { title: route, sub: '' };
  headTitle.textContent = meta.title;
  headSub.textContent = meta.sub || '';
  document.body.dataset.route = route;
  setActiveNav(route);

  if (route === 'nuevo-estudio') {
    // La pantalla de captura/conexión con código vive en index.html (no se toca por ahora).
    window.location.href = './index.html';
    return;
  }

  if (!AVAILABLE.has(route)) {
    renderPlaceholder(route);
    return;
  }

  try {
    const pageUrl = PAGE_FILES[route] || `./pages/${route}.html`;
    const res = await fetch(pageUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pageContent.innerHTML = await res.text();

    if (route === 'dashboard') initDashboard();
    if (route === 'pacientes') initPacientes();
    if (route === 'agenda')    initAgenda();
    if (route === 'qr') initQr();
    if (route === 'ia-reportes') initReports();
    if (route === 'ia-reportes-redactar') initReportEditor();
    if (route === 'galeria') initGaleria();
    if (route === 'mensajes') initMensajes();
    if (route === 'configuracion') initConfiguracion();
  } catch (err) {
    pageContent.innerHTML = `<div class="card"><h3>Error</h3><p class="muted">No se pudo cargar la sección: ${err.message}</p></div>`;
  }
}

function currentRoute() {
  const hash = (window.location.hash || '#dashboard').slice(1);
  return hash || 'dashboard';
}

function navigate(route) {
  if (window.location.hash.slice(1) === route) {
    loadPage(route);
  } else {
    window.location.hash = route;
  }
}

// Delegación de clicks en cualquier elemento con [data-nav]
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-nav]');
  if (!el) return;
  e.preventDefault();
  navigate(el.dataset.nav);
});

window.addEventListener('hashchange', () => loadPage(currentRoute()));

// Toggle de tema
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('enclaii-theme', next);
  });
}

// Arranque
loadPage(currentRoute());
