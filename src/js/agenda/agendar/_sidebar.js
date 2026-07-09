(function(){
  const MAX_VISIBLE = 5;
  const DIAS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function formatFechaTxt(dateObj) {
    const now = new Date();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fecha = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const diff = Math.round((fecha - hoy) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    if (diff === 2) return 'Pasado mañana';
    if (diff > 0 && diff <= 6) return DIAS_ES[dateObj.getDay()];
    return `${dateObj.getDate()} ${MESES_C[dateObj.getMonth()]}`;
  }

  function parseHour(h) {
    const m = String(h).match(/^(\d+):(\d+)/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    return parseInt(h || 0) * 60;
  }

  function formatHora(t) {
    const m = String(t).match(/^(\d+):(\d+)/);
    if (!m) return t + ':00';
    const h = parseInt(m[1]);
    const min = m[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return `${h12}:${min} ${ampm}`;
  }

  function buildProximas() {
    const list = document.getElementById('proximasList');
    if (!list) return;

    const EVENTS = window.__AGENDA_EVENTS || {};
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const items = [];

    Object.entries(EVENTS).forEach(([key, evs]) => {
      const parts = key.split('-').map(Number);
      const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);

      if (dateObj < hoy) return;

      evs.forEach(ev => {
        const liveCls = typeof window.__recomputeClass === 'function' ? window.__recomputeClass(ev, key) : ev.cls;
        if (liveCls !== 'ev-wait' && liveCls !== 'ev-soon') return;

        if (dateObj.toDateString() === hoy.toDateString()) {
          if (parseHour(ev.hora || ev.h) < nowMin - 30) return;
        }

        const nameRaw = ev.name || 'Paciente';
        const proc = ev.proc || 'Procedimiento';
        const displayName = window.__displayName ? window.__displayName(nameRaw) : nameRaw;

        items.push({
          dateObj,
          ev,
          liveCls,
          name: nameRaw,
          displayName,
          proc,
          h: ev.hora || ev.h
        });
      });
    });

    items.sort((a, b) => {
      const da = a.dateObj - b.dateObj;
      if (da !== 0) return da;
      return parseHour(a.h) - parseHour(b.h);
    });

    list.innerHTML = '';

    const visible = items.slice(0, MAX_VISIBLE);
    const extra = items.length - MAX_VISIBLE;

    visible.forEach(item => {
      const inits = item.displayName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const fechaTxt = formatFechaTxt(item.dateObj);
      const horaTxt = formatHora(item.h);
      const isCls = item.liveCls === 'ev-wait' ? 'prox-avatar wait' : 'prox-avatar soon';
      const stateClass = item.liveCls === 'ev-wait' ? 'is-wait' : 'is-soon';

      const div = document.createElement('div');
      div.className = `prox-item ${stateClass}`;
      div.innerHTML = `
        <div class="${isCls}">${inits}</div>
        <div class="prox-info">
          <strong>${item.displayName}</strong>
          <span>${item.proc}</span>
          <span>${fechaTxt} · ${horaTxt}</span>
        </div>`;

      div.addEventListener('click', () => {
        if (window.openDayModal) {
          const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
          const y = item.dateObj.getFullYear();
          const m = item.dateObj.getMonth();
          const d = item.dateObj.getDate();
          const dow = item.dateObj.getDay();
          window.openDayModal(item.ev, dayNames, dow, d, m, y);
        }
      });

      list.appendChild(div);
    });

    if (extra > 0) {
      const more = document.createElement('a');
      more.href = '#';
      more.className = 'more-link';
      more.textContent = `+ ${extra} citas más`;
      list.appendChild(more);
    }

    if (items.length === 0) {
      list.innerHTML = '<div style="font-size:12px;color:rgba(234,241,255,.4);text-align:center;padding:12px 0">Sin citas próximas</div>';
    }
  }

  function waitAndBuild() {
    if (window.__AGENDA_EVENTS) buildProximas();
    else setTimeout(waitAndBuild, 60);
  }

  waitAndBuild();
  window.__rebuildProximas = buildProximas;
})();
