import type {
  PrototypePlan,
  PrototypeTargetDevice,
} from "@levantamiento-rq/shared-contracts";
export interface PrototypePlannerInput {
  providerConfigurationId?: string;
  markdown: string;
  targetDevice: PrototypeTargetDevice;
  correlationId: string;
}
export interface PrototypePlannerOutput {
  plan: PrototypePlan;
  provider: "OPENAI" | "OLLAMA";
  model: string;
  executionId: string;
}
export interface PrototypePlannerProvider {
  plan(input: PrototypePlannerInput): Promise<PrototypePlannerOutput>;
}
export const PROTOTYPE_PLANNER_PROVIDER = Symbol("PROTOTYPE_PLANNER_PROVIDER");

export class PrototypePlannerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PrototypePlannerError";
  }
}
