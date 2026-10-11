import type {
  PrototypeImageProviderCode,
  PrototypeVisualDevice,
} from "@levantamiento-rq/shared-contracts";
import type { PrototypeProviderImageSize } from "./prototype-image-size.mapper";

export const PROTOTYPE_IMAGE_PROVIDER = Symbol("PROTOTYPE_IMAGE_PROVIDER");
export interface PrototypeImageProviderInput {
  providerConfigurationId?: string;
  prompt: string;
  device: PrototypeVisualDevice;
  requestedSize: PrototypeProviderImageSize;
  correlationId: string;
}
export interface PrototypeGeneratedImageResult {
  provider: PrototypeImageProviderCode;
  model: string;
  mediaType: "image/png";
  imageBase64: string;
  executionId: string;
}
export interface PrototypeImageProvider {
  generate(
    input: PrototypeImageProviderInput,
  ): Promise<PrototypeGeneratedImageResult>;
}
export class PrototypeImageProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PrototypeImageProviderError";
  }
}
