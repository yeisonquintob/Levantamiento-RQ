import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  type JsonRecord,
  recordValue,
  stringList,
  cleanDocumentText,
} from "./shared";

export const NON_FUNCTIONAL_FIELDS = [
  { key: "security", label: "Seguridad", list: true },
  { key: "traceability", label: "Trazabilidad", list: true },
  { key: "performance", label: "Rendimiento", list: true },
  { key: "compatibility", label: "Compatibilidad", list: true },
  { key: "availability", label: "Disponibilidad", list: true },
  { key: "usability", label: "Usabilidad", list: true },
] as const;

type NonFunctionalFieldKey = (typeof NON_FUNCTIONAL_FIELDS)[number]["key"];

function normalizedNonFunctionalLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

function nonFunctionalKeys(value: string): NonFunctionalFieldKey[] {
  const label = normalizedNonFunctionalLabel(value);
  const keys: NonFunctionalFieldKey[] = [];
  const add = (key: NonFunctionalFieldKey) => {
    if (!keys.includes(key)) keys.push(key);
  };

  if (/seguridad|autentic|autoriz|credencial|cifrad/u.test(label))
    add("security");
  if (
    /trazabilidad|auditor|auditab|logging|registro de eventos|timestamp|historial|seguimiento|cambios? de estado/u.test(
      label,
    )
  )
    add("traceability");
  if (
    /rendimiento|desempeno|latencia|tiempo de respuesta|tiempos? maximos?|umbral|throughput/u.test(
      label,
    )
  )
    add("performance");
  if (
    /compatibilidad|integracion|interoperabilidad|multiplataforma/u.test(label)
  )
    add("compatibility");
  if (
    /disponibilidad|respaldo|recuperacion|continuidad|sla|rto|rpo/u.test(label)
  )
    add("availability");
  if (
    /usabilidad|accesibilidad|experiencia|navegacion|interfaz|conversacional/u.test(
      label,
    )
  )
    add("usability");

  return keys;
}

function cleanNonFunctionalItem(value: string): string {
  return cleanDocumentText(value)
    .replace(/^\s*(?:[-•▪◦]|\d{1,2}[.)])\s*/u, "")
    .replace(/^[\s,;:.]+|[\s,;]+$/gu, "")
    .trim();
}

function splitNonFunctionalItems(value: string): string[] {
  return value
    .split(/\s*(?:;|\r?\n+)\s*/gu)
    .map(cleanNonFunctionalItem)
    .filter(Boolean);
}

function emptyNonFunctionalRequirements(): Record<
  NonFunctionalFieldKey,
  string[]
> {
  return {
    security: [],
    traceability: [],
    performance: [],
    compatibility: [],
    availability: [],
    usability: [],
  };
}

function parseNonFunctionalNarrative(
  value: string,
): Record<NonFunctionalFieldKey, string[]> | null {
  const prepared = cleanDocumentText(value)
    .replace(/\r/gu, "")
    .replace(/\s+[-•▪◦]\s+(?=[\p{Lu}\p{Lt}])/gu, "\n- ");
  const lines = prepared
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;

  for (const originalLine of lines) {
    const line = originalLine.replace(/^[-•▪◦]\s*/u, "").trim();
    if (
      /^(?:atributos|requisitos|requerimientos)\s+no\s+funcionales(?:\s+identificados)?\s*:?$/iu.test(
        line,
      )
    )
      continue;

    const separator = line.indexOf(":");
    const heading = separator > 0 ? line.slice(0, separator).trim() : "";
    const keys = nonFunctionalKeys(heading);
    if (keys.length > 0) {
      if (current) entries.push(current);
      current = {
        heading,
        body: line.slice(separator + 1).trim(),
      };
      continue;
    }
    if (current) {
      current.body = `${current.body} ${line}`.trim();
      continue;
    }
    return null;
  }
  if (current) entries.push(current);
  if (entries.length === 0) return null;

  const result = emptyNonFunctionalRequirements();
  for (const entry of entries) {
    const headingKeys = nonFunctionalKeys(entry.heading);
    const items = splitNonFunctionalItems(entry.body);
    for (const item of items) {
      const itemKeys = nonFunctionalKeys(item);
      const targetKeys = itemKeys.length > 0 ? itemKeys : headingKeys;
      for (const key of targetKeys) {
        if (!result[key].includes(item)) result[key].push(item);
      }
    }
  }
  return result;
}

export function normalizeNonFunctionalRequirements(
  value: DocumentJsonValue,
): JsonRecord | null {
  if (typeof value === "string") return parseNonFunctionalNarrative(value);
  const record = recordValue(value);
  if (!record) return null;

  const normalized: JsonRecord = { ...record };
  for (const { key } of NON_FUNCTIONAL_FIELDS) {
    const current = record[key];
    normalized[key] = Array.isArray(current)
      ? stringList(current)
      : typeof current === "string"
        ? splitNonFunctionalItems(current)
        : [];
  }

  if (typeof record.narrative === "string") {
    const narrative = parseNonFunctionalNarrative(record.narrative);
    if (narrative) {
      for (const { key } of NON_FUNCTIONAL_FIELDS) {
        normalized[key] = [
          ...new Set([...stringList(normalized[key]), ...narrative[key]]),
        ];
      }
    }
  }
  return normalized;
}
