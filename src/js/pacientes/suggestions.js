import { request } from './api.js';

function createPlaceholder(
  text
) {
  const option =
    document.createElement(
      'option'
    );

  option.value = '';
  option.textContent = text;
  option.disabled = true;
  option.selected = true;

  return option;
}

function fillSelect(
  selectId,
  values,
  placeholder =
    'Seleccione...'
) {
  const select =
    document.getElementById(
      selectId
    );

  if (!select) {
    console.warn(
      `Select #${selectId} no encontrado en el DOM.`
    );

    return;
  }

  select.innerHTML = '';

  select.appendChild(
    createPlaceholder(placeholder)
  );

  const rawValues =
    Array.isArray(values)
      ? values
      : [];

  const uniqueValues = [
    ...new Set(
      rawValues
        .map((v) =>
          String(
            v ?? ''
          ).trim()
        )
        .filter(Boolean)
    ),
  ];

  console.log(
    `Llenando #${selectId} con ${uniqueValues.length} opciones:`,
    uniqueValues
  );

  uniqueValues.forEach(
    (value) => {
      const option =
        document.createElement(
          'option'
        );

      option.value = value;
      option.textContent = value;

      select.appendChild(
        option
      );
    }
  );
}

function getDatalistValues(
  datalistId
) {
  const datalist =
    document.getElementById(
      datalistId
    );

  if (!datalist) {
    return [];
  }

  return Array.from(
    datalist.options
  ).map((option) =>
    String(option.value || '').trim()
  );
}

function filterSuggestionItems(
  list,
  query
) {
  const normalized =
    String(query || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  Array.from(
    list.children
  ).forEach((item) => {
    const text =
      String(item.textContent || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    item.style.display =
      !normalized ||
      text.includes(normalized)
        ? 'block'
        : 'none';
  });
}

function showSuggestions(
  input,
  list,
  values
) {
  list.innerHTML = '';

  values.forEach((value) => {
    const item =
      document.createElement(
        'li'
      );

    item.className =
      'patient-suggestion-item';
    item.textContent = value;

    item.addEventListener(
      'mousedown',
      () => {
        input.value = value;
        list.classList.remove(
          'open'
        );
      }
    );

    list.appendChild(item);
  });

  list.classList.add('open');
  filterSuggestionItems(
    list,
    input.value
  );
}

function setupCustomDropdown(
  inputId,
  datalistId
) {
  const input =
    document.getElementById(
      inputId
    );

  if (!input) {
    return;
  }

  const wrapper =
    input.closest(
      '.select-with-add'
    );

  if (!wrapper) {
    return;
  }

  let list =
    wrapper.querySelector(
      '.patient-suggestions'
    );

  if (!list) {
    list =
      document.createElement(
        'ul'
      );
    list.className =
      'patient-suggestions';
    wrapper.appendChild(list);
  }

  input.addEventListener(
    'focus',
    () => {
      const values = getDatalistValues(
        datalistId
      );

      if (!values.length) {
        return;
      }

      showSuggestions(
        input,
        list,
        values
      );
    }
  );

  input.addEventListener(
    'input',
    () => {
      if (
        !list.classList.contains(
          'open'
        )
      ) {
        const values = getDatalistValues(
          datalistId
        );

        showSuggestions(
          input,
          list,
          values
        );
      }

      filterSuggestionItems(
        list,
        input.value
      );
    }
  );

  input.addEventListener(
    'blur',
    () => {
      setTimeout(
        () =>
          list.classList.remove(
            'open'
          ),
        150
      );
    }
  );

  document.addEventListener(
    'click',
    (event) => {
      if (
        !wrapper.contains(
          event.target
        )
      ) {
        list.classList.remove(
          'open'
        );
      }
    }
  );
}

async function loadSuggestions() {
  try {
    const payload =
      await request(
        'suggestions'
      );

    console.log(
      'Respuesta de suggestions:',
      payload
    );

    const data =
      payload.data ||
      payload.suggestions ||
      payload;

    fillSelect(
      'medicoSelectMed',
      data.medicos ||
        data.medico ||
        [],
      'Selecciona un médico'
    );

    fillSelect(
      'procedimientoSelect',
      data.procedimientos ||
        data.procedimiento ||
        [],
      'Selecciona un procedimiento'
    );

    fillSelect(
      'anestesiologoSelect',
      data.anestesiologos ||
        data.anestesiologo ||
        [],
      'Selecciona un anestesiólogo'
    );
  } catch (error) {
    console.error(
      'Error cargando sugerencias:',
      error
    );
  }
}

export { loadSuggestions };
