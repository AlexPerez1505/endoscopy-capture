/* =========================================================
   LIMITE DE CONCURRENCIA
   Utilidad generica para procesar una lista de items sin
   disparar todas las tareas en paralelo (p. ej. N imagenes
   pidiendose a Laravel al mismo tiempo, saturando el puente
   IPC de Tauri). Se procesan de a `limit` a la vez; en cuanto
   una termina, se toma la siguiente de la cola.
========================================================= */

export async function runWithConcurrencyLimit(items, limit, worker) {
  const list = Array.from(items || []);

  if (!list.length) {
    return;
  }

  const effectiveLimit = Math.max(
    1,
    Math.min(limit || 1, list.length)
  );

  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        await worker(list[currentIndex], currentIndex);
      } catch (error) {
        console.error('runWithConcurrencyLimit: fallo en un item.', error);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: effectiveLimit },
      runWorker
    )
  );
}
