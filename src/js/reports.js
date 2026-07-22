// ================= IA Reportes - Inicializador =================
// Tauri consume Laravel por HTTP. La base de datos y la IA viven en Laravel.

import { apiBaseUrl, laravelFetch } from './laravel.js';
import { authHeader, clearAuthToken, getAuthToken, setAuthToken } from './auth.js';
import { escapeHtml } from './html.js';

const REPORTS_BASE = `${apiBaseUrl()}/api/tauri/reportes`;
const LOGIN_ENDPOINT = `${apiBaseUrl()}/api/tauri/login`;

let reportsTemplate = '';
let editorState = {
  studies: [],
  templates: [],
  findings: [],
  selectedStudy: null,
  selectedTemplate: null,
  saving: false,
  generating: false,
  chatting: false,
};

function endpoint(path = '') {
  const suffix = String(path || '').replace(/^\/+/, '');
  return `${REPORTS_BASE}${suffix ? `/${suffix}` : ''}`;
}

function jsonHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const authorization = authHeader();
  if (authorization) headers.Authorization = authorization;
  return headers;
}

async function reportsRequest(path = '', options = {}) {
  const response = await laravelFetch(endpoint(path), {
    method: options.method || 'GET',
    headers: {
      ...jsonHeaders(),
      ...(options.headers || {}),
    },
    body: options.body,
    credentials: 'include',
  });
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 401 || response.status === 419) {
    const error = new Error('Ingresa tus credenciales de Laravel para cargar reportes.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Laravel no devolvio JSON. Revisa la ruta: ${endpoint(path)}`);
  }

  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Laravel respondio HTTP ${response.status}.`);
  }
  return payload;
}

async function loginToLaravel(email, password) {
  const response = await laravelFetch(LOGIN_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || 'No se pudo iniciar sesion.');
  }
  return payload.token;
}

function initialsFromName(name) {
  const initials = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');
  return initials || 'RP';
}

function pick(value, fallback = '') {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function normalizeReportsPayload(payload) {
  const reports = payload?.reportes || payload?.reports || payload?.data?.reportes || payload?.data?.reports || [];
  const kpis = payload?.kpis || payload?.summary || payload?.data?.kpis || {};
  const findings = payload?.hallazgos || payload?.findings || payload?.data?.hallazgos || [];

  return {
    reports: Array.isArray(reports) ? reports.map(normalizeReport) : [],
    kpis,
    findings: Array.isArray(findings) ? findings.map(normalizeFinding) : [],
  };
}

function normalizeReport(item) {
  const name = pick(item?.paciente || item?.patient || item?.patient_name || item?.nombre_paciente || item?.name, 'Paciente sin nombre');
  const critical = Boolean(item?.critical ?? item?.critico ?? item?.contiene_hallazgos_criticos);

  return {
    id: item?.id ?? '',
    name,
    initials: item?.initials || item?.iniciales || initialsFromName(name),
    study: item?.estudio || item?.study || item?.procedimiento || item?.tipo || 'Estudio',
    date: item?.fecha || item?.date || item?.created_date || '',
    time: item?.hora || item?.time || item?.created_time || '',
    critical,
    status: item?.estado_texto || item?.status_text || (critical ? 'Critico' : 'Normal'),
    viewUrl: item?.view_url || item?.ver_url || '',
    downloadUrl: item?.download_url || item?.descargar_url || '',
    editUrl: item?.edit_url || item?.editar_url || '',
  };
}

function normalizeFinding(item, index) {
  return {
    id: item?.id ?? index,
    name: item?.nombre || item?.name || 'Hallazgo',
    percentage: Number(item?.porcentaje ?? item?.percentage ?? 0) || 0,
    critical: Boolean(item?.es_critico ?? item?.critical),
  };
}

function normalizeStudy(item, index) {
  const patientName = item?.paciente || item?.patient_name || item?.nombre_paciente || item?.patient?.name || item?.patient?.nombre || 'Paciente sin nombre';
  const procedure = item?.procedimiento || item?.procedure || item?.tipo_estudio || item?.tipo || item?.study_type || 'Estudio';
  const date = item?.fecha || item?.date || item?.fecha_estudio || item?.study_date || '';

  return {
    id: String(item?.id ?? item?.study_id ?? item?.estudio_id ?? index),
    patientId: item?.paciente_id ?? item?.patient_id ?? item?.patient?.id ?? '',
    patientName,
    patientAge: item?.edad || item?.age || item?.patient?.edad || item?.patient?.age || '--',
    patientGender: item?.sexo || item?.gender || item?.patient?.sexo || item?.patient?.gender || '--',
    patientBirthDate: item?.fecha_nacimiento || item?.birth_date || item?.patient?.fecha_nacimiento || item?.patient?.birth_date || '--',
    procedure,
    type: item?.tipo || item?.type || procedure,
    date,
    label: item?.label || `${patientName} - ${procedure}${date ? ` - ${date}` : ''}`,
    raw: item,
  };
}

function normalizeTemplate(item, index) {
  const name = item?.nombre || item?.name || item?.titulo || item?.title || `Plantilla ${index + 1}`;
  return {
    id: String(item?.id ?? item?.plantilla_id ?? index),
    name,
    description: item?.descripcion || item?.description || item?.tipo || '',
    type: item?.tipo || item?.type || name,
    content: item?.contenido || item?.content || item?.html || item?.cuerpo || '',
    raw: item,
  };
}

function normalizeEditorPayload(payload) {
  const data = payload?.data || payload || {};
  const studies = data.estudios_sin_reporte || data.estudios || data.studies || data.pending_studies || [];
  const templates = data.plantillas || data.templates || [];
  const findings = data.hallazgos || data.findings || [];

  return {
    studies: Array.isArray(studies) ? studies.map(normalizeStudy) : [],
    templates: Array.isArray(templates) ? templates.map(normalizeTemplate) : [],
    findings: Array.isArray(findings) ? findings.map(normalizeFinding) : [],
  };
}

function setText(root, selector, value) {
  const el = root.querySelector(selector);
  if (el) el.textContent = value;
}

function setKpi(root, bind, value) {
  const el = root.querySelector(`[data-bind="${bind}"]`);
  if (!el) return;
  const count = Number(value) || 0;
  el.dataset.target = String(count);
  el.textContent = '0';
}

function setTrend(root, bind, value) {
  const el = root.querySelector(`[data-bind="${bind}"]`);
  if (!el) return;
  const trend = Number(value) || 0;
  const isDown = trend < 0;
  el.classList.toggle('is-positive', trend > 0);
  el.classList.toggle('is-negative', isDown);
  el.innerHTML = `
    <svg viewBox="0 0 24 24">
      <polyline points="${isDown ? '22 7 13.5 15.5 8.5 10.5 2 17' : '22 17 13.5 8.5 8.5 13.5 2 7'}"/>
      <polyline points="${isDown ? '16 7 22 7 22 13' : '16 17 22 17 22 11'}"/>
    </svg>
    <span>${Math.abs(trend)}% <b>vs mes anterior</b></span>`;
}

function animateCounters(root) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('.stat .num').forEach((counter) => {
    const target = parseInt(counter.dataset.target, 10) || 0;
    if (reduced) {
      counter.textContent = target.toLocaleString('es-MX');
      return;
    }
    const duration = 900;
    const start = performance.now();
    function tick(time) {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = Math.round(target * eased).toLocaleString('es-MX');
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function renderLaravelLogin(root, message = 'Inicia sesion con tu usuario de Laravel.') {
  root.innerHTML = `
    <form id="laravelReportsLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
      <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar Reportes con Laravel</strong>
      <p style="color:var(--txt-soft);font-size:13px;line-height:1.5;margin:0 0 18px;">${escapeHtml(message)}</p>
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Correo</label>
      <input id="laravelReportsEmail" type="email" autocomplete="username" required style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <label style="display:block;color:var(--txt-soft);font-size:12px;margin-bottom:6px;">Contrasena</label>
      <input id="laravelReportsPassword" type="password" autocomplete="current-password" required style="width:100%;margin-bottom:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--bg);color:var(--txt);">
      <button type="submit" style="width:100%;padding:11px 14px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:700;cursor:pointer;">Conectar reportes</button>
    </form>`;

  document.getElementById('laravelReportsLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('laravelReportsEmail')?.value.trim();
    const password = document.getElementById('laravelReportsPassword')?.value || '';
    if (!email || !password) return;

    try {
      const token = await loginToLaravel(email, password);
      setAuthToken(token);
      if (reportsTemplate) root.innerHTML = reportsTemplate;
      if (root.querySelector('.report-editor-page')) initReportEditor();
      else await loadReportsFromLaravel(root);
    } catch (error) {
      console.error(error);
      renderLaravelLogin(root, error.message || 'No se pudo iniciar sesion.');
    }
  });
}

function renderReportsError(root, error) {
  if (error.code === 'UNAUTHORIZED') {
    clearAuthToken();
    renderLaravelLogin(root, error.message);
    return;
  }
  root.innerHTML = `
    <div style="padding:42px 20px;text-align:center;color:var(--txt-soft);">
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con Laravel</strong>
      <span>${escapeHtml(error.message || 'No se pudieron cargar los reportes.')}</span>
    </div>`;
}

function setReportsLoading(root) {
  const tbody = document.getElementById('reportsTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center;padding:28px;color:var(--txt-soft)">Cargando reportes desde Laravel...</td></tr>`;
  }
  setText(root, '.rep-hall h3', 'HALLAZGOS');
}

function restoreReportsShell(root) {
  if (!root.querySelector('#reportsTableBody') && reportsTemplate) root.innerHTML = reportsTemplate;
}

function reportRowHTML(report) {
  const viewUrl = report.viewUrl || '#';
  const downloadUrl = report.downloadUrl || viewUrl;
  const editUrl = report.editUrl || '#ia-reportes/redactar';

  return `
    <tr>
      <td><span class="pat"><span class="mini">${escapeHtml(report.initials)}</span>${escapeHtml(report.name)}</span></td>
      <td>${escapeHtml(report.study)}</td>
      <td class="date">${escapeHtml(report.date)} <small>${escapeHtml(report.time)}</small></td>
      <td><span class="chip ${report.critical ? 'urgent' : 'done'}">${escapeHtml(report.status)}</span></td>
      <td>
        <div class="row-actions">
          <a href="${escapeHtml(viewUrl)}" title="Ver" ${report.viewUrl ? 'target="_blank" rel="noreferrer"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
          <a href="${escapeHtml(downloadUrl)}" title="Descargar" ${report.downloadUrl ? 'target="_blank" rel="noreferrer"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>
          <a href="${escapeHtml(editUrl)}" ${report.editUrl ? 'target="_blank" rel="noreferrer"' : 'data-nav="ia-reportes-redactar"'} title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></a>
        </div>
      </td>
    </tr>`;
}

function renderReportsTable(reports) {
  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;
  if (!reports.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--txt-soft)">No hay reportes generados todavia.</td></tr>`;
    return;
  }
  tbody.innerHTML = reports.map(reportRowHTML).join('');
}

function renderKpis(root, kpis) {
  setKpi(root, 'kpi-reportes', kpis?.reportes?.valor ?? kpis?.reportes ?? 0);
  setKpi(root, 'kpi-pendientes', kpis?.sin_reporte?.valor ?? kpis?.pendientes?.valor ?? kpis?.sin_reporte ?? 0);
  setKpi(root, 'kpi-evidencias', kpis?.evidencias?.valor ?? kpis?.evidencias ?? 0);
  setKpi(root, 'kpi-estudios', kpis?.estudios?.valor ?? kpis?.estudios ?? 0);
  setTrend(root, 'trend-reportes', kpis?.reportes?.trend ?? 0);
  setTrend(root, 'trend-evidencias', kpis?.evidencias?.trend ?? 0);
  setTrend(root, 'trend-estudios', kpis?.estudios?.trend ?? 0);
  animateCounters(root);
}

function findingHTML(finding, index) {
  const percent = Math.max(0, Math.min(100, finding.percentage));
  const barClass = `c${(index % 3) + 1}`;
  const criticalStyle = finding.critical ? 'style="background:rgba(255,90,110,.12)"' : '';
  const innerStyle = finding.critical ? `style="width:${percent}%;background:var(--red)"` : `style="width:${percent}%"`;

  return `
    <div class="find">
      <div class="top"><span>${escapeHtml(finding.name)}</span><b>${percent}%</b></div>
      <div class="bar ${barClass}" ${criticalStyle}><i ${innerStyle}></i></div>
    </div>`;
}

function renderFindings(root, findings) {
  const panel = root.querySelector('.rep-hall');
  if (!panel) return;
  const title = '<h3>HALLAZGOS</h3>';
  const link = '<a class="reports-link" href="#ia-reportes">Ver todos los hallazgos <span>-></span></a>';
  panel.innerHTML = findings.length
    ? title + findings.slice(0, 5).map(findingHTML).join('') + link
    : `${title}<div class="find-empty">Sin hallazgos registrados</div>${link}`;
}

function renderPredictive(root, reports) {
  const first = reports[0];
  if (!first) return;
  setText(root, '[data-bind="predictive-initials"]', first.initials);
  setText(root, '[data-bind="predictive-name"]', first.name);
  setText(root, '[data-bind="predictive-study"]', first.study);
  setText(root, '[data-bind="predictive-date"]', first.date || 'Sin fecha');
}

function renderReportsData(root, data) {
  renderKpis(root, data.kpis);
  renderReportsTable(data.reports);
  renderFindings(root, data.findings);
  renderPredictive(root, data.reports);
}

async function loadReportsFromLaravel(root) {
  restoreReportsShell(root);
  setReportsLoading(root);
  try {
    const data = normalizeReportsPayload(await reportsRequest());
    renderReportsData(root, data);
  } catch (error) {
    console.error(error);
    renderReportsError(root, error);
  }
}

function setEditorAlert(root, message, type = 'info') {
  const alert = root.querySelector('#reportEditorAlert');
  if (!alert) return;
  alert.textContent = message || '';
  alert.dataset.type = type;
  alert.hidden = !message;
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
  button.disabled = busy;
  if (label) {
    const span = button.querySelector('span');
    if (span) span.lastChild.textContent = label;
    else button.textContent = label;
  } else if (!busy && button.dataset.originalText) {
    const span = button.querySelector('span');
    if (span) span.lastChild.textContent = button.dataset.originalText;
    else button.textContent = button.dataset.originalText;
  }
}

function renderStudyOptions(root) {
  const select = root.querySelector('#reportStudySelect');
  if (!select) return;
  select.innerHTML = `<option value="">Selecciona un estudio sin reporte...</option>`;
  editorState.studies.forEach((study) => {
    const option = document.createElement('option');
    option.value = study.id;
    option.textContent = study.label;
    select.appendChild(option);
  });
}

function renderTypeOptions(root) {
  const select = root.querySelector('#reportTypeSelect');
  if (!select) return;
  const types = [...new Set([
    ...editorState.templates.map(template => template.type || template.name),
    ...editorState.studies.map(study => study.type || study.procedure),
  ].filter(Boolean))];
  select.innerHTML = '';
  (types.length ? types : ['Colonoscopia', 'Gastroscopia', 'Duodenoscopia']).forEach((type) => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.appendChild(option);
  });
}

function templateIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>';
}

function gearIcon() {
  return '<svg class="gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.04a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.04A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.04A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.24.61.84 1 1.56 1H21a2 2 0 1 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15Z"/></svg>';
}

function renderTemplates(root) {
  const list = root.querySelector('#templateList');
  if (!list) return;
  const templates = editorState.templates.length
    ? editorState.templates
    : [{ id: 'blank', name: 'En blanco', description: 'Empieza desde cero', type: '', content: '' }];

  list.innerHTML = templates.map(template => `
    <button class="template-item" type="button" data-template-id="${escapeHtml(template.id)}">
      <span class="template-ico">${template.id === 'blank' ? '+' : templateIcon()}</span>
      <span><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.description || 'Plantilla de reporte')}</small></span>
      ${gearIcon()}
    </button>`).join('');
}

function applyStudy(root, study) {
  editorState.selectedStudy = study || null;
  const today = new Date().toLocaleDateString('es-MX');
  const patientData = root.querySelector('.patient-data');
  const patientValues = patientData?.querySelectorAll('span, strong') || [];
  setText(root, '#reportDateText', today);
  setText(root, '[data-bind="doc-patient"]', study?.patientName || 'Nombre del paciente');
  setText(root, '[data-bind="doc-age"]', study?.patientAge || '--');
  setText(root, '[data-bind="doc-gender"]', study?.patientGender || '--');
  setText(root, '[data-bind="doc-birth-date"]', study?.patientBirthDate || 'dd/mm/aaaa');
  setText(root, '[data-bind="doc-study-date"]', study?.date || today);
  setText(root, '[data-bind="doc-date"]', study?.date || today);
  setText(root, '[data-bind="doc-procedure"]', study?.procedure || 'Tipo de procedimiento');
  if (patientValues[1]) patientValues[1].textContent = study?.patientAge || '--';
  if (patientValues[2]) patientValues[2].textContent = study?.patientGender || '--';
  if (patientValues[3]) patientValues[3].textContent = study?.patientBirthDate || 'dd/mm/aaaa';
  if (patientValues[4]) patientValues[4].textContent = study?.date || today;

  const typeSelect = root.querySelector('#reportTypeSelect');
  if (typeSelect && study?.type) {
    const hasOption = Array.from(typeSelect.options).some(option => option.value === study.type);
    if (!hasOption) typeSelect.append(new Option(study.type, study.type));
    typeSelect.value = study.type;
  }
}

function applyTemplate(root, template) {
  editorState.selectedTemplate = template || null;
  root.querySelectorAll('.template-item').forEach(item => {
    item.classList.toggle('active', item.dataset.templateId === template?.id);
  });
  if (template?.type) {
    const typeSelect = root.querySelector('#reportTypeSelect');
    const hasOption = Array.from(typeSelect?.options || []).some(option => option.value === template.type);
    if (typeSelect && !hasOption) typeSelect.append(new Option(template.type, template.type));
    if (typeSelect) typeSelect.value = template.type;
    setText(root, '[data-bind="doc-procedure"]', template.type);
  }
  if (template?.content) {
    root.querySelector('#reportDocument').innerHTML = template.content;
    applyStudy(root, editorState.selectedStudy);
  }
}

function appendMessage(root, text, role = 'me') {
  const chatMessages = root.querySelector('.chat-msgs');
  if (!chatMessages || !String(text || '').trim()) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-msg ${role}`;
  bubble.textContent = String(text).trim();
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function collectReportPayload(root) {
  const documentEl = root.querySelector('#reportDocument');
  const typeSelect = root.querySelector('#reportTypeSelect');
  return {
    estudio_id: editorState.selectedStudy?.id || root.querySelector('#reportStudySelect')?.value || null,
    paciente_id: editorState.selectedStudy?.patientId || null,
    plantilla_id: editorState.selectedTemplate?.id && editorState.selectedTemplate.id !== 'blank' ? editorState.selectedTemplate.id : null,
    tipo_estudio: typeSelect?.value || editorState.selectedStudy?.type || '',
    fecha_reporte: new Date().toISOString().slice(0, 10),
    contenido_html: documentEl?.innerHTML || '',
    contenido_texto: documentEl?.innerText || '',
  };
}

function responseContent(payload) {
  return payload?.contenido_html || payload?.html || payload?.reporte || payload?.report || payload?.data?.contenido_html || payload?.data?.html || '';
}

async function loadEditorData(root) {
  setEditorAlert(root, 'Cargando estudios, plantillas y hallazgos desde Laravel...');
  const payload = await reportsRequest('editor');
  const data = normalizeEditorPayload(payload);
  editorState = {
    ...editorState,
    studies: data.studies,
    templates: data.templates,
    findings: data.findings,
    selectedStudy: null,
    selectedTemplate: null,
  };
  renderStudyOptions(root);
  renderTypeOptions(root);
  renderTemplates(root);
  setEditorAlert(root, '');

  if (!data.studies.length) {
    setEditorAlert(root, 'No hay estudios sin reporte disponibles.', 'warn');
  }
}

async function generateReport(root) {
  if (editorState.generating) return;
  const button = root.querySelector('#generateAiReportBtn');
  editorState.generating = true;
  setButtonBusy(button, true, 'Generando...');
  setEditorAlert(root, 'Generando reporte con IA...');

  try {
    const payload = await reportsRequest('generar', {
      method: 'POST',
      body: JSON.stringify(collectReportPayload(root)),
    });
    const content = responseContent(payload);
    if (content) root.querySelector('#reportDocument').innerHTML = content;
    appendMessage(root, payload?.message || 'Reporte generado con IA.', 'ai');
    setEditorAlert(root, 'Reporte generado. Revisa el contenido antes de guardar.', 'ok');
  } catch (error) {
    console.error(error);
    setEditorAlert(root, error.message || 'No se pudo generar el reporte.', 'error');
  } finally {
    editorState.generating = false;
    setButtonBusy(button, false);
  }
}

async function saveReport(root) {
  if (editorState.saving) return;
  const button = root.querySelector('#saveReportBtn');
  editorState.saving = true;
  setButtonBusy(button, true, 'Guardando...');
  setEditorAlert(root, 'Guardando reporte en Laravel...');

  try {
    await reportsRequest('', {
      method: 'POST',
      body: JSON.stringify(collectReportPayload(root)),
    });
    setEditorAlert(root, 'Reporte guardado correctamente.', 'ok');
    setText(root, '.status-pill', 'Guardado');
  } catch (error) {
    console.error(error);
    setEditorAlert(root, error.message || 'No se pudo guardar el reporte.', 'error');
  } finally {
    editorState.saving = false;
    setButtonBusy(button, false);
  }
}

async function sendChat(root, text) {
  if (editorState.chatting || !String(text || '').trim()) return;
  const input = root.querySelector('.chat-input input');
  const button = root.querySelector('.chat-input button');
  editorState.chatting = true;
  button.disabled = true;
  appendMessage(root, text, 'me');
  if (input) input.value = '';

  try {
    const payload = await reportsRequest('chat', {
      method: 'POST',
      body: JSON.stringify({
        mensaje: text,
        reporte: collectReportPayload(root),
        hallazgos: editorState.findings,
      }),
    });
    const answer = payload?.respuesta || payload?.answer || payload?.message || payload?.data?.respuesta || 'Listo.';
    appendMessage(root, answer, 'ai');
    const content = responseContent(payload);
    if (content) root.querySelector('#reportDocument').innerHTML = content;
  } catch (error) {
    console.error(error);
    appendMessage(root, error.message || 'No pude conectar con la IA.', 'ai');
  } finally {
    editorState.chatting = false;
    button.disabled = false;
  }
}

export async function initReports() {
  const root = document.getElementById('pageContent');
  if (!root) return;
  reportsTemplate = root.innerHTML;

  if (!getAuthToken()) {
    renderLaravelLogin(root, 'Inicia sesion para acceder a los reportes.');
    return;
  }
  await loadReportsFromLaravel(root);
}

export async function initReportEditor() {
  const root = document.getElementById('pageContent');
  if (!root) return;
  reportsTemplate = root.innerHTML;

  if (!getAuthToken()) {
    renderLaravelLogin(root, 'Inicia sesion para redactar reportes.');
    return;
  }

  root.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      root.querySelector('#reportDocument')?.focus();
      document.execCommand(button.dataset.command, false, null);
      button.classList.toggle('active', ['bold', 'italic', 'underline', 'strikeThrough'].includes(button.dataset.command));
    });
  });

  root.querySelector('#reportStudySelect')?.addEventListener('change', (event) => {
    const study = editorState.studies.find(item => item.id === event.target.value);
    applyStudy(root, study);
  });

  root.querySelector('#reportTypeSelect')?.addEventListener('change', (event) => {
    setText(root, '[data-bind="doc-procedure"]', event.target.value);
  });

  root.querySelector('#templateList')?.addEventListener('click', (event) => {
    const button = event.target.closest('.template-item');
    if (!button) return;
    const template = editorState.templates.find(item => item.id === button.dataset.templateId) || {
      id: 'blank',
      name: 'En blanco',
      content: '',
    };
    applyTemplate(root, template);
  });

  root.querySelectorAll('.quick-prompts button').forEach((button) => {
    button.addEventListener('click', () => sendChat(root, button.textContent || ''));
  });

  root.querySelector('.chat-input button')?.addEventListener('click', () => {
    sendChat(root, root.querySelector('.chat-input input')?.value || '');
  });

  root.querySelector('.chat-input input')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    root.querySelector('.chat-input button')?.click();
  });

  root.querySelector('#generateAiReportBtn')?.addEventListener('click', () => generateReport(root));
  root.querySelector('#saveReportBtn')?.addEventListener('click', () => saveReport(root));

  try {
    await loadEditorData(root);
  } catch (error) {
    console.error(error);
    if (error.code === 'UNAUTHORIZED') {
      clearAuthToken();
      renderLaravelLogin(root, error.message);
      return;
    }
    setEditorAlert(root, error.message || 'No se pudo cargar el editor.', 'error');
    renderStudyOptions(root);
    renderTypeOptions(root);
    renderTemplates(root);
  }
}
