// Punto de entrada del router SPA: valida la sesión, registra todos los
// listeners (eventos, UI, tema, sidebar, perfil, logout) y arranca la
// primera página. Este es el único archivo que importa app.html.
import { getAuthToken } from '../auth.js';

import { currentRoute } from './utils/current.js';
import { loadPage } from './loader/load-page.js';

import { setupDataNavClick } from './events/data-nav-click.js';
import { setupHashChange } from './events/hashchange.js';
import { setupFocusSync } from './events/focus-sync.js';
import { setupPatientSavedListener } from './events/patient-saved.js';

import { setupThemeToggle } from './ui/theme.js';
import { setupSidebar } from './ui/sidebar.js';
import { setupProfileMenu } from './ui/profile-menu.js';
import { setupLogout } from './ui/logout.js';
import { restoreHeaderProfile } from './ui/restore-profile.js';

import { setupGlobals } from './globals.js';

const authToken = getAuthToken();

if (!authToken) {
  window.location.href = './login.html';

  throw new Error(
    'Sin sesión activa, redirigiendo a login.'
  );
}

setupDataNavClick();
setupHashChange();
setupFocusSync();
setupPatientSavedListener();

setupThemeToggle();
setupSidebar();
setupProfileMenu();
setupLogout();

restoreHeaderProfile();

setupGlobals();

loadPage(
  currentRoute()
);
