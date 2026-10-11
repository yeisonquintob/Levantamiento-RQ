import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionTrackingService } from "../../apps/operations-service/src/operations/execution-tracking.service.js";
import {
  normalizeExecutionTaskCode,
  parseExecutionTaskUpdates,
} from "../../apps/operations-service/src/operations/operations-input.js";
import {
  AuditEventEntity,
  ExecutionTaskStatusEntity,
} from "../../apps/operations-service/src/operations/operation.entities.js";

const PROJECT = "55987547-eef9-406a-a736-06bd90c061a2";

test("normaliza los códigos y valida los estados de las tareas", () => {
  assert.equal(normalizeExecutionTaskCode("  ta-001 "), "TA-001");
  const parsed = parseExecutionTaskUpdates({
    items: [
      { taskCode: " ta-001 ", state: "DONE" },
      { taskCode: "TA-002", state: "IN_PROGRESS", note: "  revisando  " },
      {
        taskCode: "TA-003",
        state: "DONE",
        source: "AZURE_CSV",
        completedAt: "2026-10-01T10:00:00Z",
      },
    ],
  });
  assert.deepEqual(
    parsed.map((item) => [item.taskCode, item.state, item.source]),
    [
      ["TA-001", "DONE", "MANUAL"],
      ["TA-002", "IN_PROGRESS", "MANUAL"],
      ["TA-003", "DONE", "AZURE_CSV"],
    ],
  );
  // Solo las tareas hechas conservan fecha de cierre; si falta, se usa la actual.
  assert.ok(parsed[0]?.completedAt instanceof Date);
  assert.equal(parsed[1]?.completedAt, null);
  assert.equal(parsed[1]?.note, "revisando");
  assert.equal(parsed[2]?.completedAt?.toISOString(), "2026-10-01T10:00:00.000Z");
});

test("rechaza cuerpos vacíos, estados inválidos, códigos repetidos y lotes enormes", () => {
  for (const body of [
    null,
    {},
    { items: [] },
    { items: [{ taskCode: "", state: "DONE" }] },
    { items: [{ taskCode: "TA-1", state: "FINALIZADA" }] },
    { items: [{ taskCode: "TA-1", state: "DONE", source: "VOZ" }] },
    { items: [{ taskCode: "ta-1", state: "DONE" }, { taskCode: "TA-1 ", state: "PENDING" }] },
    { items: [{ taskCode: "TA-1", state: "DONE", completedAt: "no-es-fecha" }] },
    { items: Array.from({ length: 501 }, (_, index) => ({ taskCode: `T-${index}`, state: "DONE" })) },
  ]) {
    assert.throws(() => parseExecutionTaskUpdates(body), /válid[oa]|debe contener|repetida/);
  }
});

class FakeStatuses {
  readonly rows: ExecutionTaskStatusEntity[] = [];
  readonly manager = {
    transaction: <T>(run: (manager: { getRepository: () => FakeStatuses }) => Promise<T>) =>
      run({ getRepository: () => this }),
  };
  find(options: { where: { projectId: string; taskCode?: { _value: string[] } } }) {
    const codes = options.where.taskCode?._value;
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.projectId === options.where.projectId &&
          (!codes || codes.includes(row.taskCode)),
      ),
    );
  }
  save(rows: ExecutionTaskStatusEntity[]) {
    for (const row of rows) {
      if (!this.rows.includes(row)) this.rows.push(row);
    }
    return Promise.resolve(rows);
  }
}

function service(access: "editor" | "reader", status = "APPROVED") {
  const statuses = new FakeStatuses();
  const audits: unknown[] = [];
  const projects = {
    requireRead: () => Promise.resolve({}),
    requireEditor: () =>
      access === "editor"
        ? Promise.resolve({ status })
        : Promise.reject(new Error("sin permiso de edición")),
  };
  const instance = new ExecutionTrackingService(
    statuses as never,
    { save: (entry: unknown) => (audits.push(entry), Promise.resolve(entry)) } as unknown as never,
    projects as never,
  );
  const context = {
    actor: { id: "11111111-1111-4111-8111-111111111111" },
    accessToken: "token",
    correlationId: "corr",
  } as never;
  return { instance, statuses, audits, context };
}

test("marcar tareas crea o actualiza sin duplicar y deja auditoría", async () => {
  const { instance, statuses, audits, context } = service("editor");
  const first = await instance.update(
    context,
    PROJECT,
    parseExecutionTaskUpdates({
      items: [
        { taskCode: "TA-001", state: "DONE" },
        { taskCode: "TA-002", state: "IN_PROGRESS" },
      ],
    }),
  );
  assert.equal(first.items.length, 2);
  assert.equal(statuses.rows.length, 2);

  // Desmarcar una tarea la devuelve a pendiente y limpia la fecha de cierre.
  await instance.update(
    context,
    PROJECT,
    parseExecutionTaskUpdates({ items: [{ taskCode: "ta-001", state: "PENDING" }] }),
  );
  assert.equal(statuses.rows.length, 2);
  const row = statuses.rows.find((item) => item.taskCode === "TA-001");
  assert.equal(row?.state, "PENDING");
  assert.equal(row?.completedAt, null);
  assert.equal(audits.length, 2);
  assert.equal((audits[0] as AuditEventEntity).action, "EXECUTION_TASKS_UPDATED");
});

test("quien solo puede leer no puede marcar tareas", async () => {
  const { instance, statuses, context } = service("reader");
  await assert.rejects(
    () =>
      instance.update(
        context,
        PROJECT,
        parseExecutionTaskUpdates({ items: [{ taskCode: "TA-001", state: "DONE" }] }),
      ),
    /sin permiso/,
  );
  assert.equal(statuses.rows.length, 0);
});

test("un proyecto sin aprobar no permite marcar tareas, pero uno completado sí", async () => {
  const updates = parseExecutionTaskUpdates({
    items: [{ taskCode: "TA-001", state: "DONE" }],
  });
  for (const status of ["DRAFT", "DISCUSSION", "SOURCES", "DOCUMENT_GENERATED", "VALIDATION", "ARCHIVED"]) {
    const blocked = service("editor", status);
    await assert.rejects(
      () => blocked.instance.update(blocked.context, PROJECT, updates),
      /no ha sido aprobado/,
    );
    assert.equal(blocked.statuses.rows.length, 0, status);
  }
  for (const status of ["APPROVED", "EXECUTION", "COMPLETED"]) {
    const allowed = service("editor", status);
    await allowed.instance.update(allowed.context, PROJECT, updates);
    assert.equal(allowed.statuses.rows.length, 1, status);
  }
});
