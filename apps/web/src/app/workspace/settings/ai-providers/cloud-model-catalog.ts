// Catálogo local y curado de modelos de texto recomendados para los proveedores
// cloud. No consulta a ningún proveedor ni usa claves: es una referencia
// visible aunque aún no exista un registro. El costo se expresa como condición
// de acceso (sin precios ni cuotas) y siempre remite a la página oficial.

export type CloudProviderFamily = "CLAUDE" | "GEMINI" | "GROQ" | "CEREBRAS";
export type CloudCostCondition = "FREE_LIMITED" | "PAID";

export interface CloudModelRecommendation {
  readonly id: string;
  readonly name: string;
  readonly usage: string;
  readonly cost: CloudCostCondition;
  readonly costLabel: string;
  readonly costNotice: string;
  readonly pricingUrl: string;
  readonly verifiedAt: string;
}

export const CLOUD_CATALOG_VERIFIED_AT = "2026-10-04";

const FREE_LABEL = "Gratis con límites";
const FREE_NOTICE =
  "Depende del modelo, la región y la cuenta; puede cambiar sin aviso.";
const PAID_LABEL = "Pago por uso";
const PAID_NOTICE =
  "Requiere facturación y acceso a la API activos en la cuenta del proveedor.";

function entry(
  id: string,
  name: string,
  usage: string,
  cost: CloudCostCondition,
  pricingUrl: string,
): CloudModelRecommendation {
  return {
    id,
    name,
    usage,
    cost,
    costLabel: cost === "FREE_LIMITED" ? FREE_LABEL : PAID_LABEL,
    costNotice: cost === "FREE_LIMITED" ? FREE_NOTICE : PAID_NOTICE,
    pricingUrl,
    verifiedAt: CLOUD_CATALOG_VERIFIED_AT,
  };
}

const CLAUDE_URL = "https://www.anthropic.com/pricing#api";
const GEMINI_URL = "https://ai.google.dev/gemini-api/docs/pricing";
const GROQ_URL = "https://groq.com/pricing";
const CEREBRAS_URL = "https://www.cerebras.ai/pricing";

export const CLOUD_MODEL_CATALOG: Readonly<
  Record<CloudProviderFamily, readonly CloudModelRecommendation[]>
> = {
  CLAUDE: [
    entry(
      "claude-haiku-4-5-20251001",
      "Claude Haiku 4.5",
      "Rápido y económico para tareas de volumen.",
      "PAID",
      CLAUDE_URL,
    ),
    entry(
      "claude-sonnet-5-5",
      "Claude Sonnet 5.5",
      "Equilibrio entre calidad y velocidad para análisis y redacción.",
      "PAID",
      CLAUDE_URL,
    ),
    entry(
      "claude-opus-5-5",
      "Claude Opus 5.5",
      "Máxima calidad para razonamiento complejo.",
      "PAID",
      CLAUDE_URL,
    ),
  ],
  GEMINI: [
    entry(
      "gemini-3-flash-preview",
      "Gemini 3 Flash (Preview)",
      "Rápido y versátil para borradores y extracción.",
      "FREE_LIMITED",
      GEMINI_URL,
    ),
    entry(
      "gemini-3.1-pro-preview",
      "Gemini 3.1 Pro (Preview)",
      "Razonamiento avanzado sobre documentos largos.",
      "PAID",
      GEMINI_URL,
    ),
  ],
  GROQ: [
    entry(
      "openai/gpt-oss-20b",
      "GPT-OSS 20B",
      "Modelo abierto ligero con respuesta muy rápida.",
      "FREE_LIMITED",
      GROQ_URL,
    ),
    entry(
      "openai/gpt-oss-120b",
      "GPT-OSS 120B",
      "Modelo abierto de mayor capacidad de razonamiento.",
      "FREE_LIMITED",
      GROQ_URL,
    ),
    entry(
      "qwen/qwen3.8-27b",
      "Qwen3.8 27B",
      "Modelo multilingüe de tamaño medio.",
      "FREE_LIMITED",
      GROQ_URL,
    ),
  ],
  CEREBRAS: [
    entry(
      "llama3.1-8b",
      "Llama 3.1 8B",
      "Modelo pequeño para tareas simples y alta velocidad.",
      "FREE_LIMITED",
      CEREBRAS_URL,
    ),
    entry(
      "gpt-oss-120b",
      "GPT-OSS 120B",
      "Modelo abierto de razonamiento general.",
      "FREE_LIMITED",
      CEREBRAS_URL,
    ),
    entry(
      "qwen-3-235b-a22b-instruct-2507",
      "Qwen 3 235B",
      "Modelo grande para análisis y redacción exigentes.",
      "FREE_LIMITED",
      CEREBRAS_URL,
    ),
    entry(
      "zai-glm-4.7",
      "GLM 4.7",
      "Modelo orientado a código y razonamiento.",
      "FREE_LIMITED",
      CEREBRAS_URL,
    ),
  ],
};

export function cloudRecommendations(
  family: string,
): readonly CloudModelRecommendation[] {
  return family in CLOUD_MODEL_CATALOG
    ? CLOUD_MODEL_CATALOG[family as CloudProviderFamily]
    : [];
}
