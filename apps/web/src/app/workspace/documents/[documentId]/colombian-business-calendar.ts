export interface ColombianCalendarExcludedDay {
  readonly date: string;
  readonly reason: string;
}

export interface ColombianBusinessSprintSchedule {
  readonly startDate: string;
  readonly endDate: string;
  readonly excludedDays: readonly ColombianCalendarExcludedDay[];
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("La fecha debe tener el formato YYYY-MM-DD.");
  }
  return date;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.valueOf() + days * DAY_IN_MILLISECONDS);
}

function followingMonday(value: Date): Date {
  const day = value.getUTCDay();
  return addDays(value, day === 1 ? 0 : (8 - day) % 7);
}

// Algoritmo gregoriano de Meeus/Jones/Butcher.
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function setHoliday(
  holidays: Map<string, string>,
  date: Date,
  name: string,
): void {
  holidays.set(isoDate(date), name);
}

export function colombianNationalHolidays(
  year: number,
): ReadonlyMap<string, string> {
  const holidays = new Map<string, string>();
  const fixed = (month: number, day: number, name: string) =>
    setHoliday(holidays, new Date(Date.UTC(year, month - 1, day)), name);
  const moved = (month: number, day: number, name: string) =>
    setHoliday(
      holidays,
      followingMonday(new Date(Date.UTC(year, month - 1, day))),
      name,
    );

  fixed(1, 1, "Año Nuevo");
  moved(1, 6, "Día de los Reyes Magos");
  moved(3, 19, "Día de San José");
  fixed(5, 1, "Día del Trabajo");
  moved(6, 29, "San Pedro y San Pablo");
  fixed(7, 20, "Día de la Independencia");
  fixed(8, 7, "Batalla de Boyacá");
  moved(8, 15, "Asunción de la Virgen");
  moved(10, 12, "Día de la Diversidad Étnica y Cultural");
  moved(11, 1, "Todos los Santos");
  moved(11, 11, "Independencia de Cartagena");
  fixed(12, 8, "Inmaculada Concepción");
  fixed(12, 25, "Navidad");

  const easter = easterSunday(year);
  setHoliday(holidays, addDays(easter, -3), "Jueves Santo");
  setHoliday(holidays, addDays(easter, -2), "Viernes Santo");
  setHoliday(
    holidays,
    followingMonday(addDays(easter, 39)),
    "Ascensión del Señor",
  );
  setHoliday(holidays, followingMonday(addDays(easter, 60)), "Corpus Christi");
  setHoliday(
    holidays,
    followingMonday(addDays(easter, 68)),
    "Sagrado Corazón de Jesús",
  );

  return holidays;
}

function nonWorkingReason(value: Date): string | null {
  if (value.getUTCDay() === 0) return "Domingo";
  if (value.getUTCDay() === 6) return "Sábado";
  return (
    colombianNationalHolidays(value.getUTCFullYear()).get(isoDate(value)) ??
    null
  );
}

function nextBusinessDay(value: Date): Date {
  let candidate = value;
  while (nonWorkingReason(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

export function colombianBusinessDateAt(
  requestedStartDate: string,
  businessDayNumber: number,
): string {
  if (!Number.isInteger(businessDayNumber) || businessDayNumber < 1) {
    throw new Error("El número de día hábil debe ser un entero positivo.");
  }

  let current = nextBusinessDay(parseIsoDate(requestedStartDate));
  let position = 1;
  while (position < businessDayNumber) {
    current = addDays(current, 1);
    if (!nonWorkingReason(current)) position += 1;
  }
  return isoDate(current);
}

export function buildColombianBusinessSprintSchedule(
  requestedStartDate: string,
  sprintCount: number,
  businessDaysPerSprint = 15,
): readonly ColombianBusinessSprintSchedule[] {
  if (!Number.isInteger(sprintCount) || sprintCount < 0) {
    throw new Error("La cantidad de Sprints no es válida.");
  }
  if (!Number.isInteger(businessDaysPerSprint) || businessDaysPerSprint < 1) {
    throw new Error("La cadencia debe contener al menos un día hábil.");
  }

  const schedules: ColombianBusinessSprintSchedule[] = [];
  let cursor = parseIsoDate(requestedStartDate);

  for (let sprintIndex = 0; sprintIndex < sprintCount; sprintIndex += 1) {
    const startDate = nextBusinessDay(cursor);
    const excludedDays: ColombianCalendarExcludedDay[] = [];
    let current = startDate;
    let completedBusinessDays = 0;

    while (completedBusinessDays < businessDaysPerSprint) {
      const reason = nonWorkingReason(current);
      if (reason) {
        excludedDays.push({ date: isoDate(current), reason });
      } else {
        completedBusinessDays += 1;
      }
      if (completedBusinessDays < businessDaysPerSprint) {
        current = addDays(current, 1);
      }
    }

    schedules.push({
      startDate: isoDate(startDate),
      endDate: isoDate(current),
      excludedDays,
    });
    cursor = addDays(current, 1);
  }

  return schedules;
}

export function formatColombianCalendarDate(value: string): string {
  const date = parseIsoDate(value);
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .replace(/\./gu, "");
}
