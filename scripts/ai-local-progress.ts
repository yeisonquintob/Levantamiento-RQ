// Monitor de solo lectura de la generación con IA local.
//
// Muestra el estado real de la última solicitud de IA local: puntos de la
// plantilla, subunidades, tiempos y la última llamada al modelo. Solo lee
// metadatos (estados, conteos y métricas): nunca imprime contenido de fuentes,
// prompts ni respuestas. No modifica nada ni requiere reiniciar el servicio.
//
// Uso:  pnpm ai:local:progress          (una lectura)
//       pnpm ai:local:progress --watch  (se actualiza cada 5 segundos)
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import dataSource from "../apps/ai-analysis-service/src/database/data-source";

interface RequestRow {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorCode: string | null;
}

interface PointRow {
  blockNumber: number;
  blockTotal: number;
  label: string;
  status: string;
  updatedAt: Date;
  completedUnits: number | null;
  totalUnits: number | null;
}

interface CallMetric {
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  effectiveOutputTokens: number;
  outputTokensPerSecond: number | null;
  totalDurationMs: number;
}

const TRACE_DIRECTORY = join(process.cwd(), "logs", "ai-provider-trace");
const STATUS_LABELS: Record<string, string> = {
  PENDING: "en cola",
  PROCESSING: "en proceso",
  COMPLETED: "completada",
  FAILED: "fallida",
  CANCELLED: "cancelada",
};

function duration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

async function latestRequest(): Promise<RequestRow | null> {
  const rows = (await dataSource.query(`
    SELECT TOP 1 CONVERT(varchar(36), Id) AS id, Status AS status,
           CreatedAt AS createdAt, UpdatedAt AS updatedAt, ErrorCode AS errorCode
    FROM dbo.AnalysisRequests
    WHERE UseLocalAi = 1
    ORDER BY CreatedAt DESC`)) as RequestRow[];
  return rows[0] ?? null;
}

async function points(requestId: string): Promise<PointRow[]> {
  // Los conteos de subunidades se calculan en SQL para no cargar el contenido.
  const rows = (await dataSource.query(
    `SELECT BlockNumber AS blockNumber, BlockTotal AS blockTotal,
            BlockLabel AS label, Status AS status, UpdatedAt AS updatedAt,
            CASE WHEN ISJSON(StageValuesJson) = 1
                 THEN (SELECT COUNT(*) FROM OPENJSON(StageValuesJson, '$.units'))
                 END AS completedUnits,
            CASE WHEN ISJSON(StageValuesJson) = 1
                 THEN TRY_CONVERT(int, JSON_VALUE(StageValuesJson, '$.units[0].unitTotal'))
                 END AS totalUnits
     FROM dbo.LocalDraftBlockCheckpoints
     WHERE AnalysisRequestId = @0 AND SchemaVersion = 'LOCAL_ONLY_V2:1'
       AND ISJSON(StageValuesJson) = 1
       AND JSON_VALUE(StageValuesJson, '$.blockId') IS NOT NULL
     ORDER BY BlockNumber`,
    [requestId],
  )) as PointRow[];
  return rows;
}

async function recentCalls(since: Date): Promise<CallMetric[]> {
  let names: string[];
  try {
    names = (await readdir(TRACE_DIRECTORY)).filter((name) =>
      name.endsWith("_runtime-metrics.json"),
    );
  } catch {
    return [];
  }
  const recent = names.sort().slice(-400);
  const metrics: CallMetric[] = [];
  for (const name of recent) {
    try {
      const value = JSON.parse(
        await readFile(join(TRACE_DIRECTORY, name), "utf8"),
      ) as Record<string, unknown>;
      const timestamp = new Date(String(value.timestamp));
      if (timestamp < since) continue;
      metrics.push({
        timestamp,
        inputTokens: Number(value.inputTokens ?? 0),
        outputTokens: Number(value.outputTokens ?? 0),
        effectiveOutputTokens: Number(value.effectiveOutputTokens ?? 0),
        outputTokensPerSecond:
          typeof value.outputTokensPerSecond === "number"
            ? value.outputTokensPerSecond
            : null,
        totalDurationMs: Number(value.totalDurationMs ?? 0),
      });
    } catch {
      // Una traza ilegible no debe detener el monitor.
    }
  }
  return metrics;
}

async function render(): Promise<string> {
  const request = await latestRequest();
  if (!request) return "No hay solicitudes de IA local.";

  const now = Date.now();
  const started = request.createdAt.valueOf();
  const finished = ["COMPLETED", "FAILED", "CANCELLED"].includes(request.status)
    ? request.updatedAt.valueOf()
    : now;
  const rows = await points(request.id);
  const calls = await recentCalls(request.createdAt);
  const total = rows[0]?.blockTotal ?? 0;
  const completed = rows.filter((row) => row.status === "COMPLETED").length;
  const current = rows.find((row) => row.status === "PROCESSING") ?? null;

  const lines: string[] = [];
  lines.push(
    `IA LOCAL · solicitud ${request.id.slice(0, 8)} · ${STATUS_LABELS[request.status] ?? request.status} · transcurrido ${duration(finished - started)}`,
  );
  if (request.errorCode) lines.push(`Código de error: ${request.errorCode}`);
  lines.push(
    total > 0
      ? `Puntos completados: ${completed}/${total}${current ? ` · en curso: ${current.blockNumber}/${total} ${current.label}` : ""}`
      : "Aún no hay puntos: la preparación de las fuentes sigue en curso.",
  );
  lines.push("");
  lines.push(
    "  #   Punto                                        Estado       Subunid.  Duración",
  );
  let previous = started;
  for (const row of rows) {
    const end = row.status === "PROCESSING" ? now : row.updatedAt.valueOf();
    const subunits =
      row.totalUnits && row.totalUnits > 0
        ? `${Math.min(row.totalUnits, row.completedUnits ?? 0)}/${row.totalUnits}`
        : "—";
    const mark =
      row.status === "COMPLETED"
        ? "✓"
        : row.status === "PROCESSING"
          ? "▶"
          : "·";
    lines.push(
      `  ${mark} ${String(row.blockNumber).padStart(2)}  ${row.label.slice(0, 42).padEnd(42)}  ${(STATUS_LABELS[row.status] ?? row.status).padEnd(11)}  ${subunits.padEnd(8)}  ${duration(end - previous)}`,
    );
    previous = row.status === "COMPLETED" ? row.updatedAt.valueOf() : previous;
  }
  for (let number = rows.length + 1; number <= total; number += 1) {
    lines.push(`    ${String(number).padStart(2)}  (pendiente)`);
  }

  lines.push("");
  const last = calls.at(-1);
  if (last) {
    const truncated = calls.filter(
      (call) => call.outputTokens >= call.effectiveOutputTokens - 1,
    ).length;
    const speed = last.outputTokensPerSecond
      ? ` · ${last.outputTokensPerSecond.toFixed(1)} tokens/s`
      : "";
    lines.push(
      `Modelo: ${calls.length} llamadas · última hace ${duration(now - last.timestamp.valueOf())} (${last.inputTokens} tokens de entrada, ${last.outputTokens}/${last.effectiveOutputTokens} de salida${speed}) · ${truncated} llegaron al tope de salida`,
    );
  } else {
    lines.push("Modelo: sin llamadas registradas para esta solicitud.");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const watch = process.argv.includes("--watch");
  await dataSource.initialize();
  try {
    do {
      const output = await render();
      if (watch) process.stdout.write("\x1Bc");
      process.stdout.write(`${output}\n`);
      if (watch) {
        process.stdout.write("\n(Ctrl+C para salir · se actualiza cada 5 s)\n");
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    } while (watch);
  } finally {
    await dataSource.destroy();
  }
}

void main();
