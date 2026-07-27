// ================= Barra de titulo personalizada =================
// La ventana se crea con decorations:false (ver src-tauri/tauri.conf.json),
// asi que la barra nativa de Windows nunca se dibuja. Esta barra reemplaza
// el titulo/los botones de minimizar, maximizar y cerrar usando la API de
// ventanas de Tauri (expuesta globalmente via withGlobalTauri:true).

function getTauriWindow() {
  const tauri = window.__TAURI__;
  if (!tauri?.window?.getCurrentWindow) return null;
  return tauri.window.getCurrentWindow();
}

function titlebarMarkup() {
  return `
    <div class="app-titlebar-brand" data-tauri-drag-region>
      <img src="./assets/logo.png" alt="" onerror="this.style.display='none'">
      <span>ENCLAII</span>
    </div>
    <div class="app-titlebar-controls">
      <button type="button" class="app-titlebar-btn" data-action="minimize" aria-label="Minimizar">
        <svg viewBox="0 0 12 12" width="11" height="11">
          <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
      <button type="button" class="app-titlebar-btn" data-action="maximize" aria-label="Maximizar">
        <svg viewBox="0 0 12 12" width="10" height="10">
          <rect x="1.75" y="1.75" width="8.5" height="8.5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/>
        </svg>
      </button>
      <button type="button" class="app-titlebar-btn app-titlebar-btn--close" data-action="close" aria-label="Cerrar">
        <svg viewBox="0 0 12 12" width="11" height="11">
          <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;
}

function injectTitlebar() {
  if (document.querySelector('.app-titlebar')) return;

  const bar = document.createElement('div');
  bar.className = 'app-titlebar';
  bar.setAttribute('data-tauri-drag-region', '');
  bar.innerHTML = titlebarMarkup();

  document.body.prepend(bar);

  const appWindow = getTauriWindow();
  if (!appWindow) return;

  bar
    .querySelector('[data-action="minimize"]')
    ?.addEventListener('click', () => {
      appWindow.minimize();
    });

  bar
    .querySelector('[data-action="maximize"]')
    ?.addEventListener('click', () => {
      appWindow.toggleMaximize();
    });

  bar
    .querySelector('[data-action="close"]')
    ?.addEventListener('click', () => {
      appWindow.close();
    });

  bar
    .querySelector('.app-titlebar-brand')
    ?.addEventListener('dblclick', () => {
      appWindow.toggleMaximize();
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectTitlebar);
} else {
  injectTitlebar();
}
