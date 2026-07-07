// ================= Router SPA de ENCLAII =================
// Carga fragmentos HTML desde ./pages y ejecuta el inicializador de cada sección.

import { initDashboard } from './dashboard.js';
import { initPacientes } from './pacientes.js';
import { initAgenda } from './agenda.js';
import { initReports, initReportEditor } from './reports.js';

const HEAD = {
  dashboard:      { title: 'Dashboard',      sub: 'Resumen general de tu actividad clínica' },
  agenda:         { title: 'Agenda',         sub: 'Gestiona tus citas y estudios' },
  pacientes:      { title: 'Pacientes',      sub: 'Expedientes y datos clínicos' },
  'ia-reportes':  { title: 'Reportes IA',    sub: 'Generación y edición de reportes' },
  mensajes:       { title: 'Mensajes',       sub: 'Comunicación con pacientes' },
  galeria:        { title: 'Galería',        sub: 'Imágenes y videos de estudios' },
  finanzas:       { title: 'Finanzas',       sub: 'Ingresos y facturación' },
  configuracion:  { title: 'Configuración', sub: 'Preferencias y ajustes' },
};

// Secciones ya migradas (tienen fragmento HTML en ./pages)
const AVAILABLE = new Set(['dashboard', 'pacientes', 'agenda', 'ia-reportes', 'ia-reportes-redactar']);

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
    const res = await fetch(`./pages/${route}.html`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pageContent.innerHTML = await res.text();

    if (route === 'dashboard') initDashboard();
    if (route === 'pacientes') initPacientes();
    if (route === 'agenda')    initAgenda();
    if (route === 'ia-reportes') initReports();
    if (route === 'ia-reportes-redactar') initReportEditor();
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
