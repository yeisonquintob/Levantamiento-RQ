import { UUID_PATTERN } from "./ai-draft-constants";

export const text = (maximum = 2_000, minimum = 1) =>
  ({
    type: "string",
    minLength: minimum,
    maxLength: maximum,
  }) as const;

export const nullableText = (maximum = 2_000) =>
  ({
    anyOf: [text(maximum), { type: "null" }],
  }) as const;

export const sourceIdsSchema = (maximum = 100) =>
  ({
    type: "array",
    maxItems: maximum,
    items: { type: "string", pattern: UUID_PATTERN },
  }) as const;

/*
 * AI_V41_ALLOWED_SOURCE_IDS_SCHEMA
 *
 * El schema estructurado enviado al proveedor debe impedir, no solo detectar,
 * referencias de evidencia que no pertenecen a la solicitud. V4.0 histórico
 * permanece intacto; esta restricción se aplica únicamente al schema V4.1
 * construido para una ejecución concreta.
 */
const AI_SOURCE_REFERENCE_SCHEMA_KEYS = new Set([
  "sourceIds",
  "sourceIdsA",
  "sourceIdsB",
]);

export function restrictSchemaSourceIdsToAllowedValues<T>(
  schema: T,
  allowedSourceIds: readonly string[],
): T {
  if (allowedSourceIds.length === 0) {
    return schema;
  }

  const uuidPattern = new RegExp(UUID_PATTERN);
  const canonicalByLowerCase = new Map<string, string>();

  for (const rawSourceId of allowedSourceIds) {
    const sourceId = rawSourceId.trim();
    if (!uuidPattern.test(sourceId)) {
      throw new Error(
        `allowedSourceIds contiene un UUID inválido: ${rawSourceId}`,
      );
    }
    canonicalByLowerCase.set(sourceId.toLowerCase(), sourceId);
  }

  const allowed = [...canonicalByLowerCase.values()];
  if (allowed.length === 0) {
    throw new Error(
      "allowedSourceIds no puede quedar vacío tras normalizarlo.",
    );
  }

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (
        AI_SOURCE_REFERENCE_SCHEMA_KEYS.has(key) &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const sourceArraySchema = visit(child) as Record<string, unknown>;
        next[key] = {
          ...sourceArraySchema,
          items: {
            type: "string",
            enum: allowed,
          },
        };
        continue;
      }
      next[key] = visit(child);
    }
    return next;
  };

  return visit(schema) as T;
}

export const stringArraySchema = (maximum = 100, itemMaximum = 2_000) =>
  ({
    type: "array",
    maxItems: maximum,
    items: text(itemMaximum),
  }) as const;
