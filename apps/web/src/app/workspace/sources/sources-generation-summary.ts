// SOURCES_GENERATION_SUMMARY_V1
//
// Traduce el estado de una generación con IA a un resumen orientado a la
// decisión: qué ocurre, qué consecuencia tiene y qué puede hacer el usuario.
// Es presentación pura: no cambia contratos, persistencia ni la ejecución de
// los modos LOCAL_ONLY, LOCAL_CLOUD o CLOUD_ONLY. Todo dato técnico se conserva
// en `technical` para mostrarlo bajo divulgación progresiva.
import type { AiAnalysisStatus } from "@levantamiento-rq/shared-contracts";

export type GenerationOutcomeState =
  "ready" | "queued" | "active" | "completed" | "cancelled" | "failed";

export type GenerationFailureKind =
  | "KPI_AMBIGUOUS"
  | "KPI_UNREPAIRED"
  | "KPI_NO_MATCH"
  | "APPLY_UNAVAILABLE"
  | "ALIGNMENT"
  | "GENERIC";

export type GenerationOutcomeAction =
  | "review-result"
  | "retry-application"
  | "retry-checkpoint"
  | "technical-details";

export interface GenerationTechnicalRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface GenerationOutcomeInput {
  /** `null` cuando todavía no existe una solicitud (solo hay selección). */
  readonly status: AiAnalysisStatus | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  /** Mensaje del proveedor ya saneado (sin identificadores) para detalles. */
  readonly technicalMessage?: string | null;
  /** La IA terminó bien y el fallo fue al aplicar el resultado. */
  readonly providerCompleted?: boolean;
  /** Etapa activa o etapa donde falló, con etiqueta humana. */
  readonly stageLabel?: string | null;
  readonly selectedSourceCount?: number;
  readonly modeResultLabel?: string | null;
  readonly hasDocument?: boolean;
  readonly hasCheckpoint?: boolean;
  /** La versión borrador de este intento se descartó: no hay nada que reintentar. */
  readonly draftDiscarded?: boolean;
  /** Contexto de modo/fuentes y, en la selección previa, de la estimación. */
  readonly context?: {
    readonly modeLabel?: string | null;
    readonly sourceCount?: number | null;
    readonly estimate?: {
      readonly method?: string | null;
      readonly model?: string | null;
      readonly promptCharacters?: number | null;
      readonly estimatedInputTokens?: number | null;
      readonly maxInputTokens?: number | null;
      readonly canProcess?: boolean | null;
      /** Solo cuando el modo envía a la nube (CLOUD_ONLY o LOCAL_CLOUD). */
      readonly usesCloud?: boolean;
    } | null;
  };
  readonly technical?: {
    readonly requestId?: string | null;
    readonly providerRequestId?: string | null;
    readonly model?: string | null;
    readonly attempt?: number | null;
    readonly inputTokens?: number | null;
    readonly outputTokens?: number | null;
    readonly versionLabel?: string | null;
    /** Duración ya presentada (mismo cálculo de inicio/fin que General). */
    readonly durationLabel?: string | null;
    /** La ejecución usó solo IA local: no existe correlación de proveedor. */
    readonly localOnly?: boolean;
  };
}

export interface GenerationOutcome {
  readonly state: GenerationOutcomeState;
  /** Única etiqueta visible del estado general. */
  readonly statusLabel: string;
  readonly headline: string;
  readonly explanation: string | null;
  readonly consequence: string | null;
  readonly failureKind: GenerationFailureKind | null;
  /** Solo NO_MATCH es reparable automáticamente; AMBIGUOUS nunca. */
  readonly repairable: boolean;
  readonly actions: readonly GenerationOutcomeAction[];
  readonly technical: readonly GenerationTechnicalRow[];
}

const KPI_PATH_PATTERN = /scope\.kpis\[\d+\]\.relatedObjective/u;
const AMBIGUOUS_MARKER = /varias referencias igualmente plausibles/iu;
const UNREPAIRED_MARKER = /reintento localizado no obtuvo/iu;
const ALIGNMENT_PATTERN = /alineaci[oó]n 1:1 HU-P\/HU-F/iu;

export function classifyGenerationFailure(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
): GenerationFailureKind {
  const message = errorMessage ?? "";
  if (errorCode === "AI_AUTO_APPLY_UNAVAILABLE") return "APPLY_UNAVAILABLE";
  if (KPI_PATH_PATTERN.test(message) || /relatedObjective/u.test(message)) {
    if (AMBIGUOUS_MARKER.test(message)) return "KPI_AMBIGUOUS";
    if (UNREPAIRED_MARKER.test(message)) return "KPI_UNREPAIRED";
    return "KPI_NO_MATCH";
  }
  if (ALIGNMENT_PATTERN.test(message)) return "ALIGNMENT";
  return "GENERIC";
}

/** Causa técnica derivada del texto del error (el contrato no la expone). */
function derivedCause(kind: GenerationFailureKind): string | null {
  if (kind === "KPI_AMBIGUOUS") return "KPI_OBJECTIVE_AMBIGUOUS";
  if (kind === "KPI_UNREPAIRED") return "KPI_OBJECTIVE_UNREPAIRED";
  if (kind === "KPI_NO_MATCH") return "KPI_OBJECTIVE_NO_MATCH";
  return null;
}

function formatTokens(value: number | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : value.toLocaleString("es-CO");
}

function buildContextRows(
  input: GenerationOutcomeInput,
  state: GenerationOutcomeState,
): readonly GenerationTechnicalRow[] {
  const context = input.context;
  if (!context) return [];
  const rows: GenerationTechnicalRow[] = [];
  const add = (
    key: string,
    label: string,
    value: string | null | undefined,
  ) => {
    if (value !== null && value !== undefined && value !== "") {
      rows.push({ key, label, value });
    }
  };
  const selection = state === "ready";
  add("mode", "Modo", context.modeLabel);
  const count = context.sourceCount;
  if (count !== null && count !== undefined) {
    add(
      "sources",
      selection ? "Fuentes seleccionadas" : "Fuentes",
      String(count),
    );
  }
  if (state === "queued" || state === "active") {
    add("stage", "Etapa", input.stageLabel);
  }
  const estimate = selection ? context.estimate : null;
  if (estimate) {
    add(
      "estimate-method",
      "Método de estimación",
      estimate.method === "CHARACTERS_DIVIDED_BY_4"
        ? "Caracteres ÷ 4 (estimado)"
        : estimate.method,
    );
    if (estimate.usesCloud)
      add("estimate-model", "Modelo de nube", estimate.model);
    add(
      "estimate-characters",
      "Caracteres del prompt (estimado)",
      formatTokens(estimate.promptCharacters),
    );
    add(
      "estimate-input",
      "Tokens de entrada (estimado)",
      formatTokens(estimate.estimatedInputTokens),
    );
    if (estimate.usesCloud) {
      add(
        "estimate-limit",
        "Límite de entrada en la nube",
        formatTokens(estimate.maxInputTokens),
      );
      if (estimate.canProcess !== null && estimate.canProcess !== undefined) {
        add(
          "estimate-can-process",
          "Cabe en el límite (estimado)",
          estimate.canProcess ? "Sí" : "No",
        );
      }
    }
  }
  return rows;
}

function buildActiveRows(
  input: GenerationOutcomeInput,
  state: GenerationOutcomeState,
): readonly GenerationTechnicalRow[] {
  const rows = [...buildContextRows(input, state)];
  const technical = input.technical ?? {};
  const add = (
    key: string,
    label: string,
    value: string | null | undefined,
  ) => {
    if (value !== null && value !== undefined && value !== "") {
      rows.push({ key, label, value });
    }
  };
  add("request", "Solicitud", technical.requestId);
  add("version", "Versión generada", technical.versionLabel);
  add("model", "Modelo", technical.model);
  add(
    "attempt",
    "Intento",
    technical.attempt ? String(technical.attempt) : null,
  );
  return rows;
}

export function buildTechnicalRows(
  input: GenerationOutcomeInput,
  kind: GenerationFailureKind | null,
): readonly GenerationTechnicalRow[] {
  const rows: GenerationTechnicalRow[] = [];
  const add = (
    key: string,
    label: string,
    value: string | null | undefined,
  ) => {
    if (value !== null && value !== undefined && value !== "") {
      rows.push({ key, label, value });
    }
  };
  const technical = input.technical ?? {};

  add("code", "Código", input.errorCode);
  add("cause", "Causa", kind ? derivedCause(kind) : null);
  add(
    "path",
    "Ruta",
    KPI_PATH_PATTERN.exec(input.errorMessage ?? "")?.[0] ?? null,
  );
  const unavailable = "No disponible";
  const tokenPart = (value: number | null | undefined) =>
    formatTokens(value) ?? unavailable;
  add("request", "Solicitud", technical.requestId ?? unavailable);
  add("version", "Versión generada", technical.versionLabel ?? unavailable);
  add("model", "Modelo", technical.model ?? unavailable);
  add(
    "attempt",
    "Intento",
    technical.attempt ? String(technical.attempt) : unavailable,
  );
  add("duration", "Duración", technical.durationLabel ?? unavailable);
  add(
    "tokens",
    "Tokens (entrada / salida)",
    `${tokenPart(technical.inputTokens)} / ${tokenPart(technical.outputTokens)}`,
  );
  add(
    "correlation",
    "Correlación del proveedor",
    technical.providerRequestId ??
      (technical.localOnly ? "No aplica" : unavailable),
  );
  add(
    "message",
    "Mensaje original",
    input.technicalMessage ?? input.errorMessage?.split(/\r?\n/u)[0],
  );
  return rows;
}

function failureCopy(
  kind: GenerationFailureKind,
  input: GenerationOutcomeInput,
): Pick<GenerationOutcome, "headline" | "explanation" | "consequence"> {
  const stage = input.stageLabel ? ` (etapa: ${input.stageLabel})` : "";
  switch (kind) {
    case "KPI_AMBIGUOUS":
      return {
        headline:
          "No fue posible relacionar un indicador con un único objetivo",
        explanation:
          "Uno de los indicadores puede corresponder a más de un objetivo.",
        consequence:
          "No se aplicó el resultado para evitar una relación incorrecta.",
      };
    case "KPI_UNREPAIRED":
      return {
        headline: "No fue posible relacionar un indicador con un objetivo",
        explanation:
          "Se intentó una corrección localizada, pero no se encontró una referencia única y segura.",
        consequence: "No se aplicó el resultado al documento.",
      };
    case "KPI_NO_MATCH":
      return {
        headline: "Un indicador no coincide con ningún objetivo generado",
        explanation:
          "No se pudo asociar uno de los indicadores a ningún objetivo generado.",
        consequence: "No se aplicó el resultado al documento.",
      };
    case "APPLY_UNAVAILABLE":
      return input.providerCompleted
        ? {
            headline: "El borrador se generó, pero no pudo aplicarse",
            explanation:
              "La IA terminó correctamente y el resultado quedó guardado; el servicio documental no pudo recibirlo.",
            consequence:
              "La aplicación puede reintentarse sin volver a consumir IA en la nube.",
          }
        : {
            headline: "El servicio documental no estuvo disponible",
            explanation:
              "No fue posible aplicar el borrador generado. Verifica el servicio documental y vuelve a intentar.",
            consequence: null,
          };
    case "ALIGNMENT":
      return {
        headline: "La IA no completó la documentación de todas las historias",
        explanation:
          "El resultado fue rechazado para proteger la consistencia del documento.",
        consequence: "No se aplicó el resultado al documento.",
      };
    default:
      return {
        headline: "La generación no pudo completarse",
        explanation: `La ejecución se detuvo${stage}. El mensaje original está en los detalles técnicos.`,
        consequence: "No se aplicó el resultado al documento.",
      };
  }
}

export function describeGenerationOutcome(
  input: GenerationOutcomeInput,
): GenerationOutcome {
  const base = {
    failureKind: null,
    repairable: false,
    consequence: null,
    technical: [] as readonly GenerationTechnicalRow[],
  };

  if (input.status === null) {
    const count = input.selectedSourceCount ?? 0;
    return {
      ...base,
      state: "ready",
      statusLabel: "Lista para iniciar",
      headline:
        count > 0
          ? `${count} ${count === 1 ? "fuente seleccionada" : "fuentes seleccionadas"}`
          : "Sin fuentes seleccionadas",
      explanation:
        count > 0
          ? "Revisa la estimación de consumo y procesa cuando estés listo."
          : "Selecciona fuentes de la tabla para estimar el consumo.",
      actions: [],
      technical: buildContextRows(input, "ready"),
    };
  }

  if (input.status === "PENDING") {
    return {
      ...base,
      state: "queued",
      statusLabel: "En cola",
      headline: input.stageLabel ?? "Esperando turno de ejecución",
      explanation: "La solicitud comenzará en cuanto haya capacidad.",
      actions: [],
      technical: buildActiveRows(input, "queued"),
    };
  }

  if (input.status === "PROCESSING") {
    return {
      ...base,
      state: "active",
      statusLabel: "En proceso",
      headline: input.stageLabel ?? "Generando el documento",
      explanation: null,
      actions: [],
      technical: buildActiveRows(input, "active"),
    };
  }

  if (input.status === "COMPLETED") {
    return {
      ...base,
      state: "completed",
      statusLabel: "Completada",
      headline: "Documento validado y aplicado",
      explanation: input.modeResultLabel ?? null,
      actions: [],
      technical: [
        ...buildContextRows(input, "completed"),
        ...buildTechnicalRows(input, null),
      ],
    };
  }

  if (input.status === "CANCELLED") {
    return {
      ...base,
      state: "cancelled",
      statusLabel: "Cancelada",
      headline: "La generación se canceló",
      explanation: input.draftDiscarded
        ? "No se creó ninguna versión del documento."
        : "No se aplicó el resultado de esta solicitud al documento.",
      actions: ["technical-details"],
      technical: [
        ...buildContextRows(input, "cancelled"),
        ...buildTechnicalRows(input, null),
      ],
    };
  }

  const kind = classifyGenerationFailure(input.errorCode, input.errorMessage);
  const actions: GenerationOutcomeAction[] = [];
  // Con el borrador descartado no existe versión donde reintentar o aplicar.
  if (!input.draftDiscarded) {
    if (kind === "APPLY_UNAVAILABLE") actions.push("retry-application");
    else if (input.hasCheckpoint) actions.push("retry-checkpoint");
  }
  actions.push("technical-details");

  const copy = failureCopy(kind, input);
  return {
    ...copy,
    consequence: input.draftDiscarded
      ? "No se creó ninguna versión del documento."
      : copy.consequence,
    state: "failed",
    statusLabel: "Fallida",
    failureKind: kind,
    repairable: kind === "KPI_NO_MATCH",
    actions,
    technical: [
      ...buildContextRows(input, "failed"),
      ...buildTechnicalRows(input, kind),
    ],
  };
}

/** Etiquetas de estado que describen a la fuente y no a toda la generación. */
const SOURCE_SPECIFIC_LABELS = new Set([
  "Analizada",
  "IA local",
  "Preparando",
  "Pendiente",
]);

/**
 * Columna «En la generación»: solo muestra un estado propio de la fuente. Los
 * estados de toda la ejecución (fallida, completada, en cola…) viven en la
 * cabecera y aquí se resumen como «Incluida» para no repetirlos por fila.
 */
export function sourceGenerationCell(
  included: boolean,
  label: string,
): { readonly included: boolean; readonly label: string } {
  if (!included) return { included: false, label: "—" };
  return {
    included: true,
    label: SOURCE_SPECIFIC_LABELS.has(label) ? label : "Incluida",
  };
}

const PREPARATION_LABEL = {
  READY: ["✓", "Preparada"],
  PROCESSING: ["◔", "Preparando"],
  FAILED: ["✕", "Con error"],
  PENDING: ["○", "Pendiente"],
} as const;

/** Estado de preparación del archivo (ingestión), distinto de la generación. */
export function sourcePreparationLabel(
  status: "READY" | "PROCESSING" | "FAILED" | "PENDING",
): { readonly symbol: string; readonly label: string } {
  const [symbol, label] = PREPARATION_LABEL[status];
  return { symbol, label };
}
