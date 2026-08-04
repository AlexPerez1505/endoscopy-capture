import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  AUTH_STORAGE_KEY,
} from '../auth.js';
import {
  STUDY_ID_STORAGE_KEY,
  STUDY_LABEL_STORAGE_KEY,
  STUDY_PATIENT_ID_STORAGE_KEY,
  STUDY_PATIENT_NAME_STORAGE_KEY,
} from '../storage-keys.js';

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function renderPatientsDom() {
  document.body.innerHTML = `
    <input id="searchInput">
    <select id="fMedico"></select>
    <div id="patientsTableBody"></div>
    <div id="paginationInfo"></div>
    <div id="paginationControls"></div>
    <div id="contentWrapper">
      <div class="patients-card"></div>
      <aside id="patientPanel">
        <div id="panelAvatar"></div>
        <div id="panelName"></div>
        <div id="panelFolio"></div>
        <div id="panelAge"></div>
        <div id="panelGender"></div>
        <div id="panelDob"></div>
        <div id="panelPhone"></div>
        <div id="panelEmail"></div>
        <div id="panelAddress"></div>
        <div id="panelMedicoInfo"></div>
        <div id="panelStatus"></div>
        <div id="panelLastStudy"></div>
        <div id="panelTotalStudies"></div>
        <div id="reportPanelName"></div>
        <div id="reportPanelFolio"></div>
        <div id="reportPanelMeta"></div>
        <div id="reportPanelAvatar"></div>
        <span id="panelHistoryCount"></span>
        <div id="historialList"></div>
        <div id="historialEmpty"></div>
      </aside>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.dataset.patientMenuEventsBound = '';
  document.documentElement.dataset.patientsPaginationBound = '';
  document.documentElement.dataset.patientsControlsBound = '';
  document.documentElement.dataset.patientsRealtimeBound = '';
  document.documentElement.dataset.patientAvatarFallbackBound = '';
  sessionStorage.setItem(AUTH_STORAGE_KEY, 'token-de-prueba');
  renderPatientsDom();
});

afterEach(() => {
  window.stopPatientsRealtimeSync?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.enclaiiNavigate;
});

describe('historial de pacientes', () => {
  it('abre el detalle del estudio al hacer click en un estudio del historial', async () => {
    const navigate = vi.fn();
    window.enclaiiNavigate = navigate;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        pacientes: [
          {
            id: 13,
            nombre_completo: 'Prueba Tauri 09',
            folio: 'P-013',
            estudios_count: 1,
            estudios: [
              {
                estudio_id: 77,
                procedimiento: 'Endoscopia',
                fecha: '2026-07-31',
              },
            ],
          },
        ],
        pagination: {
          last_page: 1,
        },
        server_time: '2026-07-31T12:00:00Z',
      })
    );

    const { initPacientes } = await import('../pacientes.js');
    await initPacientes();

    window.openPanel(0);
    document
      .querySelector('[data-open-study-gallery]')
      .click();

    expect(navigate).toHaveBeenCalledWith(
      'estudio-paciente?paciente=13&estudio_id=77'
    );
    expect(
      sessionStorage.getItem(STUDY_PATIENT_ID_STORAGE_KEY)
    ).toBe('13');
    expect(
      sessionStorage.getItem(STUDY_PATIENT_NAME_STORAGE_KEY)
    ).toBe('Prueba Tauri 09');
    expect(
      sessionStorage.getItem(STUDY_ID_STORAGE_KEY)
    ).toBe('77');
    expect(
      sessionStorage.getItem(STUDY_LABEL_STORAGE_KEY)
    ).toBe('Endoscopia');
  });

  it('carga el historial completo cuando el listado solo trae el ultimo estudio', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          pacientes: [
            {
              id: 113,
              nombre_completo: 'Yolo Ventura',
              folio: 'P-113',
              ultimo_estudio: {
                estudio_id: 31,
                procedimiento: 'Endoscopia',
                fecha: '2026-07-31',
              },
            },
          ],
          pagination: {
            last_page: 1,
          },
          server_time: '2026-07-31T12:00:00Z',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          paciente: {
            id: 113,
            nombre_completo: 'Yolo Ventura',
            folio: 'P-113',
          },
          estudios_count: 2,
          estudios: [
            {
              estudio_id: 31,
              procedimiento: 'Endoscopia',
              fecha: '2026-07-31',
            },
            {
              estudio_id: 30,
              procedimiento: 'Colonoscopia',
              fecha: '2026-07-27',
            },
          ],
        })
      );

    const { initPacientes } = await import('../pacientes.js');
    await initPacientes();

    window.openPanel(0);

    expect(
      document.querySelectorAll('[data-open-study-gallery]')
    ).toHaveLength(1);

    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls[1][0]
    ).toContain('/api/tauri/pacientes/113');
    expect(
      document.querySelectorAll('[data-open-study-gallery]')
    ).toHaveLength(2);
    expect(
      document.getElementById('panelHistoryCount')?.textContent
    ).toBe('2');
    expect(
      document.getElementById('historialList')?.textContent
    ).toContain('Colonoscopia');
    expect(
      document.getElementById('btnVerTodoHistorial')
    ).toBeNull();
  });

  it('completa el historial desde galeria si el detalle del paciente no trae todos los estudios', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          pacientes: [
            {
              id: 113,
              nombre_completo: 'Yolo Ventura',
              folio: 'P-113',
              estudios_count: 2,
              estudios: [
                {
                  estudio_id: 84,
                  procedimiento: 'Estudio',
                  fecha: '2026-07-31',
                  estado: 'en_proceso',
                },
              ],
            },
          ],
          pagination: {
            last_page: 1,
          },
          server_time: '2026-07-31T12:00:00Z',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          paciente: {
            id: 113,
            nombre_completo: 'Yolo Ventura',
            folio: 'P-113',
            estudios_count: 2,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          pacientes: [
            {
              id: 113,
              nombre_completo: 'Yolo Ventura',
              folio: 'P-113',
              estudios_count: 2,
              estudios: [
                {
                  estudio_id: 62,
                  procedimiento: 'Endoscopia',
                  fecha: '2026-07-31',
                  archivos_count: 4,
                  estado: 'en_proceso',
                },
                {
                  estudio_id: 59,
                  procedimiento: 'Endoscopia',
                  fecha: '2026-07-30',
                  archivos_count: 1,
                  estado: 'en_proceso',
                },
              ],
            },
          ],
        })
      );

    const { initPacientes } = await import('../pacientes.js');
    await initPacientes();

    window.openPanel(0);

    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls[1][0]
    ).toContain('/api/tauri/pacientes/113');
    expect(
      fetchMock.mock.calls[2][0]
    ).toContain('/api/tauri/galeria');
    expect(
      document.querySelectorAll('[data-open-study-gallery]')
    ).toHaveLength(2);
    expect(
      document.getElementById('historialList')?.textContent
    ).toContain('E-0062');
    expect(
      document.getElementById('historialList')?.textContent
    ).toContain('E-0059');
    expect(
      document.getElementById('historialList')?.textContent
    ).not.toContain('E-0084');
  });

  it('no da por completo un arreglo de un estudio sin contador', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          pacientes: [
            {
              id: 113,
              nombre_completo: 'Yolo Ventura',
              folio: 'P-113',
              estudios: [
                {
                  estudio_id: 84,
                  procedimiento: 'Estudio',
                  fecha: '2026-07-31',
                },
              ],
            },
          ],
          pagination: {
            last_page: 1,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          paciente: {
            id: 113,
            nombre_completo: 'Yolo Ventura',
            folio: 'P-113',
            estudios: [
              {
                estudio_id: 84,
                procedimiento: 'Estudio',
                fecha: '2026-07-31',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          paciente: {
            id: 113,
            nombre_completo: 'Yolo Ventura',
            folio: 'P-113',
            estudios: [
              {
                estudio_id: 62,
                procedimiento: 'Endoscopia',
                fecha: '2026-07-31',
              },
              {
                estudio_id: 59,
                procedimiento: 'Endoscopia',
                fecha: '2026-07-30',
              },
            ],
          },
        })
      );

    const { initPacientes } = await import('../pacientes.js');
    await initPacientes();

    window.openPanel(0);

    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }

    expect(
      document.querySelectorAll('[data-open-study-gallery]')
    ).toHaveLength(2);
    expect(
      document.getElementById('panelHistoryCount')?.textContent
    ).toBe('2');
  });
});
