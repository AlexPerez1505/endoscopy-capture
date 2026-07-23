import { beforeEach, describe, expect, it } from 'vitest';
import { createDoubleClickCalibrator } from '../double-click-calibrator.js';

const MIN_MS = 1200;
const MAX_MS = 6000;
const DEFAULT_MS = 2000;

function createCalibrator(overrides = {}) {
  return createDoubleClickCalibrator({
    min: MIN_MS,
    max: MAX_MS,
    defaultWindowMs: DEFAULT_MS,
    ...overrides,
  });
}

describe('createDoubleClickCalibrator', () => {
  it('arranca con el valor por defecto cuando no hay storage', () => {
    const calibrator = createCalibrator();

    expect(calibrator.getWindow()).toBe(DEFAULT_MS);
    expect(calibrator.getHistory()).toEqual([]);
  });

  it('respeta los límites min/max al registrar intervalos', () => {
    const calibrator = createCalibrator();

    calibrator.recordInterval(100);
    expect(calibrator.getWindow()).toBe(MIN_MS);

    const wide = createCalibrator();
    wide.recordInterval(20000);
    expect(wide.getWindow()).toBe(MAX_MS);
  });

  it('ajusta la ventana a la mediana + colchón de los intervalos aceptados', () => {
    const calibrator = createCalibrator();

    calibrator.recordInterval(1500);
    calibrator.recordInterval(1600);
    const { windowMs } = calibrator.recordInterval(1700);

    // mediana de [1500, 1600, 1700] = 1600 + 300 de colchón.
    expect(windowMs).toBe(1900);
    expect(calibrator.getWindow()).toBe(1900);
  });

  it('isDoubleClick e isNearMiss usan la ventana actual', () => {
    const calibrator = createCalibrator();

    expect(calibrator.isDoubleClick(DEFAULT_MS)).toBe(true);
    expect(calibrator.isDoubleClick(DEFAULT_MS + 1)).toBe(false);
    expect(calibrator.isNearMiss(DEFAULT_MS + 500, 1500)).toBe(true);
    expect(calibrator.isNearMiss(DEFAULT_MS + 1501, 1500)).toBe(false);
  });

  it('rechaza como valor atípico un intervalo muy alejado del historial estable', () => {
    const calibrator = createCalibrator();

    // Historial estable alrededor de ~1600ms (mínimo 3 muestras para activar
    // el chequeo de outliers).
    calibrator.recordInterval(1580);
    calibrator.recordInterval(1600);
    const beforeOutlier = calibrator.recordInterval(1620);
    const windowBeforeOutlier = beforeOutlier.windowMs;

    // Intervalo extremo (usuario distraído / rebote raro): se descarta.
    const outlierResult = calibrator.recordInterval(5900);

    expect(outlierResult.rejectedAsOutlier).toBe(true);
    expect(outlierResult.windowMs).toBe(windowBeforeOutlier);
    expect(calibrator.getHistory()).not.toContain(5900);
  });

  it('no rechaza outliers hasta tener al menos 3 muestras en el historial', () => {
    const calibrator = createCalibrator();

    const first = calibrator.recordInterval(1500);
    expect(first.rejectedAsOutlier).toBe(false);

    const second = calibrator.recordInterval(5800);
    expect(second.rejectedAsOutlier).toBe(false);
  });

  it('acepta una deriva gradual del intervalo real (desgaste del switch)', () => {
    const calibrator = createCalibrator();

    const intervals = [1500, 1550, 1600, 1650, 1700, 1750, 1800];
    let lastResult;

    for (const interval of intervals) {
      lastResult = calibrator.recordInterval(interval);
    }

    expect(lastResult.rejectedAsOutlier).toBe(false);
    expect(lastResult.windowMs).toBeGreaterThan(DEFAULT_MS - 100);
  });

  it('mantiene el historial acotado al tamaño configurado', () => {
    const calibrator = createCalibrator({ historySize: 3 });

    calibrator.recordInterval(1500);
    calibrator.recordInterval(1550);
    calibrator.recordInterval(1600);
    calibrator.recordInterval(1650);

    expect(calibrator.getHistory()).toHaveLength(3);
    expect(calibrator.getHistory()).toEqual([1550, 1600, 1650]);
  });

  it('persiste ventana e historial en el storage provisto', () => {
    const store = new Map();
    const fakeStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    };

    const calibrator = createCalibrator({
      storage: fakeStorage,
      storageKey: 'test-double-click-window-ms',
    });

    calibrator.recordInterval(1500);
    calibrator.recordInterval(1600);

    expect(store.get('test-double-click-window-ms')).toBe(String(calibrator.getWindow()));
    expect(JSON.parse(store.get('test-double-click-window-ms:history'))).toEqual([1500, 1600]);

    // Una nueva instancia con el mismo storage debe recuperar el estado.
    const restored = createDoubleClickCalibrator({
      min: MIN_MS,
      max: MAX_MS,
      defaultWindowMs: DEFAULT_MS,
      storage: fakeStorage,
      storageKey: 'test-double-click-window-ms',
    });

    expect(restored.getWindow()).toBe(calibrator.getWindow());
    expect(restored.getHistory()).toEqual(calibrator.getHistory());
  });

  it('ignora un historial corrupto en storage y cae al valor por defecto', () => {
    const fakeStorage = {
      getItem: (key) => {
        if (key === 'corrupt-window-ms') return 'not-a-number';
        if (key === 'corrupt-window-ms:history') return '{not valid json';
        return null;
      },
      setItem: () => {},
    };

    const calibrator = createCalibrator({
      storage: fakeStorage,
      storageKey: 'corrupt-window-ms',
    });

    expect(calibrator.getWindow()).toBe(DEFAULT_MS);
    expect(calibrator.getHistory()).toEqual([]);
  });
});
