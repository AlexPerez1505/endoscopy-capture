// Switch que ejecuta el inicializador de cada módulo (initDashboard,
// initPacientes, etc.) según la ruta. Recibe el signal del AbortController
// para que cada módulo pueda limpiar timers/listeners al navegar.
import { initDashboard } from '../../dashboard.js';
import { initPacientes } from '../../pacientes.js';
import { initPacienteForm } from '../../pacientes/index.js';
import { initAgenda } from '../../agenda/index.js';
import { initAgendar } from '../../agenda/agendar/index.js';
import {
  initReports,
  initReportEditor,
} from '../../reports.js';
import { initGaleria } from '../../galeria.js';
import { initMensajes } from '../../mensajes.js';
import { initQr } from '../../qr.js';
import { initConfiguracion } from '../../configuracion.js';

async function initializeRoute(route, signal) {
  switch (route) {
    case 'dashboard':
      await initDashboard({ signal });
      break;

    case 'pacientes':
      await initPacientes({ signal });
      break;

    case 'pacientes-crear':
    case 'pacientes-editar':
      await initPacienteForm({ signal });
      break;

    case 'agenda':
      await initAgenda({ signal });
      break;

    case 'agendar':
      await initAgendar({ signal });
      break;

    case 'qr':
      await initQr({ signal });
      break;

    case 'ia-reportes':
      await initReports({ signal });
      break;

    case 'ia-reportes-redactar':
      await initReportEditor({ signal });
      break;

    case 'galeria':
      await initGaleria({ signal });
      break;

    case 'mensajes':
      await initMensajes({ signal });
      break;

    case 'configuracion':
      await initConfiguracion({ signal });
      break;

    default:
      break;
  }
}

export { initializeRoute };
