import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowOpenAiTimeout6000001787961600000
  implements MigrationInterface
{
  name = "AllowOpenAiTimeout6000001787961600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
        CHECK (
          (ProviderType = 'OPENAI'
            AND TimeoutMs BETWEEN 1000 AND 600000)
          OR
          (ProviderType = 'OLLAMA'
            AND TimeoutMs BETWEEN 1000 AND 900000)
        );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;

      UPDATE dbo.AiProviderConfigurations
        SET TimeoutMs = 300000
        WHERE ProviderType = 'OPENAI'
          AND TimeoutMs > 300000;

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
        CHECK (
          (ProviderType = 'OPENAI'
            AND TimeoutMs BETWEEN 1000 AND 300000)
          OR
          (ProviderType = 'OLLAMA'
            AND TimeoutMs BETWEEN 1000 AND 900000)
        );
    `);
  }
}
