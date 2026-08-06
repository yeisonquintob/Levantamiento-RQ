import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity({ name: "AnalysisRequestSources" })
@Index(
  "UQ_AnalysisRequestSources_Request_Source",
  ["analysisRequestId", "sourceId"],
  { unique: true },
)
@Index("IX_AnalysisRequestSources_SourceId", ["sourceId"])
export class AnalysisRequestSourceEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "AnalysisRequestId" })
  analysisRequestId!: string;

  @Column("uniqueidentifier", { name: "SourceId" })
  sourceId!: string;

  @Column("datetime2", {
    name: "SourceUpdatedAt",
    precision: 7,
  })
  sourceUpdatedAt!: Date;

  @Column("char", {
    name: "SourceSha256",
    length: 64,
    nullable: true,
  })
  sourceSha256!: string | null;

  @Column("int", { name: "Position" })
  position!: number;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;
}
