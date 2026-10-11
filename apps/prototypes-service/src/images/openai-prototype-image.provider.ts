import { Injectable } from "@nestjs/common";
import type {
  PrototypeImageProvider,
  PrototypeImageProviderInput,
  PrototypeGeneratedImageResult,
} from "./prototype-image.provider";
import { AiAnalysisImageGenerationClient } from "./ai-analysis-image-generation.client";

@Injectable()
export class OpenAiPrototypeImageProvider implements PrototypeImageProvider {
  constructor(private readonly client: AiAnalysisImageGenerationClient) {}
  generate(
    input: PrototypeImageProviderInput,
  ): Promise<PrototypeGeneratedImageResult> {
    return this.client.generate(
      {
        purpose: "PROTOTYPE_IMAGE_GENERATION",
        ...(input.providerConfigurationId ? { providerConfigurationId: input.providerConfigurationId } : {}),
        prompt: input.prompt,
        device: input.device,
        requestedSize: input.requestedSize,
      },
      input.correlationId,
    );
  }
}
