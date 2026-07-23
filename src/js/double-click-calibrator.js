// Calibrador de la ventana de doble clic del remoto del capturador.
//
// El switch fisico soldado al remoto no tiene un timing 100% estable: el
// intervalo real entre los dos clics de un "doble clic" deliberado se va
// corriendo con el uso (desgaste/oxidacion del contacto). Para no tener que
// re-ajustar esto a mano, la ventana se auto-calibra a partir del historial
// de intervalos observados.
//
// A diferencia de un ajuste "de un solo salto" (que reacciona por completo a
// cada clic, incluyendo valores atipicos como un rebote raro o un usuario
// distraido), este calibrador:
//   - Mantiene un historial acotado de los ultimos intervalos aceptados.
//   - Calcula la ventana como la MEDIANA de ese historial (+ colchon), que es
//     mucho mas resistente a valores atipicos que tomar el ultimo dato tal
//     cual.
//   - Antes de aceptar un intervalo nuevo en el historial, lo compara contra
//     la Desviacion Absoluta Mediana (MAD) del historial actual. Si el
//     intervalo nuevo se aleja demasiado de lo habitual, se descarta como
//     valor atipico y NO contamina el historial (aunque el clic en si se
//     sigue procesando normalmente para decidir si es foto o video).

const DEFAULT_HISTORY_SIZE = 5;
const MIN_SAMPLES_FOR_OUTLIER_CHECK = 3;
const OUTLIER_MAD_MULTIPLIER = 3;
const MIN_MAD_FLOOR_MS = 150;
const WINDOW_PADDING_MS = 300;

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianAbsoluteDeviation(values, centerValue) {
  if (!values.length) return 0;

  const deviations = values.map((value) => Math.abs(value - centerValue));

  return median(deviations) ?? 0;
}

/**
 * Crea un calibrador de ventana de doble clic.
 *
 * @param {object} options
 * @param {number} options.min - Piso absoluto de la ventana, en ms.
 * @param {number} options.max - Techo absoluto de la ventana, en ms.
 * @param {number} options.defaultWindowMs - Valor inicial si no hay nada guardado.
 * @param {number} [options.historySize] - Cuantos intervalos aceptados recordar.
 * @param {Storage} [options.storage] - Storage tipo localStorage (opcional).
 * @param {string} [options.storageKey] - Clave base para persistir estado.
 */
export function createDoubleClickCalibrator({
  min,
  max,
  defaultWindowMs,
  historySize = DEFAULT_HISTORY_SIZE,
  storage = null,
  storageKey = null,
} = {}) {
  const historyStorageKey = storageKey ? `${storageKey}:history` : null;

  function clamp(value) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function loadStoredWindow() {
    if (!storage || !storageKey) return defaultWindowMs;

    const stored = Number(storage.getItem(storageKey));

    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : defaultWindowMs;
  }

  function loadStoredHistory() {
    if (!storage || !historyStorageKey) return [];

    try {
      const raw = storage.getItem(historyStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];

      return Array.isArray(parsed) ? parsed.filter((value) => Number.isFinite(value) && value > 0) : [];
    } catch {
      return [];
    }
  }

  let windowMs = loadStoredWindow();
  let history = loadStoredHistory();

  function persist() {
    if (!storage) return;

    if (storageKey) storage.setItem(storageKey, String(windowMs));
    if (historyStorageKey) storage.setItem(historyStorageKey, JSON.stringify(history));
  }

  function isOutlier(candidateMs) {
    if (history.length < MIN_SAMPLES_FOR_OUTLIER_CHECK) return false;

    const center = median(history);
    const mad = Math.max(medianAbsoluteDeviation(history, center), MIN_MAD_FLOOR_MS);

    return Math.abs(candidateMs - center) > OUTLIER_MAD_MULTIPLIER * mad;
  }

  /**
   * Registra un intervalo observado entre dos clics (candidato a doble
   * clic o "casi doble clic"). Si no se detecta como valor atipico, se
   * incorpora al historial y se recalcula la ventana como la mediana del
   * historial + colchon.
   *
   * @returns {{ windowMs: number, rejectedAsOutlier: boolean }}
   */
  function recordInterval(intervalMs) {
    const rejectedAsOutlier = isOutlier(intervalMs);

    if (!rejectedAsOutlier) {
      history = [...history, intervalMs].slice(-historySize);
      windowMs = clamp(median(history) + WINDOW_PADDING_MS);
      persist();
    }

    return { windowMs, rejectedAsOutlier };
  }

  return {
    getWindow: () => windowMs,
    isDoubleClick: (intervalMs) => intervalMs <= windowMs,
    isNearMiss: (intervalMs, marginMs) => intervalMs <= windowMs + marginMs,
    recordInterval,
    getHistory: () => [...history],
  };
}
