import type { MigrationInterface, QueryRunner } from "typeorm";

export class SeparateTextAndImageAiProviders1789000002000
  implements MigrationInterface
{
  name = "SeparateTextAndImageAiProviders1789000002000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD Purpose nvarchar(16) NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_Purpose DEFAULT ('TEXT');
    `);

    await queryRunner.query(`
      DROP INDEX UQ_AiProviderConfigurations_Default ON dbo.AiProviderConfigurations;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_ProviderType;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_BaseUrl;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI', 'OLLAMA', 'COMFYUI'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_Purpose
          CHECK (Purpose IN ('TEXT', 'IMAGE'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_PurposeProvider
          CHECK (
            (Purpose = 'TEXT' AND ProviderType IN ('OPENAI', 'OLLAMA'))
            OR
            (Purpose = 'IMAGE' AND ProviderType IN ('OPENAI', 'COMFYUI'))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
          CHECK (
            (ProviderType = 'OPENAI' AND BaseUrl = 'https://api.openai.com/v1')
            OR
            (ProviderType IN ('OLLAMA', 'COMFYUI') AND (
              BaseUrl LIKE 'http://127.0.0.1:%'
              OR BaseUrl LIKE 'http://localhost:%'
              OR BaseUrl LIKE 'http://[[]::1]:%'
              OR BaseUrl LIKE 'http://host.docker.internal:%'
            ))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
          CHECK (
            (ProviderType = 'OPENAI' AND TimeoutMs BETWEEN 1000 AND 600000)
            OR
            (ProviderType IN ('OLLAMA', 'COMFYUI') AND TimeoutMs BETWEEN 1000 AND 900000)
          );

      CREATE UNIQUE INDEX UQ_AiProviderConfigurations_Default
        ON dbo.AiProviderConfigurations (Purpose, ProviderType)
        WHERE IsDefault = 1;
    `);

    await queryRunner.query(`
      DECLARE @ActorUserId uniqueidentifier;
      SELECT TOP (1) @ActorUserId = CreatedByUserId
      FROM dbo.AiProviderConfigurations
      ORDER BY CreatedAt ASC;

      IF @ActorUserId IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM dbo.AiProviderConfigurations
           WHERE Purpose = 'IMAGE'
             AND ProviderType = 'COMFYUI'
             AND BaseUrl = 'http://127.0.0.1:8188'
         )
      BEGIN
        INSERT INTO dbo.AiProviderConfigurations (
          Id,
          Name,
          ProviderType,
          Purpose,
          Model,
          BaseUrl,
          IsEnabled,
          IsDefault,
          TimeoutMs,
          MaxInputTokens,
          MaxOutputTokens,
          MaxAttempts,
          SecretReference,
          LastConnectionTestAt,
          LastConnectionTestStatus,
          LastErrorCode,
          CreatedByUserId,
          UpdatedByUserId,
          CreatedAt,
          UpdatedAt
        )
        VALUES (
          NEWID(),
          N'ComfyUI Local Prototipos',
          N'COMFYUI',
          N'IMAGE',
          N'workflow-pendiente',
          N'http://127.0.0.1:8188',
          0,
          0,
          300000,
          32000,
          1000,
          3,
          N'provider-comfyui-local-8188',
          NULL,
          N'NOT_TESTED',
          NULL,
          @ActorUserId,
          @ActorUserId,
          SYSUTCDATETIME(),
          SYSUTCDATETIME()
        );
      END;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dbo.AiProviderConfigurations
      WHERE ProviderType = 'COMFYUI';

      UPDATE dbo.AiProviderConfigurations
      SET IsDefault = 0
      WHERE Purpose = 'IMAGE';

      DROP INDEX UQ_AiProviderConfigurations_Default ON dbo.AiProviderConfigurations;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_PurposeProvider;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_Purpose;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_ProviderType;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_BaseUrl;
      ALTER TABLE dbo.AiProviderConfigurations DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT DF_AiProviderConfigurations_Purpose;
      ALTER TABLE dbo.AiProviderConfigurations DROP COLUMN Purpose;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI', 'OLLAMA'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
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

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
          CHECK (
            (ProviderType = 'OPENAI' AND TimeoutMs BETWEEN 1000 AND 600000)
            OR
            (ProviderType = 'OLLAMA' AND TimeoutMs BETWEEN 1000 AND 900000)
          );

      CREATE UNIQUE INDEX UQ_AiProviderConfigurations_Default
        ON dbo.AiProviderConfigurations (ProviderType)
        WHERE IsDefault = 1;
    `);
  }
}
