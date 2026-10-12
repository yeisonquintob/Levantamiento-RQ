import dataSource from "../apps/prototypes-service/src/database/data-source.js";

interface CountRow {
  countValue: number | string;
}

async function count(sql: string): Promise<number> {
  const rows = (await dataSource.query(sql)) as CountRow[];
  return Number(rows[0]?.countValue ?? 0);
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    // Todas las migraciones declaradas en el código están aplicadas (no depende de una lista fija).
    const declared = dataSource.migrations.length;
    const applied = await count(
      "SELECT COUNT(1) AS countValue FROM dbo.migrations",
    );
    expect(declared > 0, "El servicio no declara migraciones.");
    expect(
      !(await dataSource.showMigrations()) && applied >= declared,
      `Hay migraciones pendientes en RqPrototypesDb (declaradas ${declared}, aplicadas ${applied}).`,
    );

    const tables = await count(`
      SELECT COUNT(1) AS countValue FROM sys.tables
      WHERE schema_id = SCHEMA_ID('dbo') AND name IN (
        'PrototypeGenerations', 'PrototypeScreens',
        'PrototypeVisualSpecifications', 'PrototypeGeneratedImages'
      )
    `);
    expect(
      tables === 4,
      `Se esperaban 4 tablas de prototipos y hay ${tables}.`,
    );

    // Una imagen por especificación visual y una pantalla por orden dentro de la generación.
    const uniqueIndexes = await count(`
      SELECT COUNT(1) AS countValue FROM sys.indexes
      WHERE is_unique = 1 AND name IN (
        'UX_PrototypeScreens_GenerationId_Order',
        'UX_PrototypeGeneratedImages_VisualSpecificationId',
        'UX_PrototypeVisualSpecifications_ScreenId_Device'
      )
    `);
    expect(
      uniqueIndexes === 3,
      "Faltan índices únicos de integridad de prototipos.",
    );

    // Propiedad de datos: ProjectId y los usuarios son referencias sin clave foránea (viven en otras bases).
    const foreignKeyToOtherData = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_key_columns fkc
      JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
      WHERE c.name IN ('ProjectId', 'RequestedByUserId')
        AND fkc.parent_object_id IN (
          OBJECT_ID('dbo.PrototypeGenerations'), OBJECT_ID('dbo.PrototypeGeneratedImages')
        )
    `);
    expect(
      foreignKeyToOtherData === 0,
      "RqPrototypesDb no debe tener claves foráneas hacia datos de otros servicios.",
    );

    const secretColumns = await count(`
      SELECT COUNT(1) AS countValue FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME LIKE 'Prototype%'
        AND COLUMN_NAME IN ('ApiKey', 'SecretValue', 'Credential', 'Password')
    `);
    expect(
      secretColumns === 0,
      "Las tablas de prototipos no deben guardar secretos.",
    );

    console.log("RqPrototypesDb verificada correctamente.");
    console.log(`Migraciones declaradas y aplicadas: ${declared}/${applied}`);
    console.log("Tablas confirmadas: 4");
    console.log("Índices únicos de integridad confirmados: 3");
    console.log(
      "Referencias a otros servicios sin claves foráneas confirmadas.",
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo verificar RqPrototypesDb: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
