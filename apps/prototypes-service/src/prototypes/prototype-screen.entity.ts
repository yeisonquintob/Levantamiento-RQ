import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import type {
  PrototypeScreenOrigin,
  PrototypeScreenStatus,
  PrototypeTargetDevice,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "PrototypeScreens" })
@Index("UX_PrototypeScreens_GenerationId_Order", ["generationId", "order"], {
  unique: true,
})
export class PrototypeScreenEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "GenerationId" }) generationId!: string;
  @Column("int", { name: "ScreenOrder" }) order!: number;
  @Column("nvarchar", { name: "Code", length: 100 }) code!: string;
  @Column("nvarchar", { name: "Name", length: 200 }) name!: string;
  @Column("nvarchar", { name: "Objective", length: 2000 }) objective!: string;
  @Column("nvarchar", { name: "Origin", length: 16 })
  origin!: PrototypeScreenOrigin;
  @Column("nvarchar", { name: "Route", length: 500, nullable: true })
  route!: string | null;
  @Column("nvarchar", { name: "ComponentsJson", length: "MAX" })
  componentsJson!: string;
  @Column("nvarchar", { name: "Device", length: 16 })
  device!: PrototypeTargetDevice;
  @Column("nvarchar", { name: "Status", length: 24 })
  status!: PrototypeScreenStatus;
  @Column("nvarchar", { name: "ImageStorageKey", length: 700, nullable: true })
  imageStorageKey!: string | null;
}
