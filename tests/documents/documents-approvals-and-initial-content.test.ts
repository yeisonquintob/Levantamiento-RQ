import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  approvalsForNewVersion,
  approvalsForTransition,
  contentFromAi,
  headerForNewVersion,
  headerForTransition,
} from "../../apps/documents-service/src/documents/documents-approvals";
import { PENDING } from "../../apps/documents-service/src/documents/documents-constants";
import { initialContent } from "../../apps/documents-service/src/documents/documents-initial-content";

const actor = { displayName: "Ana Analista" } as AuthenticatedUser;
const now = new Date("2026-03-10T15:30:00.000Z");

type Approval = Record<string, unknown>;

function approvalsOf(content: unknown): Approval[] {
  return (content as { approvals: Approval[] }).approvals;
}
function byResponsibility(content: unknown, responsibility: string): Approval {
  const found = approvalsOf(content).find(
    (approval) => approval.responsibility === responsibility,
  );
  assert.ok(found, `falta la fila de ${responsibility}`);
  return found;
}

test("una versión nueva empieza en borrador y sin firmas de la versión anterior", () => {
  const header = headerForNewVersion(
    {
      title: "Proyecto",
      documentVersion: "1.0",
      status: "APROBADO",
      preparedBy: "x",
      reviewedBy: "y",
      approvedBy: "z",
    },
    "2.0",
  ) as Record<string, unknown>;

  assert.equal(header.documentVersion, "2.0");
  assert.equal(header.status, "BORRADOR");
  assert.equal(header.title, "Proyecto");
  for (const signed of ["preparedBy", "reviewedBy", "approvedBy"])
    assert.equal(signed in header, false, `${signed} no se hereda`);
});

test("el encabezado que no es un objeto se devuelve tal cual", () => {
  for (const value of ["texto", 7, null, ["a"]] as never[]) {
    assert.equal(headerForNewVersion(value, "2.0"), value);
    assert.equal(headerForTransition(value, "APPROVED"), value);
  }
});

test("el estado visible del documento sigue al flujo de revisión", () => {
  const expected: Record<string, string> = {
    IN_REVIEW: "EN VALIDACIÓN",
    APPROVED: "APROBADO",
    CHANGES_REQUESTED: "CORRECCIONES SOLICITADAS",
    REJECTED: "BORRADOR",
    DRAFT: "BORRADOR",
  };
  for (const [status, visible] of Object.entries(expected)) {
    const header = headerForTransition(
      { status: "X", approvedBy: "z" },
      status as never,
    ) as Record<string, unknown>;
    assert.equal(header.status, visible, status);
    assert.equal("approvedBy" in header, false);
  }
});

test("la IA no puede escribir las firmas del encabezado", () => {
  const header = contentFromAi(
    "header",
    { title: "a" },
    { title: "Nuevo", preparedBy: "IA", reviewedBy: "IA", approvedBy: "IA" },
  ) as Record<string, unknown>;

  assert.equal(header.title, "Nuevo");
  for (const signed of ["preparedBy", "reviewedBy", "approvedBy"])
    assert.equal(signed in header, false);
});

test("las demás secciones propuestas por la IA se aceptan sin cambios", () => {
  assert.deepEqual(contentFromAi("scope", "viejo", { incluido: ["x"] }), {
    incluido: ["x"],
  });
  assert.equal(contentFromAi("header", "viejo", "texto"), "texto");
});

test("la IA no pisa aprobaciones ya decididas por el flujo ni registra cambios aprobados", () => {
  const current = {
    approvals: [
      { responsibility: "Elaboración", name: "Ana", status: "REGISTRADO" },
      {
        responsibility: "Revisión",
        name: "Luis",
        status: "CAMBIOS SOLICITADOS",
      },
      { responsibility: "Aprobación", name: PENDING, status: "PENDIENTE" },
    ],
    changeControl: [{ version: "1.0" }],
  };
  const proposed = {
    approvals: [
      { responsibility: "Elaboración", name: "IA", status: "REGISTRADO" },
      { responsibility: "Revisión", name: "IA", status: "APROBADO" },
      { responsibility: "Aprobación", name: "IA", status: "APROBADO" },
    ],
    changeControl: [{ version: "9.9" }],
  };

  const result = contentFromAi("approvalsAndChangeControl", current, proposed);

  // Elaboración y lo que el flujo ya decidió se conservan; lo pendiente toma la propuesta.
  assert.equal(byResponsibility(result, "Elaboración").name, "Ana");
  assert.equal(byResponsibility(result, "Revisión").name, "Luis");
  assert.equal(
    byResponsibility(result, "Revisión").status,
    "CAMBIOS SOLICITADOS",
  );
  assert.equal(byResponsibility(result, "Aprobación").name, "IA");
  // Regenerar contenido no es un cambio aprobado.
  assert.deepEqual((result as { changeControl: unknown }).changeControl, []);
});

test("las aprobaciones de una versión nueva reinician la revisión y la aprobación", () => {
  const result = approvalsForNewVersion(
    {
      approvals: [
        {
          responsibility: "Revisión",
          name: "Luis",
          status: "APROBADO",
          extra: 1,
        },
        { responsibility: "Aprobación", name: "Marta", status: "APROBADO" },
      ],
      changeControl: [{ version: "1.0" }],
    },
    actor,
  );

  const elaboration = byResponsibility(result, "Elaboración");
  assert.equal(elaboration.name, "Ana Analista");
  assert.equal(elaboration.status, "REGISTRADO");
  assert.equal(byResponsibility(result, "Revisión").status, "PENDIENTE");
  assert.equal(byResponsibility(result, "Aprobación").status, "PENDIENTE");
  // Se conservan los demás datos de la fila (p. ej. quién revisaba), pero no la decisión.
  assert.equal(byResponsibility(result, "Revisión").extra, 1);
  assert.deepEqual((result as { changeControl: unknown }).changeControl, []);
});

test("las aprobaciones de una versión nueva funcionan aunque el contenido no tenga aprobaciones", () => {
  const result = approvalsForNewVersion(null, actor);
  assert.equal(approvalsOf(result).length, 3);
});

const version = {
  versionNumber: 2,
  version: "2.0",
  changeSummary: "Se ajusta el alcance",
} as never;

test("enviar a revisión registra la elaboración y deja la revisión en curso", () => {
  const result = approvalsForTransition(
    { approvals: [], changeControl: [] },
    "IN_REVIEW",
    actor,
    version,
    now,
  );

  assert.equal(byResponsibility(result, "Elaboración").name, "Ana Analista");
  assert.equal(
    byResponsibility(result, "Elaboración").approvalMoment,
    now.toISOString(),
  );
  assert.equal(byResponsibility(result, "Revisión").status, "EN REVISIÓN");
  assert.equal(byResponsibility(result, "Aprobación").status, "PENDIENTE");
  assert.equal(byResponsibility(result, "Aprobación").name, PENDING);
});

test("solicitar cambios deja constancia de quién revisó y cuándo", () => {
  const result = approvalsForTransition(
    {
      approvals: [
        { responsibility: "Revisión", name: PENDING, status: "EN REVISIÓN" },
      ],
    },
    "CHANGES_REQUESTED",
    actor,
    version,
    now,
  );

  const review = byResponsibility(result, "Revisión");
  assert.equal(review.name, "Ana Analista");
  assert.equal(review.status, "CAMBIOS SOLICITADOS");
  assert.equal(review.approvalMoment, now.toISOString());
});

test("aprobar una versión posterior a la primera registra el control de cambios", () => {
  const result = approvalsForTransition(
    { approvals: [], changeControl: [{ version: "1.0" }] },
    "APPROVED",
    actor,
    version,
    now,
  ) as { changeControl: Record<string, unknown>[] };

  assert.equal(byResponsibility(result, "Aprobación").status, "APROBADO");
  assert.equal(byResponsibility(result, "Aprobación").name, "Ana Analista");
  assert.deepEqual(result.changeControl, [
    {
      version: "2.0",
      date: "2026-03-10",
      description: "Se ajusta el alcance",
      approvedBy: "Ana Analista",
    },
  ]);
});

test("aprobar la primera versión no inventa control de cambios", () => {
  const result = approvalsForTransition(
    { approvals: [], changeControl: [{ version: "previo" }] },
    "APPROVED",
    actor,
    { ...(version as object), versionNumber: 1 } as never,
    now,
  ) as { changeControl: unknown };

  // Conserva lo que ya había en lugar de añadir una fila de la versión 1.
  assert.deepEqual(result.changeControl, [{ version: "previo" }]);
});

test("rechazar o dejar en borrador no modifica las firmas y siempre hay tres filas", () => {
  for (const status of ["REJECTED", "DRAFT"] as const) {
    const result = approvalsForTransition(null, status, actor, version, now);
    assert.deepEqual(
      approvalsOf(result).map((approval) => approval.responsibility),
      ["Elaboración", "Revisión", "Aprobación"],
    );
    for (const approval of approvalsOf(result)) {
      assert.equal(approval.status, "PENDIENTE");
      assert.equal(approval.name, PENDING);
    }
  }
});

test("el contenido inicial de cada sección parte de marcadores pendientes", () => {
  const project = {
    title: "Portal de cartera",
    code: "PRJ-001",
    requestingArea: "Finanzas",
  } as never;
  const content = (key: string) =>
    initialContent(key, project, actor, "1.0", now);

  assert.deepEqual(content("header"), {
    title: "Portal de cartera",
    projectCode: "PRJ-001",
    documentVersion: "1.0",
    createdDate: "2026-03-10",
    requestingArea: "Finanzas",
    status: "BORRADOR",
  });

  const scope = content("scope") as { kpis: unknown[] };
  assert.equal(scope.kpis.length, 3);
  assert.deepEqual(content("objectives"), {
    general: PENDING,
    qualitative: [PENDING],
    quantitative: [PENDING],
  });
  assert.deepEqual(content("backlogStructure"), { epics: [] });
  assert.equal(
    (content("scrumPlan") as { cadenceDays: number }).cadenceDays,
    15,
  );
  for (const key of ["writingRules", "visualFormat", "automationInstruction"])
    assert.equal(content(key), PENDING);
  // Una sección desconocida no rompe la creación del documento.
  assert.equal(content("seccion-inventada"), PENDING);
});

test("el contenido inicial de aprobaciones registra al elaborador y deja pendientes a los demás", () => {
  const result = initialContent(
    "approvalsAndChangeControl",
    {} as never,
    actor,
    "1.0",
    now,
  );

  assert.equal(byResponsibility(result, "Elaboración").name, "Ana Analista");
  assert.equal(byResponsibility(result, "Elaboración").status, "REGISTRADO");
  assert.equal(byResponsibility(result, "Revisión").status, "PENDIENTE");
  assert.equal(byResponsibility(result, "Aprobación").status, "PENDIENTE");
  assert.deepEqual((result as { changeControl: unknown }).changeControl, []);
});
