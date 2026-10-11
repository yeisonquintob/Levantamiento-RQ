import { Inject, Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import * as mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

import type { SourceFileExtension } from "@levantamiento-rq/shared-contracts";

import {
  SOURCES_STORAGE_CONFIG,
  type SourcesStorageConfig,
} from "./sources-storage.config";

export interface SourceExtractionResult {
  extractedText: string | null;
  processingMessage: string | null;
  pageCount: number | null;
  sheetCount: number | null;
}

function normalizeText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

async function spreadsheetText(buffer: Buffer, limits: SourcesStorageConfig): Promise<{
  text: string;
  sheetCount: number;
}> {
  const workbook = new ExcelJS.Workbook();

  const workbookBytes = Uint8Array.from(buffer);

  await workbook.xlsx.load(workbookBytes.buffer);

  if (workbook.worksheets.length > limits.maxSpreadsheetSheets) {
    throw new Error("El XLSX supera el máximo de hojas permitido.");
  }

  const sections: string[] = [];

  workbook.eachSheet((worksheet) => {
    if (worksheet.actualRowCount > limits.maxSpreadsheetRows) {
      throw new Error("El XLSX supera el máximo de filas permitido.");
    }
    if (worksheet.actualColumnCount > limits.maxSpreadsheetColumns) {
      throw new Error("El XLSX supera el máximo de columnas permitido.");
    }
    if (worksheet.actualRowCount * worksheet.actualColumnCount > limits.maxSpreadsheetCells) {
      throw new Error("El XLSX supera el máximo de celdas permitido.");
    }
    const rows: string[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];

      for (let column = 1; column <= row.cellCount; column += 1) {
        cells.push(csvCell(row.getCell(column).text));
      }

      rows.push(cells.join(","));
    });

    sections.push(`# Hoja: ${worksheet.name}\n${rows.join("\n")}`);
  });

  return {
    text: sections.join("\n\n"),
    sheetCount: workbook.worksheets.length,
  };
}

function webVttText(buffer: Buffer): string {
  const raw = buffer
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const transcript: string[] = [];

  for (const block of raw.split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    const first = lines[0] ?? "";
    if (/^WEBVTT(?:\s|$)/i.test(first)) continue;
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/i.test(first)) continue;

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    const cueLines = timingIndex >= 0 ? lines.slice(timingIndex + 1) : lines;
    if (cueLines.length === 0) continue;

    const cue = cueLines
      .join(" ")
      .replace(/<v\s+([^>]+)>/gi, "$1: ")
      .replace(/<\/v>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();

    if (cue) transcript.push(cue);
  }

  return transcript.join("\n");
}

@Injectable()
export class SourceExtractionService {
  constructor(
    @Inject(SOURCES_STORAGE_CONFIG)
    private readonly config: SourcesStorageConfig,
  ) {}

  async extract(
    extension: SourceFileExtension,
    buffer: Buffer,
  ): Promise<SourceExtractionResult> {
    let text: string | null = null;
    let pageCount: number | null = null;
    let sheetCount: number | null = null;
    let processingMessage: string | null = null;

    const extraction = async (): Promise<void> => {
    if (extension === "txt") {
      text = buffer.toString("utf8");
    } else if (extension === "vtt") {
      text = webVttText(buffer);
    } else if (extension === "csv") {
      text = buffer.toString("utf8");
      sheetCount = 1;
    } else if (extension === "docx") {
      const result = await mammoth.extractRawText({
        buffer,
      });

      text = result.value;

      if (result.messages.length > 0) {
        processingMessage = result.messages
          .map((message) => message.message)
          .join(" ")
          .slice(0, 2000);
      }
    } else if (extension === "xlsx") {
      const result = await spreadsheetText(buffer, this.config);
      text = result.text;
      sheetCount = result.sheetCount;
    } else if (extension === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));

      try {
        if (pdf.numPages > this.config.maxPdfPages) {
          throw new Error("El PDF supera el máximo de páginas permitido.");
        }
        const result = await extractText(pdf, {
          mergePages: true,
        });

        text = result.text;
        pageCount = result.totalPages;
      } finally {
        await pdf.destroy();
      }
    } else {
      processingMessage = "Imagen disponible como evidencia visual, sin OCR.";
    }
    };

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        extraction(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("El parser excedió el tiempo máximo permitido.")),
            this.config.parserTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const normalized = text === null ? null : normalizeText(text);

    if (normalized !== null && normalized.length === 0) {
      processingMessage =
        processingMessage ??
        "El archivo fue procesado, pero no contiene texto extraíble.";
      text = null;
    } else {
      text = normalized;
    }

    if (text !== null && text.length > this.config.maxExtractedTextChars) {
      text = text.slice(0, this.config.maxExtractedTextChars);
      processingMessage = `El texto fue limitado a ${this.config.maxExtractedTextChars} caracteres.`;
    }

    return {
      extractedText: text,
      processingMessage,
      pageCount,
      sheetCount,
    };
  }
}
