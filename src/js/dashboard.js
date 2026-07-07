// ================= Dashboard · Inicializador =================
// Renderiza el calendario del mes, anima contadores y dibuja el gauge de riesgo.
// Los datos reales se conectarán al API de Laravel más adelante (data-bind).

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function renderCalendar(root) {
  const titleEl = root.querySelector('[data-bind="cal-title"]');
  const bodyEl = root.querySelector('[data-bind="cal-body"]');
  if (!bodyEl) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  if (titleEl) titleEl.textContent = `${MESES[month]} ${year}`;

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // 0 = Lunes
  const totalCells = startDow + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < 7; c++) {
      const idx = r * 7 + c;
      const dayNum = idx - startDow + 1;
      const isValid = idx >= startDow && dayNum <= daysInMonth;
      const isToday = dayNum === today && isValid;
      const isPast = isValid && new Date(year, month, dayNum) < new Date(year, month, today);
      if (!isValid) {
        html += `<td class="off">${dayNum > 0 && dayNum <= daysInMonth ? dayNum : ''}</td>`;
      } else if (isPast && !isToday) {
        html += `<td class="past">${dayNum}</td>`;
      } else {
        html += `<td class="${isToday ? 'today' : ''}">${dayNum}</td>`;
      }
    }
    html += '</tr>';
  }
  bodyEl.innerHTML = html;
}

function animateCounters(root) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-target]').forEach(counter => {
    const target = parseInt(counter.dataset.target, 10) || 0;
    if (reduced) { counter.textContent = target.toLocaleString('es-MX'); return; }
    const duration = 1200;
    const start = performance.now();
    function tick(t) {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      counter.textContent = Math.round(target * eased).toLocaleString('es-MX');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function drawGauge(root) {
  const gauge = root.querySelector('.gauge .val');
  if (!gauge) return;
  const pct = parseFloat(gauge.dataset.pct) / 100;
  const C = 314.16;
  setTimeout(() => { gauge.style.strokeDashoffset = C - (C * pct); }, 400);
}

export function initDashboard() {
  const root = document.getElementById('pageContent');
  if (!root) return;
  renderCalendar(root);
  animateCounters(root);
  drawGauge(root);
}
