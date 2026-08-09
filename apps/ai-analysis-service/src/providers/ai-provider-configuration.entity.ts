import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import type {
  AiProviderConfigurationType,
  AiProviderTestStatus,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "AiProviderConfigurations" })
@Index("UQ_AiProviderConfigurations_Name", ["name"], { unique: true })
@Index("IX_AiProviderConfigurations_Enabled_Default", [
  "isEnabled",
  "isDefault",
])
export class AiProviderConfigurationEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Name", length: 120 })
  name!: string;

  @Column("nvarchar", { name: "ProviderType", length: 40 })
  providerType!: AiProviderConfigurationType;

  @Column("nvarchar", { name: "Model", length: 120 })
  model!: string;

  @Column("nvarchar", { name: "BaseUrl", length: 300 })
  baseUrl!: string;

  @Column("bit", { name: "IsEnabled", default: false })
  isEnabled!: boolean;

  @Column("bit", { name: "IsDefault", default: false })
  isDefault!: boolean;

  @Column("int", { name: "TimeoutMs", default: 60000 })
  timeoutMs!: number;

  @Column("int", { name: "MaxInputTokens", default: 120000 })
  maxInputTokens!: number;

  @Column("int", { name: "MaxOutputTokens", default: 12000 })
  maxOutputTokens!: number;

  @Column("int", { name: "MaxAttempts", default: 3 })
  maxAttempts!: number;

  @Column("nvarchar", { name: "SecretReference", length: 200 })
  secretReference!: string;

  @Column("datetime2", {
    name: "LastConnectionTestAt",
    precision: 7,
    nullable: true,
  })
  lastConnectionTestAt!: Date | null;

  @Column("nvarchar", {
    name: "LastConnectionTestStatus",
    length: 24,
    default: "NOT_TESTED",
  })
  lastConnectionTestStatus!: AiProviderTestStatus;

  @Column("nvarchar", { name: "LastErrorCode", length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column("uniqueidentifier", { name: "CreatedByUserId" })
  createdByUserId!: string;

  @Column("uniqueidentifier", { name: "UpdatedByUserId" })
  updatedByUserId!: string;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;

  @Column("datetime2", {
    name: "UpdatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  updatedAt!: Date;
}
