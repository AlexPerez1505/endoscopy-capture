import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function renderStudyDom() {
  document.body.innerHTML = readFileSync(
    join(process.cwd(), 'src/pages/estudio-paciente.html'),
    'utf8'
  );
}

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem(AUTH_STORAGE_KEY, 'token-de-prueba');
  window.location.hash =
    '#estudio-paciente?paciente=142&estudio_id=57';
  renderStudyDom();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('estudio del paciente', () => {
  it('muestra paciente y reporte del estudio seleccionado desde el historial', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const value = String(url);

      if (value.includes('/api/tauri/pacientes/142')) {
        return Promise.resolve(
          jsonResponse({
            paciente: {
              id: 142,
              nombre_completo: 'Javier Molina',
              folio: 'P-111',
              edad: 48,
              sexo: 'Masculino',
              estudios: [
                {
                  estudio_id: 57,
                  folio: 'E-0057',
                  procedimiento: 'Endoscopia',
                  fecha: '2026-07-28',
                },
                {
                  estudio_id: 56,
                  folio: 'E-0056',
                  procedimiento: 'Colonoscopia',
                  fecha: '2026-07-27',
                },
              ],
            },
          })
        );
      }

      if (value.includes('/api/tauri/galeria')) {
        return Promise.resolve(
          jsonResponse({
            paciente: {
              id: 142,
              nombre_completo: 'Javier Molina',
              folio: 'P-111',
              estudios: [
                {
                  estudio_id: 57,
                  folio: 'E-0057',
                  procedimiento: 'Endoscopia',
                  fecha: '2026-07-28',
                  media: [
                    {
                      id: 1,
                      type: 'video',
                      file: 'video-57.mp4',
                    },
                    {
                      id: 2,
                      type: 'image',
                      file: 'img-57.jpg',
                    },
                  ],
                },
                {
                  estudio_id: 56,
                  folio: 'E-0056',
                  procedimiento: 'Colonoscopia',
                  fecha: '2026-07-27',
                  media: [
                    {
                      id: 3,
                      type: 'video',
                      file: 'video-56.mp4',
                    },
                  ],
                },
              ],
            },
          })
        );
      }

      if (value.includes('/api/tauri/reportes')) {
        return Promise.resolve(
          jsonResponse({
            reportes: [
              {
                id: 9,
                estudio_id: 57,
                titulo: 'Reporte final',
                fecha_reporte: '2026-07-29',
              },
              {
                id: 8,
                estudio_id: 56,
                titulo: 'Reporte anterior',
                fecha_reporte: '2026-07-28',
              },
            ],
          })
        );
      }

      return Promise.resolve(jsonResponse({}));
    });

    const { initEstudioPaciente } = await import('../estudio-paciente.js');
    await initEstudioPaciente();

    expect(
      document.querySelector('[data-study-tab="patient"]')?.textContent
    ).toBe('Paciente');
    expect(
      document.querySelector('[data-study-tab="report"]')?.textContent
    ).toBe('Reporte');
    expect(
      document.getElementById('studyPatientName')?.textContent
    ).toBe('Javier Molina');

    document.querySelector('[data-study-tab="report"]')?.click();

    const reportText =
      document.getElementById('studyTabReport')?.textContent || '';

    expect(reportText).toContain('video-57.mp4');
    expect(reportText).toContain('img-57.jpg');
    expect(reportText).toContain('Reporte final');
    expect(reportText).not.toContain('video-56.mp4');
    expect(reportText).not.toContain('Reporte anterior');
  });

  it('comparte por correo solo los archivos del estudio seleccionado', async () => {
    let sentUrl = '';
    let sentPayload = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url, options = {}) => {
      const value = String(url);
      const method = String(options.method || 'GET').toUpperCase();

      if (
        method === 'POST' &&
        value.includes('/api/tauri/estudios/57/compartir-correo')
      ) {
        sentUrl = value;
        sentPayload = JSON.parse(String(options.body || '{}'));

        return Promise.resolve(
          jsonResponse({
            ok: true,
            message: 'Correo enviado',
          })
        );
      }

      if (value.includes('/api/tauri/pacientes/142')) {
        return Promise.resolve(
          jsonResponse({
            paciente: {
              id: 142,
              nombre_completo: 'Javier Molina',
              folio: 'P-111',
              edad: 48,
              sexo: 'Masculino',
              estudios: [
                {
                  estudio_id: 57,
                  folio: 'E-0057',
                  procedimiento: 'Endoscopia',
                  fecha: '2026-07-28',
                },
                {
                  estudio_id: 56,
                  folio: 'E-0056',
                  procedimiento: 'Colonoscopia',
                  fecha: '2026-07-27',
                },
              ],
            },
          })
        );
      }

      if (value.includes('/api/tauri/galeria')) {
        return Promise.resolve(
          jsonResponse({
            paciente: {
              id: 142,
              nombre_completo: 'Javier Molina',
              folio: 'P-111',
              estudios: [
                {
                  estudio_id: 57,
                  folio: 'E-0057',
                  procedimiento: 'Endoscopia',
                  fecha: '2026-07-28',
                  media: [
                    {
                      id: 1,
                      type: 'video',
                      file: 'video-57.mp4',
                    },
                    {
                      id: 2,
                      type: 'image',
                      file: 'img-57.jpg',
                    },
                  ],
                },
                {
                  estudio_id: 56,
                  folio: 'E-0056',
                  procedimiento: 'Colonoscopia',
                  fecha: '2026-07-27',
                  media: [
                    {
                      id: 3,
                      type: 'video',
                      file: 'video-56.mp4',
                    },
                  ],
                },
              ],
            },
          })
        );
      }

      if (value.includes('/api/tauri/reportes')) {
        return Promise.resolve(
          jsonResponse({
            reportes: [
              {
                id: 9,
                estudio_id: 57,
                titulo: 'Reporte final',
                fecha_reporte: '2026-07-29',
                pdf_url: '/storage/reportes/reporte-57.pdf',
              },
              {
                id: 8,
                estudio_id: 56,
                titulo: 'Reporte anterior',
                fecha_reporte: '2026-07-28',
                pdf_url: '/storage/reportes/reporte-56.pdf',
              },
            ],
          })
        );
      }

      return Promise.resolve(jsonResponse({}));
    });

    const { initEstudioPaciente } = await import('../estudio-paciente.js');
    await initEstudioPaciente();

    document.querySelector('[data-study-tab="report"]')?.click();
    document.getElementById('studyShareBtn')?.click();

    document.getElementById('studyShareRecipients').value =
      'doctor@example.com, paciente@example.com';

    document.getElementById('studyShareForm')?.dispatchEvent(
      new Event('submit', {
        bubbles: true,
        cancelable: true,
      })
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sentUrl).toContain('/api/tauri/estudios/57/compartir-correo');
    expect(sentPayload).toMatchObject({
      paciente_id: '142',
      estudio_id: '57',
      recipients: [
        'doctor@example.com',
        'paciente@example.com',
      ],
      image_ids: ['2'],
      video_ids: ['1'],
      reporte_ids: ['9'],
    });
    expect(JSON.stringify(sentPayload)).toContain('img-57.jpg');
    expect(JSON.stringify(sentPayload)).toContain('video-57.mp4');
    expect(JSON.stringify(sentPayload)).toContain('reporte-57.pdf');
    expect(JSON.stringify(sentPayload)).not.toContain('video-56.mp4');
    expect(JSON.stringify(sentPayload)).not.toContain('reporte-56.pdf');
    expect(
      document.getElementById('studyShareStatus')?.textContent
    ).toBe('Correo enviado correctamente desde Laravel.');
  });
});
