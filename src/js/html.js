// Helper centralizado para generar HTML de forma segura.
//
// Antes, `escapeHtml()` estaba copiado casi al pie de la letra en 11
// módulos distintos (router.js, dashboard.js, pacientes.js, mensajes.js,
// qr.js, galeria.js, reports.js, configuracion.js, agenda/index.js,
// agenda/agendar/index.js, pacientes-form.js). La lógica en sí estaba bien
// usada en general, pero duplicarla 11 veces hace muy fácil que alguien
// olvide escapar una interpolación nueva sin darse cuenta.
//
// Este módulo ofrece dos herramientas:
//   - escapeHtml(value): la función de siempre, ahora en un solo lugar.
//   - html`...`: un tagged template que escapa automáticamente cualquier
//     valor interpolado, a menos que se marque explícitamente como HTML
//     de confianza con raw().
//
// Uso recomendado en código nuevo:
//   root.innerHTML = html`<p>${patient.name}</p>`;
//   // en vez de: root.innerHTML = `<p>${escapeHtml(patient.name)}</p>`;
//
// Si necesitas insertar HTML ya generado y de confianza (por ejemplo un
// SVG que viene de Laravel, o el resultado de otro html`...`), envuélvelo
// con raw() para que no se vuelva a escapar:
//   html`<div>${raw(qrSvgMarkup)}</div>`

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const RAW_MARKER = Symbol('html.raw');

/**
 * Marca una cadena como HTML de confianza para que html`...` la inserte
 * tal cual, sin escapar. Úsalo solo con contenido que ya es HTML seguro
 * (SVG del backend, el resultado de otro html`...`, etc.), nunca con
 * texto que venga directo de un input o de datos de usuario.
 */
export function raw(value) {
  return { [RAW_MARKER]: true, value: String(value ?? '') };
}

function isRaw(value) {
  return Boolean(value) && typeof value === 'object' && value[RAW_MARKER] === true;
}

function stringifyValue(value) {
  if (isRaw(value)) {
    return value.value;
  }

  if (Array.isArray(value)) {
    return value.map(stringifyValue).join('');
  }

  return escapeHtml(value);
}

/**
 * Tagged template que escapa automáticamente cada valor interpolado.
 * Los literales de la plantilla (lo que escribe el desarrollador) nunca
 * se escapan, solo los valores dinámicos `${...}`.
 */
export function html(strings, ...values) {
  return strings.reduce((result, part, index) => {
    const value = index < values.length ? stringifyValue(values[index]) : '';
    return result + part + value;
  }, '');
}
