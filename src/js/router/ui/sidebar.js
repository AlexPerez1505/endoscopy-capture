// Contrae/expande la barra lateral: togglea las clases CSS
// is-collapsed y sidebar-collapsed, y persiste el estado en localStorage.
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from '../../storage-keys.js';

function setSidebarCollapsed(collapsed) {
  const sidebarEl =
    document.querySelector(
      '.side'
    );

  const dashEl =
    document.querySelector(
      '.dash'
    );

  const sidebarCollapseBtn =
    document.getElementById(
      'sidebarCollapseBtn'
    );

  if (!sidebarEl || !dashEl) {
    return;
  }

  sidebarEl.classList.toggle(
    'is-collapsed',
    collapsed
  );

  dashEl.classList.toggle(
    'sidebar-collapsed',
    collapsed
  );

  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.setAttribute(
      'aria-expanded',
      collapsed
        ? 'false'
        : 'true'
    );

    sidebarCollapseBtn.setAttribute(
      'aria-label',
      collapsed
        ? 'Expandir barra lateral'
        : 'Contraer barra lateral'
    );
  }

  localStorage.setItem(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    String(collapsed)
  );
}

function setupSidebar() {
  const sidebarCollapseBtn =
    document.getElementById(
      'sidebarCollapseBtn'
    );

  const sidebarEl =
    document.querySelector(
      '.side'
    );

  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener(
      'click',
      () => {
        const isCollapsed =
          sidebarEl?.classList.contains(
            'is-collapsed'
          );

        setSidebarCollapsed(
          !isCollapsed
        );
      }
    );
  }

  setSidebarCollapsed(
    localStorage.getItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY
    ) === 'true'
  );
}

export { setSidebarCollapsed, setupSidebar };
