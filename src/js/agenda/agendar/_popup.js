(function(){
  window.__initPopup = function(EVENTS, MESES, cur_ref, DIAS_ES) {
    const evPopup    = document.getElementById('evPopup');
    const evPopAvatar= document.getElementById('evPopAvatar');
    const evPopName  = document.getElementById('evPopName');
    const evPopDate  = document.getElementById('evPopDate');
    const evPopInfo  = document.getElementById('evPopInfo');
    const evPopBadge = document.getElementById('evPopBadge');
    const evPopBtns  = document.getElementById('evPopBtns');

    const STATUS_BUTTONS = {
      'ev-done':  [{label:'Datos del paciente',cls:'primary'},{label:'Reprogramar nueva cita',cls:'secondary'},{label:'Ver Informe',cls:'secondary'},{label:'Enviar mensaje',cls:'secondary'}],
      'ev-wait':  [{label:'Iniciar Estudio',cls:'primary'},{label:'Datos del Paciente',cls:'secondary'},{label:'Enviar mensaje',cls:'secondary'}],
      'ev-cancel':[{label:'Reprogramar Paciente',cls:'primary'},{label:'Datos del Paciente',cls:'secondary'},{label:'Enviar mensaje',cls:'secondary'}],
      'ev-soon':  [{label:'Reprogramar Paciente',cls:'primary'},{label:'Datos del Paciente',cls:'secondary'},{label:'Enviar mensaje',cls:'secondary'}],
    };
    const STATUS_LABELS = {'ev-done':'Completado','ev-wait':'En espera','ev-cancel':'Cancelado','ev-soon':'Próximos'};
    const STATUS_BADGE_CLS = {'ev-done':'done','ev-wait':'wait','ev-cancel':'cancel','ev-soon':'soon'};

    function parseEvent(el) {
      const text = el.textContent.trim();
      const timeMatch = text.match(/^(\d+:\d+)/);
      let time = el.dataset.time || (timeMatch ? timeMatch[1] : '00:00');
      const rest = text.replace(/^\d+:\d+\s*/, '');
      let fullName = el.dataset.name || '';
      let proc = el.dataset.proc || '';
      if (!fullName) {
        const parts = rest.split('·').map(s => s.trim());
        fullName = parts[0] || 'Paciente';
        proc = parts[1] || 'Procedimiento';
      }
      const displayName = (window.__displayName ? window.__displayName(fullName) : fullName);
      const initials = displayName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const cls = el.dataset.cls || [...el.classList].find(c => c.startsWith('ev-')) || 'ev-done';
      return {
        id: el.dataset.citaId || el.dataset.id || '',
        pacienteId: el.dataset.pacienteId || el.dataset.paciente_id || '',
        reprogramar_url: el.dataset.reprogramarUrl || '',
        deleteUrl: el.dataset.deleteUrl || '',
        estado: el.dataset.estado || '',
        estadoUrl: el.dataset.estadoUrl || '',
        fullName,
        displayName,
        initials,
        proc,
        time,
        duration: el.dataset.duration || '60',
        cls
      };
    }

    function positionPopup(e) {
      const pw = evPopup.offsetWidth  || 230;
      const ph = evPopup.offsetHeight || 200;
      const isPhone = window.innerWidth < 600;
      if (isPhone) {
        evPopup.style.left = '50%';
        evPopup.style.top  = '50%';
        evPopup.style.transform = 'translate(-50%,-50%)';
        evPopup.style.width = (Math.min(300, window.innerWidth - 32)) + 'px';
      } else {
        evPopup.style.transform = '';
        evPopup.style.width = '';
        let x = e.clientX + 14;
        let y = e.clientY + 14;
        if (x + pw > window.innerWidth  - 10) x = e.clientX - pw - 14;
        if (y + ph > window.innerHeight - 10) y = e.clientY - ph - 14;
        evPopup.style.left = x + 'px';
        evPopup.style.top  = y + 'px';
      }
    }

    const REPROG_LABELS = ['Reprogramar nueva cita','Reprogramar Paciente'];
    const PACIENTE_LABELS = ['Datos del paciente','Datos del Paciente'];
    const MENSAJE_LABELS = ['Enviar mensaje'];
    const INFORME_LABELS = ['Ver Informe'];
    const INICIAR_LABELS = ['Iniciar Estudio','Iniciar estudio'];

    function buildAgendarUrl(d, fechaTxt) {
      if (d.reprogramar_url) return d.reprogramar_url;

      if (d.id) {
        return '#agendar?cita_id=' + encodeURIComponent(d.id);
      }

      const params = new URLSearchParams();
      if (d.fullName) params.set('paciente', d.fullName);
      if (d.proc)     params.set('proc', d.proc);
      if (d.time)     params.set('hora', d.time);
      if (fechaTxt) {
        const m = fechaTxt.match(/(\d+)/);
        if (m) params.set('dia', m[1]);
      }
      return '#agendar?' + params.toString();
    }

    window.__showPopup = function(el, e) {
      let d;
      const isDayEvent = el.classList.contains('day-event');
      if (isDayEvent && el.dataset.name) {
        const displayName = (window.__displayName ? window.__displayName(el.dataset.name) : el.dataset.name);
        d = {
          fullName: el.dataset.name,
          displayName: displayName,
          initials: el.dataset.inits || displayName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),
          proc:     el.dataset.proc || 'Procedimiento',
          time:     el.dataset.time || '00:00',
          duration: el.dataset.duration || '60',
          cls:      el.dataset.evcls || 'ev-done',
          id:       el.dataset.citaId || el.dataset.id || '',
          pacienteId: el.dataset.pacienteId || el.dataset.paciente_id || '',
          deleteUrl: el.dataset.deleteUrl || '',
          estado: el.dataset.estado || '',
          estadoUrl: el.dataset.estadoUrl || '',
          reprogramar_url: el.dataset.reprogramarUrl || '',
        };
      } else {
        d = parseEvent(el);
      }
      const td = el.closest('td');
      let fechaTxt = el.dataset.fechatxt || '';
      let dayNum = null;
      if (fechaTxt) {
        const m = fechaTxt.match(/(\d+)/);
        if (m) dayNum = parseInt(m[1]);
      }
      if (dayNum === null && td) {
        const dn = td.querySelector('.day-num');
        if (dn) {
          dayNum = parseInt(dn.textContent);
        } else if (td.classList.contains('wk-cell')) {
          const tr = td.closest('tr');
          const colIdx = Array.from(tr.children).indexOf(td) - 1;
          const ths = document.querySelectorAll('#weekHead th');
          if (ths[colIdx + 1]) {
            const txt = ths[colIdx + 1].textContent.trim();
            const parts = txt.split(' ');
            dayNum = parseInt(parts[1]);
          }
        }
      }
      if (dayNum !== null && !fechaTxt) {
        const dateObj = new Date(cur_ref.y, cur_ref.m, dayNum);
        fechaTxt = `${DIAS_ES[dateObj.getDay()]} ${dayNum} de ${MESES[dateObj.getMonth()]}`;
      }

      let liveCls = d.cls;
      const recompute = window.__recomputeClass;
      if (typeof recompute === 'function' && dayNum !== null) {
        const dateKey = `${cur_ref.y}-${cur_ref.m + 1}-${dayNum}`;
        const [h] = String(d.time || '00:00').split(':').map(Number);
        liveCls = recompute({ cls: d.cls, estado: d.estado, hora: d.time, h: h || 0 }, dateKey);
      }

      function minutesTo12h(min) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
      }
      function time24To12h(time24) {
        const [h, m] = String(time24 || '00:00').split(':').map(Number);
        return minutesTo12h((h || 0) * 60 + (m || 0));
      }
      const startMin = (() => {
        const [h, m] = String(d.time || '00:00').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      })();
      const duration = parseInt(d.duration || '60', 10) || 60;
      const endMin = startMin + duration;
      const timeRange = `${time24To12h(d.time)} – ${minutesTo12h(endMin)}`;
      evPopAvatar.textContent = d.initials;
      evPopName.textContent   = d.displayName || d.fullName;
      evPopDate.innerHTML     = fechaTxt ? `<b>Fecha:</b> ${fechaTxt}` : '';
      evPopInfo.innerHTML =
        `<b>Motivo:</b> ${d.proc}<br>` +
        `<b>Tiempo:</b> ${timeRange}<br>` +
        `<b>Habitación:</b> Sala 3`;
      const badgeCls = STATUS_BADGE_CLS[liveCls] || 'done';
      evPopBadge.className = 'ev-pop-badge ' + badgeCls;
      evPopBadge.textContent = STATUS_LABELS[liveCls] || '';
      evPopBadge.style.display = 'inline-flex';
      evPopBtns.innerHTML = '';
      (STATUS_BUTTONS[liveCls] || STATUS_BUTTONS['ev-wait']).forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'ev-pop-btn ' + b.cls;
        btn.textContent = b.label;
        if (REPROG_LABELS.includes(b.label)) {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            window.location.href = buildAgendarUrl(d, fechaTxt);
          });
        }
        if (PACIENTE_LABELS.includes(b.label)) {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            if (d.pacienteId) {
              window.location.href = '#pacientes?paciente_id=' + encodeURIComponent(d.pacienteId);
            } else {
              window.location.href = '#pacientes?paciente=' + encodeURIComponent(d.fullName);
            }
          });
        }
        if (MENSAJE_LABELS.includes(b.label)) {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            window.location.href = '#mensajes?paciente=' + encodeURIComponent(d.displayName || d.fullName);
          });
        }
        if (INICIAR_LABELS.includes(b.label)) {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            if (d.pacienteId) {
              window.location.href = './index.html?paciente=' + encodeURIComponent(d.pacienteId);
            } else {
              window.location.href = './index.html?paciente=' + encodeURIComponent(d.fullName);
            }
          });
        }
        if (INFORME_LABELS.includes(b.label)) {
          btn.addEventListener('click', ev => {
            ev.stopPropagation();
            window.location.href = '#ia-reportes?paciente=' + encodeURIComponent(d.displayName || d.fullName) + '&procedimiento=' + encodeURIComponent(d.proc || 'Endoscopia');
          });
        }
        evPopBtns.appendChild(btn);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'ev-pop-btn danger';
      const puedeEliminar = ['cancelado', 'completado'].includes(d.estado);
      delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>${puedeEliminar ? 'Eliminar cita' : 'Cancelar cita'}`;
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        const evEl = popupAnchoredEl;
        if (!evEl) return;
        const isEliminar = ['cancelado', 'completado'].includes(evEl.dataset.estado);
        hidePopup();
        if (window.showDelConfirmGlobal) {
          window.showDelConfirmGlobal(evEl, isEliminar ? evEl.dataset.deleteUrl : evEl.dataset.estadoUrl);
        }
      });
      evPopBtns.appendChild(delBtn);
      positionPopup(e);
      evPopup.classList.add('visible');
    }

    let popupAnchoredEl = null;
    let popupCloseTimer = null;

    function hidePopup() {
      popupAnchoredEl = null;
      evPopup.classList.remove('visible');
    }

    function scheduleHide() {
      if (popupCloseTimer) clearTimeout(popupCloseTimer);
      popupCloseTimer = setTimeout(() => {
        if (!evPopup.matches(':hover') && !popupAnchoredEl?.matches(':hover')) {
          hidePopup();
        }
      }, 200);
    }

    function cancelHide() {
      if (popupCloseTimer) { clearTimeout(popupCloseTimer); popupCloseTimer = null; }
    }

    /* ---- Desktop: hover en cal/week events ---- */
    document.addEventListener('mouseover', e => {
      if (window.innerWidth < 600) return;
      const ev = e.target.closest('.cal-event, .wk-event');
      if (ev) {
        cancelHide();
        if (popupAnchoredEl !== ev) { popupAnchoredEl = ev; __showPopup(ev, e); }
        return;
      }
      if (e.target.closest('#evPopup')) { cancelHide(); return; }
      scheduleHide();
    });

    evPopup.addEventListener('mouseenter', cancelHide);
    evPopup.addEventListener('mouseleave', scheduleHide);

    /* ---- Móvil + Día: click en day-event / cal-event / wk-event ---- */
    document.addEventListener('click', e => {
      const ev = e.target.closest('.day-event, .cal-event, .wk-event');
      if (ev && !ev.classList.contains('ev-block')) {
        const isMobile = window.innerWidth < 600;
        const isDayEvent = ev.classList.contains('day-event');
        // En desktop, ev-done en la vista día no abre popup (usa el panel lateral)
        if (!isMobile && isDayEvent && ev.classList.contains('ev-done')) return;
        e.stopPropagation();
        if (popupAnchoredEl === ev) {
          popupAnchoredEl = null;
          evPopup.classList.remove('visible');
          return;
        }
        popupAnchoredEl = ev;
        __showPopup(ev, e);
        return;
      }
      if (e.target.closest('#evPopup')) return;
      popupAnchoredEl = null;
      evPopup.classList.remove('visible');
    });

    /* Cerrar popup con Escape */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { popupAnchoredEl = null; evPopup.classList.remove('visible'); }
    });

    /* ---- Arrastrar el popup ---- */
    let isDragging = false;
    let dragOffsetX = 0, dragOffsetY = 0;
    let dragStartX = 0, dragStartY = 0;
    let dragHasMoved = false;

    evPopup.addEventListener('mousedown', e => {
      if (e.target.closest('.ev-pop-btn') || e.target.closest('a')) return;
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      dragHasMoved = false;
      const rect = evPopup.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      cancelHide();
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      dragHasMoved = true;
      const x = e.clientX - dragOffsetX;
      const y = e.clientY - dragOffsetY;
      evPopup.style.left = x + 'px';
      evPopup.style.top  = y + 'px';
      evPopup.style.transform = 'none';
      cancelHide();
    });

    document.addEventListener('mouseup', e => {
      if (!isDragging) return;
      isDragging = false;
      // Una vez soltado, el popup permanece en su nueva posición.
      // Se cierra solo cuando el mouse abandona el popup (mouseleave)
      // o cuando el usuario pasa a otro evento/sale del popup.
      if (!e.target.closest('#evPopup')) {
        scheduleHide();
      }
    });
  };
})();
