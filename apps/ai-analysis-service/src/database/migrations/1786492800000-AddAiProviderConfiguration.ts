import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiProviderConfiguration1786492800000 implements MigrationInterface {
  name = "AddAiProviderConfiguration1786492800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisExecutions
        DROP CONSTRAINT CK_AnalysisExecutions_Provider;

      ALTER TABLE dbo.AnalysisExecutions
        ADD CONSTRAINT CK_AnalysisExecutions_Provider
        CHECK (Provider IN ('DISABLED', 'OPENAI', 'FAKE'));

      CREATE TABLE dbo.AiProviderConfigurations (
        Id uniqueidentifier NOT NULL,
        Name nvarchar(120) NOT NULL,
        ProviderType nvarchar(40) NOT NULL,
        Model nvarchar(120) NOT NULL,
        BaseUrl nvarchar(300) NOT NULL,
        IsEnabled bit NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_IsEnabled DEFAULT 0,
        IsDefault bit NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_IsDefault DEFAULT 0,
        TimeoutMs int NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_TimeoutMs DEFAULT 60000,
        MaxInputTokens int NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_MaxInputTokens DEFAULT 120000,
        MaxOutputTokens int NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_MaxOutputTokens DEFAULT 12000,
        MaxAttempts int NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_MaxAttempts DEFAULT 3,
        SecretReference nvarchar(200) NOT NULL,
        LastConnectionTestAt datetime2(7) NULL,
        LastConnectionTestStatus nvarchar(24) NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_TestStatus DEFAULT 'NOT_TESTED',
        LastErrorCode nvarchar(100) NULL,
        CreatedByUserId uniqueidentifier NOT NULL,
        UpdatedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AiProviderConfigurations_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiProviderConfigurations PRIMARY KEY (Id),
        CONSTRAINT UQ_AiProviderConfigurations_Name UNIQUE (Name),
        CONSTRAINT UQ_AiProviderConfigurations_SecretReference UNIQUE (SecretReference),
        CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI')),
        CONSTRAINT CK_AiProviderConfigurations_BaseUrl
          CHECK (BaseUrl = 'https://api.openai.com/v1'),
        CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
          CHECK (TimeoutMs BETWEEN 1000 AND 300000),
        CONSTRAINT CK_AiProviderConfigurations_MaxInputTokens
          CHECK (MaxInputTokens BETWEEN 1000 AND 1000000),
        CONSTRAINT CK_AiProviderConfigurations_MaxOutputTokens
          CHECK (MaxOutputTokens BETWEEN 100 AND 128000),
        CONSTRAINT CK_AiProviderConfigurations_MaxAttempts
          CHECK (MaxAttempts BETWEEN 1 AND 10),
        CONSTRAINT CK_AiProviderConfigurations_TestStatus
          CHECK (LastConnectionTestStatus IN ('NOT_TESTED', 'SUCCEEDED', 'FAILED')),
        CONSTRAINT CK_AiProviderConfigurations_DefaultEnabled
          CHECK (IsDefault = 0 OR IsEnabled = 1)
      );

      CREATE INDEX IX_AiProviderConfigurations_Enabled_Default
        ON dbo.AiProviderConfigurations (IsEnabled, IsDefault);

      CREATE UNIQUE INDEX UQ_AiProviderConfigurations_Default
        ON dbo.AiProviderConfigurations (IsDefault)
        WHERE IsDefault = 1;

      CREATE TABLE dbo.AiProviderAuditEvents (
        Id uniqueidentifier NOT NULL,
        ProviderConfigurationId uniqueidentifier NULL,
        Action nvarchar(40) NOT NULL,
        ActorUserId uniqueidentifier NOT NULL,
        CorrelationId nvarchar(100) NOT NULL,
        Outcome nvarchar(24) NOT NULL,
        MetadataJson nvarchar(2000) NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AiProviderAuditEvents_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiProviderAuditEvents PRIMARY KEY (Id),
        CONSTRAINT FK_AiProviderAuditEvents_Provider
          FOREIGN KEY (ProviderConfigurationId)
          REFERENCES dbo.AiProviderConfigurations(Id)
          ON DELETE SET NULL,
        CONSTRAINT CK_AiProviderAuditEvents_Outcome
          CHECK (Outcome IN ('SUCCEEDED', 'FAILED'))
      );

      CREATE INDEX IX_AiProviderAuditEvents_Provider_CreatedAt
        ON dbo.AiProviderAuditEvents (ProviderConfigurationId, CreatedAt DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE dbo.AiProviderAuditEvents;
      DROP TABLE dbo.AiProviderConfigurations;

      ALTER TABLE dbo.AnalysisExecutions
        DROP CONSTRAINT CK_AnalysisExecutions_Provider;

      ALTER TABLE dbo.AnalysisExecutions
        ADD CONSTRAINT CK_AnalysisExecutions_Provider
        CHECK (Provider IN ('DISABLED'));
    `);
  }
}
