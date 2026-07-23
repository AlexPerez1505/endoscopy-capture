// Mapea sub-rutas (pacientes-crear, agendar, ia-reportes-redactar)
// a su ruta padre para saber qué ítem del sidebar marcar como activo.
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
    route === 'ia-reportes-redactar'
  ) {
    return 'ia-reportes';
  }

  return route;
}

export { navRouteFor };
