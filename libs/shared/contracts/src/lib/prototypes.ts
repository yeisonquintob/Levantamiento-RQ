export type PrototypeTargetDevice = "RESPONSIVE" | "WEB" | "MOBILE";

export type PrototypeGenerationStatus =
  | "SOURCE_READY"
  | "PLANNING"
  | "PLANNED"
  | "VISUAL_SPEC_BUILDING"
  | "VISUAL_SPEC_READY"
  | "IMAGE_GENERATING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED";

export type PrototypePlannerProviderCode = "OPENAI" | "OLLAMA";
export type PrototypeImageProviderCode =
  "OPENAI_IMAGES" | "COMFYUI" | "OTHER" | "OLLAMA_IMAGES";
export type PrototypeGeneratedImageStatus =
  "PENDING" | "GENERATING" | "COMPLETED" | "FAILED";

export type PrototypeScreenOrigin = "EXPLICIT" | "DERIVED";

export type PrototypeScreenStatus = "PLANNED" | "FAILED";

export interface PrototypePlannedScreen {
  code: string;
  name: string;
  objective: string;
  origin: PrototypeScreenOrigin;
  route: string | null;
  components: string[];
  order: number;
}

export interface PrototypePlan {
  applicationName: string;
  summary: string;
  targetDevice: PrototypeTargetDevice;
  screens: PrototypePlannedScreen[];
}

export interface PrototypePlanningResult {
  generation: PrototypeGenerationDetail;
  plan: PrototypePlan;
  provider: PrototypePlannerProviderCode;
  model: string;
  executionId: string;
}

export interface PrototypePlanningInternalRequest {
  providerConfigurationId?: string;
  purpose: "PROTOTYPE_PLANNING";
  input: {
    markdown: string;
    targetDevice: PrototypeTargetDevice;
  };
}

export interface PrototypePlanningInternalResponse {
  provider: PrototypePlannerProviderCode;
  model: string;
  executionId: string;
  structuredResult: PrototypePlan;
}

/** Detalle completo de UNA pantalla: la IA lo extrae del Markdown con la pantalla como foco. */
export interface PrototypeScreenDetailInternalRequest {
  providerConfigurationId?: string;
  purpose: "PROTOTYPE_SCREEN_DETAIL";
  input: {
    markdown: string;
    applicationName: string;
    summary: string;
    /** Nombres de todas las pantallas del plan: el menú común de la aplicación. */
    menu: string[];
    screen: {
      code: string;
      name: string;
      objective: string;
      route: string | null;
      components: string[];
    };
  };
}

export interface PrototypeScreenDetailOutput {
  objective: string;
  components: string[];
}

export interface PrototypeScreenDetailInternalResponse {
  provider: PrototypePlannerProviderCode;
  model: string;
  executionId: string;
  structuredResult: PrototypeScreenDetailOutput;
}

export interface PrototypeScreenDetailResult {
  generation: PrototypeGenerationDetail;
  screen: PrototypeScreenDetail;
  provider: PrototypePlannerProviderCode;
  model: string;
  executionId: string;
  previousComponentCount: number;
  componentCount: number;
}

export interface PrototypeGenerationCreateRequest {
  plannerConfigurationId?: string;
  imageConfigurationId?: string;
  projectId?: string;
  sourceFileName: string;
  markdown: string;
  targetDevice: PrototypeTargetDevice;
}

export interface PrototypeGenerationDetail {
  plannerConfigurationId?: string | null;
  imageConfigurationId?: string | null;
  id: string;
  projectId: string | null;
  sourceFileName: string;
  sourceSizeBytes: number;
  sourceSha256: string;
  targetDevice: PrototypeTargetDevice;
  status: PrototypeGenerationStatus;
  plannerProvider: PrototypePlannerProviderCode | null;
  plannerModel: string | null;
  applicationName: string | null;
  summary: string | null;
  imageProvider: PrototypeImageProviderCode | null;
  totalScreens: number;
  generatedScreens: number;
  totalVisualSpecifications: number;
  totalImages: number;
  completedImages: number;
  failedImages: number;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrototypeScreenDetail {
  id: string;
  generationId: string;
  order: number;
  code: string;
  name: string;
  objective: string;
  origin: PrototypeScreenOrigin;
  route: string | null;
  components: string[];
  device: PrototypeTargetDevice;
  status: PrototypeScreenStatus;
  imageStorageKey: string | null;
}

export type PrototypeVisualDevice = "WEB" | "MOBILE";
export type PrototypeVisualTemplateCode =
  "WEB_TEMPLATE_V1" | "MOBILE_TEMPLATE_V1";
export type PrototypeDesignSystemCode = "CORPORATE_DEFAULT_V1";
export type PrototypeCanonicalComponent =
  | "APP_SHELL"
  | "SIDEBAR"
  | "TOPBAR"
  | "MOBILE_HEADER"
  | "MOBILE_NAVIGATION"
  | "KPI"
  | "CARD"
  | "TABLE"
  | "LIST"
  | "FORM"
  | "TEXT_INPUT"
  | "SELECT"
  | "DATE_PICKER"
  | "SEARCH"
  | "FILTER_BAR"
  | "BADGE"
  | "BUTTON"
  | "ICON_BUTTON"
  | "TABS"
  | "MODAL"
  | "DRAWER"
  | "BOTTOM_SHEET"
  | "EMPTY_STATE"
  | "ERROR_STATE"
  | "SUCCESS_STATE"
  | "PAGINATION"
  | "BREADCRUMB"
  | "DETAIL_PANEL";

export interface PrototypeVisualViewport {
  width: number;
  height: number;
}
export interface PrototypeVisualLayout {
  shell: "DESKTOP_SHELL" | "MOBILE_SHELL";
  contentDirection: "ROW" | "COLUMN";
  columns: 1 | 2;
  padding: number;
  gap: number;
}
export interface PrototypeVisualNavigation {
  primary: "SIDEBAR" | "MOBILE_HEADER";
  secondary: "TOPBAR" | "MOBILE_NAVIGATION";
  items?: { screenCode: string; label: string; route: string | null }[];
  activeScreenCode?: string;
}
export interface PrototypeVisualComponentSpecification {
  type: PrototypeCanonicalComponent;
  semanticRole: string;
  presentation: "FULL_WIDTH" | "COMPACT" | "CARD_COLLECTION" | "TOUCH";
}
export interface PrototypeVisualAction {
  semanticRole: string;
  component: "BUTTON" | "ICON_BUTTON";
  emphasis: "PRIMARY" | "SECONDARY" | "DANGER";
}
export interface PrototypeVisualState {
  type: "EMPTY" | "ERROR" | "SUCCESS";
  component: "EMPTY_STATE" | "ERROR_STATE" | "SUCCESS_STATE";
}

export interface PrototypeVisualSpecification {
  id: string;
  generationId: string;
  screenId: string;
  screenCode: string;
  screenOrigin: PrototypeScreenOrigin;
  device: PrototypeVisualDevice;
  templateCode: PrototypeVisualTemplateCode;
  designSystemCode: PrototypeDesignSystemCode;
  applicationName?: string;
  /** Propósito de la aplicación según el plan; da contexto común a todas las pantallas. */
  applicationSummary?: string;
  /** Ruta de la pantalla dentro de la aplicación, si el documento la define. */
  route?: string;
  title: string;
  objective: string;
  viewport: PrototypeVisualViewport;
  layout: PrototypeVisualLayout;
  navigation: PrototypeVisualNavigation;
  components: PrototypeVisualComponentSpecification[];
  contentHierarchy: string[];
  actions: PrototypeVisualAction[];
  states: PrototypeVisualState[];
  createdAt: string;
  updatedAt: string;
}

export interface PrototypeVisualSpecificationBuildResult {
  generation: PrototypeGenerationDetail;
  specifications: PrototypeVisualSpecification[];
  webCount: number;
  mobileCount: number;
  total: number;
}

export interface PrototypeGeneratedImage {
  id: string;
  generationId: string;
  visualSpecificationId: string;
  screenId: string;
  screenCode: string;
  screenName: string;
  screenOrder: number;
  screenObjective: string;
  screenOrigin: PrototypeScreenOrigin;
  device: PrototypeVisualDevice;
  provider: PrototypeImageProviderCode;
  model: string | null;
  status: PrototypeGeneratedImageStatus;
  mediaType: "image/png" | null;
  storageKey: string | null;
  width: number | null;
  height: number | null;
  attemptNumber: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrototypeImageActionResult {
  generation: PrototypeGenerationDetail;
  image: PrototypeGeneratedImage;
  progress: PrototypeImageProgress;
}

/** Un prompt listo para pegar en otra IA, con el nombre exacto que debe llevar la imagen. */
export interface PrototypePromptExportItem {
  screenCode: string;
  screenName: string;
  screenOrder: number;
  device: PrototypeVisualDevice;
  /** Nombre de archivo con el que se importa la imagen de vuelta a la galería. */
  fileName: string;
  width: number;
  height: number;
  prompt: string;
}

export interface PrototypePromptExportScreen {
  screenCode: string;
  name: string;
  route: string | null;
  order: number;
  objective: string;
  components: string[];
}

export interface PrototypePromptExport {
  generationId: string;
  applicationName: string | null;
  applicationSummary: string | null;
  targetDevice: PrototypeTargetDevice;
  /** Todas las pantallas del plan, en orden: es el menú común de la aplicación. */
  screens: PrototypePromptExportScreen[];
  /** Sistema de apariencia compartido por todas las imágenes. */
  designSystem: PrototypeDesignSystem;
  items: PrototypePromptExportItem[];
}

export interface PrototypeImageImportRequest {
  fileName: string;
  imageBase64: string;
}

export interface PrototypeImageProgress {
  generationId: string;
  status: PrototypeGenerationStatus;
  totalImages: number;
  completedImages: number;
  failedImages: number;
  pendingImages: number;
  generatingImages: number;
  web: { total: number; completed: number; failed: number };
  mobile: { total: number; completed: number; failed: number };
  current: { screenName: string; device: PrototypeVisualDevice } | null;
}

export interface PrototypeImageGenerationResult {
  generation: PrototypeGenerationDetail;
  images: PrototypeGeneratedImage[];
  progress: PrototypeImageProgress;
}

export interface PrototypeImageGenerationInternalRequest {
  providerConfigurationId?: string;
  purpose: "PROTOTYPE_IMAGE_GENERATION";
  prompt: string;
  device: PrototypeVisualDevice;
  requestedSize: "1536x1024" | "1024x1536";
}

export interface PrototypeImageGenerationInternalResponse {
  provider: "OPENAI_IMAGES" | "COMFYUI" | "OLLAMA_IMAGES";
  model: string;
  mediaType: "image/png";
  imageBase64: string;
  executionId: string;
}

export interface PrototypeAiOption {
  id: string;
  name: string;
  model: string;
  provider: "OPENAI" | "OLLAMA" | "OPENAI_IMAGES" | "COMFYUI" | "OLLAMA_IMAGES";
  available: boolean;
  isDefault: boolean;
  message: string;
}
export interface PrototypeAiOptions {
  planning: PrototypeAiOption[];
  images: PrototypeAiOption[];
}

export interface PrototypeDesignSystem {
  id: string;
  code: PrototypeDesignSystemCode;
  version: string;
  name: string;
  typography: Readonly<
    Record<
      | "family"
      | "display"
      | "title"
      | "heading"
      | "body"
      | "caption"
      | "table"
      | "button",
      string
    >
  >;
  colors: Readonly<
    Record<
      | "background"
      | "surface"
      | "primary"
      | "primaryDark"
      | "text"
      | "textSecondary"
      | "border"
      | "success"
      | "warning"
      | "danger"
      | "info",
      string
    >
  >;
  spacing: readonly number[];
  borderRadius: Readonly<Record<"small" | "medium" | "large", number>>;
  shadows: Readonly<Record<"card" | "modal", string>>;
  buttons: Readonly<Record<string, string | number>>;
  cards: Readonly<Record<string, string | number>>;
  tables: Readonly<Record<string, string | number>>;
  forms: Readonly<Record<string, string | number>>;
  navigation: Readonly<Record<string, string | number>>;
  badges: Readonly<Record<string, string | number>>;
}

export const PROTOTYPE_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["applicationName", "summary", "targetDevice", "screens"],
  properties: {
    applicationName: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    targetDevice: { type: "string", enum: ["RESPONSIVE", "WEB", "MOBILE"] },
    screens: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "code",
          "name",
          "objective",
          "origin",
          "route",
          "components",
          "order",
        ],
        properties: {
          code: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          objective: { type: "string", minLength: 1 },
          origin: { type: "string", enum: ["EXPLICIT", "DERIVED"] },
          route: { anyOf: [{ type: "string" }, { type: "null" }] },
          components: {
            type: "array",
            description:
              "Componentes detallados, uno por elemento: tipo, etiqueta, campos o columnas, reglas documentadas, acciones y estados. Conservar evidencia de sección o requisito; no resumir como tabla o formulario genérico.",
            items: { type: "string", minLength: 1 },
          },
          order: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as const;

export const PROTOTYPE_SCREEN_DETAIL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objective", "components"],
  properties: {
    objective: { type: "string", minLength: 1 },
    components: {
      type: "array",
      minItems: 1,
      description:
        "Un elemento por componente visible de la pantalla, con etiquetas, columnas, campos, reglas, acciones por rol y estados documentados.",
      items: { type: "string", minLength: 1 },
    },
  },
} as const;

/** Valida el detalle de una pantalla devuelto por la IA. */
export function parsePrototypeScreenDetail(
  value: unknown,
): PrototypeScreenDetailOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El detalle de la pantalla no es un objeto válido.");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "objective" && key !== "components")) {
    throw new Error("El detalle contiene propiedades desconocidas.");
  }
  if (typeof input["objective"] !== "string" || !input["objective"].trim()) {
    throw new Error("objective no puede estar vacío.");
  }
  const components = input["components"];
  if (
    !Array.isArray(components) ||
    components.length === 0 ||
    components.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error("components debe traer al menos un elemento de texto.");
  }
  return {
    objective: input["objective"].trim().slice(0, 2000),
    components: (components as string[]).map((item) => item.trim()),
  };
}

function planObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El plan de prototipo no es un objeto válido.");
  }
  return value as Record<string, unknown>;
}

function planText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} no puede estar vacío.`);
  }
  return value.trim();
}

/** Validación de defensa adicional a Structured Outputs. */
export function parsePrototypePlan(
  value: unknown,
  expectedDevice?: PrototypeTargetDevice,
): PrototypePlan {
  const plan = planObject(value);
  const allowedPlanKeys = new Set([
    "applicationName",
    "summary",
    "targetDevice",
    "screens",
  ]);
  if (Object.keys(plan).some((key) => !allowedPlanKeys.has(key))) {
    throw new Error("El plan contiene propiedades desconocidas.");
  }
  const targetDevice = plan.targetDevice as PrototypeTargetDevice;
  if (!["RESPONSIVE", "WEB", "MOBILE"].includes(targetDevice)) {
    throw new Error("targetDevice no es válido.");
  }
  if (expectedDevice && targetDevice !== expectedDevice) {
    throw new Error("targetDevice no coincide con la generación.");
  }
  if (!Array.isArray(plan.screens) || plan.screens.length === 0) {
    throw new Error("PROTOTYPE_PLAN_EMPTY");
  }
  const codes = new Set<string>();
  const allowedScreenKeys = new Set([
    "code",
    "name",
    "objective",
    "origin",
    "route",
    "components",
    "order",
  ]);
  const screens = plan.screens.map((raw, index): PrototypePlannedScreen => {
    const screen = planObject(raw);
    if (Object.keys(screen).some((key) => !allowedScreenKeys.has(key))) {
      throw new Error("Una pantalla contiene propiedades desconocidas.");
    }
    const code = planText(screen.code, "code");
    if (codes.has(code)) throw new Error("PROTOTYPE_SCREEN_CODE_DUPLICATED");
    codes.add(code);
    if (screen.origin !== "EXPLICIT" && screen.origin !== "DERIVED") {
      throw new Error("El origen de una pantalla no es válido.");
    }
    if (screen.order !== index + 1) {
      throw new Error("El orden de pantallas debe ser consecutivo desde 1.");
    }
    if (screen.route !== null && typeof screen.route !== "string") {
      throw new Error("La ruta de una pantalla no es válida.");
    }
    if (
      !Array.isArray(screen.components) ||
      screen.components.some(
        (component) => typeof component !== "string" || !component.trim(),
      )
    ) {
      throw new Error("Los componentes de una pantalla no son válidos.");
    }
    return {
      code,
      name: planText(screen.name, "name"),
      objective: planText(screen.objective, "objective"),
      origin: screen.origin,
      route: screen.route === null ? null : screen.route.trim() || null,
      components: screen.components.map((component) => component.trim()),
      order: screen.order,
    };
  });
  return {
    applicationName: planText(plan.applicationName, "applicationName"),
    summary: planText(plan.summary, "summary"),
    targetDevice,
    screens,
  };
}
