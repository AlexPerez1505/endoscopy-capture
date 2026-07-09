(function(){
  window.__getMondayOf = function(date) {
    const d = new Date(date);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
    d.setDate(d.getDate() - dow);
    d.setHours(0,0,0,0);
    return d;
  };

  window.__buildWeek = function(date, EVENTS, MESES, DIAS_CORTO, updateSumCards, countEvents) {
    const monday = window.__getMondayOf(date);
    const today  = new Date();
    const HOURS  = [8,9,10,11,12,13,14,15,16,17,18,19,20,21];

    const thead = document.getElementById('weekHead');
    thead.innerHTML = '';
    const headTr = document.createElement('tr');
    const thHora = document.createElement('th');
    thHora.textContent = 'Hora';
    headTr.appendChild(thHora);

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDays.push(d);
      const th = document.createElement('th');
      if (d.toDateString() === today.toDateString()) th.classList.add('wk-today');
      th.textContent = DIAS_CORTO[i] + ' ' + d.getDate();
      headTr.appendChild(th);
    }
    thead.appendChild(headTr);

    document.getElementById('mesActual').textContent = MESES[monday.getMonth()];
    document.getElementById('anioActual').textContent = monday.getFullYear();

    const weekKeys = weekDays.map(d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`);
    updateSumCards(countEvents(weekKeys));

    const tbody = document.getElementById('weekBody');
    tbody.innerHTML = '';
    HOURS.forEach(hr => {
      const tr = document.createElement('tr');
      const tdHr = document.createElement('td');
      tdHr.className = 'hr-label';
      tdHr.textContent = hr + ':00';
      tr.appendChild(tdHr);
      weekDays.forEach(d => {
        const td = document.createElement('td');
        td.className = 'wk-cell';
        if (d.toDateString() === today.toDateString()) td.classList.add('wk-today-col');
        const key = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        const cellEvents = (EVENTS[key] || []).filter(ev => ev.h === hr);
        const MAX_VISIBLE = 2;
        cellEvents.slice(0, MAX_VISIBLE).forEach(ev => {
          const liveCls = typeof window.__recomputeClass === 'function' ? window.__recomputeClass(ev, key) : ev.cls;
          const div = document.createElement('div');
          div.className = 'wk-event ' + liveCls;
          let name = ev.name || '';
          let proc = ev.proc || '';
          if (!name && ev.t) {
            const parts = ev.t.split('·').map(s => s.trim());
            const timeAndName = parts[0] || '';
            name = timeAndName.replace(/^\d+:\d+\s*/, '');
            proc = parts[1] || '';
          }
          const displayName = (window.__displayName ? window.__displayName(name) : name);
          const timeM = ev.t ? ev.t.match(/^(\d+:\d+)/) : null;
          div.innerHTML = `<div class="wk-line1">${displayName}</div><div class="wk-line2">${proc}</div>`;
          div.dataset.name = name;
          div.dataset.proc = proc;
          div.dataset.cls = liveCls;
          div.dataset.time = timeM ? timeM[1] : (ev.h ? String(ev.h).padStart(2,'0') + ':00' : '');
          div.dataset.duration = ev.duracion || '60';
          div.dataset.citaId = ev.id || '';
          div.dataset.pacienteId = ev.paciente_id || '';
          div.dataset.deleteUrl = ev.delete_url || '';
          div.dataset.estado = ev.estado || '';
          div.dataset.estadoUrl = ev.estado_url || '';
          td.appendChild(div);
        });
        if (cellEvents.length > MAX_VISIBLE) {
          const moreBtn = document.createElement('button');
          moreBtn.className = 'wk-more-btn';
          moreBtn.textContent = `+${cellEvents.length - MAX_VISIBLE} más`;
          moreBtn.dataset.day = d.toDateString();
          moreBtn.dataset.hour = hr;
          moreBtn.dataset.key = key;
          moreBtn.addEventListener('click', e => {
            e.stopPropagation();
            openWeekModal(cellEvents, d, hr, DIAS_CORTO[i]);
          });
          td.appendChild(moreBtn);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  };

  /* ---- Modal de citas ---- */
  const wkModalOverlay = document.getElementById('wkModalOverlay');
  const wkModalTitle   = document.getElementById('wkModalTitle');
  const wkModalBody    = document.getElementById('wkModalBody');
  const wkModalClose   = document.getElementById('wkModalClose');

  const STATUS_LABELS = {'ev-done':'Completado','ev-wait':'En espera','ev-cancel':'Cancelado','ev-soon':'Próximos'};

  function minutesTo12h(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  function time24To12h(time24) {
    const [h, m] = String(time24 || '00:00').split(':').map(Number);
    return minutesTo12h((h || 0) * 60 + (m || 0));
  }

  window.openWeekModal = function(events, date, hour, dayName) {
    const dStr = `${dayName} ${date.getDate()}`;
    const key = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
    const hourLabel = hour !== '' ? time24To12h(String(hour).padStart(2, '0') + ':00') : '';
    wkModalTitle.textContent = hourLabel ? `${dStr} – ${hourLabel}` : `${dStr} – Citas del día`;
    wkModalBody.innerHTML = '';
    events.forEach(ev => {
      const liveCls = typeof window.__recomputeClass === 'function' ? window.__recomputeClass(ev, key) : ev.cls;
      const parsed = (typeof window.__parseEvData === 'function') ? window.__parseEvData(ev) : null;
      let name = parsed ? parsed.name : (ev.name || '');
      let proc = parsed ? parsed.proc : (ev.proc || '');
      if (!name && ev.t && !parsed) {
        const parts = ev.t.split('·').map(s => s.trim());
        const timeAndName = parts[0] || '';
        name = timeAndName.replace(/^\d+:\d+\s*/, '');
        proc = parts[1] || '';
      }
      const displayName = (window.__displayName ? window.__displayName(name) : name);
      const inits = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const cls = liveCls;
      const statusKey = cls.replace('ev-', '');
      const statusLabel = STATUS_LABELS[cls] || statusKey;

      const item = document.createElement('div');
      item.className = 'wk-modal-item';
      item.dataset.name = name;
      item.dataset.proc = proc;
      item.dataset.cls = cls;
      item.dataset.pacienteId = ev.paciente_id || '';
      item.dataset.citaId = ev.id || '';
      item.dataset.deleteUrl = ev.delete_url || '';
      item.dataset.estado = ev.estado || '';
      item.dataset.estadoUrl = ev.estado_url || '';
      item.innerHTML = `
        <div class="wk-modal-avatar">${inits}</div>
        <div class="wk-modal-info">
          <div class="wk-modal-name">${displayName}</div>
          <div class="wk-modal-proc">${proc}</div>
        </div>
        <div class="wk-modal-badge ${statusKey}">${statusLabel}</div>
      `;
      item.addEventListener('click', () => {
        const DIAS_MODAL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        closeWkModal();
        setTimeout(() => {
          if (window.openDayModal) {
            window.openDayModal(ev, DIAS_MODAL, date.getDay(), date.getDate(), date.getMonth(), date.getFullYear());
          }
        }, 200);
      });
      wkModalBody.appendChild(item);
    });
    wkModalOverlay.classList.add('open');
  };

  function closeWkModal() {
    wkModalOverlay.classList.remove('open');
  }

  wkModalClose.addEventListener('click', closeWkModal);
  wkModalOverlay.addEventListener('click', e => {
    if (e.target === wkModalOverlay) closeWkModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && wkModalOverlay.classList.contains('open')) closeWkModal();
  });
})();
