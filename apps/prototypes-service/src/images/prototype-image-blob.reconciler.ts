import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PrototypeGeneratedImageEntity } from "./prototype-generated-image.entity";
import { PrototypeImageBlobStorage } from "./prototype-image-blob.storage";
import {
  PROTOTYPE_IMAGE_CONFIG,
  type PrototypeImageConfig,
} from "./prototype-image.config";

export interface PrototypeBlobReconciliation {
  mode: "OFF" | "REPORT" | "DELETE";
  scanned: number;
  referenced: number;
  orphans: number;
  deleted: number;
  skippedRecent: number;
  aborted: string | null;
}

/**
 * SQL es la fuente de verdad: un archivo de Blob Storage que ninguna imagen referencia (ni como
 * versión actual ni como anterior) es huérfano. Se acumulan por fallos entre la subida y el
 * guardado o por borrados que fallaron. Para no dañar nada:
 * - por defecto solo informa (REPORT); borrar exige PROTOTYPE_BLOB_RECONCILE_MODE=DELETE;
 * - ignora archivos recientes (cubre subidas en curso);
 * - limita los borrados por ejecución;
 * - se detiene si SQL no devuelve ninguna referencia y hay archivos (consulta sospechosa).
 */
@Injectable()
export class PrototypeImageBlobReconciler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrototypeImageBlobReconciler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private readonly storage: PrototypeImageBlobStorage,
    @InjectRepository(PrototypeGeneratedImageEntity)
    private readonly images: Repository<PrototypeGeneratedImageEntity>,
    @Inject(PROTOTYPE_IMAGE_CONFIG)
    private readonly config: PrototypeImageConfig,
  ) {}

  onModuleInit() {
    const { mode, intervalMs } = this.config.blobReconcile;
    if (mode === "OFF") return;
    // Primera pasada pasado un rato del arranque y luego periódica; no impide cerrar el proceso.
    this.timer = setInterval(() => void this.runSafely(), intervalMs);
    this.timer.unref();
    const first = setTimeout(() => void this.runSafely(), 10 * 60_000);
    first.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runSafely(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: "PROTOTYPE_BLOB_RECONCILE_FAILED",
          reason: error instanceof Error ? error.name : "UNKNOWN",
        }),
      );
    } finally {
      this.running = false;
    }
  }

  async reconcile(
    now: Date = new Date(),
  ): Promise<PrototypeBlobReconciliation> {
    const { mode, graceMs, maxDeletesPerRun } = this.config.blobReconcile;
    const result: PrototypeBlobReconciliation = {
      mode,
      scanned: 0,
      referenced: 0,
      orphans: 0,
      deleted: 0,
      skippedRecent: 0,
      aborted: null,
    };
    if (mode === "OFF") return result;

    const rows = await this.images.find({
      select: ["storageKey", "previousStorageKey"],
    });
    const referenced = new Set<string>();
    for (const row of rows)
      for (const key of [row.storageKey, row.previousStorageKey])
        if (key) referenced.add(key);
    result.referenced = referenced.size;

    const orphanNames: string[] = [];
    const cutoff = now.getTime() - graceMs;
    for await (const blob of this.storage.list()) {
      result.scanned += 1;
      if (referenced.has(blob.name)) continue;
      if (blob.lastModified.getTime() > cutoff) {
        result.skippedRecent += 1;
        continue;
      }
      result.orphans += 1;
      orphanNames.push(blob.name);
    }

    if (referenced.size === 0 && result.scanned > 0 && mode === "DELETE") {
      result.aborted = "SQL no devolvió referencias: no se borra nada.";
    } else if (mode === "DELETE") {
      for (const name of orphanNames.slice(0, maxDeletesPerRun)) {
        try {
          await this.storage.delete(name);
          result.deleted += 1;
        } catch {
          // Se reintentará en la siguiente pasada.
        }
      }
    }

    this.logger.log(
      JSON.stringify({
        event: "PROTOTYPE_BLOB_RECONCILE",
        ...result,
        // Nombres de ejemplo (sin contenido) para poder revisarlos en modo REPORT.
        sample: orphanNames.slice(0, 5),
      }),
    );
    return result;
  }
}
