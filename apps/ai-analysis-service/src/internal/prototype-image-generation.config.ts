export const PROTOTYPE_IMAGE_GENERATION_CONFIG = Symbol(
  "PROTOTYPE_IMAGE_GENERATION_CONFIG",
);
export interface PrototypeImageGenerationConfig {
  model: string;
  quality: "low" | "medium" | "high";
  timeoutMs: number;
  maxBase64Chars: number;
}
function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const result = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${name} debe estar entre ${min} y ${max}.`);
  return result;
}
export function loadPrototypeImageGenerationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PrototypeImageGenerationConfig {
  const model =
    environment.PROTOTYPE_IMAGE_MODEL?.trim() || "gpt-image-2.5-flare";
  const quality = environment.PROTOTYPE_IMAGE_QUALITY?.trim() || "medium";
  if (!["low", "medium", "high"].includes(quality))
    throw new Error("PROTOTYPE_IMAGE_QUALITY no es válido.");
  return {
    model,
    quality: quality as PrototypeImageGenerationConfig["quality"],
    timeoutMs: integer(
      environment.PROTOTYPE_IMAGE_TIMEOUT_MS,
      600_000,
      10_000,
      900_000,
      "PROTOTYPE_IMAGE_TIMEOUT_MS",
    ),
    maxBase64Chars: integer(
      environment.PROTOTYPE_IMAGE_MAX_BASE64_CHARS,
      30_000_000,
      1024,
      70_000_000,
      "PROTOTYPE_IMAGE_MAX_BASE64_CHARS",
    ),
  };
}
