import { state } from './state.js';
import { cleanNullableValue } from './utils.js';

function validateForm(form) {
  const folio =
    String(
      document.getElementById(
        'folioInput'
      )?.value ||
      form.elements.folio?.value ||
      state.currentPatient?.folio ||
      ''
    ).trim();

  const name =
    String(
      form.elements
        .nombre_completo
        ?.value ||
      ''
    ).trim();

  if (!folio) {
    throw new Error(
      'No se pudo generar el folio. Regresa al listado e intenta nuevamente.'
    );
  }

  if (!name) {
    form.elements
      .nombre_completo
      ?.focus();

    throw new Error(
      'Escribe el nombre completo del paciente.'
    );
  }

  const email =
    String(
      form.elements.email
        ?.value ||
      ''
    ).trim();

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    form.elements.email
      ?.focus();

    throw new Error(
      'Escribe un correo electrónico válido.'
    );
  }
}

function buildPatientPayload(form) {
  const folio =
    String(
      document.getElementById(
        'folioInput'
      )?.value ||
      form.elements.folio?.value ||
      state.currentPatient?.folio ||
      ''
    ).trim();

  const nombreCompleto =
    String(
      form.elements
        .nombre_completo
        ?.value ||
      ''
    ).trim();

  if (!nombreCompleto) {
    throw new Error(
      'Escribe el nombre completo del paciente.'
    );
  }

  const edadValue =
    String(
      document.getElementById(
        'edadCalculada'
      )?.value ||
      ''
    ).trim();

  const pesoValue =
    String(
      form.elements.peso?.value ||
      ''
    ).trim();

  const alturaValue =
    String(
      form.elements.altura?.value ||
      ''
    ).trim();

  return {
    folio,
    identificacion: folio,

    nombre_completo:
      nombreCompleto,

    fecha_nacimiento:
      cleanNullableValue(
        form.elements
          .fecha_nacimiento
          ?.value
      ),

    edad:
      edadValue === ''
        ? null
        : Number(edadValue),

    peso:
      pesoValue === ''
        ? null
        : Number(pesoValue),

    altura:
      alturaValue === ''
        ? null
        : Number(alturaValue),

    sexo:
      cleanNullableValue(
        form.elements.sexo?.value
      ),

    direccion:
      cleanNullableValue(
        form.elements.direccion?.value
      ),

    telefono:
      cleanNullableValue(
        form.elements.telefono?.value
      ),

    email:
      cleanNullableValue(
        form.elements.email?.value
      ),

    medico:
      cleanNullableValue(
        form.elements.medico?.value
      ),

    procedimiento:
      cleanNullableValue(
        form.elements.procedimiento?.value
      ),

    anestesiologo:
      cleanNullableValue(
        form.elements.anestesiologo?.value
      ),

    referido_por:
      cleanNullableValue(
        form.elements.referido_por?.value
      ),

    equipo_utilizado:
      cleanNullableValue(
        form.elements
          .equipo_utilizado
          ?.value
      ),

    diagnostico_preliminar:
      cleanNullableValue(
        form.elements
          .diagnostico_preliminar
          ?.value
      ),

    enfermedad:
      cleanNullableValue(
        form.elements.enfermedad?.value
      ),

    alergias:
      cleanNullableValue(
        form.elements.alergias?.value
      ),
  };
}

function buildPatientFormData(
  payload
) {
  const data =
    new FormData();

  Object.entries(payload)
    .forEach(([key, value]) => {
      if (
        value !== null &&
        value !== undefined
      ) {
        data.append(
          key,
          String(value)
        );
      }
    });

  if (state.currentPhotoFile) {
    data.append(
      'foto',
      state.currentPhotoFile,
      state.currentPhotoFile.name ||
      'foto-paciente.png'
    );
  }

  state.selectedStudyFiles.forEach(
    (file) => {
      data.append(
        'estudios_archivos[]',
        file,
        file.name ||
        'documento'
      );
    }
  );

  if (state.currentMode === 'edit') {
    data.append(
      '_method',
      'PUT'
    );
  }

  return data;
}

function hasPatientFiles() {
  return Boolean(
    state.currentPhotoFile ||
    state.selectedStudyFiles.length > 0
  );
}

export {
  validateForm,
  buildPatientPayload,
  buildPatientFormData,
  hasPatientFiles,
};
