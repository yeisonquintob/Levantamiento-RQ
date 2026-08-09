import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "AiProviderAuditEvents" })
@Index("IX_AiProviderAuditEvents_Provider_CreatedAt", [
  "providerConfigurationId",
  "createdAt",
])
export class AiProviderAuditEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", {
    name: "ProviderConfigurationId",
    nullable: true,
  })
  providerConfigurationId!: string | null;

  @Column("nvarchar", { name: "Action", length: 40 })
  action!: string;

  @Column("uniqueidentifier", { name: "ActorUserId" })
  actorUserId!: string;

  @Column("nvarchar", { name: "CorrelationId", length: 100 })
  correlationId!: string;

  @Column("nvarchar", { name: "Outcome", length: 24 })
  outcome!: string;

  @Column("nvarchar", { name: "MetadataJson", length: 2000, nullable: true })
  metadataJson!: string | null;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;
}
