import dataSource from "../apps/projects-service/src/database/data-source";

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
    const projectsTable = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE name = 'Projects' AND schema_id = SCHEMA_ID('dbo')
    `);
    const participantsTable = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE name = 'ProjectParticipants' AND schema_id = SCHEMA_ID('dbo')
    `);
    const codeSequence = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.sequences
      WHERE name = 'ProjectCodeSequence' AND schema_id = SCHEMA_ID('dbo')
    `);
    const foundationMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'CreateProjectsFoundation1785715200000'
    `);
    const templateMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AddProjectTemplateSelection1786060800000'
    `);
    const templateColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'Projects'
        AND COLUMN_NAME IN (
          'TemplateId',
          'TemplateCode',
          'TemplateName',
          'TemplateVersion',
          'TemplateType'
        )
    `);
    const templateIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name = 'IX_Projects_TemplateId'
        AND object_id = OBJECT_ID('dbo.Projects')
    `);

    if (
      projectsTable !== 1 ||
      participantsTable !== 1 ||
      codeSequence !== 1 ||
      foundationMigration !== 1 ||
      templateMigration !== 1 ||
      templateColumns !== 5 ||
      templateIndex !== 1
    ) {
      throw new Error(
        "RqProjectsDb no contiene la estructura completa del Paso 12.",
      );
    }

    console.log("RqProjectsDb verificada correctamente.");
    console.log("Tabla confirmada: dbo.Projects");
    console.log("Tabla confirmada: dbo.ProjectParticipants");
    console.log("Secuencia confirmada: dbo.ProjectCodeSequence");
    console.log("Migración confirmada: CreateProjectsFoundation1785715200000");
    console.log("Migración confirmada: AddProjectTemplateSelection1786060800000");
    console.log("Selección exacta de plantilla confirmada en dbo.Projects.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqProjectsDb: ${message}`);
  process.exitCode = 1;
});
