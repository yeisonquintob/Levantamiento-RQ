import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  toDocumentSummary,
  toHistoryEntry,
  toVersionDetail,
  versionSummary,
} from "../../apps/documents-service/src/documents/documents-mappers";
import {
  buildCriterionRows,
  buildEvidenceRows,
  buildRequirementRows,
  cloneSectionsForNewVersion,
  prepareAiSections,
} from "../../apps/documents-service/src/documents/documents-version-content";

const actor = { displayName: "Ana Analista" } as AuthenticatedUser;
const now = new Date("2026-03-10T15:30:00.000Z");
const project = {
  title: "Portal de cartera",
  code: "PRJ-001",
  requestingArea: "Finanzas",
} as never;

/** El error es una excepción HTTP de Nest con ese estado (hay copias de @nestjs/common). */
function httpStatus(expected: number) {
  return (error: unknown) =>
    typeof (error as { getStatus?: () => number }).getStatus === "function" &&
    (error as { getStatus: () => number }).getStatus() === expected;
}

test("las filas de requisitos conservan el orden y enlazan el identificador del cliente con el nuevo", () => {
  const { requirementRows, clientRequirementIds } = buildRequirementRows(
    [
      {
        clientId: "c1",
        sectionKey: "scope",
        code: "RF-1",
        title: "A",
        description: "a",
        requirementType: "FUNCTIONAL",
        status: "DRAFT",
        order: 1,
        acceptanceCriteria: [],
      },
      {
        sectionKey: "scope",
        code: "RF-2",
        title: "B",
        description: "b",
        requirementType: "FUNCTIONAL",
        status: "DRAFT",
        order: 2,
        acceptanceCriteria: [],
      },
    ] as never,
    "version-1",
  );

  assert.equal(requirementRows.length, 2);
  assert.equal(requirementRows[0]?.documentVersionId, "version-1");
  assert.equal(requirementRows[0]?.orderIndex, 1);
  assert.equal(requirementRows[1]?.code, "RF-2");
  assert.equal(clientRequirementIds.get("c1"), requirementRows[0]?.id);
  assert.equal(
    clientRequirementIds.size,
    1,
    "solo los que traían identificador",
  );
  assert.notEqual(requirementRows[0]?.id, requirementRows[1]?.id);
});

test("los criterios de aceptación apuntan al requisito de su misma posición", () => {
  const requirements = [
    {
      acceptanceCriteria: [
        { description: "x", order: 1 },
        { description: "y", order: 2 },
      ],
    },
    { acceptanceCriteria: [] },
    { acceptanceCriteria: [{ description: "z", order: 1 }] },
  ] as never;
  const rows = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];

  const criteria = buildCriterionRows(requirements, rows);

  assert.deepEqual(
    criteria.map((criterion) => [
      criterion.requirementId,
      criterion.description,
    ]),
    [
      ["r1", "x"],
      ["r1", "y"],
      ["r3", "z"],
    ],
  );
});

test("la evidencia se enlaza con el requisito nuevo y los campos opcionales quedan en null", () => {
  const ids = new Map([["c1", "nuevo-1"]]);

  const rows = buildEvidenceRows(
    [
      {
        sourceId: "s1",
        requirementClientId: "c1",
        sectionKey: "scope",
        excerpt: "texto",
        note: "nota",
      },
      { sourceId: "s2" },
    ] as never,
    "version-1",
    ids,
  );

  assert.equal(rows[0]?.requirementId, "nuevo-1");
  assert.equal(rows[0]?.excerpt, "texto");
  assert.equal(rows[1]?.requirementId, null);
  assert.equal(rows[1]?.sectionKey, null);
  assert.equal(rows[1]?.excerpt, null);
  assert.equal(rows[1]?.note, null);
  assert.equal(rows[0]?.documentVersionId, "version-1");
});

function sectionRow(key: string, orderIndex: number, content: unknown = "x") {
  return {
    id: `id-${key}`,
    key,
    title: key,
    orderIndex,
    contentJson: JSON.stringify(content),
    templateControlled: false,
  } as never;
}

test("el borrador de IA debe traer las secciones del documento en su orden real", () => {
  const rows = [sectionRow("header", 1), sectionRow("scope", 2)];
  const request = (keys: string[]) =>
    ({
      sections: keys.map((key) => ({ key, content: { title: "t" } })),
      requirements: [],
      evidence: [],
    }) as never;

  // Orden distinto, sección repetida y sección ausente: todos se rechazan con 409.
  for (const keys of [["scope", "header"], ["header", "header"], ["header"]])
    assert.throws(
      () => prepareAiSections(rows, request(keys)),
      httpStatus(409),
      keys.join(","),
    );
});

test("la trazabilidad del borrador no puede apuntar a una sección ajena", () => {
  const rows = [sectionRow("header", 1)];

  assert.throws(
    () =>
      prepareAiSections(rows, {
        sections: [{ key: "header", content: { title: "t" } }],
        requirements: [{ sectionKey: "inventada" }],
        evidence: [],
      } as never),
    httpStatus(409),
  );
});

test("el borrador de IA válido devuelve el contenido listo, sin firmas en el encabezado", () => {
  const rows = [sectionRow("header", 1, { title: "viejo" })];

  const prepared = prepareAiSections(rows, {
    sections: [
      { key: "header", content: { title: "Nuevo", preparedBy: "IA" } },
    ],
    requirements: [],
    evidence: [],
  } as never);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.key, "header");
  assert.deepEqual(prepared[0]?.content, { title: "Nuevo" });
});

function clone(
  sections: unknown[],
  options: Partial<{ isCustomTemplate: boolean; includesScrum: boolean }> = {},
) {
  return cloneSectionsForNewVersion({
    sourceSections: sections as never,
    versionId: "version-2",
    nextVersion: "2.0",
    actor,
    project,
    now,
    isCustomTemplate: options.isCustomTemplate ?? false,
    includesScrum: options.includesScrum ?? false,
  });
}

test("una versión nueva clona las secciones con identificadores nuevos y reinicia encabezado y firmas", () => {
  const { clonedSections, sectionCount } = clone([
    sectionRow("header", 1, {
      title: "T",
      documentVersion: "1.0",
      status: "APROBADO",
      approvedBy: "z",
    }),
    sectionRow("solutionProposal", 2, { objective: "o" }),
    sectionRow("approvalsAndChangeControl", 3, {
      approvals: [
        { responsibility: "Revisión", name: "Luis", status: "APROBADO" },
      ],
    }),
  ]);

  assert.equal(sectionCount, 3);
  assert.equal(clonedSections.length, 3);
  for (const section of clonedSections) {
    assert.equal(section.documentVersionId, "version-2");
    assert.ok(!section.id.startsWith("id-"), "identificador nuevo");
  }
  const header = JSON.parse(clonedSections[0]!.contentJson);
  assert.equal(header.documentVersion, "2.0");
  assert.equal(header.status, "BORRADOR");
  assert.equal("approvedBy" in header, false);
  const approvals = JSON.parse(clonedSections[2]!.contentJson).approvals;
  assert.equal(approvals[0].name, "Ana Analista");
  assert.equal(approvals[1].status, "PENDIENTE");
});

test("un documento antiguo sin solución propuesta la recibe antes del flujo de proceso", () => {
  const { clonedSections } = clone([
    sectionRow("header", 1),
    sectionRow("scope", 2),
    sectionRow("processFlow", 5),
    sectionRow("tests", 6),
  ]);

  const keys = clonedSections.map((section) => section.key);
  assert.deepEqual(keys, [
    "header",
    "scope",
    "solutionProposal",
    "processFlow",
    "tests",
  ]);
  const orders = clonedSections.map((section) => section.orderIndex);
  assert.deepEqual(
    orders,
    [1, 2, 5, 6, 7],
    "las posteriores se desplazan una posición",
  );
});

test("una plantilla personalizada no recibe secciones que no definió", () => {
  const { clonedSections } = clone(
    [sectionRow("header", 1), sectionRow("scope", 2)],
    { isCustomTemplate: true, includesScrum: true },
  );

  assert.deepEqual(
    clonedSections.map((section) => section.key),
    ["header", "scope"],
  );
});

test("si la plantilla incluye plan de trabajo y el documento no lo tenía, se añade al final", () => {
  const { clonedSections } = clone(
    [sectionRow("header", 1), sectionRow("solutionProposal", 2)],
    { includesScrum: true },
  );

  const last = clonedSections.at(-1);
  assert.equal(last?.key, "scrumPlan");
  assert.equal(last?.orderIndex, 3);
  assert.equal(JSON.parse(last!.contentJson).cadenceDays, 15);
});

test("si el plan de trabajo ya existía no se duplica", () => {
  const { clonedSections } = clone(
    [
      sectionRow("header", 1),
      sectionRow("solutionProposal", 2),
      sectionRow("scrumPlan", 3),
    ],
    { includesScrum: true },
  );

  assert.equal(
    clonedSections.filter((section) => section.key === "scrumPlan").length,
    1,
  );
});

const date = new Date("2026-02-01T10:00:00.000Z");

test("el resumen de versión serializa las fechas y la aprobación pendiente como null", () => {
  const summary = versionSummary({
    id: "v1",
    versionNumber: 1,
    version: "1.0",
    status: "DRAFT",
    revision: 3,
    changeSummary: "Inicial",
    createdByUserId: "u1",
    createdAt: date,
    updatedAt: date,
    approvedByUserId: null,
    approvedAt: null,
  } as never);

  assert.equal(summary.createdAt, "2026-02-01T10:00:00.000Z");
  assert.equal(summary.approvedAt, null);
  assert.equal(summary.revision, 3);
  assert.equal(
    versionSummary({
      createdAt: date,
      updatedAt: date,
      approvedAt: date,
    } as never).approvedAt,
    "2026-02-01T10:00:00.000Z",
  );
});

test("el resumen de documento incluye plantilla sin su definición y el indicador de prototipo", () => {
  const summary = toDocumentSummary(
    {
      id: "d1",
      projectId: "p1",
      title: "Doc",
      status: "DRAFT",
      revision: 2,
      currentVersionNumber: 1,
      createdByUserId: "u1",
      createdAt: date,
      updatedAt: date,
      archivedAt: null,
    } as never,
    { version: "1.0" } as never,
    {
      id: "t1",
      sourceTemplateId: "st1",
      code: "STD",
      name: "Estándar",
      version: "1",
      templateType: "STANDARD",
      appliedAt: date,
      definitionJson: "{}",
      definition: { secret: true },
    } as never,
    true,
  );

  assert.equal(summary.hasPrototype, true);
  assert.equal(summary.currentVersion, "1.0");
  assert.equal(summary.archivedAt, null);
  assert.equal(summary.template.appliedAt, "2026-02-01T10:00:00.000Z");
  assert.equal("definition" in summary.template, false);
});

test("el historial devuelve el detalle como JSON y un detalle corrupto se informa como conflicto, no como 500", () => {
  const row = {
    id: "h1",
    documentId: "d1",
    versionId: "v1",
    eventType: "CREATED",
    actorUserId: "u1",
    createdAt: date,
  };

  assert.deepEqual(
    toHistoryEntry({ ...row, detailsJson: '{"a":1}' } as never).details,
    { a: 1 },
  );
  assert.throws(
    () => toHistoryEntry({ ...row, detailsJson: "{no es json" } as never),
    httpStatus(409),
  );
});

test("el detalle de versión agrupa criterios por requisito y descarta los de otros", () => {
  const detail = toVersionDetail(
    { id: "v1", createdAt: date, updatedAt: date, approvedAt: null } as never,
    [
      {
        id: "s1",
        key: "scope",
        title: "Alcance",
        orderIndex: 2,
        contentJson: '{"x":1}',
        templateControlled: true,
      },
    ] as never,
    [
      {
        id: "f1",
        sectionKey: "scope",
        key: "k",
        label: "L",
        valueType: "TEXT",
        valueJson: '"v"',
        orderIndex: 1,
      },
    ] as never,
    [
      {
        id: "r1",
        sectionKey: "scope",
        code: "RF-1",
        title: "A",
        description: "a",
        requirementType: "FUNCTIONAL",
        status: "DRAFT",
        orderIndex: 1,
      },
      {
        id: "r2",
        sectionKey: "scope",
        code: "RF-2",
        title: "B",
        description: "b",
        requirementType: "FUNCTIONAL",
        status: "DRAFT",
        orderIndex: 2,
      },
    ] as never,
    [
      { id: "c1", requirementId: "r1", description: "x", orderIndex: 1 },
      { id: "c2", requirementId: "r2", description: "y", orderIndex: 1 },
      { id: "c3", requirementId: "otro", description: "z", orderIndex: 1 },
    ] as never,
    [
      {
        id: "e1",
        sourceId: "s1",
        sectionKey: null,
        requirementId: "r1",
        excerpt: null,
        note: null,
      },
    ] as never,
  );

  assert.deepEqual(detail.sections[0]?.content, { x: 1 });
  assert.equal(detail.sections[0]?.templateControlled, true);
  assert.equal(detail.fields[0]?.value, "v");
  assert.deepEqual(
    detail.requirements.map((requirement) =>
      requirement.acceptanceCriteria.map((c) => c.id),
    ),
    [["c1"], ["c2"]],
  );
  assert.equal(detail.evidence[0]?.requirementId, "r1");
});
