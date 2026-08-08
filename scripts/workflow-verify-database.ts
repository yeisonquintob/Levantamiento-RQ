import dataSource from "../apps/workflow-service/src/database/data-source";

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
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE schema_id = SCHEMA_ID('dbo')
        AND name IN (
          'WorkflowReviewRequests',
          'WorkflowReviewAssignments',
          'WorkflowReviewActivities'
        )
    `);
    const migration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'CreateWorkflowFoundation1786406400000'
    `);
    const indexes = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name IN (
        'UQ_WorkflowReviewRequests_Document_Version',
        'IX_WorkflowReviewRequests_Project_Status_UpdatedAt',
        'IX_WorkflowReviewRequests_Status_UpdatedAt',
        'UQ_WorkflowReviewAssignments_Request_User_Role',
        'IX_WorkflowReviewAssignments_User_Status',
        'IX_WorkflowReviewActivities_Request_CreatedAt',
        'UX_WorkflowReviewActivities_Request_IdempotencyKey'
      )
    `);
    const internalForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE name IN (
        'FK_WorkflowReviewAssignments_Request',
        'FK_WorkflowReviewActivities_Request'
      )
    `);
    const externalReferenceColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND (
          (TABLE_NAME = 'WorkflowReviewRequests' AND COLUMN_NAME IN (
            'ProjectId', 'DocumentId', 'DocumentVersionId',
            'RequestedByUserId', 'CompletedByUserId'
          ))
          OR (TABLE_NAME = 'WorkflowReviewAssignments' AND COLUMN_NAME = 'UserId')
          OR (TABLE_NAME = 'WorkflowReviewActivities' AND COLUMN_NAME = 'ActorUserId')
        )
    `);
    const unexpectedForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE parent_object_id IN (
        OBJECT_ID('dbo.WorkflowReviewRequests'),
        OBJECT_ID('dbo.WorkflowReviewAssignments'),
        OBJECT_ID('dbo.WorkflowReviewActivities')
      )
        AND name NOT IN (
          'FK_WorkflowReviewAssignments_Request',
          'FK_WorkflowReviewActivities_Request'
        )
    `);

    if (
      tables !== 3 ||
      migration !== 1 ||
      indexes !== 7 ||
      internalForeignKeys !== 2 ||
      externalReferenceColumns !== 7 ||
      unexpectedForeignKeys !== 0
    ) {
      throw new Error(
        "RqWorkflowDb no contiene la estructura aprobada del Punto 19.1.",
      );
    }

    console.log("RqWorkflowDb verificada correctamente.");
    console.log("Tablas confirmadas: 3");
    console.log("Índices confirmados: 7");
    console.log("Claves foráneas internas confirmadas: 2");
    console.log("Referencias externas sin claves foráneas confirmadas: 7");
    console.log("Migración confirmada: CreateWorkflowFoundation1786406400000");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqWorkflowDb: ${message}`);
  process.exitCode = 1;
});
