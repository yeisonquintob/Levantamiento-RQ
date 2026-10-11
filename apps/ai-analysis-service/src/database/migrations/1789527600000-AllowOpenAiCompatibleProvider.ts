import type { MigrationInterface, QueryRunner } from "typeorm";

// Añade el tipo OPENAI_COMPATIBLE (llama.cpp / llama-swap) y permite que los
// proveedores Ollama / OpenAI-compatible apunten a un equipo de la red local.
// La API valida el host (IPv4 privada, VPN 100.64/10 o `.local`); la base de
// datos solo exige HTTP para esos tipos. ComfyUI sigue limitado a loopback.
export class AllowOpenAiCompatibleProvider1789527600000
  implements MigrationInterface
{
  name = "AllowOpenAiCompatibleProvider1789527600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropConstraints(queryRunner);
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI', 'OLLAMA', 'OPENAI_COMPATIBLE', 'COMFYUI', 'OLLAMA_IMAGES'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_PurposeProvider
          CHECK (
            (Purpose = 'TEXT' AND ProviderType IN ('OPENAI', 'OLLAMA', 'OPENAI_COMPATIBLE'))
            OR
            (Purpose = 'IMAGE' AND ProviderType IN ('OPENAI', 'COMFYUI', 'OLLAMA_IMAGES'))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
          CHECK (
            (ProviderType = 'OPENAI' AND BaseUrl = 'https://api.openai.com/v1')
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
            (ProviderType = 'OPENAI' AND TimeoutMs BETWEEN 1000 AND 600000)
            OR
            (ProviderType IN ('OLLAMA', 'OPENAI_COMPATIBLE', 'COMFYUI', 'OLLAMA_IMAGES') AND TimeoutMs BETWEEN 1000 AND 900000)
          );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM dbo.AiProviderConfigurations
      WHERE ProviderType = 'OPENAI_COMPATIBLE';
    `);
    await this.dropConstraints(queryRunner);
    await queryRunner.query(`
      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_ProviderType
          CHECK (ProviderType IN ('OPENAI', 'OLLAMA', 'COMFYUI', 'OLLAMA_IMAGES'));

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_PurposeProvider
          CHECK (
            (Purpose = 'TEXT' AND ProviderType IN ('OPENAI', 'OLLAMA'))
            OR
            (Purpose = 'IMAGE' AND ProviderType IN ('OPENAI', 'COMFYUI', 'OLLAMA_IMAGES'))
          );

      ALTER TABLE dbo.AiProviderConfigurations
        ADD CONSTRAINT CK_AiProviderConfigurations_BaseUrl
          CHECK (
            (ProviderType = 'OPENAI' AND BaseUrl = 'https://api.openai.com/v1')
            OR
            (ProviderType IN ('OLLAMA', 'COMFYUI', 'OLLAMA_IMAGES') AND (
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
            (ProviderType IN ('OLLAMA', 'COMFYUI', 'OLLAMA_IMAGES') AND TimeoutMs BETWEEN 1000 AND 900000)
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
