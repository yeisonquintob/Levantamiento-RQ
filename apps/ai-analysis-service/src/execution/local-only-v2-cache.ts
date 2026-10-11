// LOCAL_ONLY_V2_06_INCREMENTAL_CACHE
//
// Caché lógica por fragmento para LOCAL_ONLY_V2.
// Este paso NO crea tabla, migración ni repositorio de persistencia.
//
// Clave:
// - sourceId;
// - SHA-256 del TEXTO del fragmento;
// - modelo;
// - versión del extractor;
// - SHA-256 de configuración relevante.
//
// Se cachea la salida atómica CRUDA del Paso 4. La trazabilidad (segmentId,
// offsets, sourceTitle, índice) se vuelve a calcular contra el segmento actual,
// permitiendo reutilizar un fragmento idéntico aunque haya cambiado de posición.
//
// Si cambia un solo fragmento, únicamente ese descriptor se convierte en MISS.

import { createHash } from "node:crypto";

import {
  LOCAL_ONLY_V2_ATOMIC_SCHEMA_VERSION,
  parseLocalOnlyV2AtomicExtraction,
  type LocalOnlyV2AtomicExtractionTask,
  type LocalOnlyV2AtomicFinding,
  type LocalOnlyV2AtomicModelOutput,
} from "./local-only-v2-atomic-extraction";

export const LOCAL_ONLY_V2_CACHE_SCHEMA_VERSION = "1.0.0" as const;
export const LOCAL_ONLY_V2_DEFAULT_EXTRACTOR_VERSION =
  `atomic-${LOCAL_ONLY_V2_ATOMIC_SCHEMA_VERSION}` as const;

export interface LocalOnlyV2CachePolicy {
  readonly model: string;
  readonly extractorVersion?: string;
  readonly relevantConfiguration: Readonly<Record<string, unknown>>;
}

export interface LocalOnlyV2CacheDescriptor {
  readonly cacheKey: string;
  readonly sourceId: string;
  readonly fragmentSha256: string;
  readonly model: string;
  readonly extractorVersion: string;
  readonly configurationSha256: string;
}

export interface LocalOnlyV2AtomicCacheEntry extends LocalOnlyV2CacheDescriptor {
  readonly cacheSchemaVersion: typeof LOCAL_ONLY_V2_CACHE_SCHEMA_VERSION;
  readonly rawOutput: LocalOnlyV2AtomicModelOutput;
}

export interface LocalOnlyV2CacheHit {
  readonly taskId: string;
  readonly descriptor: LocalOnlyV2CacheDescriptor;
  readonly findings: readonly LocalOnlyV2AtomicFinding[];
}

export type LocalOnlyV2CacheMissReason = "NOT_FOUND" | "INVALID_CACHED_OUTPUT";

export interface LocalOnlyV2CacheMiss {
  readonly task: LocalOnlyV2AtomicExtractionTask;
  readonly descriptor: LocalOnlyV2CacheDescriptor;
  readonly reason: LocalOnlyV2CacheMissReason;
}

export interface LocalOnlyV2IncrementalCachePlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly hitCount: number;
  readonly missCount: number;
  readonly hits: readonly LocalOnlyV2CacheHit[];
  readonly misses: readonly LocalOnlyV2CacheMiss[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(
  value: unknown,
  stack: WeakSet<object> = new WeakSet<object>(),
): string {
  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        "La configuración de caché LOCAL_ONLY_V2 no admite números no finitos.",
      );
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (stack.has(value)) {
      throw new Error(
        "La configuración de caché LOCAL_ONLY_V2 no admite ciclos.",
      );
    }
    stack.add(value);
    try {
      return `[${value.map((item) => canonicalJson(item, stack)).join(",")}]`;
    } finally {
      stack.delete(value);
    }
  }

  if (typeof value === "object") {
    const object = value as Readonly<Record<string, unknown>>;
    if (stack.has(object)) {
      throw new Error(
        "La configuración de caché LOCAL_ONLY_V2 no admite ciclos.",
      );
    }
    stack.add(object);
    try {
      const keys = Object.keys(object).sort();
      const parts = keys.map((key) => {
        const item = object[key];
        if (
          item === undefined ||
          typeof item === "function" ||
          typeof item === "symbol" ||
          typeof item === "bigint"
        ) {
          throw new Error(
            `La configuración de caché LOCAL_ONLY_V2 contiene un valor no serializable en ${key}.`,
          );
        }
        return `${JSON.stringify(key)}:${canonicalJson(item, stack)}`;
      });
      return `{${parts.join(",")}}`;
    } finally {
      stack.delete(object);
    }
  }

  throw new Error(
    "La configuración de caché LOCAL_ONLY_V2 contiene un valor no serializable.",
  );
}

export function hashLocalOnlyV2RelevantConfiguration(
  configuration: Readonly<Record<string, unknown>>,
): string {
  return sha256(canonicalJson(configuration));
}

function normalizedPolicy(policy: LocalOnlyV2CachePolicy): {
  model: string;
  extractorVersion: string;
  configurationSha256: string;
} {
  const model = policy.model.trim();
  if (!model) {
    throw new Error("LOCAL_ONLY_V2 requiere model para construir la caché.");
  }

  const extractorVersion = (
    policy.extractorVersion ?? LOCAL_ONLY_V2_DEFAULT_EXTRACTOR_VERSION
  ).trim();
  if (!extractorVersion) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere extractorVersion para construir la caché.",
    );
  }

  return {
    model,
    extractorVersion,
    configurationSha256: hashLocalOnlyV2RelevantConfiguration(
      policy.relevantConfiguration,
    ),
  };
}

export function buildLocalOnlyV2CacheDescriptor(
  task: LocalOnlyV2AtomicExtractionTask,
  policy: LocalOnlyV2CachePolicy,
): LocalOnlyV2CacheDescriptor {
  if (task.pipelineId !== "LOCAL_ONLY_V2") {
    throw new Error("La caché V2 acepta únicamente tareas LOCAL_ONLY_V2.");
  }

  const sourceId = task.segment.sourceId.trim();
  if (!sourceId) {
    throw new Error("La caché V2 requiere sourceId.");
  }

  const { model, extractorVersion, configurationSha256 } =
    normalizedPolicy(policy);
  const fragmentSha256 = sha256(task.segment.text);

  const logicalKey = canonicalJson({
    pipelineId: "LOCAL_ONLY_V2",
    sourceId,
    fragmentSha256,
    model,
    extractorVersion,
    configurationSha256,
  });

  return Object.freeze({
    cacheKey: `v2c_${sha256(logicalKey)}`,
    sourceId,
    fragmentSha256,
    model,
    extractorVersion,
    configurationSha256,
  });
}

function descriptorMatches(
  entry: LocalOnlyV2AtomicCacheEntry,
  descriptor: LocalOnlyV2CacheDescriptor,
): boolean {
  return (
    entry.cacheSchemaVersion === LOCAL_ONLY_V2_CACHE_SCHEMA_VERSION &&
    entry.cacheKey === descriptor.cacheKey &&
    entry.sourceId === descriptor.sourceId &&
    entry.fragmentSha256 === descriptor.fragmentSha256 &&
    entry.model === descriptor.model &&
    entry.extractorVersion === descriptor.extractorVersion &&
    entry.configurationSha256 === descriptor.configurationSha256
  );
}

export function createLocalOnlyV2AtomicCacheEntry(
  task: LocalOnlyV2AtomicExtractionTask,
  policy: LocalOnlyV2CachePolicy,
  rawOutput: LocalOnlyV2AtomicModelOutput,
): LocalOnlyV2AtomicCacheEntry {
  // Valida antes de permitir almacenar. La salida cruda se conserva porque los
  // offsets dependen del segmento ACTUAL y deben recalcularse al hacer HIT.
  parseLocalOnlyV2AtomicExtraction(rawOutput, task.segment);

  const descriptor = buildLocalOnlyV2CacheDescriptor(task, policy);
  return Object.freeze({
    cacheSchemaVersion: LOCAL_ONLY_V2_CACHE_SCHEMA_VERSION,
    ...descriptor,
    rawOutput,
  });
}

function indexEntries(
  entries: readonly LocalOnlyV2AtomicCacheEntry[],
): ReadonlyMap<string, LocalOnlyV2AtomicCacheEntry> {
  const indexed = new Map<string, LocalOnlyV2AtomicCacheEntry>();

  for (const entry of entries) {
    if (indexed.has(entry.cacheKey)) {
      throw new Error(
        `LOCAL_ONLY_V2 encontró una clave de caché duplicada: ${entry.cacheKey}.`,
      );
    }
    indexed.set(entry.cacheKey, entry);
  }

  return indexed;
}

export function planLocalOnlyV2IncrementalCache(
  tasks: readonly LocalOnlyV2AtomicExtractionTask[],
  cachedEntries: readonly LocalOnlyV2AtomicCacheEntry[],
  policy: LocalOnlyV2CachePolicy,
): LocalOnlyV2IncrementalCachePlan {
  const cache = indexEntries(cachedEntries);
  const hits: LocalOnlyV2CacheHit[] = [];
  const misses: LocalOnlyV2CacheMiss[] = [];

  for (const task of tasks) {
    const descriptor = buildLocalOnlyV2CacheDescriptor(task, policy);
    const cached = cache.get(descriptor.cacheKey);

    if (!cached || !descriptorMatches(cached, descriptor)) {
      misses.push(
        Object.freeze({
          task,
          descriptor,
          reason: "NOT_FOUND" as const,
        }),
      );
      continue;
    }

    try {
      const findings = parseLocalOnlyV2AtomicExtraction(
        cached.rawOutput,
        task.segment,
      );
      hits.push(
        Object.freeze({
          taskId: task.taskId,
          descriptor,
          findings,
        }),
      );
    } catch {
      misses.push(
        Object.freeze({
          task,
          descriptor,
          reason: "INVALID_CACHED_OUTPUT" as const,
        }),
      );
    }
  }

  return Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    hitCount: hits.length,
    missCount: misses.length,
    hits: Object.freeze(hits),
    misses: Object.freeze(misses),
  });
}
