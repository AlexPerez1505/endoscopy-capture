// Limpia un string de ruta: quita el "#", separa query params y
// devuelve "dashboard" si queda vacío. Función pura, sin efectos.
function normalizeRoute(route) {
  const normalized = String(
    route || 'dashboard'
  )
    .replace(/^#/, '')
    .split('?')[0]
    .trim();

  return normalized || 'dashboard';
}

export { normalizeRoute };
