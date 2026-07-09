const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const DIAS_ES    = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

let cur = new Date();
let curView = 'mes';

function updateSumCards(counts) {
  const map = {
    'ev-done':   {el: document.querySelector('.sum-done'),  cnt: document.getElementById('cntDone')},
    'ev-wait':   {el: document.querySelector('.sum-wait'),  cnt: document.getElementById('cntWait')},
    'ev-cancel': {el: document.querySelector('.sum-cancel'),cnt: document.getElementById('cntCancel')},
    'ev-soon':   {el: document.querySelector('.sum-soon'),  cnt: document.getElementById('cntSoon')},
  };
  Object.entries(map).forEach(([cls, {el, cnt}]) => {
    if (!el) return;
    const n = counts[cls] || 0;
    if (cnt) cnt.textContent = n;
    el.style.display = n > 0 ? '' : 'none';
  });
}

function countEvents(keys) {
  const counts = {'ev-done':0,'ev-wait':0,'ev-cancel':0,'ev-soon':0};
  const recompute = window.__recomputeClass;
  keys.forEach(k => {
    (window.__AGENDA_EVENTS[k] || []).forEach(ev => {
      const liveCls = typeof recompute === 'function' ? recompute(ev, k) : ev.cls;
      if (counts[liveCls] !== undefined) counts[liveCls]++;
    });
  });
  return counts;
}

const filterMap = {'fi-done':'ev-done','fi-wait':'ev-wait','fi-cancel':'ev-cancel','fi-soon':'ev-soon'};
const reverseMap = {'ev-done':'fi-done','ev-wait':'fi-wait','ev-cancel':'fi-cancel','ev-soon':'fi-soon'};

function getFilterState(evClass) {
  const sidebarChk = document.querySelector('.' + reverseMap[evClass] + ' input[type=checkbox]');
  const toolbarChk = document.querySelector('.filter-row[data-filter="' + evClass + '"] input[type=checkbox]');
  if (sidebarChk) return sidebarChk.checked;
  if (toolbarChk) return toolbarChk.checked;
  return true;
}

function setFilterState(evClass, checked) {
  const sidebarChk = document.querySelector('.' + reverseMap[evClass] + ' input[type=checkbox]');
  const toolbarChk = document.querySelector('.filter-row[data-filter="' + evClass + '"] input[type=checkbox]');
  if (sidebarChk) sidebarChk.checked = checked;
  if (toolbarChk) toolbarChk.checked = checked;
  document.querySelectorAll('.' + evClass).forEach(el => { el.style.display = checked ? '' : 'none'; });
}

function applyFilters() {
  Object.values(filterMap).forEach(evClass => {
    setFilterState(evClass, getFilterState(evClass));
  });
}

window.__EVENTS_DIA = window.__AGENDA_EVENTS;

function buildCal(date)  { window.__buildCal(date, window.__AGENDA_EVENTS, MESES, updateSumCards, countEvents); }
function buildWeek(date) { window.__buildWeek(date, window.__AGENDA_EVENTS, MESES, DIAS_CORTO, updateSumCards, countEvents); }
function buildDay(date)  { window.__buildDay(date, window.__AGENDA_EVENTS, MESES, updateSumCards, countEvents); }

function setView(view) {
  curView = view;
  const calGrid    = document.getElementById('calWrap');
  const weekGrid   = document.getElementById('weekGrid');
  const dayView    = document.getElementById('dayView');
  const monthNav   = document.querySelector('.month-nav');
  const agLeft     = document.querySelector('.agenda-left');
  calGrid && calGrid.classList.remove('active');
  weekGrid && weekGrid.classList.remove('active');
  dayView && dayView.classList.remove('active');
  agLeft && agLeft.classList.toggle('day-view-active', view === 'dia');
  if (view === 'mes')         { calGrid && calGrid.classList.add('active');  buildCal(cur);  monthNav && (monthNav.style.display = ''); }
  else if (view === 'semana') { weekGrid && weekGrid.classList.add('active'); buildWeek(cur); monthNav && (monthNav.style.display = ''); }
  else if (view === 'dia')    { dayView && dayView.classList.add('active');  buildDayAndSync(cur); monthNav && (monthNav.style.display = 'none'); }
  applyFilters();
}

setView('mes');

setInterval(() => {
  if (curView === 'mes') buildCal(cur);
  else if (curView === 'semana') buildWeek(cur);
  else if (curView === 'dia') buildDayAndSync(cur);
  if (typeof window.__rebuildProximas === 'function') window.__rebuildProximas();
}, 30000);

document.querySelectorAll('.month-nav button').forEach((btn, i) => {
  btn.addEventListener('click', () => {
    if (curView === 'mes') {
      cur = new Date(cur.getFullYear(), cur.getMonth() + (i === 0 ? -1 : 1), 1);
      buildCal(cur);
    } else if (curView === 'semana') {
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + (i === 0 ? -7 : 7));
      buildWeek(cur);
    }
    applyFilters();
  });
});

document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const v = tab.textContent.trim().toLowerCase();
    if (v === 'mes') setView('mes');
    else if (v === 'semana') setView('semana');
    else setView('dia');
  });
});

const dayPrev = document.getElementById('dayPrev');
const dayNext = document.getElementById('dayNext');
if (dayPrev) {
  dayPrev.addEventListener('click', () => {
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1);
    buildDayAndSync(cur);
  });
}
if (dayNext) {
  dayNext.addEventListener('click', () => {
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    buildDayAndSync(cur);
  });
}

document.querySelectorAll('.filter-item input[type=checkbox]').forEach(chk => {
  chk.addEventListener('change', () => {
    const label = chk.closest('.filter-item');
    const fiClass = Object.keys(filterMap).find(k => label && label.classList.contains(k));
    if (fiClass) setFilterState(filterMap[fiClass], chk.checked);
  });
});
document.querySelectorAll('.filter-row input[type=checkbox]').forEach(chk => {
  chk.addEventListener('change', () => {
    const label = chk.closest('.filter-row');
    const evClass = label && label.dataset.filter;
    if (evClass) setFilterState(evClass, chk.checked);
  });
});

const mesPicker = document.getElementById('mesPicker');
const anioPicker= document.getElementById('anioPicker');
const mesSpan   = document.getElementById('mesActual');
const anioSpan  = document.getElementById('anioActual');

function closePickers() { mesPicker && mesPicker.classList.remove('open'); anioPicker && anioPicker.classList.remove('open'); }

function buildMesPicker() {
  if (!mesPicker) return;
  mesPicker.querySelectorAll('.picker-item').forEach(el => el.remove());
  MESES.forEach((nombre, idx) => {
    const btn = document.createElement('button');
    btn.className = 'picker-item' + (cur.getMonth() === idx ? ' active' : '');
    btn.textContent = nombre;
    btn.addEventListener('click', () => { cur = new Date(cur.getFullYear(), idx, 1); buildCal(cur); applyFilters(); closePickers(); });
    mesPicker.appendChild(btn);
  });
}
function buildAnioPicker() {
  if (!anioPicker) return;
  anioPicker.querySelectorAll('.picker-item').forEach(el => el.remove());
  const currentY = cur.getFullYear();
  for (let y = currentY + 5; y >= currentY - 5; y--) {
    const btn = document.createElement('button');
    btn.className = 'picker-item' + (y === currentY ? ' active' : '');
    btn.textContent = y;
    btn.addEventListener('click', () => { cur = new Date(y, cur.getMonth(), 1); buildCal(cur); applyFilters(); closePickers(); });
    anioPicker.appendChild(btn);
  }
}

if (mesSpan) {
  mesSpan.addEventListener('click', e => { e.stopPropagation(); const o = mesPicker.classList.contains('open'); closePickers(); if (!o) { buildMesPicker(); mesPicker.classList.add('open'); } });
}
if (anioSpan) {
  anioSpan.addEventListener('click', e => { e.stopPropagation(); const o = anioPicker.classList.contains('open'); closePickers(); if (!o) { buildAnioPicker(); anioPicker.classList.add('open'); } });
}
document.addEventListener('click', closePickers);

function buildDayAndSync(date) {
  cur = date;
  buildDay(date);
  if (window.__setBloqueoDate) window.__setBloqueoDate(date);
  if (window.__syncDayPicker) window.__syncDayPicker(date);
}

window.__rebuildAgenda = function() {
  if (curView === 'mes') buildCal(cur);
  else if (curView === 'semana') buildWeek(cur);
  else if (curView === 'dia') buildDayAndSync(cur);
  applyFilters();
  if (typeof window.__rebuildProximas === 'function') window.__rebuildProximas();
};

const cur_ref = { get y(){ return cur.getFullYear(); }, get m(){ return cur.getMonth(); } };
if (window.__initPopup) window.__initPopup(window.__AGENDA_EVENTS, MESES, cur_ref, DIAS_ES);
if (window.__initDayPicker) window.__initDayPicker(function(date) { buildDayAndSync(date); });
if (window.__initBloqueos) window.__initBloqueos(window.__AGENDA_EVENTS, MESES, DIAS_ES, buildDayAndSync);

/* ---- Botón y dropdown de filtros ---- */
const toolbarFilterBtn = document.getElementById('toolbarFilterBtn');
const toolbarFilterDropdown = document.getElementById('toolbarFilterDropdown');
if (toolbarFilterBtn && toolbarFilterDropdown) {
  toolbarFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toolbarFilterDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => {
    toolbarFilterDropdown.classList.remove('open');
  });
  toolbarFilterDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

/* ---- Botón expandir sidebar ---- */
const agendaExpandBtn = document.getElementById('agendaExpandBtn');
const agLeft = document.querySelector('.agenda-left');
if (agendaExpandBtn && agLeft) {
  agendaExpandBtn.addEventListener('click', () => {
    agLeft.classList.toggle('expanded');
    if (!agLeft.classList.contains('expanded') && toolbarFilterDropdown) {
      toolbarFilterDropdown.classList.remove('open');
    }
    const dayView = document.getElementById('dayView');
    if (dayView && dayView.classList.contains('active') && typeof buildDay === 'function') {
      buildDay(cur);
    }
    applyFilters();
  });
}
