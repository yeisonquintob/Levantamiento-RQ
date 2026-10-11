import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { ObjectLiteral, SelectQueryBuilder } from "typeorm";

export function requireAuditAdministrator(actor: {
  permissions: readonly string[];
}): void {
  if (!actor.permissions.includes("system.admin"))
    throw new ForbiddenException(
      "La auditoría administrativa requiere permiso de administración.",
    );
}

export interface AuditHistoryQuery {
  page: number;
  pageSize: number;
  search?: string;
  result?: string;
  projectId?: string;
  from?: Date;
  to?: Date;
}

export function parseAuditHistoryQuery(
  input: Readonly<Record<string, unknown>>,
): AuditHistoryQuery {
  const number = (key: string, fallback: number, max: number): number => {
    const value = input[key] === undefined ? fallback : Number(input[key]);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new BadRequestException(`${key} fuera de rango.`);
    return value;
  };
  const text = (key: string, max: number): string | undefined => {
    if (input[key] === undefined || input[key] === "") return undefined;
    if (typeof input[key] !== "string" || input[key].length > max)
      throw new BadRequestException(`${key} inválido.`);
    return input[key].trim() || undefined;
  };
  const date = (key: string): Date | undefined => {
    const value = text(key, 10);
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value))
      throw new BadRequestException(`${key} debe tener formato AAAA-MM-DD.`);
    const result = new Date(
      `${value}T${key === "to" ? "23:59:59.999" : "00:00:00.000"}-05:00`,
    );
    if (
      Number.isNaN(result.valueOf()) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException(`${key} no es una fecha válida.`);
    return result;
  };
  const result = text("result", 20);
  if (result && !["SUCCEEDED", "FAILED", "DENIED"].includes(result))
    throw new BadRequestException("Resultado inválido.");
  const projectId = text("projectId", 36);
  if (
    projectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      projectId,
    )
  )
    throw new BadRequestException("Proyecto inválido.");
  const from = date("from"),
    to = date("to");
  if (from && to && from > to)
    throw new BadRequestException("El rango de fechas es inválido.");
  return {
    page: number("page", 1, 100000),
    pageSize: number("pageSize", 50, 100),
    search: text("search", 200),
    result,
    projectId,
    from,
    to,
  };
}

export async function readAuditHistory<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  input: Readonly<Record<string, unknown>>,
  columns: {
    date: string;
    id: string;
    search: string[];
    result?: string;
    projectId?: string;
  },
) {
  const query = parseAuditHistoryQuery(input);
  if (query.search) {
    const search = `%${query.search.replace(/[[%_]/gu, (char) => `[${char}]`)}%`;
    builder.andWhere(
      `(${columns.search.map((column) => `${column} LIKE :auditSearch`).join(" OR ")})`,
      { auditSearch: search },
    );
  }
  if (query.from)
    builder.andWhere(`${columns.date} >= :auditFrom`, {
      auditFrom: query.from,
    });
  if (query.to)
    builder.andWhere(`${columns.date} <= :auditTo`, { auditTo: query.to });
  if (query.projectId && columns.projectId)
    builder.andWhere(`${columns.projectId} = :auditProject`, {
      auditProject: query.projectId,
    });
  if (query.result) {
    if (columns.result)
      builder.andWhere(`${columns.result} = :auditResult`, {
        auditResult: query.result,
      });
    else if (query.result !== "SUCCEEDED") builder.andWhere("1 = 0");
  }
  const [items, totalItems] = await builder
    .orderBy(columns.date, "DESC")
    .addOrderBy(columns.id, "DESC")
    .skip((query.page - 1) * query.pageSize)
    .take(query.pageSize)
    .getManyAndCount();
  return {
    items,
    totalItems,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(totalItems / query.pageSize),
  };
}
