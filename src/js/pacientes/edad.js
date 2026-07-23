function calculateAge(value) {
  if (!value) {
    return '';
  }

  const str =
    String(value);

  const birth = new Date(
    str.length === 10
      ? `${str}T00:00:00`
      : str
  );

  const today = new Date();

  if (
    Number.isNaN(
      birth.getTime()
    ) ||
    birth > today
  ) {
    return '';
  }

  let age =
    today.getFullYear() -
    birth.getFullYear();

  const month =
    today.getMonth() -
    birth.getMonth();

  if (
    month < 0 ||
    (
      month === 0 &&
      today.getDate() <
        birth.getDate()
    )
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function updateAge() {
  const date =
    document.getElementById(
      'fechaNacimiento'
    );

  const age =
    document.getElementById(
      'edadCalculada'
    );

  if (!age) {
    return;
  }

  age.value =
    calculateAge(
      date?.value
    );
}

export { calculateAge, updateAge };
