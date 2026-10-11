import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowOllamaProviderConfiguration1787266800000 implements MigrationInterface {
  name = "AllowOllamaProviderConfiguration1787266800000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX UQ_AiProviderConfigurations_Default ON dbo.AiProviderConfigurations;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_ProviderType;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_BaseUrl;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_MaxInputTokens;
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
        CHECK (ProviderType IN ('OPENAI', 'OLLAMA'));
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
        CHECK (
          (ProviderType = 'OPENAI' AND BaseUrl = 'https://api.openai.com/v1')
          OR
          (ProviderType = 'OLLAMA' AND (
            BaseUrl LIKE 'http://127.0.0.1:%'
            OR BaseUrl LIKE 'http://localhost:%'
            OR BaseUrl LIKE 'http://[[]::1]:%'
            OR BaseUrl LIKE 'http://host.docker.internal:%'
          ))
        );
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
        CHECK ((ProviderType = 'OPENAI' AND TimeoutMs BETWEEN 1000 AND 300000) OR (ProviderType = 'OLLAMA' AND TimeoutMs BETWEEN 1000 AND 900000));
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_MaxInputTokens
        CHECK (MaxInputTokens BETWEEN 1000 AND 1048576);
      CREATE UNIQUE INDEX UQ_AiProviderConfigurations_Default
        ON dbo.AiProviderConfigurations (ProviderType)
        WHERE IsDefault = 1;
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dbo.AiProviderConfigurations SET IsDefault = 0, IsEnabled = 0 WHERE ProviderType = 'OLLAMA';
      DELETE FROM dbo.AiProviderConfigurations WHERE ProviderType = 'OLLAMA';
      DROP INDEX UQ_AiProviderConfigurations_Default ON dbo.AiProviderConfigurations;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_ProviderType;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_BaseUrl;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_MaxInputTokens;
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType CHECK (ProviderType IN ('OPENAI'));
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl CHECK (BaseUrl = 'https://api.openai.com/v1');
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs CHECK (TimeoutMs BETWEEN 1000 AND 300000);
      ALTER TABLE dbo.AiProviderConfigurations ADD CONSTRAINT CK_AiProviderConfigurations_MaxInputTokens CHECK (MaxInputTokens BETWEEN 1000 AND 1000000);
      CREATE UNIQUE INDEX UQ_AiProviderConfigurations_Default
        ON dbo.AiProviderConfigurations (IsDefault)
        WHERE IsDefault = 1;
    `);
  }
}
