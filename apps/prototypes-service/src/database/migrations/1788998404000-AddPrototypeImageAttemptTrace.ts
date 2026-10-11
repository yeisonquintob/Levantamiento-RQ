import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrototypeImageAttemptTrace1788998404000 implements MigrationInterface {
  name = "AddPrototypeImageAttemptTrace1788998404000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dbo.PrototypeGeneratedImages
      ADD AttemptNumber int NOT NULL CONSTRAINT DF_PrototypeGeneratedImages_AttemptNumber DEFAULT (1),
          PreviousProvider nvarchar(40) NULL,
          PreviousModel nvarchar(120) NULL,
          PreviousStatus nvarchar(16) NULL,
          PreviousStorageKey nvarchar(700) NULL,
          PreviousCompletedAt datetime2(7) NULL;`);
    await queryRunner.query(
      "ALTER TABLE dbo.PrototypeGeneratedImages ADD CONSTRAINT CK_PrototypeGeneratedImages_AttemptNumber CHECK (AttemptNumber >= 1);",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dbo.PrototypeGeneratedImages DROP CONSTRAINT CK_PrototypeGeneratedImages_AttemptNumber;
      ALTER TABLE dbo.PrototypeGeneratedImages DROP CONSTRAINT DF_PrototypeGeneratedImages_AttemptNumber;
      ALTER TABLE dbo.PrototypeGeneratedImages DROP COLUMN PreviousCompletedAt, PreviousStorageKey, PreviousStatus, PreviousModel, PreviousProvider, AttemptNumber;`);
  }
}
