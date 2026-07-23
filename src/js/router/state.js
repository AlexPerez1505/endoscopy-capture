// Referencias a elementos del DOM (#pageContent, #headTitle, #headSub) y
// estado mutable del router (ruta en carga, AbortController activo).
// Los get/set evitan problemas de live-binding entre módulos ES.
const pageContent =
  document.getElementById('pageContent');

const headTitle =
  document.getElementById('headTitle');

const headSub =
  document.getElementById('headSub');

let currentLoadingRoute = null;

let currentPageAbortController = null;

export {
  pageContent,
  headTitle,
  headSub,
};

export function getCurrentLoadingRoute() {
  return currentLoadingRoute;
}

export function setCurrentLoadingRoute(value) {
  currentLoadingRoute = value;
}

export function getCurrentPageAbortController() {
  return currentPageAbortController;
}

export function setCurrentPageAbortController(value) {
  currentPageAbortController = value;
}
