import {
  UUID_PATTERN,
  ISO_DATE_PATTERN,
  PENDING_SUMMARY_LIMIT,
} from "./ai-draft-constants";

export function object(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} no es un objeto válido.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

export function string(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${name} no es texto válido.`);
  }
  return value.trim();
}

export function pushReconciliationWarning(
  warnings: string[],
  message: string,
): void {
  const normalized = message.replaceAll(/\s+/gu, " ").trim().slice(0, 2_000);
  if (normalized && !warnings.includes(normalized) && warnings.length < 100) {
    warnings.push(normalized);
  }
}

export function nullableString(
  value: unknown,
  name: string,
  maximum: number,
): string | null {
  return value === null ? null : string(value, name, maximum);
}

export function integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} no es un entero válido.`);
  }
  return value;
}

export function strings(
  value: unknown,
  name: string,
  maximumItems: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${name} no es una lista válida.`);
  }
  return value.map((item, index) => string(item, `${name}[${index}]`, 2_000));
}

export function pendingSummaryStrings(value: unknown, name: string): string[] {
  return strings(value, name, 100).slice(0, PENDING_SUMMARY_LIMIT);
}

export function array(
  value: unknown,
  name: string,
  maximumItems: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${name} no es una lista válida.`);
  }
  return value;
}

function uuid(value: unknown, name: string): string {
  const parsed = string(value, name, 36).toLowerCase();
  if (!new RegExp(UUID_PATTERN, "u").test(parsed)) {
    throw new Error(`${name} no es un UUID válido.`);
  }
  return parsed;
}

export function sourceIds(value: unknown, name: string): string[] {
  return array(value, name, 100).map((item, index) =>
    uuid(item, `${name}[${index}]`),
  );
}

export function unique(values: readonly string[], name: string): void {
  const normalized = values.map((item) => item.toUpperCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} contiene códigos duplicados.`);
  }
}

export function isoDate(value: string, name: string): string {
  if (!new RegExp(ISO_DATE_PATTERN, "u").test(value)) {
    throw new Error(`${name} no tiene formato YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} no es una fecha válida.`);
  }
  return value;
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
