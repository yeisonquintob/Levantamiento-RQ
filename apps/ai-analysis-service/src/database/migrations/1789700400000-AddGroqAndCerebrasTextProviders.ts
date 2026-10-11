import type { MigrationInterface, QueryRunner } from "typeorm";

// Añade Groq y Cerebras como proveedores de texto en la nube con endpoints
// oficiales fijos, y permite registrarlos como proveedor de ejecución.
export class AddGroqAndCerebrasTextProviders1789700400000 implements MigrationInterface {
  name = "AddGroqAndCerebrasTextProviders1789700400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropConstraints(queryRunner);
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI', 'ANTHROPIC', 'GEMINI', 'GROQ', 'CEREBRAS', 'OLLAMA', 'OPENAI_COMPATIBLE', 'COMFYUI', 'OLLAMA_IMAGES'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_PurposeProvider
          CHECK (
            (Purpose = 'TEXT' AND ProviderType IN ('OPENAI', 'ANTHROPIC', 'GEMINI', 'GROQ', 'CEREBRAS', 'OLLAMA', 'OPENAI_COMPATIBLE'))
            OR
            (Purpose = 'IMAGE' AND ProviderType IN ('OPENAI', 'COMFYUI', 'OLLAMA_IMAGES'))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
          CHECK (
            (ProviderType = 'OPENAI' AND BaseUrl = 'https://api.openai.com/v1')
            OR
            (ProviderType = 'ANTHROPIC' AND BaseUrl = 'https://api.anthropic.com/v1')
            OR
            (ProviderType = 'GEMINI' AND BaseUrl = 'https://generativelanguage.googleapis.com/v1beta')
            OR
            (ProviderType = 'GROQ' AND BaseUrl = 'https://api.groq.com/openai/v1')
            OR
            (ProviderType = 'CEREBRAS' AND BaseUrl = 'https://api.cerebras.ai/v1')
            OR
            (ProviderType IN ('OLLAMA', 'OLLAMA_IMAGES', 'OPENAI_COMPATIBLE') AND BaseUrl LIKE 'http://%')
            OR
            (ProviderType = 'COMFYUI' AND (
              BaseUrl LIKE 'http://127.0.0.1:%'
              OR BaseUrl LIKE 'http://localhost:%'
              OR BaseUrl LIKE 'http://[[]::1]:%'
              OR BaseUrl LIKE 'http://host.docker.internal:%'
            ))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
          CHECK (
            (ProviderType IN ('OPENAI', 'ANTHROPIC', 'GEMINI', 'GROQ', 'CEREBRAS') AND TimeoutMs BETWEEN 1000 AND 600000)
            OR
            (ProviderType IN ('OLLAMA', 'OPENAI_COMPATIBLE', 'COMFYUI', 'OLLAMA_IMAGES') AND TimeoutMs BETWEEN 1000 AND 900000)
          );

      ALTER TABLE dbo.AnalysisExecutions DROP CONSTRAINT CK_AnalysisExecutions_Provider;
      ALTER TABLE dbo.AnalysisExecutions ADD CONSTRAINT CK_AnalysisExecutions_Provider
        CHECK (Provider IN ('DISABLED', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'GROQ', 'CEREBRAS', 'OLLAMA', 'FAKE'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Las ejecuciones históricas conservan su fila; solo se normaliza el código.
    // Los proveedores nuevos se deshabilitan y se eliminan antes de restaurar.
    await queryRunner.query(`
      UPDATE dbo.AnalysisExecutions
        SET Provider = 'DISABLED'
        WHERE Provider IN ('GROQ', 'CEREBRAS');

      UPDATE dbo.AiProviderConfigurations
        SET IsEnabled = 0, IsDefault = 0
        WHERE ProviderType IN ('GROQ', 'CEREBRAS');

      DELETE FROM dbo.AiProviderConfigurations
        WHERE ProviderType IN ('GROQ', 'CEREBRAS');

      ALTER TABLE dbo.AnalysisExecutions DROP CONSTRAINT CK_AnalysisExecutions_Provider;
      ALTER TABLE dbo.AnalysisExecutions ADD CONSTRAINT CK_AnalysisExecutions_Provider
        CHECK (Provider IN ('DISABLED', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA', 'FAKE'));
    `);
    await this.dropConstraints(queryRunner);
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA', 'OPENAI_COMPATIBLE', 'COMFYUI', 'OLLAMA_IMAGES'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_PurposeProvider
          CHECK (
            (Purpose = 'TEXT' AND ProviderType IN ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA', 'OPENAI_COMPATIBLE'))
            OR
            (Purpose = 'IMAGE' AND ProviderType IN ('OPENAI', 'COMFYUI', 'OLLAMA_IMAGES'))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
          CHECK (
            (ProviderType = 'OPENAI' AND BaseUrl = 'https://api.openai.com/v1')
            OR
            (ProviderType = 'ANTHROPIC' AND BaseUrl = 'https://api.anthropic.com/v1')
            OR
            (ProviderType = 'GEMINI' AND BaseUrl = 'https://generativelanguage.googleapis.com/v1beta')
            OR
            (ProviderType IN ('OLLAMA', 'OLLAMA_IMAGES', 'OPENAI_COMPATIBLE') AND BaseUrl LIKE 'http://%')
            OR
            (ProviderType = 'COMFYUI' AND (
              BaseUrl LIKE 'http://127.0.0.1:%'
              OR BaseUrl LIKE 'http://localhost:%'
              OR BaseUrl LIKE 'http://[[]::1]:%'
              OR BaseUrl LIKE 'http://host.docker.internal:%'
            ))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_TimeoutMs
          CHECK (
            (ProviderType IN ('OPENAI', 'ANTHROPIC', 'GEMINI') AND TimeoutMs BETWEEN 1000 AND 600000)
            OR
            (ProviderType IN ('OLLAMA', 'OPENAI_COMPATIBLE', 'COMFYUI', 'OLLAMA_IMAGES') AND TimeoutMs BETWEEN 1000 AND 900000)
          );
    `);
  }

  private async dropConstraints(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT CK_AiProviderConfigurations_PurposeProvider;
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT CK_AiProviderConfigurations_ProviderType;
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT CK_AiProviderConfigurations_BaseUrl;
      ALTER TABLE dbo.AiProviderConfigurations
        DROP CONSTRAINT CK_AiProviderConfigurations_TimeoutMs;
    `);
  }
}
