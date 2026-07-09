// ================= Nuevo Paciente · Inicializador =================

import { SAMPLE_PATIENTS } from './pacientes.js';

export function initNuevoPaciente() {

  // ── Folio automático ──
  const currentCount = SAMPLE_PATIENTS.length + 1;
  const folio = 'P-' + String(currentCount).padStart(3, '0');
  const folioEl = document.getElementById('npFolioDisplay');
  if (folioEl) folioEl.textContent = folio;

  // ── Calcular edad desde fecha de nacimiento ──
  const inputFecha = document.getElementById('npFechaNac');
  const inputEdad  = document.getElementById('npEdad');
  if (inputFecha && inputEdad) {
    inputFecha.addEventListener('change', () => {
      const dob = new Date(inputFecha.value);
      if (isNaN(dob)) { inputEdad.value = ''; return; }
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      inputEdad.value = age >= 0 ? age + ' años' : '';
    });
  }

  // ── Modal de foto ──
  const btnPhoto     = document.getElementById('npBtnPhoto');
  const photoPreview = document.getElementById('npPhotoPreview');
  const photoBox     = document.getElementById('npPhotoBox');
  const modal        = document.getElementById('npFotoModal');

  let stream       = null;
  let facingMode   = 'user';
  let capturedBlob = null;
  let fileBlob     = null;

  function setPhotoInForm(url) {
    if (photoPreview) { photoPreview.src = url; photoPreview.style.display = 'block'; }
    const ph = photoBox?.querySelector('.np-photo-placeholder');
    if (ph) ph.style.display = 'none';
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  async function startCamera() {
    stopStream();
    capturedBlob = null;
    fileBlob     = null;
    const video    = document.getElementById('npfmVideo');
    const canvas   = document.getElementById('npfmCanvas');
    const imgPrev  = document.getElementById('npfmImgPreview');
    const ph       = document.getElementById('npfmPlaceholderWrap');
    if (!video) return;
    try {
      const res = document.getElementById('npfmResolucion')?.value || '1280x720';
      const [w, h] = res.split('x').map(Number);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: w }, height: { ideal: h } }, audio: false });
      video.srcObject = stream;
      video.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
      if (imgPrev) imgPrev.style.display = 'none';
      if (ph) ph.style.display = 'none';
    } catch {
      if (ph) ph.style.display = 'flex';
    }
  }

  function openModal() {
    if (!modal) return;
    modal.style.display = 'flex';
    capturedBlob = null;
    fileBlob     = null;
    const canvas  = document.getElementById('npfmCanvas');
    const imgPrev = document.getElementById('npfmImgPreview');
    const ph      = document.getElementById('npfmPlaceholderWrap');
    if (canvas)  canvas.style.display  = 'none';
    if (imgPrev) imgPrev.style.display = 'none';
    if (ph)      ph.style.display      = 'flex';
    setSrcActive('camera');
    startCamera();
  }

  function closeModal() {
    stopStream();
    if (modal) modal.style.display = 'none';
  }

  function setSrcActive(src) {
    document.getElementById('npfmSrcCamera')?.classList.toggle('npfm-source-active', src === 'camera');
    document.getElementById('npfmSrcFile')?.classList.toggle('npfm-source-active', src === 'file');
    const actRow = document.querySelector('.npfm-actions-row');
    if (actRow) actRow.style.display = src === 'camera' ? 'flex' : 'none';
  }

  if (btnPhoto) btnPhoto.addEventListener('click', openModal);

  document.getElementById('npfmBtnCancel')?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('npfmSrcCamera')?.addEventListener('click', () => {
    setSrcActive('camera');
    startCamera();
  });

  document.getElementById('npfmSrcFile')?.addEventListener('click', () => {
    stopStream();
    const video = document.getElementById('npfmVideo');
    if (video) video.style.display = 'none';
    setSrcActive('file');
    document.getElementById('npfmFileInput')?.click();
  });

  document.getElementById('npfmFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileBlob     = file;
    capturedBlob = null;
    const url    = URL.createObjectURL(file);
    const imgPrev = document.getElementById('npfmImgPreview');
    const ph      = document.getElementById('npfmPlaceholderWrap');
    if (imgPrev) { imgPrev.src = url; imgPrev.style.display = 'block'; }
    if (ph)      ph.style.display = 'none';
    e.target.value = '';
  });

  document.getElementById('npfmBtnCapture')?.addEventListener('click', () => {
    const video  = document.getElementById('npfmVideo');
    const canvas = document.getElementById('npfmCanvas');
    const ph     = document.getElementById('npfmPlaceholderWrap');
    if (!video || !canvas || !stream) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.style.display = 'block';
    video.style.display  = 'none';
    if (ph) ph.style.display = 'none';
    canvas.toBlob(b => { capturedBlob = b; fileBlob = null; }, 'image/jpeg', 0.92);
    stopStream();
  });

  document.getElementById('npfmBtnFlip')?.addEventListener('click', () => {
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    startCamera();
  });

  document.getElementById('npfmBtnGallery')?.addEventListener('click', () => {
    document.getElementById('npfmFileInput')?.click();
  });

  document.getElementById('npfmResolucion')?.addEventListener('change', () => {
    const src = document.getElementById('npfmSrcCamera')?.classList.contains('npfm-source-active');
    if (src) startCamera();
  });

  document.getElementById('npfmBtnUse')?.addEventListener('click', () => {
    const blob = capturedBlob || fileBlob;
    if (!blob) { closeModal(); return; }
    const url = URL.createObjectURL(blob);
    setPhotoInForm(url);
    closeModal();
  });

  // ── Subir archivos de estudios ──
  const btnUpload  = document.getElementById('npBtnUpload');
  const filesInput = document.getElementById('npFilesInput');
  const fileList   = document.getElementById('npFileList');
  let uploadedFiles = [];
  initNuevoPaciente.getUploadedFiles = () => uploadedFiles;

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  if (btnUpload && filesInput) {
    btnUpload.addEventListener('click', () => filesInput.click());
    filesInput.addEventListener('change', () => {
      Array.from(filesInput.files).forEach(file => {
        uploadedFiles.push(file);
        const item = document.createElement('div');
        item.className = 'np-file-item';
        item.dataset.filename = file.name;
        item.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>${file.name}</span>
          <button type="button" class="np-file-remove" aria-label="Quitar archivo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
        item.querySelector('.np-file-remove').addEventListener('click', () => {
          const idx = uploadedFiles.findIndex(f => f.name === file.name && f.size === file.size);
          if (idx > -1) uploadedFiles.splice(idx, 1);
          item.remove();
        });
        if (fileList) fileList.appendChild(item);
      });
      filesInput.value = '';
    });
  }

  // ── Guardar paciente ──
  const form = document.getElementById('formNuevoPaciente');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const nombre = document.getElementById('npNombre')?.value.trim();
      if (!nombre) {
        alert('Por favor ingresa el nombre completo del paciente.');
        document.getElementById('npNombre')?.focus();
        return;
      }

      const fechaHoy = new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' });
      const estudios = uploadedFiles.map((file, i) => ({
        id: Date.now() + i,
        tipo: file.name.split('.').slice(0, -1).join('.') || 'Estudio',
        fecha: fechaHoy,
        nombre: file.name,
        size: formatSize(file.size),
        url: URL.createObjectURL(file),
      }));

      const newPatient = {
        id: Date.now(),
        name: nombre,
        initials: nombre.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(),
        age: document.getElementById('npEdad')?.value || '',
        gender: document.getElementById('npSexo')?.value || '',
        folio,
        dob: document.getElementById('npFechaNac')?.value || '',
        phone: document.getElementById('npTelefono')?.value.trim() || '',
        email: document.getElementById('npEmail')?.value.trim() || '',
        address: document.getElementById('npDireccion')?.value.trim() || '',
        medico: document.getElementById('npMedico')?.value.trim() || '',
        status: '',
        tiene_estudios: estudios.length > 0,
        estudios,
        study_date: estudios.length ? estudios[estudios.length - 1].fecha : '',
        study_type: estudios.length ? estudios[estudios.length - 1].tipo : '',
        proxima_cita: null,
      };

      SAMPLE_PATIENTS.push(newPatient);
      console.log('Nuevo paciente:', newPatient);
      window.location.hash = 'pacientes';
    });
  }
}
