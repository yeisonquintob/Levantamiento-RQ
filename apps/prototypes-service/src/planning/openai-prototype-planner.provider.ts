import { Injectable } from "@nestjs/common";
import { parsePrototypePlan } from "@levantamiento-rq/shared-contracts";
import { AiAnalysisStructuredExecutionClient } from "./ai-analysis-structured-execution.client";
import type {
  PrototypePlannerInput,
  PrototypePlannerOutput,
  PrototypePlannerProvider,
} from "./prototype-planner.provider";
@Injectable()
export class OpenAiPrototypePlannerProvider implements PrototypePlannerProvider {
  constructor(private readonly client: AiAnalysisStructuredExecutionClient) {}
  async plan(input: PrototypePlannerInput): Promise<PrototypePlannerOutput> {
    const result = await this.client.execute(
      {
        purpose: "PROTOTYPE_PLANNING",
        ...(input.providerConfigurationId ? { providerConfigurationId: input.providerConfigurationId } : {}),
        input: { markdown: input.markdown, targetDevice: input.targetDevice },
      },
      input.correlationId,
    );
    return {
      plan: parsePrototypePlan(result.structuredResult, input.targetDevice),
      provider: result.provider,
      model: result.model,
      executionId: result.executionId,
    };
  }
}
