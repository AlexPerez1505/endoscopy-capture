// Botón de toggle de tema (claro/oscuro): alterna el data-theme
// del <html> y lo persiste en localStorage.
import { THEME_STORAGE_KEY } from '../../storage-keys.js';

function setupThemeToggle() {
  const themeToggle =
    document.getElementById(
      'themeToggle'
    );

  if (themeToggle) {
    themeToggle.addEventListener(
      'click',
      () => {
        const currentTheme =
          document.documentElement
            .dataset.theme ||
          'dark';

        const nextTheme =
          currentTheme === 'light'
            ? 'dark'
            : 'light';

        document.documentElement
          .dataset.theme =
          nextTheme;

        localStorage.setItem(
          THEME_STORAGE_KEY,
          nextTheme
        );
      }
    );
  }
}

export { setupThemeToggle };
