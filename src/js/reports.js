// ================= IA Reportes · Inicializador =================

const SAMPLE_REPORTS = [
  { id:201, name:'María González', initials:'MG', study:'Endoscopía alta', date:'07/07/2025', time:'09:45 AM', critical:true },
  { id:202, name:'Carlos Ramírez', initials:'CR', study:'Colonoscopía', date:'07/07/2025', time:'12:15 PM', critical:false },
  { id:203, name:'Ana Torres', initials:'AT', study:'Consulta general', date:'05/07/2025', time:'10:30 AM', critical:false },
  { id:204, name:'Luis Hernández', initials:'LH', study:'Gastroscopía', date:'04/07/2025', time:'04:20 PM', critical:true },
];

function reportRowHTML(r) {
  return `
    <tr>
      <td><span class="pat"><span class="mini">${r.initials}</span>${r.name}</span></td>
      <td>${r.study}</td>
      <td class="date">${r.date} <small>${r.time}</small></td>
      <td><span class="chip ${r.critical ? 'urgent' : 'done'}">${r.critical ? 'Crítico' : 'Normal'}</span></td>
      <td>
        <div class="row-actions">
          <a href="#" title="Ver"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
          <a href="#" title="Descargar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
          <a href="#ia-reportes/redactar" data-nav="ia-reportes-redactar" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></a>
        </div>
      </td>
    </tr>`;
}

export function initReports() {
  const tbody = document.getElementById('reportsTableBody');
  if (tbody) {
    tbody.innerHTML = SAMPLE_REPORTS.map(reportRowHTML).join('');
  }

  // Animar KPIs
  document.querySelectorAll('.stat .num').forEach(counter => {
    const target = parseInt(counter.dataset.target, 10) || 0;
    let current = 0;
    const step = target / 50;
    const interval = setInterval(() => {
      current += step;
      if (current >= target) {
        counter.textContent = target.toLocaleString();
        clearInterval(interval);
      } else {
        counter.textContent = Math.round(current).toLocaleString();
      }
    }, 20);
  });
}

export function initReportEditor() {
  // Inicialización básica del editor (puedes agregar más lógica de execCommand aquí)
  console.log("Editor de reportes inicializado");
}
