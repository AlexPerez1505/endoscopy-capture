// ================= Editar Paciente · Inicializador =================
import { initNuevoPaciente } from './nuevo-paciente.js';
import { SAMPLE_PATIENTS } from './pacientes.js';

export function initEditarPaciente() {
  // Reutiliza toda la lógica del formulario (modal foto, archivos, edad, etc.)
  initNuevoPaciente();

  // Leer datos guardados
  const raw = sessionStorage.getItem('enclaii-editar-paciente');
  if (!raw) return;
  let p;
  try { p = JSON.parse(raw); } catch { return; }

  // ── Precargar folio ──
  const folioEl = document.getElementById('npFolioDisplay');
  if (folioEl && p.folio) folioEl.textContent = p.folio;

  // ── Precargar foto ──
  if (p.foto_url) {
    const preview = document.getElementById('npPhotoPreview');
    const ph      = document.querySelector('#npPhotoBox .np-photo-placeholder');
    if (preview) { preview.src = p.foto_url; preview.style.display = 'block'; }
    if (ph)      ph.style.display = 'none';
  }

  // ── Precargar campos personales ──
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

  setVal('npNombre',    p.name);
  setVal('npEdad',      p.age);
  setVal('npSexo',      p.gender);
  setVal('npTelefono',  p.phone);
  setVal('npEmail',     p.email);
  setVal('npDireccion', p.address);
  setVal('npMedico',    p.medico);

  // Fecha de nacimiento — convertir de DD/MM/YYYY a YYYY-MM-DD para el input type=date
  if (p.dob) {
    const parts = p.dob.split('/');
    if (parts.length === 3) {
      const iso = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      setVal('npFechaNac', iso);
    }
  }

  // ── Redirigir submit a "guardar cambios" ──
  const form = document.getElementById('formEditarPaciente');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nombre = document.getElementById('npNombre')?.value.trim();
      if (!nombre) {
        alert('Por favor ingresa el nombre completo del paciente.');
        document.getElementById('npNombre')?.focus();
        return;
      }

      const formatSize = bytes => {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      };

      const idx = SAMPLE_PATIENTS.findIndex(x => x.id === p.id);
      if (idx > -1) {
        const target = SAMPLE_PATIENTS[idx];
        const fechaHoy = new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' });
        const nuevosArchivos = (initNuevoPaciente.getUploadedFiles ? initNuevoPaciente.getUploadedFiles() : []).map((file, i) => ({
          id: Date.now() + i,
          tipo: file.name.split('.').slice(0, -1).join('.') || 'Estudio',
          fecha: fechaHoy,
          nombre: file.name,
          size: formatSize(file.size),
          url: URL.createObjectURL(file),
        }));

        target.name    = nombre;
        target.initials = nombre.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        target.age     = document.getElementById('npEdad')?.value || target.age;
        target.gender  = document.getElementById('npSexo')?.value || target.gender;
        target.dob     = document.getElementById('npFechaNac')?.value || target.dob;
        target.phone   = document.getElementById('npTelefono')?.value.trim() || target.phone;
        target.email   = document.getElementById('npEmail')?.value.trim() || target.email;
        target.address = document.getElementById('npDireccion')?.value.trim() || target.address;
        target.medico  = document.getElementById('npMedico')?.value.trim() || target.medico;
        target.estudios = [...(target.estudios || []), ...nuevosArchivos];
        target.tiene_estudios = target.estudios.length > 0;
        if (nuevosArchivos.length) {
          const ult = nuevosArchivos[nuevosArchivos.length - 1];
          target.study_date = ult.fecha;
          target.study_type = ult.tipo;
        }
        console.log('Paciente actualizado:', target);
      }

      sessionStorage.removeItem('enclaii-editar-paciente');
      window.location.hash = 'pacientes';
    }, { once: true });
  }
}
