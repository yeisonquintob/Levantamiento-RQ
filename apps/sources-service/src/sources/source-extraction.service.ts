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

async function spreadsheetText(buffer: Buffer): Promise<{
  text: string;
  sheetCount: number;
}> {
  const workbook = new ExcelJS.Workbook();

  const workbookBytes = Uint8Array.from(buffer);

  await workbook.xlsx.load(workbookBytes.buffer);

  const sections: string[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];

      for (let column = 1; column <= row.cellCount; column += 1) {
        cells.push(csvCell(row.getCell(column).text));
      }

      rows.push(cells.join(","));
    });

    sections.push(
      `# Hoja: ${worksheet.name}\n${rows.join("\n")}`,
    );
  });

  return {
    text: sections.join("\n\n"),
    sheetCount: workbook.worksheets.length,
  };
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

    if (extension === "txt") {
      text = buffer.toString("utf8");
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
      const result = await spreadsheetText(buffer);
      text = result.text;
      sheetCount = result.sheetCount;
    } else if (extension === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));

      try {
        const result = await extractText(pdf, {
          mergePages: true,
        });

        text = result.text;
        pageCount = result.totalPages;
      } finally {
        await pdf.destroy();
      }
    } else {
      processingMessage =
        "Imagen disponible como evidencia visual, sin OCR.";
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

    if (
      text !== null &&
      text.length > this.config.maxExtractedTextChars
    ) {
      text = text.slice(0, this.config.maxExtractedTextChars);
      processingMessage =
        `El texto fue limitado a ${this.config.maxExtractedTextChars} caracteres.`;
    }

    return {
      extractedText: text,
      processingMessage,
      pageCount,
      sheetCount,
    };
  }
}
