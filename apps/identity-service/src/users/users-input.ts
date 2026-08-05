import { BadRequestException } from "@nestjs/common";

export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

export function text(
  record: Readonly<Record<string, unknown>>,
  name: string,
  minimum: number,
  maximum: number,
): string {
  const value = record[name];

  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.trim().length > maximum
  ) {
    throw new BadRequestException(
      `${name} debe tener entre ${minimum} y ${maximum} caracteres.`,
    );
  }

  return value.trim();
}

export function optionalText(
  record: Readonly<Record<string, unknown>>,
  name: string,
  minimum: number,
  maximum: number,
): string | undefined {
  return record[name] === undefined
    ? undefined
    : text(record, name, minimum, maximum);
}

export function email(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new BadRequestException("El correo electrónico no es válido.");
  }

  return normalized;
}

export function roleCodes(
  record: Readonly<Record<string, unknown>>,
): string[] {
  const value = record.roleCodes;

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !/^[A-Z0-9._-]{2,100}$/u.test(item.trim().toUpperCase()),
    )
  ) {
    throw new BadRequestException(
      "roleCodes debe contener al menos un rol válido.",
    );
  }

  return [...new Set(value.map((item) => String(item).trim().toUpperCase()))];
}

export function pagination(value: unknown, fallback: number, maximum: number): number {
  const resolved = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new BadRequestException(`El valor debe estar entre 1 y ${maximum}.`);
  }

  return resolved;
}
