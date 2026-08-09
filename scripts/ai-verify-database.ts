import dataSource from "../apps/ai-analysis-service/src/database/data-source";

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
          'AnalysisRequests',
          'AnalysisRequestSources',
          'AnalysisExecutions',
          'AiProviderConfigurations',
          'AiProviderAuditEvents',
          'AnalysisPromptVersions',
          'AnalysisResults'
        )
    `);
    const migration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name IN (
        'CreateAiAnalysisFoundation1786320000000',
        'AddAiProviderConfiguration1786492800000',
        'AddAiExecutionPipeline1786579200000'
      )
    `);
    const indexes = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name IN (
        'IX_AnalysisRequests_ProjectId_CreatedAt',
        'IX_AnalysisRequests_DocumentVersionId_Status',
        'IX_AnalysisRequests_Status_UpdatedAt',
        'UQ_AnalysisRequestSources_Request_Source',
        'IX_AnalysisRequestSources_SourceId',
        'UQ_AnalysisExecutions_Request_Attempt',
        'IX_AnalysisExecutions_Status_CreatedAt',
        'UQ_AiProviderConfigurations_Name',
        'UQ_AiProviderConfigurations_SecretReference',
        'IX_AiProviderConfigurations_Enabled_Default',
        'UQ_AiProviderConfigurations_Default',
        'IX_AiProviderAuditEvents_Provider_CreatedAt',
        'UQ_AnalysisPromptVersions_Code_Version',
        'UQ_AnalysisPromptVersions_ActiveCode',
        'IX_AnalysisExecutions_ProviderConfigurationId',
        'UQ_AnalysisResults_Request',
        'UQ_AnalysisResults_Execution'
      )
    `);
    const internalForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE name IN (
        'FK_AnalysisRequestSources_Request',
        'FK_AnalysisExecutions_Request',
        'FK_AiProviderAuditEvents_Provider',
        'FK_AnalysisExecutions_ProviderConfiguration',
        'FK_AnalysisExecutions_PromptVersion',
        'FK_AnalysisResults_Request',
        'FK_AnalysisResults_Execution'
      )
    `);
    const externalReferenceColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND (
          (
            TABLE_NAME = 'AnalysisRequests'
            AND COLUMN_NAME IN (
              'ProjectId',
              'DocumentId',
              'DocumentVersionId',
              'RequestedByUserId'
            )
          )
          OR (
            TABLE_NAME = 'AnalysisRequestSources'
            AND COLUMN_NAME = 'SourceId'
          )
        )
    `);
    const unexpectedForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE parent_object_id IN (
        OBJECT_ID('dbo.AnalysisRequests'),
        OBJECT_ID('dbo.AnalysisRequestSources'),
        OBJECT_ID('dbo.AnalysisExecutions')
      )
        AND name NOT IN (
          'FK_AnalysisRequestSources_Request',
          'FK_AnalysisExecutions_Request',
          'FK_AnalysisExecutions_ProviderConfiguration',
          'FK_AnalysisExecutions_PromptVersion'
        )
    `);
    const secretValueColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME IN (
          'AiProviderConfigurations',
          'AiProviderAuditEvents'
        )
        AND COLUMN_NAME IN (
          'ApiKey',
          'SecretValue',
          'Credential',
          'Password'
        )
    `);
    const activePrompt = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.AnalysisPromptVersions
      WHERE Code = N'REQUIREMENT_DOCUMENT'
        AND Version = N'1.0.0'
        AND IsActive = 1
    `);
    const snapshotColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND (
          (TABLE_NAME = 'AnalysisRequests' AND COLUMN_NAME = 'DocumentSnapshotJson')
          OR (
            TABLE_NAME = 'AnalysisRequestSources'
            AND COLUMN_NAME IN ('SourceTitle', 'SourceClassification', 'SnapshotText')
          )
        )
    `);

    if (
      tables !== 7 ||
      migration !== 3 ||
      indexes !== 17 ||
      internalForeignKeys !== 7 ||
      externalReferenceColumns !== 5 ||
      unexpectedForeignKeys !== 0 ||
      secretValueColumns !== 0 ||
      activePrompt !== 1 ||
      snapshotColumns !== 4
    ) {
      throw new Error(
        "RqAiDb no contiene la estructura aprobada del Paso 18.1B.",
      );
    }

    console.log("RqAiDb verificada correctamente.");
    console.log("Tablas confirmadas: 7");
    console.log("Índices confirmados: 17");
    console.log("Claves foráneas internas confirmadas: 7");
    console.log("Referencias externas sin claves foráneas confirmadas: 5");
    console.log(
      "Migraciones confirmadas: foundation, proveedores seguros y ejecución asíncrona.",
    );
    console.log("Columnas de secretos en SQL confirmadas: 0");
    console.log("Prompt activo y cuatro columnas de snapshot confirmados.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqAiDb: ${message}`);
  process.exitCode = 1;
});
