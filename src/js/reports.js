// ================= IA Reportes - Inicializador =================
// Tauri consume Laravel por HTTP. La base de datos y la IA viven en Laravel.

import {
  apiBaseUrl,
  authenticatedLaravelAssetUrl,
  laravelAssetUrl,
  laravelFetch,
} from './laravel.js';
import { authHeader, clearAuthToken, getAuthToken, setAuthToken } from './auth.js';
import { escapeHtml } from './html.js';

const REPORTS_BASE = `${apiBaseUrl()}/api/tauri/reportes`;
const LOGIN_ENDPOINT = `${apiBaseUrl()}/api/tauri/login`;
const REPORT_DRAFT_KEY = 'enclaii.reportes.editor.draft';
const REPORT_ASSET_TIMEOUT_MS = 8000;
const REPORT_PRINT_WAIT_MS = 2500;

let reportsTemplate = '';
let editorState = {
  studies: [],
  templates: [],
  templatesByKey: {},
  findings: [],
  images: [],
  report: null,
  selectedStudy: null,
  selectedTemplate: null,
  imageState: new Map(),
  imageEnabled: true,
  imageCols: 4,
  currentTemplateKey: 'colonoscopia',
  mode: 'normal',
  settings: {},
  saving: false,
  generating: false,
  chatting: false,
  assetUrlCache: new Map(),
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
    const error = new Error('Ingresa tus credenciales para cargar reportes.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`El servidor no devolvio JSON. Revisa la ruta: ${endpoint(path)}`);
  }

  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `El servidor respondio HTTP ${response.status}.`);
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

function currentEditorMode() {
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : '';
  const mode = new URLSearchParams(hashQuery).get('mode');
  return mode === 'ia' || mode === 'ai' || mode === 'generar' ? 'ia' : 'normal';
}

function draftKey() {
  const studyId = editorState.selectedStudy?.id || 'nuevo';
  return `${REPORT_DRAFT_KEY}.${studyId}`;
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
    reporteId: item?.reporte_id || item?.report_id || item?.id || '',
    estudioId: item?.estudio_id || item?.study_id || '',
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

function reportImageUrl(item = {}) {
  return laravelAssetUrl(
    item.url ||
    item.src ||
    item.media_url ||
    item.file_url ||
    item.archivo_url ||
    item.imagen_url ||
    item.image_url ||
    item.path ||
    item.ruta ||
    item.archivo ||
    item.file ||
    ''
  );
}

function normalizeReportImage(item = {}, index = 0) {
  const url = reportImageUrl(item);
  const title =
    item.titulo ||
    item.title ||
    item.nombre ||
    item.filename ||
    item.file ||
    `Captura ${index + 1}`;

  return {
    ...item,
    id: item.id ?? item.imagen_id ?? item.image_id ?? index,
    titulo: title,
    url,
    show_url: laravelAssetUrl(
      item.show_url ||
      item.ver_url ||
      item.full_url ||
      item.url ||
      url
    ),
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

function renderLaravelLogin(root, message = 'Inicia sesion con tu cuenta.') {
  root.innerHTML = `
    <form id="laravelReportsLoginForm" style="max-width:420px;margin:42px auto;padding:24px;border:1px solid var(--stroke);border-radius:14px;background:var(--card);">
      <strong style="display:block;color:var(--txt);font-size:16px;margin-bottom:8px;">Conectar Reportes</strong>
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
      <strong style="display:block;color:var(--txt);margin-bottom:8px;">No se pudo conectar con el servidor</strong>
      <span>${escapeHtml(error.message || 'No se pudieron cargar los reportes.')}</span>
    </div>`;
}

function setReportsLoading(root) {
  const tbody = document.getElementById('reportsTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center;padding:28px;color:var(--txt-soft)">Cargando reportes...</td></tr>`;
  }
  setText(root, '.rep-hall h3', 'HALLAZGOS');
}

function restoreReportsShell(root) {
  if (!root.querySelector('#reportsTableBody') && reportsTemplate) root.innerHTML = reportsTemplate;
}

function reportRowHTML(report) {
  const viewUrl = report.viewUrl || '#';
  const downloadUrl = report.downloadUrl || viewUrl;
  const editRoute = `#ia-reportes-redactar?mode=normal${report.reporteId ? `&reporte_id=${encodeURIComponent(report.reporteId)}` : ''}${report.estudioId ? `&estudio_id=${encodeURIComponent(report.estudioId)}` : ''}`;
  const editUrl = report.editUrl || editRoute;

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
          <a href="${escapeHtml(editUrl)}" ${report.editUrl ? 'target="_blank" rel="noreferrer"' : `data-nav="${escapeHtml(editRoute.replace(/^#/, ''))}"`} title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></a>
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
  const setButtonLabel = (value) => {
    const textNode = Array.from(button.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNode) {
      textNode.textContent = ` ${value} `;
      return;
    }
    button.append(` ${value} `);
  };
  button.disabled = busy;
  if (label) {
    setButtonLabel(label);
  } else if (!busy && button.dataset.originalText) {
    setButtonLabel(button.dataset.originalText);
  }
}

function execEditorCommand(root, command, value = null) {
  root.querySelector('#reportDocument')?.focus();
  document.execCommand(command, false, value);
}

function setEditorMode(root, mode) {
  editorState.mode = mode === 'ia' ? 'ia' : 'normal';
  root.dataset.reportMode = editorState.mode;
  root.querySelectorAll('[data-report-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.reportMode === editorState.mode);
  });
  const status = root.querySelector('#edStatus');
  if (status) status.textContent = editorState.mode === 'ia' ? 'IA en borrador' : 'Borrador';
  const aiButton = root.querySelector('#generateAiReportBtn');
  if (aiButton) {
    const label = editorState.mode === 'ia' ? 'Regenerar IA' : 'Generar IA';
    const textNode = Array.from(aiButton.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = ` ${label}`;
  }
}

function applyReportSettings(root) {
  const settings = {
    clinicName: root.querySelector('#clinicNameInput')?.value || 'Nombre de la clinica',
    doctorName: root.querySelector('#doctorNameInput')?.value || 'Dr. Nombre del medico',
    signature: root.querySelector('#signatureInput')?.value || 'firma',
    logoText: root.querySelector('#logoTextInput')?.value || 'Logo de la clinica',
    includeAiNote: Boolean(root.querySelector('#includeAiNoteInput')?.checked),
    includeImages: Boolean(root.querySelector('#includeImagesInput')?.checked),
    autosave: Boolean(root.querySelector('#autosaveInput')?.checked),
  };

  editorState.settings = settings;
  setText(root, '.clinic-name', settings.clinicName);
  setText(root, '.clinic-logo', settings.logoText);
  setText(root, '.signature-mark', settings.signature);
  setText(root, '.doctor-signature strong', settings.doctorName);
  root.querySelector('#reportDocument')?.classList.toggle('without-evidence', !settings.includeImages);

  return settings;
}

function saveDraft(root, showMessage = true) {
  const payload = collectReportPayload(root);
  localStorage.setItem(draftKey(), JSON.stringify({
    savedAt: new Date().toISOString(),
    payload,
    currentTemplateKey: editorState.currentTemplateKey,
    imagesConfig: imageConfigPayload(),
    mode: editorState.mode,
  }));
  if (showMessage) setEditorAlert(root, 'Borrador guardado en este equipo.', 'ok');
}

function restoreDraft(root) {
  const raw = localStorage.getItem(draftKey());
  if (!raw) return false;

  try {
    const draft = JSON.parse(raw);
    const sectionsEl = root.querySelector('#docSections');
    if (draft?.currentTemplateKey) {
      applyTemplateByKey(root, draft.currentTemplateKey, true);
    }
    if (sectionsEl && draft?.payload?.contenido_html) {
      sectionsEl.innerHTML = draft.payload.contenido_html;
    }

    if (draft?.mode) setEditorMode(root, draft.mode);
    renderReportImages(root);
    setEditorAlert(root, 'Se recupero el borrador local.', 'ok');
    return true;
  } catch {
    localStorage.removeItem(draftKey());
    return false;
  }
}

function openPreview(root) {
  applyReportSettings(root);
  const modal = root.querySelector('#reportPreviewModal');
  const content = root.querySelector('#reportPreviewContent');
  const documentEl = root.querySelector('#reportDocument');
  if (!modal || !content || !documentEl) return;
  content.innerHTML = documentEl.innerHTML;
  modal.classList.remove('is-hidden');
}

function closePreview(root) {
  root.querySelector('#reportPreviewModal')?.classList.add('is-hidden');
}

function printReport(root) {
  printPreviewReport(root);
}

const STUDY_IMAGES = {
  Colonoscopia: new URL('../assets/Colonoscopia.png', import.meta.url).href,
  Gastroscopia: new URL('../assets/Gastroscopia.png', import.meta.url).href,
  Duodenoscopia: new URL('../assets/Duodenoscopia.png', import.meta.url).href,
  Broncoscopia: new URL('../assets/Broncoscopia.png', import.meta.url).href,
};

function studyImageForType(type) {
  const text = String(type || '').toLowerCase();
  if (text.includes('colono')) return STUDY_IMAGES.Colonoscopia;
  if (text.includes('gastro') || text.includes('endoscopia')) return STUDY_IMAGES.Gastroscopia;
  if (text.includes('duodeno')) return STUDY_IMAGES.Duodenoscopia;
  if (text.includes('bronco')) return STUDY_IMAGES.Broncoscopia;
  return '';
}

const PAGE_W = 760;

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function defaultTemplateConfig() {
  return {
    logoImg: null,
    anatImg: null,
    clinic: '',
    signName: '',
    signPos: 'center',
    headH: 121,
    logo: { x: 0, y: 17, w: 86, h: 86 },
    name: { x: 100, y: 28, w: 466, h: 64, fontSize: 21 },
    anat: { x: 672, y: 5, w: 88, h: 110 },
  };
}

function builtInTemplates() {
  return {
    colonoscopia: {
      key: 'colonoscopia',
      name: 'Colonoscopia',
      description: 'Preparacion, hallazgos por segmento...',
      title: 'INFORME DE COLONOSCOPIA',
      subtitle: 'COLONOSCOPIA',
      type: 'Colonoscopia',
      sections: [
        { h: 'INDICACION', type: 'p', ph: 'Motivo del estudio...' },
        { h: 'PREPARACION', type: 'p', ph: 'Calidad de la preparacion...' },
        { h: 'SEDACION', type: 'p', ph: 'Tipo y nivel de sedacion...' },
        { h: 'HALLAZGOS', type: 'ul', ph: 'Hallazgo por segmento (recto, sigmoides, colon...)' },
        { h: 'IMPRESION DIAGNOSTICA', type: 'p', ph: 'Diagnostico...' },
        { h: 'PLAN Y RECOMENDACIONES', type: 'ul', ph: 'Recomendacion...' },
        { h: 'OBSERVACIONES', type: 'p', ph: 'Observaciones adicionales...' },
      ],
    },
    gastroscopia: {
      key: 'gastroscopia',
      name: 'Gastroscopia',
      description: 'Esofago, estomago, duodeno...',
      title: 'INFORME DE GASTROSCOPIA',
      subtitle: 'GASTROSCOPIA',
      type: 'Gastroscopia',
      sections: [
        { h: 'INDICACION', type: 'p', ph: 'Motivo del estudio...' },
        { h: 'SEDACION', type: 'p', ph: 'Tipo y nivel de sedacion...' },
        { h: 'HALLAZGOS', type: 'ul', ph: 'Esofago / estomago / duodeno...' },
        { h: 'IMPRESION DIAGNOSTICA', type: 'p', ph: 'Diagnostico...' },
        { h: 'PLAN Y RECOMENDACIONES', type: 'ul', ph: 'Recomendacion...' },
        { h: 'OBSERVACIONES', type: 'p', ph: 'Observaciones adicionales...' },
      ],
    },
    duodenoscopia: {
      key: 'duodenoscopia',
      name: 'Duodenoscopia',
      description: 'Duodeno, papila, via biliar...',
      title: 'INFORME DE DUODENOSCOPIA',
      subtitle: 'DUODENOSCOPIA',
      type: 'Duodenoscopia',
      sections: [
        { h: 'INDICACION', type: 'p', ph: 'Motivo del estudio...' },
        { h: 'SEDACION', type: 'p', ph: 'Tipo y nivel de sedacion...' },
        { h: 'HALLAZGOS', type: 'ul', ph: 'Duodeno / papila / via biliar...' },
        { h: 'IMPRESION DIAGNOSTICA', type: 'p', ph: 'Diagnostico...' },
        { h: 'PLAN Y RECOMENDACIONES', type: 'ul', ph: 'Recomendacion...' },
        { h: 'OBSERVACIONES', type: 'p', ph: 'Observaciones adicionales...' },
      ],
    },
    broncoscopia: {
      key: 'broncoscopia',
      name: 'Broncoscopia',
      description: 'Arbol bronquial, traquea, carina...',
      title: 'INFORME DE BRONCOSCOPIA',
      subtitle: 'BRONCOSCOPIA',
      type: 'Broncoscopia',
      sections: [
        { h: 'INDICACION', type: 'p', ph: 'Motivo del estudio...' },
        { h: 'SEDACION', type: 'p', ph: 'Tipo y nivel de sedacion...' },
        { h: 'HALLAZGOS', type: 'ul', ph: 'Arbol bronquial / traquea / carina...' },
        { h: 'IMPRESION DIAGNOSTICA', type: 'p', ph: 'Diagnostico...' },
        { h: 'PLAN Y RECOMENDACIONES', type: 'ul', ph: 'Recomendacion...' },
        { h: 'OBSERVACIONES', type: 'p', ph: 'Observaciones adicionales...' },
      ],
    },
    blanco: {
      key: 'blanco',
      name: 'En blanco',
      description: 'Empieza desde cero',
      title: 'NUEVO REPORTE',
      subtitle: '',
      type: '',
      sections: [
        { h: 'INTRODUCCION', type: 'p', ph: 'Escribe aqui...' },
        { h: 'DESARROLLO', type: 'p', ph: 'Escribe aqui...' },
        { h: 'CONCLUSION', type: 'p', ph: 'Escribe aqui...' },
      ],
    },
    img2: { key: 'img2', name: '2 columnas', imgOnly: true, cols: 2, count: 4 },
    img3: { key: 'img3', name: '3 columnas', imgOnly: true, cols: 3, count: 6 },
    img4: { key: 'img4', name: '4 columnas', imgOnly: true, cols: 4, count: 8 },
    imgNone: { key: 'imgNone', name: 'Sin imagenes', imgOnly: true, cols: 0, count: 0 },
  };
}

function templateKeyFromType(type) {
  const text = String(type || '').toLowerCase();
  if (text.includes('colono')) return 'colonoscopia';
  if (text.includes('gastro')) return 'gastroscopia';
  if (text.includes('duodeno')) return 'duodenoscopia';
  if (text.includes('bronco')) return 'broncoscopia';
  return 'blanco';
}

function imageKey(img, index) {
  return String(img?.id ?? index);
}

function reportImageMarkup(img, index, className = '') {
  const title =
    img.titulo || 'Captura';

  const url =
    img.url || '';

  return `
    <span class="report-img-loader">Cargando imagen...</span>
    <img
      class="${escapeHtml(className)}"
      alt=""
      title="${escapeHtml(title)}"
      loading="eager"
      hidden
      data-report-img-index="${index}"
      data-report-asset-url="${escapeHtml(url)}"
    >
  `;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout(
  promise,
  ms,
  message = 'Tiempo de espera agotado.'
) {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(message);
    }),
  ]);
}

async function authenticatedReportAssetUrl(url) {
  if (!url) {
    return '';
  }

  if (!editorState.assetUrlCache) {
    editorState.assetUrlCache = new Map();
  }

  if (editorState.assetUrlCache.has(url)) {
    return editorState.assetUrlCache.get(url);
  }

  const localUrl =
    await authenticatedLaravelAssetUrl(
      url,
      {
        accept: 'image/*,*/*',
      }
    );

  editorState.assetUrlCache.set(
    url,
    localUrl
  );

  return localUrl;
}

async function reportImageSourceCandidates(remoteUrl) {
  const sources = [];

  try {
    const localUrl =
      await withTimeout(
        authenticatedReportAssetUrl(remoteUrl),
        REPORT_ASSET_TIMEOUT_MS,
        'La imagen tardo demasiado en responder.'
      );

    if (localUrl) {
      sources.push(localUrl);
    }
  } catch (error) {
    console.warn(
      'No se pudo preparar captura autenticada, se intentara URL directa:',
      error
    );
  }

  if (
    remoteUrl &&
    !remoteUrl.startsWith('blob:') &&
    !remoteUrl.startsWith('data:')
  ) {
    sources.push(remoteUrl);
  }

  return [...new Set(sources)];
}

function loadReportImageSource(
  image,
  src,
  frame,
  loader
) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (loaded) => {
      if (settled) return;
      settled = true;

      window.clearTimeout(timer);
      resolve(loaded);
    };

    const timer = window.setTimeout(
      () => finish(false),
      REPORT_ASSET_TIMEOUT_MS
    );

    image.onload = () => {
      if (settled) return;
      image.hidden = false;
      image.style.visibility = '';
      frame?.classList.remove('img-missing');

      if (loader) {
        loader.hidden = true;
      }

      finish(true);
    };

    image.onerror = () => {
      if (settled) return;
      finish(false);
    };

    image.loading = 'eager';
    image.hidden = false;
    image.style.visibility = 'hidden';
    image.src = src;

    if (
      image.complete &&
      image.naturalWidth > 0
    ) {
      image.onload();
    }
  });
}

async function hydrateReportImage(image, options = {}) {
  const remoteUrl =
    image.dataset.reportAssetUrl;

  if (
    !remoteUrl ||
    (
      !options.force &&
      image.dataset.reportAssetHydrated === 'true'
    )
  ) {
    return Boolean(image.getAttribute('src'));
  }

  image.dataset.reportAssetHydrated = 'true';

  const frame =
    image.closest(
      '.cell, .cap-thumb'
    );

  const loader =
    frame?.querySelector(
      '.report-img-loader'
    );

  try {
    const sources =
      await reportImageSourceCandidates(
        remoteUrl
      );

    if (!sources.length) {
      throw new Error(
        'No se devolvio una imagen usable.'
      );
    }

    for (const src of sources) {
      const loaded =
        await loadReportImageSource(
          image,
          src,
          frame,
          loader
        );

      if (loaded) {
        return true;
      }
    }

    throw new Error(
      'No se pudo renderizar la imagen.'
    );
  } catch (error) {
    console.warn(
      'No se pudo cargar captura para reporte:',
      error
    );

    image.hidden = true;
    frame?.classList.add('img-missing');

    if (loader) {
      loader.hidden = false;
      loader.textContent =
        'No se pudo cargar';
    }

    image.removeAttribute('data-report-asset-hydrated');
    return false;
  }
}

function hydrateReportImages(root, options = {}) {
  const images = Array.from(
    root.querySelectorAll?.(
      'img[data-report-asset-url]'
    ) || []
  );

  return Promise.all(
    images.map((image) => hydrateReportImage(image, options))
  );
}

function imageConfigPayload() {
  const items = {};
  editorState.images.forEach((img, index) => {
    const key = imageKey(img, index);
    const state = editorState.imageState.get(key) || { visible: true, size: 1 };
    items[key] = {
      visible: state.visible !== false,
      size: clampInt(state.size, 1, editorState.imageCols || 8, 1),
    };
  });
  return {
    version: 1,
    enabled: editorState.imageEnabled !== false,
    cols: editorState.imageEnabled !== false ? editorState.imageCols : 0,
    items,
  };
}

function mergeTemplateData(rawTemplates = {}) {
  const templates = builtInTemplates();
  Object.values(templates).forEach((template) => {
    template.cfg = defaultTemplateConfig();
  });

  const entries = Array.isArray(rawTemplates)
    ? rawTemplates.map(item => [item.clave || item.key || item.id, item])
    : Object.entries(rawTemplates || {});

  entries.forEach(([key, data]) => {
    if (!key || !templates[key]) return;
    templates[key].id = data.id ?? templates[key].id;
    templates[key].title = data.titulo || templates[key].title;
    templates[key].subtitle = data.subtitulo || templates[key].subtitle;
    if (data.configuracion && typeof data.configuracion === 'object') {
      templates[key].cfg = { ...defaultTemplateConfig(), ...data.configuracion };
    }
    if (templates[key].imgOnly) {
      if (data.columnas !== undefined && data.columnas !== null) templates[key].cols = data.columnas;
      if (data.num_imagenes !== undefined && data.num_imagenes !== null) templates[key].count = data.num_imagenes;
    }
  });

  return templates;
}

function setEditorStatus(root, text, saved = false) {
  const status = root.querySelector('#edStatus');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('guardado', saved);
  status.classList.toggle('borrador', !saved);
}

function markReportDirty(root) {
  setEditorStatus(root, editorState.mode === 'ia' ? 'IA en borrador' : 'Borrador', false);
}

function showToast(root, message, isError = false) {
  const toast = root.querySelector('#edToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('err', isError);
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function renderTemplateLists(root) {
  const list = root.querySelector('#tplList');
  const imgGrid = root.querySelector('#imgTplGrid');
  if (list) {
    const fileIcon = templateIcon();
    const gear = gearIcon();
    list.innerHTML = ['colonoscopia', 'gastroscopia', 'duodenoscopia', 'broncoscopia', 'blanco']
      .map((key) => {
        const tpl = editorState.templatesByKey[key];
        return `
          <div class="tpl-item">
            <button type="button" class="tpl-main" data-tpl="${escapeHtml(key)}">
              <span class="tpl-ico">${key === 'blanco' ? '+' : fileIcon}</span>
              <span class="tpl-tx"><span class="tpl-t">${escapeHtml(tpl.name)}</span><span class="tpl-d">${escapeHtml(tpl.description)}</span></span>
            </button>
            <button type="button" class="tpl-cfg" data-tpl-cfg="${escapeHtml(key)}" aria-label="Editar plantilla" title="Editar plantilla">${gear}</button>
          </div>`;
      }).join('');
  }

  if (imgGrid) {
    const gear = gearIcon();
    imgGrid.innerHTML = ['img2', 'img3', 'img4', 'imgNone']
      .map((key, index) => {
        const tpl = editorState.templatesByKey[key];
        const spans = tpl.count ? Array.from({ length: tpl.count }, () => '<span></span>').join('') : '<span style="background:none;border:1px dashed var(--stroke-strong)"></span>';
        const cols = tpl.count ? tpl.cols : 1;
        return `
          <div class="img-item">
            <button type="button" class="img-tpl ${index === 0 ? 'active' : ''}" data-tpl="${escapeHtml(key)}">
              <span class="img-prev" style="grid-template-columns:repeat(${cols},1fr)">${spans}</span>
              <span class="img-t">${escapeHtml(tpl.name)}</span>
            </button>
            ${key === 'imgNone' ? '' : `<button type="button" class="img-cfg" data-tpl-cfg="${escapeHtml(key)}" aria-label="Editar plantilla" title="Editar plantilla">${gear}</button>`}
          </div>`;
      }).join('');
  }
}

function renderStudyOptionsLaravel(root) {
  const select = root.querySelector('#edEstudioSel');
  if (!select) return;
  select.innerHTML = '<option value="">Selecciona un estudio sin reporte...</option>';
  editorState.studies.forEach((study) => {
    const option = document.createElement('option');
    option.value = study.id;
    option.textContent = study.label;
    select.appendChild(option);
  });
  if (editorState.selectedStudy?.id) select.value = editorState.selectedStudy.id;
}

function applyStudyLaravel(root, study) {
  editorState.selectedStudy = study || editorState.selectedStudy || null;
  const today = new Date().toLocaleDateString('es-MX');
  setText(root, '#reportDateText', today);
  setText(root, '[data-bind="doc-patient"]', study?.patientName || 'Nombre del paciente');
  setText(root, '[data-bind="doc-age"]', study?.patientAge || '');
  setText(root, '[data-bind="doc-gender"]', study?.patientGender || '');
  setText(root, '[data-bind="doc-birth-date"]', study?.patientBirthDate || '');
  setText(root, '[data-bind="doc-study-date"]', study?.date || today);
  setText(root, '[data-bind="doc-procedure"]', study?.procedure || 'Tipo de procedimiento');
  const typeSelect = root.querySelector('#edTipo');
  if (typeSelect && study?.type) {
    const hasOption = Array.from(typeSelect.options).some(option => option.value === study.type);
    if (!hasOption) typeSelect.append(new Option(study.type, study.type));
    typeSelect.value = study.type;
  }
}

function applyHeaderConfig(root, cfg) {
  const header = root.querySelector('.ed-doc .rep-header');
  if (!cfg || !header) return;
  const scale = (header.clientWidth || PAGE_W) / PAGE_W;
  header.style.height = `${(cfg.headH || 121) * scale}px`;
  const place = (selector, box) => {
    const el = root.querySelector(selector);
    if (!el || !box) return;
    el.style.left = `${box.x * scale}px`;
    el.style.top = `${box.y * scale}px`;
    el.style.width = `${box.w * scale}px`;
    el.style.height = `${box.h * scale}px`;
  };
  place('#repLogo', cfg.logo);
  place('#repClinicBox', cfg.name);
  place('#repAnat', cfg.anat);

  const logo = root.querySelector('#repLogo');
  if (logo) logo.innerHTML = cfg.logoImg ? `<img src="${escapeHtml(cfg.logoImg)}" alt="Logo de la clinica">` : '<span class="logo-ph">Logo de<br>la clinica</span>';

  const anat = root.querySelector('#repAnat');
  const studyImage = studyImageForType(root.querySelector('#edTipo')?.value || '');
  const anatSrc = cfg.anatImg || studyImage;
  if (anat) {
    anat.innerHTML = anatSrc
      ? `<img src="${escapeHtml(anatSrc)}" alt="Imagen lateral">`
      : '<svg viewBox="0 0 80 110" fill="none" stroke="currentColor" stroke-width="2"><path d="M30 8c-6 6-10 14-10 22 0 6 2 11 6 16 4 5 6 9 6 15 0 10-8 14-8 24 0 8 6 13 14 13s14-6 14-15c0-12-12-16-12-26 0-7 5-11 9-17 3-5 5-10 5-16C58 22 50 12 42 8"/><path d="M30 8c4-3 8-3 12 0"/></svg>';
  }

  const clinic = root.querySelector('#repClinicName');
  if (clinic) {
    if (cfg.clinic) clinic.textContent = cfg.clinic;
    clinic.style.fontSize = `${(cfg.name?.fontSize || 21) * scale}px`;
  }
  if (cfg.signName) setText(root, '#repSignName', cfg.signName);
  root.querySelector('#repSign')?.setAttribute('data-pos', cfg.signPos || 'center');
}

function renderSections(root, template, preserveContent = false) {
  const title = root.querySelector('#docTitle');
  const subtitle = root.querySelector('#docSubtitle');
  const sections = root.querySelector('#docSections');
  if (title) title.textContent = template.title || 'NUEVO REPORTE';
  if (subtitle) subtitle.textContent = template.subtitle || '';
  if (!sections || preserveContent) return;

  const cfg = template.cfg || {};
  const hidden = cfg.secciones_ocultas || [];
  const deleted = cfg.secciones_borradas || [];
  const custom = cfg.secciones_nuevas || [];
  const sectionList = [...(template.sections || []).filter(section => !hidden.includes(section.h) && !deleted.includes(section.h)), ...custom];
  sections.innerHTML = sectionList.map((section) => {
    const head = `<h4 data-section="${escapeHtml(section.h)}">${escapeHtml(section.h)}<button type="button" class="sec-hide" title="Ocultar seccion">x</button><button type="button" class="sec-delete" title="Borrar seccion">Borrar</button></h4>`;
    if (section.type === 'ul' || section.tipo === 'ul') {
      return `${head}<ul><li contenteditable="true" data-ph="${escapeHtml(section.ph || 'Escribe aqui...')}"></li></ul>`;
    }
    return `${head}<p contenteditable="true" data-ph="${escapeHtml(section.ph || 'Escribe aqui...')}"></p>`;
  }).join('') + '<button type="button" class="sec-add" id="secAddBtn">+ Anadir seccion</button>';
}

function visibleImages() {
  return editorState.images
    .map((img, index) => ({ img, index }))
    .filter((entry) => {
      const state = editorState.imageState.get(imageKey(entry.img, entry.index));
      return !state || state.visible !== false;
    });
}

function renderReportImages(root) {
  const repImgs = root.querySelector('#repImgs');
  if (!repImgs) return;
  if (editorState.imageEnabled === false || editorState.imageCols <= 0) {
    repImgs.style.display = 'none';
    repImgs.innerHTML = '';
    syncCaptureThumbs(root);
    return;
  }
  const cols = clampInt(editorState.imageCols, 1, 8, 4);
  const entries = visibleImages();
  repImgs.style.display = entries.length ? 'grid' : 'none';
  repImgs.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  repImgs.innerHTML = entries.map(({ img, index }) => {
    const key = imageKey(img, index);
    const state = editorState.imageState.get(key) || { visible: true, size: 1 };
    const span = clampInt(state.size, 1, cols, 1);
    return `
      <span class="cell" data-img-index="${index}" style="grid-column:span ${span}">
        ${reportImageMarkup(img, index)}
        <span class="rep-img-tools">
          <button type="button" data-img-action="smaller" aria-label="Reducir captura" title="Reducir">-</button>
          <button type="button" data-img-action="larger" aria-label="Agrandar captura" title="Agrandar">+</button>
          <button type="button" data-img-action="remove" aria-label="Quitar captura" title="Quitar">x</button>
        </span>
        <span class="rep-img-size">${span}x</span>
      </span>`;
  }).join('');
  hydrateReportImages(repImgs);
  syncCaptureThumbs(root);
}

function syncCaptureThumbs(root) {
  const count = visibleImages().length;
  setText(root, '#capIncludedCount', `${count}/${editorState.images.length}`);
  root.querySelectorAll('.cap-thumb[data-img-index]').forEach((button) => {
    const index = Number(button.dataset.imgIndex);
    const img = editorState.images[index];
    const state = editorState.imageState.get(imageKey(img, index)) || { visible: true, size: 1 };
    const visible = state.visible !== false;
    button.classList.toggle('off', !visible);
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    setText(button, '.cap-state', visible ? 'En reporte' : 'Oculta');
  });
}

function renderCapturePanel(root) {
  const host = root.querySelector('#capGridHost');
  if (!host) return;
  if (!editorState.images.length) {
    host.innerHTML = '<p class="cap-empty">Sin capturas asociadas.</p>';
    syncCaptureThumbs(root);
    return;
  }
  host.innerHTML = `<div class="cap-grid">${editorState.images.map((img, index) => `
    <div class="cap-thumb-wrap">
      <button type="button" class="cap-thumb" data-img-index="${index}" title="Agregar o quitar del reporte">
        ${reportImageMarkup(img, index)}
        <span class="cap-state">En reporte</span>
      </button>
      <a class="cap-open" href="${escapeHtml(img.show_url || img.url)}" target="_blank" rel="noopener" aria-label="Abrir captura completa" title="Abrir captura completa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
      </a>
    </div>`).join('')}</div>`;
  hydrateReportImages(host);
  syncCaptureThumbs(root);
}

function applyTemplateByKey(root, key, preserveContent = false) {
  const template = editorState.templatesByKey[key] || editorState.templatesByKey.blanco;
  if (!template) return;
  editorState.currentTemplateKey = key;
  editorState.selectedTemplate = template;
  if (template.type) {
    const typeSelect = root.querySelector('#edTipo');
    if (typeSelect) typeSelect.value = template.type;
    setText(root, '[data-bind="doc-procedure"]', template.type);
  }
  if (template.imgOnly) {
    root.querySelector('#docSections').innerHTML = '';
    editorState.imageEnabled = template.cols > 0 && template.count > 0;
    editorState.imageCols = template.cols || 0;
  } else {
    editorState.imageEnabled = true;
    editorState.imageCols = 4;
    renderSections(root, template, preserveContent);
  }
  applyHeaderConfig(root, template.cfg || defaultTemplateConfig());
  renderReportImages(root);
  markReportDirty(root);
}

function selectedFindingTexts(root) {
  const headings = root.querySelectorAll('#docSections h4');
  const hallazgoHeading = Array.from(headings).find((heading) => (
    heading.textContent || ''
  ).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes('HALLAZGO'));
  let next = hallazgoHeading?.nextElementSibling || null;
  while (next && next.tagName !== 'H4') {
    if (next.tagName === 'UL') {
      return Array.from(next.querySelectorAll('li'))
        .map(li => li.textContent.trim())
        .filter(Boolean);
    }
    next = next.nextElementSibling;
  }
  return [];
}

function findFindingsList(root) {
  const headings = root.querySelectorAll('#docSections h4');
  const heading = Array.from(headings).find((item) => (
    item.textContent || ''
  ).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes('HALLAZGO'));
  let next = heading?.nextElementSibling || null;
  while (next && next.tagName !== 'H4') {
    if (next.tagName === 'UL') return next;
    next = next.nextElementSibling;
  }
  return null;
}

function insertFinding(root, name) {
  const list = findFindingsList(root);
  if (!list || !String(name || '').trim()) return;
  const text = String(name).trim();
  const existing = Array.from(list.querySelectorAll('li')).map(li => li.textContent.trim());
  if (existing.includes(text)) return;
  const placeholder = list.querySelector('li[data-ph]');
  if (placeholder && !placeholder.textContent.trim()) {
    placeholder.textContent = text;
  } else {
    const item = document.createElement('li');
    item.contentEditable = 'true';
    item.textContent = text;
    list.appendChild(item);
  }
  updateFindingsCount(root);
  markReportDirty(root);
}

function updateFindingsCount(root) {
  const strong = root.querySelector('#hzCount strong');
  if (strong) strong.textContent = String(selectedFindingTexts(root).length);
}

function renderFindingsChips(root) {
  const host = root.querySelector('#hzChips');
  if (!host) return;
  const findings = editorState.findings.length ? editorState.findings : [
    { id: 'gastritis', name: 'Gastritis', critical: false },
    { id: 'polipo', name: 'Polipo', critical: false },
    { id: 'sangrado', name: 'Sangrado activo', critical: true },
    { id: 'ulcera', name: 'Ulcera', critical: true },
  ];
  host.innerHTML = findings.map(item => `
    <span class="hz-chip ${item.critical ? 'critico' : ''}" data-finding-name="${escapeHtml(item.name)}">
      <span class="hz-dot"></span>${escapeHtml(item.name)}
    </span>`).join('');
}

function cleanPreviewClone(clone) {
  clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  clone.querySelectorAll('.sec-add,.sec-hide,.sec-delete,.rep-img-tools,.rep-img-size').forEach(el => el.remove());
  return clone;
}

function openReportPreview(root) {
  const doc = root.querySelector('#reportDocument');
  const modal = root.querySelector('#previewModal');
  const paper = root.querySelector('#pvPaper');
  if (!doc || !modal || !paper) return;
  const clone = cleanPreviewClone(doc.cloneNode(true));
  paper.innerHTML = '';
  paper.appendChild(clone);
  resetReportAssetImages(paper);
  hydrateReportImages(paper, { force: true });
  modal.classList.add('open');
}

function closeReportPreview(root) {
  root.querySelector('#previewModal')?.classList.remove('open');
}

function removeReportPrintRoot() {
  document.getElementById('printReportRoot')?.remove();
  document.body.classList.remove('has-report-print-root');
}

function resetReportAssetImages(root) {
  root.querySelectorAll?.('img[data-report-asset-url]').forEach((image) => {
    image.removeAttribute('data-report-asset-hydrated');

    const loader = image.closest('.cell, .cap-thumb')?.querySelector('.report-img-loader');
    if (loader) {
      loader.hidden = Boolean(image.getAttribute('src')) && !image.hidden;
    }
  });
}

function buildReportPrintRoot(root) {
  const doc = root.querySelector('#reportDocument');
  if (!doc) return null;

  removeReportPrintRoot();

  const printRoot = document.createElement('div');
  printRoot.id = 'printReportRoot';

  const paper = document.createElement('div');
  paper.className = 'pv-paper print-paper';
  paper.appendChild(cleanPreviewClone(doc.cloneNode(true)));

  printRoot.appendChild(paper);
  document.body.appendChild(printRoot);
  document.body.classList.add('has-report-print-root');
  resetReportAssetImages(printRoot);

  return printRoot;
}

async function printPreviewReport(root) {
  openReportPreview(root);
  const printRoot = buildReportPrintRoot(root);
  if (!printRoot) return;

  await Promise.race([
    hydrateReportImages(printRoot, { force: true }),
    delay(REPORT_PRINT_WAIT_MS),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  window.addEventListener(
    'afterprint',
    () => {
      setTimeout(removeReportPrintRoot, 200);
    },
    { once: true }
  );
  window.print();
}

function setupLaravelEditorInteractions(root) {
  root.querySelector('#capPanelToggle')?.addEventListener('click', () => {
    const panel = root.querySelector('.cap-panel');
    const collapsed = panel?.classList.toggle('is-collapsed');
    root.querySelector('#capPanelToggle')?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  root.querySelector('#repImgs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-img-action]');
    if (!button) return;
    const cell = button.closest('[data-img-index]');
    const index = Number(cell?.dataset.imgIndex);
    const img = editorState.images[index];
    const key = imageKey(img, index);
    const state = editorState.imageState.get(key) || { visible: true, size: 1 };
    if (button.dataset.imgAction === 'remove') state.visible = false;
    if (button.dataset.imgAction === 'larger') state.size = clampInt((state.size || 1) + 1, 1, editorState.imageCols || 1, 1);
    if (button.dataset.imgAction === 'smaller') state.size = clampInt((state.size || 1) - 1, 1, editorState.imageCols || 1, 1);
    editorState.imageState.set(key, state);
    renderReportImages(root);
    markReportDirty(root);
  });

  root.querySelector('#capGridHost')?.addEventListener('click', (event) => {
    const button = event.target.closest('.cap-thumb[data-img-index]');
    if (!button) return;
    const index = Number(button.dataset.imgIndex);
    const img = editorState.images[index];
    const key = imageKey(img, index);
    const state = editorState.imageState.get(key) || { visible: true, size: 1 };
    state.visible = state.visible === false;
    editorState.imageState.set(key, state);
    renderReportImages(root);
    markReportDirty(root);
  });

  root.querySelector('#imgRestoreAll')?.addEventListener('click', () => {
    editorState.images.forEach((img, index) => {
      const key = imageKey(img, index);
      const state = editorState.imageState.get(key) || { visible: true, size: 1 };
      state.visible = true;
      editorState.imageState.set(key, state);
    });
    renderReportImages(root);
    markReportDirty(root);
  });

  root.querySelectorAll('.tpl-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tpl-tab').forEach(item => item.classList.remove('active'));
      tab.classList.add('active');
      root.querySelectorAll('.tpl-pane').forEach(item => item.classList.remove('active'));
      root.querySelector(`#pane${tab.dataset.tab === 'imagenes' ? 'Imagenes' : 'Informe'}`)?.classList.add('active');
    });
  });

  root.querySelector('#tplList')?.addEventListener('click', (event) => {
    const cfg = event.target.closest('[data-tpl-cfg]');
    if (cfg) {
      openTemplateConfig(root, cfg.dataset.tplCfg);
      return;
    }
    const main = event.target.closest('[data-tpl]');
    if (main) applyTemplateByKey(root, main.dataset.tpl);
  });

  root.querySelector('#imgTplGrid')?.addEventListener('click', (event) => {
    const cfg = event.target.closest('[data-tpl-cfg]');
    if (cfg) {
      openTemplateConfig(root, cfg.dataset.tplCfg);
      return;
    }
    const main = event.target.closest('[data-tpl]');
    if (!main) return;
    root.querySelectorAll('.img-tpl').forEach(item => item.classList.remove('active'));
    main.classList.add('active');
    applyTemplateByKey(root, main.dataset.tpl);
  });

  root.querySelector('#docSections')?.addEventListener('click', (event) => {
    const hide = event.target.closest('.sec-hide');
    const remove = event.target.closest('.sec-delete');
    const add = event.target.closest('.sec-add');
    const template = editorState.templatesByKey[editorState.currentTemplateKey];
    if (!template) return;
    if (hide || remove) {
      const section = event.target.closest('h4')?.dataset.section;
      if (!section) return;
      const field = hide ? 'secciones_ocultas' : 'secciones_borradas';
      template.cfg[field] = template.cfg[field] || [];
      if (!template.cfg[field].includes(section)) template.cfg[field].push(section);
      applyTemplateByKey(root, editorState.currentTemplateKey);
    }
    if (add) {
      const sectionName = window.prompt('Nombre de la nueva seccion:');
      if (!sectionName?.trim()) return;
      template.cfg.secciones_nuevas = template.cfg.secciones_nuevas || [];
      template.cfg.secciones_nuevas.push({ h: sectionName.trim(), ph: 'Escribe aqui...', type: 'p' });
      applyTemplateByKey(root, editorState.currentTemplateKey);
    }
  });

  root.querySelector('#hzChips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-finding-name]');
    if (chip) insertFinding(root, chip.dataset.findingName);
  });
  root.querySelector('#hzAddBtn')?.addEventListener('click', () => {
    const input = root.querySelector('#hzNewInput');
    insertFinding(root, input?.value || '');
    if (input) input.value = '';
  });
  root.querySelector('#hzNewInput')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    root.querySelector('#hzAddBtn')?.click();
  });

  root.querySelector('#btnPreview')?.addEventListener('click', () => openReportPreview(root));
  root.querySelector('#pvClose')?.addEventListener('click', () => closeReportPreview(root));
  root.querySelector('#pvPrint')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button?.dataset.printing === 'true') return;
    if (button) button.dataset.printing = 'true';
    setButtonBusy(button, true, 'Preparando...');
    try {
      await printPreviewReport(root);
    } finally {
      if (button) button.dataset.printing = 'false';
      setButtonBusy(button, false);
    }
  });

  root.querySelector('#reportDocument')?.addEventListener('input', () => {
    markReportDirty(root);
    if (root.querySelector('#autosaveInput')?.checked !== false) saveDraft(root, false);
  });
}

function openTemplateConfig(root, key) {
  const template = editorState.templatesByKey[key];
  const modal = root.querySelector('#cfgModal');
  if (!template || !modal) return;
  modal.dataset.editingKey = key;
  const work = JSON.parse(JSON.stringify(template.cfg || defaultTemplateConfig()));
  modal._work = work;
  root.querySelector('#cfgSub').textContent = template.imgOnly ? 'Plantilla de imagenes' : `Plantilla: ${template.name}`;
  root.querySelector('#imgCfgFields').style.display = template.imgOnly ? 'block' : 'none';
  root.querySelector('#cfgClinic').value = work.clinic || root.querySelector('#repClinicName')?.textContent || '';
  root.querySelector('#cfgSignName').value = work.signName || root.querySelector('#repSignName')?.textContent || '';
  root.querySelector('#cfgSignPos').value = work.signPos || 'center';
  root.querySelector('#cfgImgCols').value = template.cols || 2;
  root.querySelector('#cfgImgCount').value = template.count || 4;
  modal.classList.add('open');
  drawTemplateConfig(root);
}

function closeTemplateConfig(root) {
  root.querySelector('#cfgModal')?.classList.remove('open');
}

function drawTemplateConfig(root) {
  const modal = root.querySelector('#cfgModal');
  const work = modal?._work;
  const sheet = root.querySelector('#cfgSheet');
  const head = root.querySelector('#cfgHead');
  if (!work || !sheet || !head) return;
  const maxBottom = Math.max(work.logo.y + work.logo.h, work.name.y + work.name.h, work.anat.y + work.anat.h);
  work.headH = Math.max(96, Math.ceil(maxBottom) + 6);
  const scale = (sheet.clientWidth || PAGE_W) / PAGE_W;
  head.style.height = `${work.headH * scale}px`;
  const place = (id, box) => {
    const el = root.querySelector(id);
    if (!el) return;
    el.style.left = `${box.x * scale}px`;
    el.style.top = `${box.y * scale}px`;
    el.style.width = `${box.w * scale}px`;
    el.style.height = `${box.h * scale}px`;
  };
  place('#elLogo', work.logo);
  place('#elName', work.name);
  place('#elAnat', work.anat);
  root.querySelector('#elLogoIn').innerHTML = work.logoImg ? `<img src="${escapeHtml(work.logoImg)}" alt="Logo">` : 'Logo de<br>la clinica';
  root.querySelector('#elNameTx').textContent = work.clinic || 'Nombre de la clinica';
  root.querySelector('#elNameTx').style.fontSize = `${(work.name.fontSize || 21) * scale}px`;
  const anatSrc = work.anatImg || studyImageForType(root.querySelector('#edTipo')?.value || '');
  root.querySelector('#elAnatIn').innerHTML = anatSrc
    ? `<img src="${escapeHtml(anatSrc)}" alt="">`
    : '<svg viewBox="0 0 80 110" fill="none" stroke="currentColor" stroke-width="2"><path d="M30 8c-6 6-10 14-10 22 0 6 2 11 6 16 4 5 6 9 6 15 0 10-8 14-8 24 0 8 6 13 14 13s14-6 14-15c0-12-12-16-12-26 0-7 5-11 9-17 3-5 5-10 5-16C58 22 50 12 42 8"/><path d="M30 8c4-3 8-3 12 0"/></svg>';
  root.querySelector('#cfgSignPv')?.setAttribute('data-pos', work.signPos || 'center');
  root.querySelector('#cfgSignPvTx').textContent = work.signName || 'Dr. Nombre del medico';
}

function setupTemplateConfig(root) {
  const modal = root.querySelector('#cfgModal');
  if (!modal) return;
  const readImage = (input, setter) => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter(String(reader.result || ''));
      drawTemplateConfig(root);
    };
    reader.readAsDataURL(file);
  };
  root.querySelector('#cfgLogoInput')?.addEventListener('change', (event) => readImage(event.target, value => { modal._work.logoImg = value; }));
  root.querySelector('#cfgAnatInput')?.addEventListener('change', (event) => readImage(event.target, value => { modal._work.anatImg = value; }));
  root.querySelector('#cfgClinic')?.addEventListener('input', (event) => { modal._work.clinic = event.target.value; drawTemplateConfig(root); });
  root.querySelector('#cfgSignName')?.addEventListener('input', (event) => { modal._work.signName = event.target.value; drawTemplateConfig(root); });
  root.querySelector('#cfgSignPos')?.addEventListener('change', (event) => { modal._work.signPos = event.target.value; drawTemplateConfig(root); });
  root.querySelector('#cfgCancel')?.addEventListener('click', () => closeTemplateConfig(root));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeTemplateConfig(root);
  });
  root.querySelector('#cfgApply')?.addEventListener('click', () => {
    const key = modal.dataset.editingKey;
    const template = editorState.templatesByKey[key];
    if (!template || !modal._work) return;
    template.cfg = modal._work;
    if (template.imgOnly) {
      template.cols = clampInt(root.querySelector('#cfgImgCols')?.value, 1, 6, template.cols || 2);
      template.count = clampInt(root.querySelector('#cfgImgCount')?.value, 1, 24, template.count || 4);
      renderTemplateLists(root);
    }
    if (editorState.currentTemplateKey === key) applyTemplateByKey(root, key, true);
    closeTemplateConfig(root);
    showToast(root, 'Plantilla aplicada');
  });

  let drag = null;
  const elements = { logo: '#elLogo', name: '#elName', anat: '#elAnat' };
  Object.entries(elements).forEach(([key, selector]) => {
    root.querySelector(selector)?.addEventListener('pointerdown', (event) => {
      const work = modal._work;
      if (!work) return;
      event.preventDefault();
      const mode = event.target.classList.contains('rz') ? 'resize' : 'move';
      const box = work[key];
      drag = { key, mode, sx: event.clientX, sy: event.clientY, box: { ...box } };
      root.querySelectorAll('.cfg-el').forEach(el => el.classList.remove('sel'));
      root.querySelector(selector)?.classList.add('sel');
    });
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag || !modal._work) return;
    const sheet = root.querySelector('#cfgSheet');
    const scale = (sheet?.clientWidth || PAGE_W) / PAGE_W;
    const dx = (event.clientX - drag.sx) / scale;
    const dy = (event.clientY - drag.sy) / scale;
    const box = modal._work[drag.key];
    if (drag.mode === 'move') {
      box.x = Math.max(0, Math.min(PAGE_W - box.w, drag.box.x + dx));
      box.y = Math.max(0, drag.box.y + dy);
    } else {
      box.w = Math.max(24, Math.min(PAGE_W - box.x, drag.box.w + dx));
      box.h = Math.max(20, drag.box.h + dy);
      if (drag.key === 'name') box.fontSize = Math.max(10, Math.round(box.h * 0.32));
    }
    drawTemplateConfig(root);
  });
  window.addEventListener('pointerup', () => { drag = null; });
}

function setupToolbar(root) {
  const docEl = root.querySelector('#reportDocument');
  const buttons = Array.from(root.querySelectorAll('.ed-tb[data-cmd]'));
  const stateCmds = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'];
  let savedRange = null;
  const selectionInsideDoc = () => {
    const selection = document.getSelection();
    return Boolean(selection?.rangeCount && docEl?.contains(selection.getRangeAt(0).commonAncestorContainer));
  };
  const saveSelection = () => {
    const selection = document.getSelection();
    if (selection?.rangeCount && selectionInsideDoc()) savedRange = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    if (!savedRange) return;
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
  };
  const refresh = () => {
    buttons.forEach((button) => {
      const cmd = button.dataset.cmd;
      if (!stateCmds.includes(cmd)) return;
      try {
        button.classList.toggle('active', document.queryCommandState(cmd));
      } catch {
        button.classList.remove('active');
      }
    });
  };
  buttons.forEach(button => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      restoreSelection();
      document.execCommand(button.dataset.cmd, false, null);
      saveSelection();
      refresh();
      markReportDirty(root);
    });
  });
  document.addEventListener('selectionchange', () => {
    if (selectionInsideDoc()) {
      saveSelection();
      refresh();
    }
  });
  docEl?.addEventListener('keyup', () => {
    saveSelection();
    refresh();
    updateFindingsCount(root);
  });
  docEl?.addEventListener('mouseup', () => {
    saveSelection();
    refresh();
  });
  root.querySelector('#textColorBtn')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    saveSelection();
    root.querySelector('#textColorInput')?.click();
  });
  root.querySelector('#textColorInput')?.addEventListener('input', (event) => {
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, event.target.value);
    root.querySelector('#textColorSwatch').style.backgroundColor = event.target.value;
    saveSelection();
    markReportDirty(root);
  });
  root.querySelector('#underlineColorBtn')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, '#ffff00');
    saveSelection();
    markReportDirty(root);
  });
  root.querySelector('#fontSizeInput')?.addEventListener('change', (event) => {
    const size = clampInt(event.target.value, 8, 72, 14);
    restoreSelection();
    document.execCommand('fontSize', false, '3');
    const font = docEl?.querySelector('font[size="3"]');
    if (font) {
      font.removeAttribute('size');
      font.style.fontSize = `${size}px`;
    }
    saveSelection();
    markReportDirty(root);
  });
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
  const sections = root.querySelector('#docSections');
  const typeSelect = root.querySelector('#edTipo');
  const existingReporteId = root.querySelector('#existingReporteId')?.value || null;
  return {
    estudio_id: editorState.selectedStudy?.id || root.querySelector('#edEstudioSel')?.value || null,
    paciente_id: editorState.selectedStudy?.patientId || null,
    reporte_id: existingReporteId,
    plantilla_id: editorState.selectedTemplate?.id && editorState.selectedTemplate.id !== 'blank' ? editorState.selectedTemplate.id : null,
    tipo_estudio: typeSelect?.value || editorState.selectedStudy?.type || '',
    tipo_reporte: editorState.mode,
    usar_ia: editorState.mode === 'ia',
    fecha_reporte: new Date().toISOString().slice(0, 10),
    contenido_html: sections?.innerHTML || documentEl?.innerHTML || '',
    contenido_texto: sections?.innerText || documentEl?.innerText || '',
    imagenes_config: imageConfigPayload(),
    hallazgos: selectedFindingTexts(root),
  };
}

function responseContent(payload) {
  return payload?.contenido_html || payload?.html || payload?.reporte || payload?.report || payload?.data?.contenido_html || payload?.data?.html || '';
}

async function loadEditorData(root) {
  setEditorAlert(root, 'Cargando estudios, plantillas y hallazgos...');
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : '';
  const params = new URLSearchParams(hashQuery);
  const query = new URLSearchParams();
  ['paciente_id', 'estudio_id', 'reporte_id'].forEach((key) => {
    const value = params.get(key) || params.get(key.replace('_id', ''));
    if (value) query.set(key, value);
  });

  const [editorResult, studiesResult, templatesResult] = await Promise.allSettled([
    reportsRequest(`editor${query.toString() ? `?${query}` : ''}`),
    reportsRequest(`estudios-sin-reporte${query.get('estudio_id') ? `?estudio_id=${encodeURIComponent(query.get('estudio_id'))}` : ''}`),
    reportsRequest('plantillas'),
  ]);

  if (editorResult.status === 'rejected') throw editorResult.reason;

  const payload = editorResult.value;
  const editorData = payload?.data || payload || {};
  const data = normalizeEditorPayload({
    data: {
      studies: studiesResult.status === 'fulfilled' ? studiesResult.value?.estudios : [],
      templates: [],
      findings: editorData.hallazgos || [],
    },
  });
  const preloadStudy = normalizeStudy({
    id: editorData.estudio_id,
    paciente_id: editorData.paciente_id,
    paciente: editorData.paciente,
    edad: editorData.edad,
    sexo: editorData.sexo,
    fecha_nacimiento: editorData.nacimiento,
    fecha: editorData.fecha_estudio,
    procedimiento: editorData.procedimiento,
    tipo: editorData.tipo,
    label: `${editorData.paciente || 'Paciente'} - ${editorData.procedimiento || 'Estudio'}${editorData.fecha_estudio ? ` - ${editorData.fecha_estudio}` : ''}`,
  }, 0);

  const studies = data.studies.length ? data.studies : (preloadStudy.id && preloadStudy.id !== 'undefined' ? [preloadStudy] : []);
  const templatesByKey = mergeTemplateData(templatesResult.status === 'fulfilled' ? templatesResult.value?.plantillas : {});
  const savedImageConfig = editorData.reporte?.imagenes_config || {};
  const reportImages = Array.isArray(editorData.imagenes)
    ? editorData.imagenes.map(normalizeReportImage)
    : [];

  editorState = {
    ...editorState,
    studies,
    templates: Object.values(templatesByKey),
    templatesByKey,
    findings: data.findings,
    images: reportImages,
    report: editorData.reporte || null,
    selectedStudy: preloadStudy.id && preloadStudy.id !== 'undefined' ? preloadStudy : studies[0] || null,
    selectedTemplate: null,
    imageState: new Map(),
    imageEnabled: savedImageConfig.enabled !== false,
    imageCols: clampInt(savedImageConfig.cols, 1, 8, 4),
    assetUrlCache: new Map(),
  };

  editorState.images.forEach((img, index) => {
    const key = imageKey(img, index);
    const saved = savedImageConfig.items?.[key] || {};
    editorState.imageState.set(key, {
      visible: saved.visible !== false,
      size: clampInt(saved.size, 1, editorState.imageCols || 8, 1),
    });
  });

  renderStudyOptionsLaravel(root);
  renderTemplateLists(root);
  renderCapturePanel(root);
  applyStudyLaravel(root, editorState.selectedStudy);

  const initialKey = templateKeyFromType(editorState.selectedStudy?.type || editorData.tipo);
  applyTemplateByKey(root, initialKey, Boolean(editorData.reporte?.contenido_html));
  if (editorData.reporte?.contenido_html) {
    root.querySelector('#docSections').innerHTML = editorData.reporte.contenido_html;
    root.querySelector('#existingReporteId').value = editorData.reporte.id || '';
  } else if (editorData.reporte?.contenido_texto) {
    root.querySelector('#docSections').innerHTML = `<div contenteditable="true">${escapeHtml(editorData.reporte.contenido_texto)}</div>`;
    root.querySelector('#existingReporteId').value = editorData.reporte.id || '';
  }

  setEditorAlert(root, '');

  if (!editorState.studies.length) {
    setEditorAlert(root, 'No hay estudios sin reporte disponibles.', 'warn');
  }
}

async function generateReport(root) {
  if (editorState.generating) return;
  const button = root.querySelector('#generateAiReportBtn');
  setEditorMode(root, 'ia');
  editorState.generating = true;
  setButtonBusy(button, true, 'Generando...');
  setEditorAlert(root, 'Generando reporte con IA...');

  try {
    const payload = await reportsRequest('generar', {
      method: 'POST',
      body: JSON.stringify(collectReportPayload(root)),
    });
    const content = responseContent(payload);
    if (content) root.querySelector('#docSections').innerHTML = content;
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
  const button = root.querySelector('#btnGuardar');
  editorState.saving = true;
  setButtonBusy(button, true, 'Guardando...');
  setEditorAlert(root, 'Guardando reporte...');

  try {
    const payload = await reportsRequest('guardar', {
      method: 'POST',
      body: JSON.stringify(collectReportPayload(root)),
    });
    if (payload?.reporte_id) root.querySelector('#existingReporteId').value = payload.reporte_id;
    localStorage.removeItem(draftKey());
    setEditorAlert(root, 'Reporte guardado correctamente.', 'ok');
    setEditorStatus(root, 'Guardado', true);
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
    if (content) root.querySelector('#docSections').innerHTML = content;
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
  setEditorMode(root, currentEditorMode());

  if (!getAuthToken()) {
    renderLaravelLogin(root, 'Inicia sesion para redactar reportes.');
    return;
  }

  root.querySelectorAll('[data-report-mode]').forEach((button) => {
    button.addEventListener('click', () => setEditorMode(root, button.dataset.reportMode));
  });

  root.querySelector('#edEstudioSel')?.addEventListener('change', async (event) => {
    const study = editorState.studies.find(item => item.id === event.target.value);
    applyStudyLaravel(root, study);
    if (study?.id) {
      const params = new URLSearchParams();
      params.set('mode', editorState.mode);
      params.set('estudio_id', study.id);
      window.location.hash = `ia-reportes-redactar?${params}`;
      return;
    }
    restoreDraft(root);
  });

  root.querySelector('#edTipo')?.addEventListener('change', (event) => {
    setText(root, '[data-bind="doc-procedure"]', event.target.value);
    applyHeaderConfig(root, editorState.templatesByKey[editorState.currentTemplateKey]?.cfg || defaultTemplateConfig());
    });

  root.querySelector('#chatForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = root.querySelector('#chatText');
    const text = input?.value || '';
    if (input) input.value = '';
    sendChat(root, text);
  });

  root.querySelector('#chatChips')?.addEventListener('click', (event) => {
    const button = event.target.closest('.chat-chip');
    if (button) sendChat(root, button.textContent || '');
  });

  root.querySelector('#generateAiReportBtn')?.addEventListener('click', () => generateReport(root));
  root.querySelector('#btnGuardar')?.addEventListener('click', () => saveReport(root));
  root.querySelector('#btnDraft')?.addEventListener('click', () => saveDraft(root));
  setupToolbar(root);
  setupTemplateConfig(root);
  setupLaravelEditorInteractions(root);

  try {
    await loadEditorData(root);
    restoreDraft(root);
    renderFindingsChips(root);
    updateFindingsCount(root);
    const greeting = 'Hola, soy ENCLAII. Tu redactas el reporte y yo te ayudo: puedo proponer hallazgos, recomendaciones o mejorar la redaccion de cualquier seccion. ¿Empezamos?';
    appendMessage(root, greeting, 'ai');
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
