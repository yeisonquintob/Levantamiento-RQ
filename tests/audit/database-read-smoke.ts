// Read-only integration check; never creates or changes domain records.
import assert from "node:assert/strict";
import type {
  AuditHistoryResponse,
  AuthenticatedUser,
} from "../../libs/shared/contracts/src/index";
import type { DataSource } from "typeorm";

const actor: AuthenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Prueba de lectura",
  email: "audit-test@example.invalid",
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  mustChangePassword: false,
};
async function main() {
  const domain = process.argv[2];
  let source: DataSource;
  let read: (query: Record<string, string>) => Promise<AuditHistoryResponse>;
  const context = {
    actor,
    accessToken: "unused-in-local-read-test",
    correlationId: "audit-read-smoke",
  };
  if (domain === "projects") {
    source =
      require("../../apps/projects-service/src/database/data-source").default;
    const {
      ProjectsService,
    } = require("../../apps/projects-service/src/projects/projects.service");
    const service = new ProjectsService(source, null, null, null);
    read = (query) => service.auditHistory(actor, query);
  } else if (domain === "users") {
    source =
      require("../../apps/identity-service/src/database/data-source").default;
    const {
      UsersService,
    } = require("../../apps/identity-service/src/users/users.service");
    const service = new UsersService(null, null, null, source, null);
    read = (query) => service.auditHistory(actor, query);
  } else if (domain === "ai") {
    source =
      require("../../apps/ai-analysis-service/src/database/data-source").default;
    const {
      AiProviderConfigurationsService,
    } = require("../../apps/ai-analysis-service/src/providers/ai-provider-configurations.service");
    const service = new AiProviderConfigurationsService(null, source, null);
    read = (query) => service.auditHistory(context, query);
  } else if (domain === "approvals") {
    source =
      require("../../apps/operations-service/src/database/data-source").default;
    const {
      NotificationsAuditService,
    } = require("../../apps/operations-service/src/operations/notifications-audit.service");
    const {
      AuditEventEntity,
    } = require("../../apps/operations-service/src/operations/operation.entities");
    const service = new NotificationsAuditService(
      null,
      source.getRepository(AuditEventEntity),
      null,
    );
    read = (query) => service.approvalsHistory(context, query);
  } else throw new Error("Use projects, users, ai or approvals");
  await source.initialize();
  try {
    const page = await read({ pageSize: "2" });
    assert.ok(page.items.length <= 2);
    for (const event of page.items)
      assert.ok(event.id && event.occurredAt && event.resourceLabel);
    await read({
      search: "__auditoria_inexistente__%[",
      from: "2026-01-01",
      to: "2026-12-31",
      result: "SUCCEEDED",
    });
    await read({ page: "2", pageSize: "2" });
    console.log(
      `${domain}: lectura y filtros correctos; ${page.totalItems} eventos existentes.`,
    );
  } finally {
    await source.destroy();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Falló la prueba de lectura",
  );
  process.exitCode = 1;
});
