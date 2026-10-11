import assert from "node:assert/strict";
import test from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import {
  AppliedAiAnalysisResultEntity,
  DocumentEvidenceEntity,
  DocumentRequirementEntity,
  DocumentSectionEntity,
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "../../apps/documents-service/src/documents/document.entities.js";
import { DocumentsService } from "../../apps/documents-service/src/documents/documents.service.js";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-30T12:00:00Z");

/** Plantilla propia (dinámica) de tres secciones, sin encabezado ni aprobaciones. */
const THREE_SECTION_TEMPLATE = {
  sectionOrder: ["contexto", "alcance", "cierre"],
  scrum: { enabled: false },
  sections: ["contexto", "alcance", "cierre"].map((key, index) => ({
    key,
    order: index + 1,
    title: `Sección ${key}`,
    required: true,
    guidance: "Guía",
  })),
};

const appliedTemplate = {
  id: "template-applied",
  sourceTemplateId: "template-source",
  code: "PROPIA",
  name: "Plantilla propia",
  version: "1.0.0",
  templateType: "CUSTOM",
  definitionJson: JSON.stringify(THREE_SECTION_TEMPLATE),
  appliedAt: now,
};

const sectionRows = ["contexto", "alcance", "cierre"].map((key, index) => ({
  id: `section-${key}`,
  documentVersionId: VERSION_ID,
  key,
  title: `Sección ${key}`,
  orderIndex: index + 1,
  contentJson: JSON.stringify("[PENDIENTE POR DEFINIR]"),
  templateControlled: false,
}));

function makeService(overrides: Record<string, unknown>): DocumentsService {
  return Object.assign(
    Object.create(DocumentsService.prototype),
    overrides,
  ) as DocumentsService;
}

interface ManagerState {
  readonly updates: { entity: unknown; id: unknown; data: any }[];
  readonly deletes: { entity: unknown; where: unknown }[];
  readonly saved: unknown[][];
}

function makeManager(
  state: ManagerState,
  handlers: {
    find?: (entity: unknown) => unknown[];
    findOne?: (entity: unknown, options: any) => unknown;
    deleteAffected?: (entity: unknown) => number;
  } = {},
) {
  const qb: any = {
    update: () => qb,
    set: () => qb,
    where: () => qb,
    andWhere: () => qb,
    execute: async () => ({ affected: 1 }),
  };
  return {
    createQueryBuilder: () => qb,
    create: (_entity: unknown, value: unknown) => value,
    save: async (...args: unknown[]) => {
      state.saved.push(args);
    },
    update: async (entity: unknown, id: unknown, data: any) => {
      state.updates.push({ entity, id, data });
    },
    delete: async (entity: unknown, where: unknown) => {
      state.deletes.push({ entity, where });
      return { affected: handlers.deleteAffected?.(entity) ?? 1 };
    },
    find: async (entity: unknown) => handlers.find?.(entity) ?? [],
    findOne: async (entity: unknown, options: any) =>
      handlers.findOne?.(entity, options) ?? null,
    findOneBy: async () => null,
    countBy: async () => 0,
  };
}

function newState(): ManagerState {
  return { updates: [], deletes: [], saved: [] };
}

const actor = (permissions: string[] = []) => ({
  id: "actor",
  displayName: "Actor",
  permissions,
});

test("una plantilla propia de 3 secciones se crea, se lee, se edita y se aprueba", async () => {
  const state = newState();
  const manager = makeManager(state);
  const document = {
    id: DOCUMENT_ID,
    projectId: PROJECT_ID,
    appliedTemplateId: appliedTemplate.id,
    currentVersionNumber: 1,
    status: "DRAFT",
  };
  const version = {
    id: VERSION_ID,
    documentId: DOCUMENT_ID,
    versionNumber: 1,
    version: "1.0.0",
    status: "DRAFT",
    revision: 1,
    approvedByUserId: null,
    approvedAt: null,
    rejectedByUserId: null,
    rejectedAt: null,
  };
  const service = makeService({
    projectAccess: async () => ({
      canEdit: true,
      canReview: true,
      role: "OWNER",
      project: { id: PROJECT_ID, title: "Proyecto", code: "P-1", template: { id: "t" } },
    }),
    documents: {
      findOneBy: async (where: { id?: string; creationIdempotencyKey?: string }) =>
        where.id ? document : null,
    },
    templates: {
      findOneBy: async () => ({
        id: "template-source",
        status: "PUBLISHED",
        includesScrum: false,
        code: "PROPIA",
        name: "Plantilla propia",
        version: "1.0.0",
        templateType: "CUSTOM",
        definitionJson: appliedTemplate.definitionJson,
      }),
    },
    appliedTemplates: { findOneBy: async () => appliedTemplate },
    dataSource: { transaction: async (cb: any) => cb(manager) },
    loadDetail: async () => ({ created: true }),
    loadVersionDetail: async () => ({ sections: sectionRows }),
    requireDocument: async () => document,
    requireVersion: async () => version,
    sections: { findOneBy: async () => sectionRows[0] },
    projects: { documentGenerated: async () => undefined },
  });
  const context = { actor: actor(), accessToken: "t", correlationId: "c" } as never;

  // Crear: se materializan exactamente las 3 secciones de la plantilla.
  await service.create(context, PROJECT_ID, {} as never);
  const sectionSave = state.saved.find((args) => args[0] === DocumentSectionEntity);
  assert.deepEqual(
    (sectionSave?.[1] as { key: string }[]).map((section) => section.key),
    ["contexto", "alcance", "cierre"],
  );

  // Validar: acepta el layout de la plantilla y rechaza uno distinto.
  const assertSections = (rows: unknown[]) =>
    (service as any).assertDocumentSections(rows, appliedTemplate);
  assert.doesNotThrow(() => assertSections(sectionRows));
  assert.throws(() => assertSections(sectionRows.slice(0, 2)), ConflictException);
  assert.throws(
    () => assertSections([sectionRows[1], sectionRows[0], sectionRows[2]]),
    /orden de las secciones/,
  );
  // Sin plantilla (documento canónico) sigue exigiendo el layout canónico.
  assert.throws(
    () => (service as any).assertDocumentSections(sectionRows),
    /secciones base/,
  );

  // Leer: loadVersionDetail real valida contra la plantilla efectiva.
  const reader = makeService({
    documents: { findOneBy: async () => document },
    appliedTemplates: { findOneBy: async () => appliedTemplate },
    sections: { find: async () => sectionRows },
    fields: { find: async () => [] },
    requirements: { find: async () => [] },
    evidence: { find: async () => [] },
    criteria: { find: async () => [] },
  });
  const detail = await (reader as any).loadVersionDetail({
    ...version,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(detail.sections.length, 3);

  // Editar.
  await service.updateSection(context, DOCUMENT_ID, 1, "contexto" as never, {
    expectedRevision: 1,
    content: "Nuevo contenido",
  });
  assert.equal(state.updates[0]?.data.contentJson, JSON.stringify("Nuevo contenido"));

  // Aprobar: sin encabezado ni aprobaciones no falla.
  const inReview = { ...version, status: "IN_REVIEW" };
  const approver = makeService({
    requireDocument: async () => document,
    projectAccess: async () => ({ canEdit: true, canReview: true }),
    requireVersion: async () => inReview,
    appliedTemplates: { findOneBy: async () => appliedTemplate },
    dataSource: { transaction: async (cb: any) => cb(manager) },
    loadVersionDetail: async () => ({ status: "APPROVED" }),
  });
  const approved = await approver.approve(context, DOCUMENT_ID, 1, {
    expectedRevision: 1,
    comment: null,
  } as never);
  assert.equal((approved as { status: string }).status, "APPROVED");
});

function aiDraftFixture(options: {
  rows: { id: string; key: string; contentJson: string }[];
  canEdit?: boolean;
  state: ManagerState;
}) {
  const manager = makeManager(options.state, {
    find: (entity) => (entity === DocumentSectionEntity ? options.rows : []),
    findOne: (entity, query) =>
      entity === DocumentSectionEntity
        ? (options.rows.find((row) => row.key === query.where.key) ?? null)
        : null,
  });
  const document = {
    id: DOCUMENT_ID,
    projectId: PROJECT_ID,
    currentVersionNumber: 1,
    status: "DRAFT",
  };
  const service = makeService({
    requireDocument: async () => document,
    projectAccess: async () => ({ canEdit: options.canEdit ?? true }),
    requireVersion: async () => ({
      id: VERSION_ID,
      documentId: DOCUMENT_ID,
      versionNumber: 1,
      status: "DRAFT",
    }),
    appliedAiResults: { findOneBy: async () => null },
    sources: { requireSource: async () => undefined },
    projects: { documentGenerated: async () => undefined },
    dataSource: { transaction: async (cb: any) => cb(manager) },
    loadVersionDetail: async () => ({ ok: true }),
  });
  const context = {
    actor: actor(["documents.ai.apply"]),
    accessToken: "t",
    correlationId: "c",
  } as never;
  const request = (sections: { key: string; content: unknown }[]) =>
    ({
      expectedRevision: 1,
      analysisRequestId: "44444444-4444-4444-8444-444444444444",
      analysisResultId: "55555555-5555-4555-8555-555555555555",
      sections,
      requirements: [],
      evidence: [],
    }) as never;
  return { service, context, request };
}

test("applyAiDraft rechaza contenido de sección inválido sin escribir nada", async () => {
  const state = newState();
  const { service, context, request } = aiDraftFixture({
    state,
    rows: [{ id: "s1", key: "solutionProposal", contentJson: '"x"' }],
  });
  await assert.rejects(
    service.applyAiDraft(
      context,
      DOCUMENT_ID,
      1,
      request([{ key: "solutionProposal", content: { objective: "ok" } }]),
    ),
    BadRequestException,
  );
  assert.equal(
    state.updates.filter((update) => update.entity === DocumentSectionEntity).length,
    0,
  );
});

test("applyAiDraft sincroniza Punto 7 con Punto 6 como updateSection", async () => {
  const state = newState();
  const { service, context, request } = aiDraftFixture({
    state,
    rows: [
      {
        id: "s-milestones",
        key: "milestones",
        contentJson: JSON.stringify({
          functionalRequirements: [],
          nonFunctionalRequirements: [],
        }),
      },
      { id: "s-backlog", key: "backlogStructure", contentJson: '{"epics":[]}' },
    ],
  });
  const backlog = {
    epics: [
      {
        code: "EP-001",
        title: "Épica",
        features: [
          {
            code: "FE-001",
            title: "Funcionalidad",
            userStories: [
              {
                code: "HU-001",
                featureCode: "FE-001",
                title: "Historia",
                description: "Descripción",
                acceptanceCriteria: [{ code: "CA-001" }],
                tasks: [],
              },
            ],
          },
        ],
      },
    ],
  };
  await service.applyAiDraft(
    context,
    DOCUMENT_ID,
    1,
    request([
      {
        key: "milestones",
        content: { functionalRequirements: [], nonFunctionalRequirements: [] },
      },
      { key: "backlogStructure", content: backlog },
    ]),
  );
  const milestonesWrites = state.updates.filter((update) => update.id === "s-milestones");
  const projected = JSON.parse(
    milestonesWrites.at(-1)?.data.contentJson as string,
  ) as { functionalRequirements: { code: string; epicCode: string }[] };
  assert.equal(projected.functionalRequirements[0]?.code, "HU-001");
  assert.equal(projected.functionalRequirements[0]?.epicCode, "EP-001");
});

test("applyAiDraft exige requireEdit aunque el actor tenga documents.ai.apply", async () => {
  const state = newState();
  const { service, context, request } = aiDraftFixture({
    state,
    canEdit: false,
    rows: [{ id: "s1", key: "contexto", contentJson: '"x"' }],
  });
  await assert.rejects(
    service.applyAiDraft(
      context,
      DOCUMENT_ID,
      1,
      request([{ key: "contexto", content: "Texto" }]),
    ),
    ForbiddenException,
  );
  assert.equal(state.updates.length, 0);
});

test("deleteDraftVersion no borra una versión que dejó de ser DRAFT por una carrera", async () => {
  const state = newState();
  const document = {
    id: DOCUMENT_ID,
    projectId: PROJECT_ID,
    currentVersionNumber: 2,
    revision: 3,
    status: "IN_REVIEW",
  };
  const stale = { id: VERSION_ID, documentId: DOCUMENT_ID, versionNumber: 2, status: "DRAFT" };
  const buildService = (lockedStatus: string, deleteAffected: number) =>
    makeService({
      requireDocument: async () => document,
      projectAccess: async () => ({ canEdit: true }),
      // Lectura previa (fuera de la transacción): aún aparece como DRAFT.
      requireVersion: async () => stale,
      dataSource: {
        transaction: async (cb: any) =>
          cb(
            makeManager(state, {
              findOne: (entity) =>
                entity === RequirementDocumentEntity
                  ? document
                  : entity === DocumentVersionEntity
                    ? { ...stale, status: lockedStatus }
                    : null,
              find: () => [stale, { id: "v1", versionNumber: 1, status: "APPROVED" }],
              deleteAffected: (entity) =>
                entity === DocumentVersionEntity ? deleteAffected : 1,
            }),
          ),
      },
    });
  const context = { actor: actor(), accessToken: "t", correlationId: "c" } as never;

  // El bloqueo revela que una transición concurrente ya la envió a revisión.
  await assert.rejects(
    buildService("IN_REVIEW", 1).deleteDraftVersion(context, DOCUMENT_ID, 2),
    /Solo se pueden eliminar versiones en estado DRAFT/,
  );
  assert.equal(state.deletes.length, 0);

  // Defensa final: el DELETE condicionado por estado no afecta ninguna fila.
  await assert.rejects(
    buildService("DRAFT", 0).deleteDraftVersion(context, DOCUMENT_ID, 2),
    ConflictException,
  );
  const versionDelete = state.deletes.find((item) => item.entity === DocumentVersionEntity);
  assert.deepEqual(versionDelete?.where, { id: VERSION_ID, status: "DRAFT" });
  assert.equal(
    state.deletes.some((item) => item.entity === RequirementDocumentEntity),
    false,
  );
  // Se referencian para dejar explícito qué tablas no deben tocarse antes del guard.
  assert.ok(AppliedAiAnalysisResultEntity && DocumentEvidenceEntity && DocumentRequirementEntity);
});

test("un JSON corrupto en base de datos produce un error controlado", async () => {
  const document = {
    id: DOCUMENT_ID,
    appliedTemplateId: appliedTemplate.id,
  };
  const service = makeService({
    documents: { findOneBy: async () => document },
    appliedTemplates: { findOneBy: async () => appliedTemplate },
    sections: {
      find: async () => [{ ...sectionRows[0], contentJson: "{corrupto" }, sectionRows[1], sectionRows[2]],
    },
    fields: { find: async () => [] },
    requirements: { find: async () => [] },
    evidence: { find: async () => [] },
    criteria: { find: async () => [] },
  });
  await assert.rejects(
    (service as any).loadVersionDetail({
      id: VERSION_ID,
      documentId: DOCUMENT_ID,
      versionNumber: 1,
      createdAt: now,
      updatedAt: now,
    }),
    (error: unknown) =>
      error instanceof ConflictException &&
      /JSON inválido/.test((error as Error).message),
  );
});
