import { omitKey } from "../common/require-defined";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import type { AuthenticatedUser, ViabilityConfiguration, ViabilityCriterion } from "@levantamiento-rq/shared-contracts";
import { validateViabilityCriteria } from "@levantamiento-rq/shared-contracts";
import { ViabilityCriterionEntity } from "./viability-criterion.entity";
import { ViabilitySettingEntity } from "./viability-setting.entity";

@Injectable()
export class ViabilityCriteriaService {
  constructor(
    @InjectRepository(ViabilityCriterionEntity) private readonly criteria: Repository<ViabilityCriterionEntity>,
    @InjectRepository(ViabilitySettingEntity) private readonly settings: Repository<ViabilitySettingEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async get(): Promise<ViabilityConfiguration> {
    const [criteria, threshold] = await Promise.all([
      this.criteria.find({ order: { order: "ASC" } }),
      this.settings.findOneBy({ key: "discrepancyThreshold" }),
    ]);
    return { criteria: criteria.map((item) => omitKey(omitKey(item, "createdAt"), "updatedAt")), discrepancyThreshold: threshold?.integerValue ?? 25 };
  }

  async update(actor: AuthenticatedUser, input: unknown): Promise<ViabilityConfiguration> {
    if (!actor.permissions.includes("system.admin")) throw new ForbiddenException("Solo un administrador puede configurar criterios de viabilidad.");
    if (!input || typeof input !== "object") throw new ConflictException("La configuración no es válida.");
    const body = input as { criteria?: unknown; discrepancyThreshold?: unknown };
    if (!Array.isArray(body.criteria)) throw new ConflictException("Los criterios son obligatorios.");
    const criteria = body.criteria.map((raw, index) => this.parseCriterion(raw, index));
    const threshold = Number(body.discrepancyThreshold);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) throw new ConflictException("El umbral de discrepancia debe estar entre 0 y 100.");
    const errors = validateViabilityCriteria(criteria);
    if (errors.length) throw new ConflictException(errors.join(" "));
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ViabilityCriterionEntity, {});
      await manager.save(ViabilityCriterionEntity, criteria.map((item) => manager.create(ViabilityCriterionEntity, { ...item, createdAt: now, updatedAt: now })));
      await manager.save(ViabilitySettingEntity, manager.create(ViabilitySettingEntity, { key: "discrepancyThreshold", integerValue: threshold, updatedAt: now }));
    });
    return this.get();
  }

  private parseCriterion(raw: unknown, index: number): ViabilityCriterion {
    const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const text = (name: string) => typeof value[name] === "string" ? value[name].trim() : "";
    return {
      id: text("id") || randomUUID(), level: Number(value.level), minimumPercentage: Number(value.minimumPercentage), maximumPercentage: Number(value.maximumPercentage),
      name: text("name"), description: text("description"), recommendation: text("recommendation"), viable: value.viable === true,
      order: Number.isInteger(Number(value.order)) ? Number(value.order) : index, active: value.active !== false,
    };
  }
}
