import dataSource from "../apps/operations-service/src/database/data-source.js";

interface CountRow {
  countValue: number | string;
}

async function count(sql: string): Promise<number> {
  const rows = (await dataSource.query(sql)) as CountRow[];
  return Number(rows[0]?.countValue ?? 0);
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const tables = await count(`
      SELECT COUNT(1) AS countValue FROM sys.tables
      WHERE schema_id = SCHEMA_ID('dbo') AND name IN (
        'ExportRequests', 'ExportArtifacts', 'NotificationRequests',
        'NotificationDeliveries', 'AuditEvents', 'IntegrationEventInbox'
      )
    `);
    const migration = await count(`
      SELECT COUNT(1) AS countValue FROM dbo.migrations
      WHERE name = 'CreateOperationsFoundation1786752000000'
    `);
    const indexes = await count(`
      SELECT COUNT(1) AS countValue FROM sys.indexes WHERE name IN (
        'IX_ExportRequests_Project_Document_RequestedAt',
        'IX_ExportRequests_Status_UpdatedAt',
        'UQ_ExportRequests_Requester_IdempotencyKey',
        'UQ_ExportArtifacts_Request',
        'IX_NotificationRequests_Recipient_Status_CreatedAt',
        'IX_NotificationDeliveries_Request_Attempt',
        'IX_AuditEvents_Project_OccurredAt',
        'IX_AuditEvents_Resource_OccurredAt',
        'UQ_IntegrationEventInbox_EventId',
        'IX_IntegrationEventInbox_ReceivedAt'
      )
    `);
    const internalForeignKeys = await count(`
      SELECT COUNT(1) AS countValue FROM sys.foreign_keys WHERE name IN (
        'FK_ExportArtifacts_Request', 'FK_NotificationDeliveries_Request'
      )
    `);
    const unexpectedForeignKeys = await count(`
      SELECT COUNT(1) AS countValue FROM sys.foreign_keys
      WHERE parent_object_id IN (
        OBJECT_ID('dbo.ExportRequests'), OBJECT_ID('dbo.NotificationRequests'),
        OBJECT_ID('dbo.AuditEvents'), OBJECT_ID('dbo.IntegrationEventInbox')
      )
    `);
    if (
      tables !== 6 ||
      migration !== 1 ||
      indexes !== 10 ||
      internalForeignKeys !== 2 ||
      unexpectedForeignKeys !== 0
    ) {
      throw new Error("RqOperationsDb no contiene su estructura V1 completa.");
    }
    console.log("RqOperationsDb verificada correctamente.");
    console.log("Tablas confirmadas: 6");
    console.log("Índices confirmados: 10");
    console.log("Claves internas confirmadas: 2; cross-database: 0");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo verificar RqOperationsDb: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
