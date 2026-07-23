// Dropdown del perfil: abre/cierra al clic, se cierra al clic
// fuera o al presionar Escape. Gestiona aria-expanded para accesibilidad.
function setupProfileMenu() {
  const profileMenu =
    document.getElementById(
      'profileMenu'
    );

  if (profileMenu) {
    profileMenu.addEventListener(
      'click',
      (event) => {
        if (
          event.target.closest(
            '#logoutBtn'
          )
        ) {
          return;
        }

        const isOpen =
          profileMenu.classList.toggle(
            'open'
          );

        profileMenu.setAttribute(
          'aria-expanded',
          isOpen
            ? 'true'
            : 'false'
        );
      }
    );

    document.addEventListener(
      'click',
      (event) => {
        if (
          !profileMenu.contains(
            event.target
          )
        ) {
          profileMenu.classList.remove(
            'open'
          );

          profileMenu.setAttribute(
            'aria-expanded',
            'false'
          );
        }
      }
    );

    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Escape'
        ) {
          profileMenu.classList.remove(
            'open'
          );

          profileMenu.setAttribute(
            'aria-expanded',
            'false'
          );
        }
      }
    );
  }
}

export { setupProfileMenu };
