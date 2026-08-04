import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SOURCE_CLASSIFICATIONS,
  SOURCE_FILE_EXTENSIONS,
  SOURCE_PROCESSING_STATUSES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  TEXT_SOURCE_TYPES,
} from "../../libs/shared/contracts/src/lib/sources.js";
import {
  parseCreateTextSource,
  parseSourceListQuery,
  parseUpdateSource,
  parseUploadMetadata,
} from "../../apps/sources-service/src/sources/sources-input.js";
import {
  titleFromFileName,
  validateSourceFile,
} from "../../apps/sources-service/src/sources/source-file-validation.js";
import {
  loadSourcesStorageConfig,
} from "../../apps/sources-service/src/sources/sources-storage.config.js";
import {
  SourceExtractionService,
} from "../../apps/sources-service/src/sources/source-extraction.service.js";

test("el contrato publica tipos, formatos y estados controlados", () => {
  assert.deepEqual(SOURCE_TYPES, [
    "FILE",
    "NOTE",
    "CONVERSATION",
    "TRANSCRIPT",
  ]);
  assert.deepEqual(TEXT_SOURCE_TYPES, [
    "NOTE",
    "CONVERSATION",
    "TRANSCRIPT",
  ]);
  assert.deepEqual(SOURCE_STATUSES, ["ACTIVE", "ARCHIVED"]);
  assert.deepEqual(SOURCE_PROCESSING_STATUSES, [
    "PENDING",
    "PROCESSING",
    "READY",
    "FAILED",
  ]);
  assert.deepEqual(SOURCE_CLASSIFICATIONS, [
    "REQUIREMENT",
    "MEETING",
    "CURRENT_PROCESS",
    "BUSINESS_RULE",
    "EVIDENCE",
    "MANUAL",
    "INTEGRATION",
    "DATA",
    "OTHER",
  ]);
  assert.deepEqual(SOURCE_FILE_EXTENSIONS, [
    "pdf",
    "docx",
    "xlsx",
    "txt",
    "csv",
    "png",
    "jpg",
    "jpeg",
    "webp",
  ]);
});

test("la creación textual normaliza sus campos", () => {
  assert.deepEqual(
    parseCreateTextSource({
      sourceType: "NOTE",
      title: "  Entrevista inicial  ",
      content: "  El usuario requiere trazabilidad.  ",
    }),
    {
      sourceType: "NOTE",
      title: "Entrevista inicial",
      content: "El usuario requiere trazabilidad.",
    },
  );
});

test("FILE utiliza la ruta multipart y no la creación textual", () => {
  assert.throws(
    () =>
      parseCreateTextSource({
        sourceType: "FILE",
        title: "Documento",
        content: "Contenido",
      }),
    /NOTE, CONVERSATION o TRANSCRIPT/,
  );
});

test("la actualización exige al menos un campo", () => {
  assert.throws(() => parseUpdateSource({}), /al menos un campo/i);
});

test("cada archivo exige clasificación y admite descripción", () => {
  assert.deepEqual(
    parseUploadMetadata(
      JSON.stringify([
        {
          fileName: "acta.pdf",
          classification: "MEETING",
          description: "  Reunión inicial  ",
        },
        {
          fileName: "reglas.docx",
          classification: "BUSINESS_RULE",
          description: "",
        },
      ]),
    ),
    [
      {
        fileName: "acta.pdf",
        classification: "MEETING",
        description: "Reunión inicial",
      },
      {
        fileName: "reglas.docx",
        classification: "BUSINESS_RULE",
        description: null,
      },
    ],
  );

  assert.throws(
    () =>
      parseUploadMetadata(
        JSON.stringify([
          {
            fileName: "sin-clasificar.pdf",
            classification: "",
          },
        ]),
      ),
    /clasificación válida/i,
  );
});

test("los filtros incluyen paginación y procesamiento", () => {
  assert.deepEqual(
    parseSourceListQuery({
      search: "  entrevista  ",
      sourceType: "FILE",
      processingStatus: "READY",
      status: "ACTIVE",
      page: "2",
      pageSize: "25",
    }),
    {
      search: "entrevista",
      sourceType: "FILE",
      processingStatus: "READY",
      status: "ACTIVE",
      page: 2,
      pageSize: 25,
    },
  );
});

test("la validación de archivos controla extensión, tamaño y firma", () => {
  const validText = validateSourceFile(
    "evidencia.txt",
    Buffer.from("Contenido válido", "utf8"),
    1024,
  );

  assert.equal(validText.extension, "txt");
  assert.equal(validText.mediaType, "text/plain; charset=utf-8");
  assert.equal(titleFromFileName("evidencia.txt"), "evidencia");

  assert.throws(
    () =>
      validateSourceFile(
        "falso.pdf",
        Buffer.from("no es pdf", "utf8"),
        1024,
      ),
    /firma del formato/i,
  );

  assert.throws(
    () =>
      validateSourceFile(
        "grande.txt",
        Buffer.alloc(20),
        10,
      ),
    /tamaño máximo/i,
  );
});

test("la configuración aplica límites seguros de carga", () => {
  const config = loadSourcesStorageConfig({
    AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
    SOURCES_STORAGE_CONTAINER: "rq-sources",
    SOURCES_MAX_FILE_BYTES: "1048576",
    SOURCES_MAX_FILES_PER_UPLOAD: "5",
    SOURCES_MAX_BATCH_BYTES: "5242880",
    SOURCES_MAX_EXTRACTED_TEXT_CHARS: "50000",
  });

  assert.equal(config.containerName, "rq-sources");
  assert.equal(config.maxFileBytes, 1048576);
  assert.equal(config.maxFilesPerUpload, 5);
  assert.equal(config.maxBatchBytes, 5242880);
});

test("la extracción prepara TXT, CSV e imágenes", async () => {
  const config = loadSourcesStorageConfig({
    AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
    SOURCES_STORAGE_CONTAINER: "rq-sources",
    SOURCES_MAX_FILE_BYTES: "1048576",
    SOURCES_MAX_FILES_PER_UPLOAD: "5",
    SOURCES_MAX_BATCH_BYTES: "5242880",
    SOURCES_MAX_EXTRACTED_TEXT_CHARS: "50000",
  });
  const extractor = new SourceExtractionService(config);

  const text = await extractor.extract(
    "txt",
    Buffer.from("Necesidad\r\nfuncional", "utf8"),
  );
  const csv = await extractor.extract(
    "csv",
    Buffer.from("campo,valor\nprioridad,alta", "utf8"),
  );
  const image = await extractor.extract(
    "png",
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );

  assert.equal(text.extractedText, "Necesidad\nfuncional");
  assert.match(csv.extractedText ?? "", /prioridad,alta/);
  assert.equal(csv.sheetCount, 1);
  assert.equal(image.extractedText, null);
  assert.match(image.processingMessage ?? "", /sin OCR/i);
});

test("las migraciones mantienen la autonomía de RqSourcesDb", async () => {
  const foundation = await readFile(
    "apps/sources-service/src/database/migrations/1785801600000-CreateSourcesFoundation.ts",
    "utf8",
  );
  const files = await readFile(
    "apps/sources-service/src/database/migrations/1785888000000-AddSourceFilesAndExtraction.ts",
    "utf8",
  );
  const metadata = await readFile(
    "apps/sources-service/src/database/migrations/1786060801000-AddSourceClassificationAndDescription.ts",
    "utf8",
  );

  assert.match(foundation, /CREATE TABLE dbo\.Sources/);
  assert.match(foundation, /ProjectId uniqueidentifier NOT NULL/);
  assert.match(files, /ProcessingMessage nvarchar\(2000\)/);
  assert.match(files, /FileExtension nvarchar\(24\)/);
  assert.match(files, /UX_Sources_ProjectId_Sha256_ActiveFile/);
  assert.match(files, /'PROCESSING'/);
  assert.match(metadata, /Description nvarchar\(2000\)/);
  assert.match(metadata, /Classification nvarchar\(40\)/);
  assert.match(metadata, /IX_Sources_ProjectId_Classification/);
  assert.doesNotMatch(
    `${foundation}\n${files}\n${metadata}`,
    /FOREIGN KEY\s*\(ProjectId\)/i,
  );
  assert.doesNotMatch(`${foundation}\n${files}\n${metadata}`, /RqProjectsDb/i);
});

test("Sources valida el proyecto por API y no por repositorio externo", async () => {
  const client = await readFile(
    "apps/sources-service/src/sources/projects-access.client.ts",
    "utf8",
  );

  assert.match(client, /\/api\/v1\/projects\//);
  assert.match(client, /authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(client, /ProjectEntity/);
  assert.doesNotMatch(client, /InjectRepository\(Project/);
});

test("las dependencias de extracción evitan el paquete xlsx vulnerable", async () => {
  const packageJson = JSON.parse(
    await readFile("apps/sources-service/package.json", "utf8"),
  ) as {
    dependencies?: Readonly<Record<string, string>>;
  };

  assert.equal(packageJson.dependencies?.exceljs, "4.4.0");
  assert.equal(packageJson.dependencies?.xlsx, undefined);
});

test("el almacenamiento, la extracción y la descarga son privados", async () => {
  const storage = await readFile(
    "apps/sources-service/src/sources/source-blob-storage.service.ts",
    "utf8",
  );
  const extraction = await readFile(
    "apps/sources-service/src/sources/source-extraction.service.ts",
    "utf8",
  );
  const service = await readFile(
    "apps/sources-service/src/sources/sources.service.ts",
    "utf8",
  );

  assert.match(storage, /BlobServiceClient\.fromConnectionString/);
  assert.match(storage, /uploadData/);
  assert.match(storage, /downloadToBuffer/);
  assert.doesNotMatch(storage, /generateBlobSASQueryParameters/);
  assert.match(extraction, /mammoth\.extractRawText/);
  assert.match(extraction, /new ExcelJS\.Workbook/);
  assert.match(extraction, /extractText\(pdf/);
  assert.match(service, /requireRead/);
  assert.match(service, /requireManage/);
  assert.match(service, /duplicateSourceId/);
});

test("Gateway y frontend usan una sola experiencia Nueva fuente", async () => {
  const gateway = await readFile(
    "apps/gateway/src/sources/sources-client.service.ts",
    "utf8",
  );
  const controller = await readFile(
    "apps/gateway/src/sources/sources-gateway.controller.ts",
    "utf8",
  );
  const client = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );

  assert.match(gateway, /requestMultipart/);
  assert.match(gateway, /FormData/);
  assert.match(controller, /request\.parts\(\)/);
  assert.match(client, />\s*Nueva fuente\s*</);
  assert.match(client, />\s*Fuente textual\s*</);
  assert.match(client, />\s*Subir archivos\s*</);
  assert.match(client, /multiple/);
  assert.match(client, /onDrop=\{handleDrop\}/);
  assert.match(client, /Clasificación/);
  assert.match(client, /Descripción opcional/);
  assert.match(client, />\s*Editar\s*</);
  assert.match(client, />\s*Eliminar\s*</);
  assert.match(client, /data\.append\(\s*"metadata"/);
  assert.match(client, /Reprocesar/);
  assert.match(client, /Descargar/);
  assert.doesNotMatch(client, /127\.0\.0\.1:3003/);
});

test("KPI y Nueva fuente aparecen antes del selector de proyecto", async () => {
  const client = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );

  assert.ok(
    client.indexOf('className="rq-module-commandbar"') <
      client.indexOf('className="rq-source-project-card"'),
  );
  assert.match(client, /Etapa del proyecto/);
  assert.match(client, /Paso 13 completo/);
});
