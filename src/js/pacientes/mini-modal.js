import { state } from './state.js';

function openMiniModal(button) {
  state.miniTargetId =
    button.dataset.miniField ||
    null;

  const modal =
    document.getElementById(
      'patientMiniModal'
    );

  const title =
    document.getElementById(
      'patientMiniTitle'
    );

  const description =
    document.getElementById(
      'patientMiniDescription'
    );

  const input =
    document.getElementById(
      'patientMiniInput'
    );

  if (title) {
    title.textContent =
      button.dataset.miniTitle ||
      'Agregar';
  }

  if (description) {
    description.textContent =
      button.dataset
        .miniDescription ||
      'Escribe el valor';
  }

  if (input) {
    input.value = '';
  }

  modal?.classList.add('active');

  modal?.setAttribute(
    'aria-hidden',
    'false'
  );

  window.setTimeout(
    () => input?.focus(),
    50
  );
}

function closeMiniModal() {
  state.miniTargetId = null;

  const modal =
    document.getElementById(
      'patientMiniModal'
    );

  modal?.classList.remove('active');

  modal?.setAttribute(
    'aria-hidden',
    'true'
  );
}

function confirmMiniModal() {
  const input =
    document.getElementById(
      'patientMiniInput'
    );

  const value =
    String(
      input?.value || ''
    ).trim();

  if (
    !value ||
    !state.miniTargetId
  ) {
    return;
  }

  const target =
    document.getElementById(
      state.miniTargetId
    );

  if (target) {
    target.value = value;

    target.dispatchEvent(
      new Event(
        'input',
        {
          bubbles: true,
        }
      )
    );

    target.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true,
        }
      )
    );
  }

  closeMiniModal();
}

export {
  openMiniModal,
  closeMiniModal,
  confirmMiniModal,
};
