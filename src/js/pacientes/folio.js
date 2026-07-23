function extractFolio(payload = {}) {
  return String(
    payload.folio ||
    payload.next_folio ||
    payload.siguiente_folio ||
    payload.proximo_folio ||
    payload.data?.folio ||
    payload.data?.next_folio ||
    payload.defaults?.folio ||
    payload.paciente?.folio ||
    payload.patient?.folio ||
    ''
  ).trim();
}

function updateFolio(folio) {
  const normalizedFolio =
    String(folio || '').trim();

  const folioInput =
    document.getElementById(
      'folioInput'
    );

  const identificacionInput =
    document.getElementById(
      'identificacionInput'
    );

  const folioText =
    document.getElementById(
      'patientFolioText'
    );

  if (folioInput) {
    folioInput.value =
      normalizedFolio;
  }

  if (identificacionInput) {
    identificacionInput.value =
      normalizedFolio;
  }

  if (folioText) {
    folioText.textContent =
      normalizedFolio ||
      'Generando...';
  }
}

export { extractFolio, updateFolio };
