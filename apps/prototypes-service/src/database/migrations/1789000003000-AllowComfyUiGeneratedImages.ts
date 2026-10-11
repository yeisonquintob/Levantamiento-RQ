import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowComfyUiGeneratedImages1789000003000
  implements MigrationInterface
{
  name = "AllowComfyUiGeneratedImages1789000003000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.PrototypeGeneratedImages
        DROP CONSTRAINT CK_PrototypeGeneratedImages_Provider;
      ALTER TABLE dbo.PrototypeGeneratedImages
        ADD CONSTRAINT CK_PrototypeGeneratedImages_Provider
        CHECK (Provider IN ('OPENAI_IMAGES','COMFYUI','OTHER'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dbo.PrototypeGeneratedImages
        SET Provider = 'OTHER'
        WHERE Provider = 'COMFYUI';
      ALTER TABLE dbo.PrototypeGeneratedImages
        DROP CONSTRAINT CK_PrototypeGeneratedImages_Provider;
      ALTER TABLE dbo.PrototypeGeneratedImages
        ADD CONSTRAINT CK_PrototypeGeneratedImages_Provider
        CHECK (Provider IN ('OPENAI_IMAGES','OTHER'));
    `);
  }
}
