// ================= Editar Paciente · Inicializador =================
import { initNuevoPaciente } from './nuevo-paciente.js';

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
      // TODO: enviar al API de Laravel (PUT /pacientes/{id})
      console.log('Paciente actualizado:', { id: p.id, nombre });
      sessionStorage.removeItem('enclaii-editar-paciente');
      window.location.hash = 'pacientes';
    }, { once: true });
  }
}
