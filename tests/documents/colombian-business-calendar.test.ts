import assert from "node:assert/strict";
import test from "node:test";

import {
  buildColombianBusinessSprintSchedule,
  colombianBusinessDateAt,
  colombianNationalHolidays,
  formatColombianCalendarDate,
} from "../../apps/web/src/app/workspace/documents/[documentId]/colombian-business-calendar";

test("reconoce festivos fijos, religiosos y trasladados de Colombia", () => {
  const holidays = colombianNationalHolidays(2026);

  assert.equal(holidays.get("2026-04-02"), "Jueves Santo");
  assert.equal(holidays.get("2026-04-03"), "Viernes Santo");
  assert.equal(holidays.get("2026-05-18"), "Ascensión del Señor");
  assert.equal(holidays.get("2026-06-08"), "Corpus Christi");
  assert.equal(
    holidays.get("2026-10-12"),
    "Día de la Diversidad Étnica y Cultural",
  );
  assert.equal(holidays.get("2026-12-25"), "Navidad");
});

test("calendariza Sprints consecutivos usando quince días hábiles colombianos", () => {
  const schedule = buildColombianBusinessSprintSchedule("2026-09-01", 2);

  assert.deepEqual(
    schedule.map(({ startDate, endDate }) => ({ startDate, endDate })),
    [
      { startDate: "2026-09-01", endDate: "2026-09-21" },
      { startDate: "2026-09-22", endDate: "2026-10-13" },
    ],
  );
  assert.ok(
    schedule[1]?.excludedDays.some(
      (day) =>
        day.date === "2026-10-12" &&
        day.reason === "Día de la Diversidad Étnica y Cultural",
    ),
  );
});

test("materializa el día relativo de una tarea en el calendario laboral", () => {
  assert.equal(colombianBusinessDateAt("2026-09-01", 1), "2026-09-01");
  assert.equal(colombianBusinessDateAt("2026-09-01", 5), "2026-09-07");
  assert.equal(colombianBusinessDateAt("2026-09-01", 15), "2026-09-21");
});

test("ajusta el inicio no laborable y presenta las fechas en español", () => {
  const [sprint] = buildColombianBusinessSprintSchedule("2026-12-06", 1);

  assert.equal(sprint?.startDate, "2026-12-07");
  assert.equal(sprint?.endDate, "2026-12-29");
  assert.equal(formatColombianCalendarDate("2026-12-07"), "7 de dic de 2026");
  assert.ok(
    sprint?.excludedDays.some(
      (day) =>
        day.date === "2026-12-08" && day.reason === "Inmaculada Concepción",
    ),
  );
  assert.ok(
    sprint?.excludedDays.some(
      (day) => day.date === "2026-12-25" && day.reason === "Navidad",
    ),
  );
});
