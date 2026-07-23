// Restaura el nombre, rol e avatar del usuario en el dropdown
// del perfil leyendo de sessionStorage/localStorage al arrancar.
import {
  ACCOUNT_NAME_STORAGE_KEY,
  ACCOUNT_ROLE_STORAGE_KEY,
} from '../../storage-keys.js';

function restoreHeaderProfile() {
  const profileMenu =
    document.getElementById(
      'profileMenu'
    );

  if (!profileMenu) {
    return;
  }

  const accountName =
    sessionStorage.getItem(
      ACCOUNT_NAME_STORAGE_KEY
    ) ||
    localStorage.getItem(
      ACCOUNT_NAME_STORAGE_KEY
    ) ||
    'Doctor';

  const accountRole =
    sessionStorage.getItem(
      ACCOUNT_ROLE_STORAGE_KEY
    ) ||
    localStorage.getItem(
      ACCOUNT_ROLE_STORAGE_KEY
    ) ||
    'Médico';

  const nameElement =
    profileMenu.querySelector(
      'strong'
    );

  const roleElement =
    profileMenu.querySelector(
      '.profile > div > span'
    ) ||
    profileMenu.querySelector(
      'div > span:not(.avatar)'
    );

  const avatar =
    profileMenu.querySelector(
      '.avatar'
    );

  if (nameElement) {
    nameElement.textContent =
      accountName;
  }

  if (roleElement) {
    roleElement.textContent =
      accountRole;
  }

  if (avatar) {
    const parts =
      accountName
        .split(/\s+/)
        .filter(Boolean);

    if (parts.length > 1) {
      avatar.textContent =
        `${parts[0][0]}${parts[1][0]}`
          .toUpperCase();
    } else {
      avatar.textContent =
        accountName
          .slice(0, 2)
          .toUpperCase();
    }
  }
}

export { restoreHeaderProfile };
