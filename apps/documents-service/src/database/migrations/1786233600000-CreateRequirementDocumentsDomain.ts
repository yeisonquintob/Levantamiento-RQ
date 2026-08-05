import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRequirementDocumentsDomain1786233600000
  implements MigrationInterface
{
  name = "CreateRequirementDocumentsDomain1786233600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.AppliedDocumentTemplates (
        Id uniqueidentifier NOT NULL,
        SourceTemplateId uniqueidentifier NOT NULL,
        Code nvarchar(40) NOT NULL,
        Name nvarchar(200) NOT NULL,
        Version nvarchar(32) NOT NULL,
        TemplateType nvarchar(40) NOT NULL,
        DefinitionJson nvarchar(max) NOT NULL,
        AppliedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_AppliedDocumentTemplates PRIMARY KEY (Id),
        CONSTRAINT CK_AppliedDocumentTemplates_DefinitionJson CHECK (ISJSON(DefinitionJson) = 1)
      );
      CREATE INDEX IX_AppliedDocumentTemplates_SourceTemplateId
        ON dbo.AppliedDocumentTemplates (SourceTemplateId);

      CREATE TABLE dbo.RequirementDocuments (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        AppliedTemplateId uniqueidentifier NOT NULL,
        Title nvarchar(240) NOT NULL,
        Status nvarchar(24) NOT NULL,
        Revision int NOT NULL,
        CurrentVersionNumber int NOT NULL,
        CreatedByUserId uniqueidentifier NOT NULL,
        UpdatedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL,
        ArchivedByUserId uniqueidentifier NULL,
        ArchivedAt datetime2(7) NULL,
        CONSTRAINT PK_RequirementDocuments PRIMARY KEY (Id),
        CONSTRAINT FK_RequirementDocuments_AppliedTemplate
          FOREIGN KEY (AppliedTemplateId) REFERENCES dbo.AppliedDocumentTemplates(Id),
        CONSTRAINT CK_RequirementDocuments_Status
          CHECK (Status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED')),
        CONSTRAINT CK_RequirementDocuments_Revision CHECK (Revision > 0),
        CONSTRAINT CK_RequirementDocuments_CurrentVersion CHECK (CurrentVersionNumber > 0)
      );
      CREATE INDEX IX_RequirementDocuments_ProjectId_UpdatedAt
        ON dbo.RequirementDocuments (ProjectId, UpdatedAt DESC);
      CREATE INDEX IX_RequirementDocuments_Status
        ON dbo.RequirementDocuments (Status);

      CREATE TABLE dbo.DocumentVersions (
        Id uniqueidentifier NOT NULL,
        DocumentId uniqueidentifier NOT NULL,
        VersionNumber int NOT NULL,
        Version nvarchar(32) NOT NULL,
        Status nvarchar(24) NOT NULL,
        Revision int NOT NULL,
        ChangeSummary nvarchar(1000) NOT NULL,
        CreatedByUserId uniqueidentifier NOT NULL,
        UpdatedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL,
        ApprovedByUserId uniqueidentifier NULL,
        ApprovedAt datetime2(7) NULL,
        RejectedByUserId uniqueidentifier NULL,
        RejectedAt datetime2(7) NULL,
        CONSTRAINT PK_DocumentVersions PRIMARY KEY (Id),
        CONSTRAINT FK_DocumentVersions_Document
          FOREIGN KEY (DocumentId) REFERENCES dbo.RequirementDocuments(Id) ON DELETE CASCADE,
        CONSTRAINT CK_DocumentVersions_Status
          CHECK (Status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED')),
        CONSTRAINT CK_DocumentVersions_Revision CHECK (Revision > 0),
        CONSTRAINT CK_DocumentVersions_Number CHECK (VersionNumber > 0),
        CONSTRAINT UQ_DocumentVersions_DocumentId_Number UNIQUE (DocumentId, VersionNumber)
      );
      CREATE INDEX IX_DocumentVersions_DocumentId_Status
        ON dbo.DocumentVersions (DocumentId, Status);

      CREATE TABLE dbo.DocumentSections (
        Id uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        SectionKey nvarchar(64) NOT NULL,
        Title nvarchar(200) NOT NULL,
        OrderIndex int NOT NULL,
        ContentJson nvarchar(max) NOT NULL,
        TemplateControlled bit NOT NULL,
        CONSTRAINT PK_DocumentSections PRIMARY KEY (Id),
        CONSTRAINT FK_DocumentSections_Version
          FOREIGN KEY (DocumentVersionId) REFERENCES dbo.DocumentVersions(Id) ON DELETE CASCADE,
        CONSTRAINT CK_DocumentSections_ContentJson CHECK (ISJSON(ContentJson) = 1),
        CONSTRAINT CK_DocumentSections_Order CHECK (OrderIndex BETWEEN 1 AND 13),
        CONSTRAINT UQ_DocumentSections_Version_Key UNIQUE (DocumentVersionId, SectionKey),
        CONSTRAINT UQ_DocumentSections_Version_Order UNIQUE (DocumentVersionId, OrderIndex)
      );

      CREATE TABLE dbo.DocumentFields (
        Id uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        SectionKey nvarchar(64) NOT NULL,
        FieldKey nvarchar(100) NOT NULL,
        Label nvarchar(200) NOT NULL,
        ValueType nvarchar(40) NOT NULL,
        ValueJson nvarchar(max) NOT NULL,
        OrderIndex int NOT NULL,
        CONSTRAINT PK_DocumentFields PRIMARY KEY (Id),
        CONSTRAINT FK_DocumentFields_Version
          FOREIGN KEY (DocumentVersionId) REFERENCES dbo.DocumentVersions(Id) ON DELETE CASCADE,
        CONSTRAINT CK_DocumentFields_ValueJson CHECK (ISJSON(ValueJson) = 1),
        CONSTRAINT UQ_DocumentFields_Version_Section_Key
          UNIQUE (DocumentVersionId, SectionKey, FieldKey)
      );

      CREATE TABLE dbo.DocumentRequirements (
        Id uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        SectionKey nvarchar(64) NOT NULL,
        Code nvarchar(40) NOT NULL,
        Title nvarchar(240) NOT NULL,
        Description nvarchar(max) NOT NULL,
        RequirementType nvarchar(40) NOT NULL,
        Status nvarchar(40) NOT NULL,
        OrderIndex int NOT NULL,
        CONSTRAINT PK_DocumentRequirements PRIMARY KEY (Id),
        CONSTRAINT FK_DocumentRequirements_Version
          FOREIGN KEY (DocumentVersionId) REFERENCES dbo.DocumentVersions(Id) ON DELETE CASCADE,
        CONSTRAINT UQ_DocumentRequirements_Version_Code UNIQUE (DocumentVersionId, Code)
      );

      CREATE TABLE dbo.AcceptanceCriteria (
        Id uniqueidentifier NOT NULL,
        RequirementId uniqueidentifier NOT NULL,
        Description nvarchar(2000) NOT NULL,
        OrderIndex int NOT NULL,
        CONSTRAINT PK_AcceptanceCriteria PRIMARY KEY (Id),
        CONSTRAINT FK_AcceptanceCriteria_Requirement
          FOREIGN KEY (RequirementId) REFERENCES dbo.DocumentRequirements(Id) ON DELETE CASCADE
      );
      CREATE INDEX IX_AcceptanceCriteria_Requirement_Order
        ON dbo.AcceptanceCriteria (RequirementId, OrderIndex);

      CREATE TABLE dbo.DocumentEvidence (
        Id uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        SourceId uniqueidentifier NOT NULL,
        SectionKey nvarchar(64) NULL,
        RequirementId uniqueidentifier NULL,
        Excerpt nvarchar(4000) NULL,
        Note nvarchar(2000) NULL,
        CONSTRAINT PK_DocumentEvidence PRIMARY KEY (Id),
        CONSTRAINT FK_DocumentEvidence_Version
          FOREIGN KEY (DocumentVersionId) REFERENCES dbo.DocumentVersions(Id) ON DELETE CASCADE,
        CONSTRAINT FK_DocumentEvidence_Requirement
          FOREIGN KEY (RequirementId) REFERENCES dbo.DocumentRequirements(Id)
      );
      CREATE INDEX IX_DocumentEvidence_Version_Source
        ON dbo.DocumentEvidence (DocumentVersionId, SourceId);

      CREATE TABLE dbo.DocumentHistory (
        Id uniqueidentifier NOT NULL,
        DocumentId uniqueidentifier NOT NULL,
        VersionId uniqueidentifier NULL,
        EventType nvarchar(80) NOT NULL,
        ActorUserId uniqueidentifier NOT NULL,
        DetailsJson nvarchar(max) NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_DocumentHistory PRIMARY KEY (Id),
        CONSTRAINT FK_DocumentHistory_Document
          FOREIGN KEY (DocumentId) REFERENCES dbo.RequirementDocuments(Id) ON DELETE CASCADE,
        CONSTRAINT CK_DocumentHistory_DetailsJson CHECK (ISJSON(DetailsJson) = 1)
      );
      CREATE INDEX IX_DocumentHistory_Document_CreatedAt
        ON dbo.DocumentHistory (DocumentId, CreatedAt DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE dbo.DocumentHistory;
      DROP TABLE dbo.DocumentEvidence;
      DROP TABLE dbo.AcceptanceCriteria;
      DROP TABLE dbo.DocumentRequirements;
      DROP TABLE dbo.DocumentFields;
      DROP TABLE dbo.DocumentSections;
      DROP TABLE dbo.DocumentVersions;
      DROP TABLE dbo.RequirementDocuments;
      DROP TABLE dbo.AppliedDocumentTemplates;
    `);
  }
}
