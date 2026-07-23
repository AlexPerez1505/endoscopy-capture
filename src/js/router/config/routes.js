// Define qué rutas son válidas (AVAILABLE) y qué archivo HTML
// corresponde a cada una (PAGE_FILES). Es el mapa estático del router.
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

export { AVAILABLE, PAGE_FILES };
