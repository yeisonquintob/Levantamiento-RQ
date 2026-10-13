import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DocumentHistoryEntity,
  DocumentSectionEntity,
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "../../apps/documents-service/src/documents/document.entities";
import { DocumentsService } from "../../apps/documents-service/src/documents/documents.service";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function httpStatus(expected: number, message?: RegExp) {
  return (error: unknown) =>
    typeof (error as { getStatus?: () => number }).getStatus === "function" &&
    (error as { getStatus: () => number }).getStatus() === expected &&
    (!message || message.test((error as Error).message));
}

interface Access {
  canEdit: boolean;
  canReview: boolean;
}
const EDITOR: Access = { canEdit: true, canReview: false };
const REVIEWER: Access = { canEdit: false, canReview: true };
const OWNER: Access = { canEdit: true, canReview: true };
const VIEWER: Access = { canEdit: false, canReview: false };

/** Plantilla propia (dinámica) de tres secciones, sin encabezado ni aprobaciones. */
const CUSTOM_TEMPLATE = {
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

const sectionRows = {
  header: {
    id: "section-header",
    key: "header",
    contentJson: JSON.stringify({
      title: "Doc",
      status: "BORRADOR",
      approvedBy: "x",
    }),
  },
  approvals: {
    id: "section-approvals",
    key: "approvalsAndChangeControl",
    contentJson: JSON.stringify({ approvals: [], changeControl: [] }),
  },
};

interface Scenario {
  access?: Access;
  document?: Partial<Record<string, unknown>>;
  version?: Partial<Record<string, unknown>>;
  /** El UPDATE condicionado por revisión y estado no afecta ninguna fila (otra persona lo cambió antes). */
  staleUpdate?: boolean;
  sections?: Partial<Record<"header" | "approvals", unknown>>;
  customTemplate?: boolean;
}

function build(scenario: Scenario = {}) {
  const log = {
    sets: [] as {
      entity: unknown;
      set: Record<string, unknown>;
      params: Record<string, unknown>;
    }[],
    updates: [] as {
      entity: unknown;
      id: unknown;
      data: Record<string, unknown>;
    }[],
    saved: [] as unknown[],
  };
  const document = {
    id: DOCUMENT_ID,
    projectId: PROJECT_ID,
    appliedTemplateId: "tpl",
    currentVersionNumber: 2,
    status: "DRAFT",
    ...scenario.document,
  };
  const version = {
    id: VERSION_ID,
    documentId: DOCUMENT_ID,
    versionNumber: 2,
    version: "2.0",
    status: "DRAFT",
    revision: 1,
    changeSummary: "Cambios",
    approvedByUserId: null,
    approvedAt: null,
    rejectedByUserId: null,
    rejectedAt: null,
    ...scenario.version,
  };

  const manager = {
    createQueryBuilder() {
      const state = {
        entity: undefined as unknown,
        set: {} as Record<string, unknown>,
        params: {} as Record<string, unknown>,
      };
      const qb: Record<string, unknown> = {
        update(entity: unknown) {
          state.entity = entity;
          return qb;
        },
        set(value: Record<string, unknown>) {
          state.set = value;
          return qb;
        },
        where(_sql: string, params: Record<string, unknown>) {
          Object.assign(state.params, params);
          return qb;
        },
        andWhere(_sql: string, params: Record<string, unknown>) {
          Object.assign(state.params, params);
          return qb;
        },
        async execute() {
          log.sets.push({
            entity: state.entity,
            set: state.set,
            params: state.params,
          });
          // Solo el UPDATE de la versión depende de la revisión que envía quien edita.
          const isVersion = state.entity === DocumentVersionEntity;
          return { affected: isVersion && scenario.staleUpdate ? 0 : 1 };
        },
      };
      return qb;
    },
    create: (_entity: unknown, value: unknown) => value,
    save: async (value: unknown) => {
      log.saved.push(value);
    },
    update: async (
      entity: unknown,
      id: unknown,
      data: Record<string, unknown>,
    ) => {
      log.updates.push({ entity, id, data });
    },
    findOneBy: async (entity: unknown, where: { key: string }) => {
      if (entity !== DocumentSectionEntity) return null;
      const map = scenario.sections ?? sectionRows;
      const wanted = where.key === "header" ? "header" : "approvals";
      return (
        (wanted in map
          ? (map as Record<string, unknown>)[wanted]
          : sectionRows[wanted]) ?? null
      );
    },
  };

  const service = Object.assign(Object.create(DocumentsService.prototype), {
    documents: { findOneBy: async () => document },
    versions: { findOneBy: async () => version },
    appliedTemplates: {
      findOneBy: async () => ({
        id: "tpl",
        templateType: scenario.customTemplate ? "CUSTOM" : "STANDARD",
        definitionJson: JSON.stringify(
          scenario.customTemplate ? CUSTOM_TEMPLATE : {},
        ),
      }),
    },
    projects: {
      requireRead: async () => ({
        project: { id: PROJECT_ID },
        ...(scenario.access ?? OWNER),
      }),
    },
    dataSource: {
      transaction: async (work: (m: unknown) => unknown) => work(manager),
    },
    loadVersionDetail: async (loaded: { status: string }) => ({ loaded }),
    loadDetail: async () => ({ archived: true }),
  }) as DocumentsService;

  const context = {
    actor: { id: "actor-1", displayName: "Ana Analista", permissions: [] },
    accessToken: "jwt",
    correlationId: "corr",
  } as never;
  return { service, log, context };
}

const request = { expectedRevision: 1, comment: "Listo" } as never;

type Transition = "submitReview" | "requestChanges" | "approve" | "reject";
const CASES: {
  method: Transition;
  from: string;
  to: string;
  needs: "edit" | "review";
}[] = [
  { method: "submitReview", from: "DRAFT", to: "IN_REVIEW", needs: "edit" },
  {
    method: "requestChanges",
    from: "IN_REVIEW",
    to: "CHANGES_REQUESTED",
    needs: "review",
  },
  { method: "approve", from: "IN_REVIEW", to: "APPROVED", needs: "review" },
  { method: "reject", from: "IN_REVIEW", to: "REJECTED", needs: "review" },
];

test("enviar a revisión exige poder editar; solicitar cambios, aprobar o rechazar exigen poder revisar", async () => {
  for (const { method, from, needs } of CASES) {
    const allowed = needs === "edit" ? EDITOR : REVIEWER;
    const denied = needs === "edit" ? REVIEWER : EDITOR;

    const ok = build({ access: allowed, version: { status: from } });
    await ok.service[method](ok.context, DOCUMENT_ID, 2, request);

    for (const access of [denied, VIEWER]) {
      const blocked = build({ access, version: { status: from } });
      await assert.rejects(
        blocked.service[method](blocked.context, DOCUMENT_ID, 2, request),
        httpStatus(403),
        `${method} con ${JSON.stringify(access)}`,
      );
      assert.equal(blocked.log.sets.length, 0, "no se escribió nada");
    }
  }
});

test("cada transición solo parte de los estados permitidos", async () => {
  const invalid: Record<Transition, string[]> = {
    submitReview: ["IN_REVIEW", "APPROVED", "REJECTED"],
    requestChanges: ["DRAFT", "APPROVED", "CHANGES_REQUESTED"],
    approve: ["DRAFT", "APPROVED", "CHANGES_REQUESTED"],
    reject: ["DRAFT", "APPROVED", "REJECTED"],
  };
  for (const [method, statuses] of Object.entries(invalid) as [
    Transition,
    string[],
  ][])
    for (const status of statuses) {
      const { service, context, log } = build({ version: { status } });
      await assert.rejects(
        service[method](context, DOCUMENT_ID, 2, request),
        httpStatus(409, /requiere una versión en estado/u),
        `${method} desde ${status}`,
      );
      assert.equal(log.sets.length, 0);
    }
});

test("también se puede volver a enviar a revisión una versión con cambios solicitados", async () => {
  const { service, context } = build({
    version: { status: "CHANGES_REQUESTED" },
  });
  await service.submitReview(context, DOCUMENT_ID, 2, request);
});

test("un documento archivado es inmutable y solo la versión actual cambia de estado", async () => {
  const archived = build({
    document: { status: "ARCHIVED" },
    version: { status: "IN_REVIEW" },
  });
  await assert.rejects(
    archived.service.approve(archived.context, DOCUMENT_ID, 2, request),
    httpStatus(409, /archivado/u),
  );

  const old = build({
    document: { currentVersionNumber: 3 },
    version: { status: "IN_REVIEW" },
  });
  await assert.rejects(
    old.service.approve(old.context, DOCUMENT_ID, 2, request),
    httpStatus(409, /versión actual/u),
  );
});

test("si otra persona cambió la versión antes, la transición se rechaza por revisión desactualizada", async () => {
  const { service, context, log } = build({
    version: { status: "IN_REVIEW" },
    staleUpdate: true,
  });

  await assert.rejects(
    service.approve(context, DOCUMENT_ID, 2, request),
    httpStatus(409, /desactualizada/u),
  );
  // No se tocaron encabezado, aprobaciones ni historial.
  assert.equal(log.updates.length, 0);
  assert.equal(log.saved.length, 0);
  // El UPDATE se condicionó a la revisión y a los estados de origen permitidos.
  assert.equal(log.sets[0]?.params.expectedRevision, 1);
  assert.deepEqual(log.sets[0]?.params.from, ["IN_REVIEW"]);
});

test("aprobar registra quién y cuándo, actualiza encabezado y aprobaciones y deja historial", async () => {
  const { service, context, log } = build({ version: { status: "IN_REVIEW" } });

  await service.approve(context, DOCUMENT_ID, 2, {
    expectedRevision: 1,
    comment: "Conforme",
  } as never);

  const versionUpdate = log.sets.find(
    (entry) => entry.entity === DocumentVersionEntity,
  )!;
  assert.equal(versionUpdate.set.status, "APPROVED");
  assert.equal(versionUpdate.set.approvedByUserId, "actor-1");
  assert.ok(versionUpdate.set.approvedAt instanceof Date);
  assert.equal(versionUpdate.set.rejectedByUserId, null);

  const header = log.updates.find((entry) => entry.id === "section-header")!;
  const headerContent = JSON.parse(String(header.data.contentJson));
  assert.equal(headerContent.status, "APROBADO");
  assert.equal("approvedBy" in headerContent, false);

  const approvals = log.updates.find(
    (entry) => entry.id === "section-approvals",
  )!;
  const rows = JSON.parse(String(approvals.data.contentJson)).approvals;
  const approval = rows.find(
    (row: { responsibility: string }) => row.responsibility === "Aprobación",
  );
  assert.equal(approval.status, "APROBADO");
  assert.equal(approval.name, "Ana Analista");

  const documentUpdate = log.sets.find(
    (entry) => entry.entity === RequirementDocumentEntity,
  )!;
  assert.equal(documentUpdate.set.status, "APPROVED");

  const history = log.saved.find(
    (entry) =>
      (entry as { eventType?: string }).eventType === "VERSION_APPROVED",
  ) as {
    detailsJson: string;
    actorUserId: string;
  };
  assert.ok(history, "se registró el evento");
  assert.equal(history.actorUserId, "actor-1");
  assert.deepEqual(JSON.parse(history.detailsJson), {
    from: "IN_REVIEW",
    to: "APPROVED",
    comment: "Conforme",
  });
  void DocumentHistoryEntity;
});

test("rechazar registra quién y cuándo, y no marca la versión como aprobada", async () => {
  const { service, context, log } = build({ version: { status: "IN_REVIEW" } });

  await service.reject(context, DOCUMENT_ID, 2, request);

  const versionUpdate = log.sets.find(
    (entry) => entry.entity === DocumentVersionEntity,
  )!;
  assert.equal(versionUpdate.set.status, "REJECTED");
  assert.equal(versionUpdate.set.rejectedByUserId, "actor-1");
  assert.equal(versionUpdate.set.approvedByUserId, null);
  const header = JSON.parse(
    String(
      log.updates.find((entry) => entry.id === "section-header")!.data
        .contentJson,
    ),
  );
  assert.equal(header.status, "BORRADOR");
});

test("el comentario es opcional y se guarda como null", async () => {
  const { service, context, log } = build({ version: { status: "DRAFT" } });

  await service.submitReview(context, DOCUMENT_ID, 2, {
    expectedRevision: 1,
  } as never);

  const history = log.saved.find(
    (entry) =>
      (entry as { eventType?: string }).eventType ===
      "VERSION_SUBMITTED_FOR_REVIEW",
  ) as { detailsJson: string };
  assert.equal(JSON.parse(history.detailsJson).comment, null);
});

test("un documento estándar sin encabezado o sin aprobaciones no puede cambiar de estado", async () => {
  for (const [missing, message] of [
    ["header", /encabezado/u],
    ["approvals", /aprobaciones/u],
  ] as const) {
    const { service, context } = build({
      version: { status: "IN_REVIEW" },
      sections: { [missing]: null },
    });
    await assert.rejects(
      service.approve(context, DOCUMENT_ID, 2, request),
      httpStatus(409, message),
      missing,
    );
  }
});

test("una plantilla propia sin encabezado ni aprobaciones sí puede cambiar de estado", async () => {
  const { service, context, log } = build({
    customTemplate: true,
    version: { status: "IN_REVIEW" },
    sections: { header: null, approvals: null },
  });

  await service.approve(context, DOCUMENT_ID, 2, request);

  assert.equal(
    log.updates.length,
    0,
    "no hay secciones canónicas que actualizar",
  );
  assert.equal(
    log.sets.find((entry) => entry.entity === DocumentVersionEntity)?.set
      .status,
    "APPROVED",
  );
});

test("archivar exige poder revisar, una revisión vigente y un documento activo", async () => {
  const denied = build({ access: EDITOR });
  await assert.rejects(
    denied.service.archive(denied.context, DOCUMENT_ID, {
      expectedRevision: 4,
    } as never),
    httpStatus(403),
  );

  const archived = build({ document: { status: "ARCHIVED" } });
  await assert.rejects(
    archived.service.archive(archived.context, DOCUMENT_ID, {
      expectedRevision: 4,
    } as never),
    httpStatus(409, /archivado/u),
  );

  // En archivar el UPDATE condicionado afecta al documento, no a la versión: se simula desfase en él.
  const stale = build();
  const originalTransaction = (
    stale.service as unknown as { dataSource: { transaction: unknown } }
  ).dataSource;
  (stale.service as unknown as { dataSource: unknown }).dataSource = {
    transaction: async (work: (manager: unknown) => unknown) =>
      work({
        createQueryBuilder: () => {
          const qb: Record<string, unknown> = {
            update: () => qb,
            set: () => qb,
            where: () => qb,
            andWhere: () => qb,
            execute: async () => ({ affected: 0 }),
          };
          return qb;
        },
        create: (_e: unknown, value: unknown) => value,
        save: async () => undefined,
      }),
  };
  void originalTransaction;
  await assert.rejects(
    stale.service.archive(stale.context, DOCUMENT_ID, {
      expectedRevision: 4,
    } as never),
    httpStatus(409, /desactualizada/u),
  );
});

test("archivar deja el documento archivado con quién y cuándo, y registra el historial", async () => {
  const { service, context, log } = build({ access: REVIEWER });

  const result = await service.archive(context, DOCUMENT_ID, {
    expectedRevision: 4,
  } as never);

  assert.deepEqual(result, { archived: true });
  const update = log.sets.find(
    (entry) => entry.entity === RequirementDocumentEntity,
  )!;
  assert.equal(update.set.status, "ARCHIVED");
  assert.equal(update.set.archivedByUserId, "actor-1");
  assert.ok(update.set.archivedAt instanceof Date);
  assert.equal(update.params.expectedRevision, 4);
  assert.equal(update.params.archived, "ARCHIVED");
  assert.ok(
    log.saved.some(
      (entry) =>
        (entry as { eventType?: string }).eventType === "DOCUMENT_ARCHIVED",
    ),
  );
});
