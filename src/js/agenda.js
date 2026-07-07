// ================= Agenda · Inicializador =================
// Gestiona la vista mensual de la agenda, navegación y filtros.
// Los datos reales se conectarán al API de Laravel más adelante.

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const SAMPLE_EVENTS = [
  { id:101, title:'María González', sub:'Endoscopía alta', date:'2025-07-07', h:'09:00', cls:'ev-done' },
  { id:102, title:'Carlos Ramírez', sub:'Colonoscopía', date:'2025-07-07', h:'11:30', cls:'ev-wait' },
  { id:103, title:'Ana Torres', sub:'Consulta general', date:'2025-07-15', h:'10:00', cls:'ev-soon' },
  { id:104, title:'Luis Hernández', sub:'Gastroscopía', date:'2025-07-20', h:'12:30', cls:'ev-soon' },
  { id:105, title:'Sofía Martínez', sub:'Endoscopía alta', date:'2025-07-28', h:'09:00', cls:'ev-soon' },
];

let currentDate = new Date();

function buildCalendar(date, events) {
  const y = date.getFullYear();
  const m = date.getMonth();

  const mesActualEl = document.getElementById('mesActual');
  const anioActualEl = document.getElementById('anioActual');
  if (mesActualEl) mesActualEl.textContent = MESES[m];
  if (anioActualEl) anioActualEl.textContent = y;

  const today = new Date();
  today.setHours(0,0,0,0);

  let startDow = new Date(y, m, 1).getDay();
  startDow = startDow === 0 ? 6 : startDow - 1; // Ajustar a Lunes inicio

  const tbody = document.getElementById('calBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let day = 1 - startDow;
  const lastDay = new Date(y, m + 1, 0).getDate();

  for (let row = 0; row < 6; row++) {
    const tr = document.createElement('tr');
    let hasValidDay = false;

    for (let col = 0; col < 7; col++) {
      const td = document.createElement('td');
      const cellDate = new Date(y, m, day);
      const isOff = day < 1 || day > lastDay;
      
      if (isOff) {
        td.className = 'off-month';
        const offDay = cellDate.getDate();
        td.innerHTML = `<span class="day-num">${offDay}</span>`;
      } else {
        hasValidDay = true;
        const dateKey = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const isToday = cellDate.getTime() === today.getTime();
        if (isToday) td.className = 'today-cell';

        let html = `<span class="day-num">${day}</span>`;
        
        // Filtrar eventos del día
        const dayEvents = events.filter(e => e.date === dateKey);
        dayEvents.forEach(ev => {
          html += `
            <div class="cal-event ${ev.cls}" title="${ev.title} - ${ev.sub}">
              <div class="ce-line1">${ev.h} ${ev.title}</div>
              <div class="ce-line2">${ev.sub}</div>
            </div>`;
        });

        td.innerHTML = html;
      }
      tr.appendChild(td);
      day++;
    }
    if (row < 5 || hasValidDay) tbody.appendChild(tr);
  }
}

function updateProxList(events) {
  const container = document.getElementById('proxList');
  if (!container) return;

  const now = new Date();
  const upcoming = events
    .filter(e => new Date(e.date + 'T' + e.h) >= now)
    .sort((a,b) => new Date(a.date + 'T' + a.h) - new Date(b.date + 'T' + b.h))
    .slice(0, 4);

  if (upcoming.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt-soft);font-size:12px">No hay citas próximas agendadas</div>';
    return;
  }

  container.innerHTML = upcoming.map(ev => {
    const d = new Date(ev.date + 'T' + ev.h);
    const timeStr = d.toLocaleTimeString('es-MX', { hour:'numeric', minute:'2-digit', hour12:true });
    const dateStr = d.toLocaleDateString('es-MX', { day:'numeric', month:'short' });
    return `
      <div class="prox-item">
        <div class="prox-time">
          <span class="h">${timeStr.split(' ')[0]}</span>
          <span class="m">${timeStr.split(' ')[1]}</span>
        </div>
        <div class="prox-info">
          <div class="prox-name">${ev.title}</div>
          <div class="prox-study">${ev.sub} · ${dateStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

export function initAgenda() {
  buildCalendar(currentDate, SAMPLE_EVENTS);
  updateProxList(SAMPLE_EVENTS);

  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');

  if (prevBtn) {
    prevBtn.onclick = () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      buildCalendar(currentDate, SAMPLE_EVENTS);
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      buildCalendar(currentDate, SAMPLE_EVENTS);
    };
  }

  // Lógica de filtros simple
  document.querySelectorAll('.filter-row input').forEach(cb => {
    cb.onchange = () => {
      const activeFilters = Array.from(document.querySelectorAll('.filter-row input:checked'))
        .map(c => c.dataset.filter);
      
      const filteredEvents = SAMPLE_EVENTS.filter(e => activeFilters.includes(e.cls));
      buildCalendar(currentDate, filteredEvents);
    };
  });
}
