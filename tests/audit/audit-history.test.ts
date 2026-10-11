import assert from "node:assert/strict";
import test from "node:test";
import {
  auditFieldChanges,
  auditMetadataChanges,
  AI_AUDIT_FIELDS,
} from "../../libs/shared/contracts/src/lib/audit-history";
import {
  parseAuditHistoryQuery,
  readAuditHistory,
} from "../../libs/shared/persistence/src/lib/audit-history";
import { ProjectsService } from "../../apps/projects-service/src/projects/projects.service";
import { ProjectEntity } from "../../apps/projects-service/src/projects/project.entity";
import { ProjectAuditEntity } from "../../apps/projects-service/src/projects/project-audit.entity";
import { UsersService } from "../../apps/identity-service/src/users/users.service";
import { NotificationsAuditService } from "../../apps/operations-service/src/operations/notifications-audit.service";
import { AiProviderConfigurationsService } from "../../apps/ai-analysis-service/src/providers/ai-provider-configurations.service";
import { AiProviderConfigurationEntity } from "../../apps/ai-analysis-service/src/providers/ai-provider-configuration.entity";
import { MemoryAiSecretVault } from "../../apps/ai-analysis-service/src/providers/ai-secret-vault";
import type { AuthenticatedUser } from "../../libs/shared/contracts/src/index";

const actor: AuthenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Administradora",
  email: "admin@example.invalid",
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  mustChangePassword: false,
};
const context = { actor, accessToken: "test", correlationId: "audit-test" };

test("distingue campos sin cambios, eliminados y valores falsos", () => {
  assert.deepEqual(
    auditFieldChanges(
      { title: "Proyecto", description: "Texto", active: true, limit: 5 },
      { title: "Proyecto", description: null, active: false, limit: 0 },
    ),
    [
      { field: "description", before: "Texto", after: null },
      { field: "active", before: true, after: false },
      { field: "limit", before: 5, after: 0 },
    ],
  );
  assert.deepEqual(
    auditMetadataChanges(
      {
        changes: [
          { field: "apiKey", before: "secret", after: "new" },
          { field: "model", before: "a", after: "b" },
          { field: "name", before: {}, after: [] },
        ],
      },
      AI_AUDIT_FIELDS,
    ),
    [{ field: "model", before: "a", after: "b" }],
  );
});

test("valida fechas reales, rango, UUID y límites de paginación", () => {
  for (const input of [
    { from: "2026-02-30" },
    { from: "2026-09-14", to: "2026-09-13" },
    { page: "0" },
    { pageSize: "101" },
    { projectId: "x' OR 1=1" },
    { result: "OTHER" },
  ])
    assert.throws(() => parseAuditHistoryQuery(input));
  const query = parseAuditHistoryQuery({
    from: "2026-09-13",
    to: "2026-09-13",
  });
  assert.equal(query.from?.toISOString(), "2026-09-13T05:00:00.000Z");
  assert.equal(query.to?.toISOString(), "2026-09-14T04:59:59.999Z");
});

test("consulta parametrizada conserva filtros y calcula paginación global", async () => {
  const calls: unknown[][] = [];
  const builder = {
    andWhere: (...args: unknown[]) => {
      calls.push(args);
      return builder;
    },
    orderBy: () => builder,
    addOrderBy: () => builder,
    skip: (value: number) => {
      assert.equal(value, 25);
      return builder;
    },
    take: (value: number) => {
      assert.equal(value, 25);
      return builder;
    },
    getManyAndCount: async () => [[], 60],
  };
  const result = await readAuditHistory(
    builder as never,
    {
      search: "50%_[",
      projectId: actor.id,
      result: "FAILED",
      page: "2",
      pageSize: "25",
    },
    {
      date: "audit.date",
      id: "audit.id",
      search: ["audit.name"],
      projectId: "audit.projectId",
    },
  );
  assert.equal(result.totalPages, 3);
  assert.deepEqual(calls[0], [
    "(audit.name LIKE :auditSearch)",
    { auditSearch: "%50[%][_][[]%" },
  ]);
  assert.deepEqual(calls[1], [
    "audit.projectId = :auditProject",
    { auditProject: actor.id },
  ]);
  assert.deepEqual(calls[2], ["1 = 0"]);
});

test("los cuatro historiales rechazan usuarios sin permiso antes de consultar datos", async () => {
  const denied = {
    ...context,
    actor: { ...actor, roles: [], permissions: [] },
  };
  await assert.rejects(
    new ProjectsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ).auditHistory(denied.actor, {}),
    /administración/i,
  );
  await assert.rejects(
    new UsersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ).auditHistory(denied.actor, {}),
    /administración/i,
  );
  await assert.rejects(
    new NotificationsAuditService(
      {} as never,
      {} as never,
      {} as never,
    ).approvalsHistory(denied, {}),
    /administración/i,
  );
  await assert.rejects(
    new AiProviderConfigurationsService(
      {} as never,
      {} as never,
      {} as never,
    ).auditHistory(denied, {}),
    /administr/i,
  );
});

function projectFixture(failAudit = false) {
  const project = Object.assign(new ProjectEntity(), {
    id: "22222222-2222-4222-8222-222222222222",
    code: "RQ-TEST",
    title: "Título",
    requestingArea: "Operaciones",
    description: "Descripción original",
    status: "DRAFT",
    ownerUserId: actor.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    participants: [],
  });
  const records: {
    action: string;
    projectId: string;
    actorName: string;
    metadataJson: string;
  }[] = [];
  let inTransaction = false;
  const repo = {
    findOne: async () => project,
    save: async (value: unknown) => {
      assert.ok(inTransaction);
      return value;
    },
    remove: async (value: ProjectEntity) => {
      assert.ok(inTransaction);
      value.id = undefined as never;
    },
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === ProjectAuditEntity
        ? {
            insert: async (row: (typeof records)[number]) => {
              assert.ok(inTransaction);
              if (failAudit) throw new Error("Audit persistence failed");
              records.push(row);
            },
          }
        : repo,
  };
  const service = new ProjectsService(
    {
      transaction: async (work: (manager: unknown) => Promise<unknown>) => {
        inTransaction = true;
        try {
          return await work(manager);
        } finally {
          inTransaction = false;
        }
      },
    } as never,
    repo as never,
    {} as never,
    {} as never,
  );
  return { service, project, records };
}

test("actualizar descripción vacía registra autor y valores en la misma transacción", async () => {
  const { service, project, records } = projectFixture();
  await service.update(actor, project.id, { description: null });
  assert.equal(records[0].actorName, actor.displayName);
  assert.deepEqual(JSON.parse(records[0].metadataJson).changes, [
    { field: "description", before: "Descripción original", after: null },
  ]);
});

test("no confirma una modificación si falla la escritura del historial", async () => {
  const { service, project } = projectFixture(true);
  await assert.rejects(
    service.update(actor, project.id, { title: "Cambio" }),
    /Audit persistence failed/,
  );
});

test("eliminar proyecto conserva el identificador y el contenido del evento", async () => {
  const { service, project, records } = projectFixture();
  const id = project.id;
  await service.deleteProject(actor, id);
  assert.equal(records[0].projectId, id);
  assert.equal(records[0].action, "PROJECT_DELETED");
  assert.ok(
    JSON.parse(records[0].metadataJson).changes.some(
      (change: { field: string; before: unknown; after: unknown }) =>
        change.field === "title" &&
        change.before === "Título" &&
        change.after === null,
    ),
  );
});

function providerFixture() {
  const vault = new MemoryAiSecretVault();
  const provider = Object.assign(new AiProviderConfigurationEntity(), {
    id: "22222222-2222-4222-8222-222222222222",
    name: "IA",
    purpose: "TEXT",
    providerType: "OPENAI",
    model: "modelo",
    baseUrl: "https://api.openai.com/v1",
    isEnabled: true,
    isDefault: false,
    timeoutMs: 60000,
    maxInputTokens: 20000,
    maxOutputTokens: 5000,
    maxAttempts: 2,
    secretReference: "previous",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const previous = Object.assign(new AiProviderConfigurationEntity(), {
    ...provider,
    id: "33333333-3333-4333-8333-333333333333",
    name: "Anterior",
    isDefault: true,
  });
  const records: {
    action: string;
    providerConfigurationId: string;
    metadataJson: string;
  }[] = [];
  const manager = {
    create: (_: unknown, row: unknown) => row,
    save: async (row: (typeof records)[number]) => {
      if (row.action) records.push(row);
      return row;
    },
    find: async () => [previous],
    findOneBy: async () => provider,
  };
  const service = new AiProviderConfigurationsService(
    { findOneBy: async () => provider } as never,
    {
      transaction: async (work: (value: typeof manager) => Promise<unknown>) =>
        work(manager),
    } as never,
    vault,
  );
  return { service, provider, previous, records, vault, manager };
}

test("cambiar proveedor predeterminado audita ambos proveedores y omite secretos de URL", async () => {
  const { service, provider, previous, records } = providerFixture();
  await service.update(context, provider.id, {
    isDefault: true,
    baseUrl: "https://user:secret@api.openai.com/v1?key=hidden#secret",
  });
  assert.equal(previous.isDefault, false);
  assert.equal(records.length, 2);
  assert.equal(records[0].providerConfigurationId, previous.id);
  assert.deepEqual(JSON.parse(records[0].metadataJson).changes, [
    { field: "isDefault", before: true, after: false },
  ]);
  assert.doesNotMatch(JSON.stringify(records), /hidden|secret|user:/);
});

test("rotación registra quién cambió la credencial sin almacenar su valor", async () => {
  const { service, provider, records, vault } = providerFixture();
  await vault.put("previous", "old-secret");
  await service.rotateCredential(context, provider.id, {
    apiKey: "new-secret-value",
  });
  assert.equal(await vault.has("previous"), false);
  assert.equal(
    await vault.resolve(provider.secretReference),
    "new-secret-value",
  );
  assert.equal(records[0].action, "CREDENTIAL_ROTATED");
  assert.equal(
    JSON.parse(records[0].metadataJson).actorName,
    actor.displayName,
  );
  assert.doesNotMatch(JSON.stringify(records), /old-secret|new-secret-value/);
});

test("si falla la auditoría de rotación conserva la credencial anterior", async () => {
  const { service, provider, vault, manager } = providerFixture();
  await vault.put("previous", "old-secret");
  manager.save = async (row) => {
    if (row.action) throw new Error("Audit persistence failed");
    return row;
  };
  await assert.rejects(
    service.rotateCredential(context, provider.id, {
      apiKey: "new-secret-value",
    }),
    /Audit persistence failed/,
  );
  assert.equal(await vault.resolve("previous"), "old-secret");
  assert.equal(await vault.has(provider.secretReference), false);
});
