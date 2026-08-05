import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import dataSource from "../apps/identity-service/src/database/data-source";

loadEnvironmentFiles({
  paths: [".env", "apps/identity-service/.env"],
});

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const rows = (await dataSource.query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.IdentityUsers', 'MustChangePassword') IS NOT NULL
          THEN 1 ELSE 0 END AS hasMustChangePassword,
        CASE WHEN COL_LENGTH('dbo.IdentityUsers', 'SessionVersion') IS NOT NULL
          THEN 1 ELSE 0 END AS hasSessionVersion,
        CASE WHEN OBJECT_ID('dbo.IdentitySecurityAudit', 'U') IS NOT NULL
          THEN 1 ELSE 0 END AS hasAudit,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.migrations
          WHERE name = 'AddUserAdministration1786147200000'
        ) THEN 1 ELSE 0 END AS hasMigration;
    `)) as Array<{
      hasMustChangePassword: number | boolean;
      hasSessionVersion: number | boolean;
      hasAudit: number | boolean;
      hasMigration: number | boolean;
    }>;
    const state = rows[0];

    if (
      !state ||
      !state.hasMustChangePassword ||
      !state.hasSessionVersion ||
      !state.hasAudit ||
      !state.hasMigration
    ) {
      throw new Error(`El esquema no está completo: ${JSON.stringify(state)}`);
    }

    console.log("RqIdentityDb verificada correctamente.");
    console.log("Cambio obligatorio y versión de sesión confirmados.");
    console.log("Auditoría de seguridad y migración confirmadas.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`No se pudo verificar RqIdentityDb: ${message}`);
  process.exitCode = 1;
});
