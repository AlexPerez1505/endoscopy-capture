// Limpieza antes de cambiar de ruta: detiene el intervalo de
// sincronización de pacientes y dispara el evento
// "enclaii:route-before-change" para que otros módulos se limpien.
function cleanupModules(nextRoute) {
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

export { cleanupModules };
