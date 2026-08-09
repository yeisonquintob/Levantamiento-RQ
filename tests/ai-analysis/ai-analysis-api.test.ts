import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseAiAnalysisRequestListQuery,
  parseCreateAiAnalysisRequest,
  parseReviewAiAnalysisResult,
} from "../../apps/ai-analysis-service/src/analysis/ai-analysis-input.js";
import {
  AI_ANALYSIS_STATUSES,
  type SourceDetail,
} from "../../libs/shared/contracts/src/index.js";
import {
  loadAiAnalysisAuthConfig,
  type AiAnalysisAuthConfig,
} from "../../apps/ai-analysis-service/src/analysis/ai-analysis-auth.config.js";
import { AiAnalysisDocumentsAccessClient } from "../../apps/ai-analysis-service/src/analysis/documents-access.client.js";
import { AiAnalysisSourcesAccessClient } from "../../apps/ai-analysis-service/src/analysis/sources-access.client.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const CONFIG: AiAnalysisAuthConfig = {
  issuer: "levantamiento-rq-identity",
  audience: "levantamiento-rq",
  accessSecret: "ai-analysis-test-secret-with-32-characters",
  projectsServiceUrl: "http://127.0.0.1:3002",
  projectsTimeoutMs: 8000,
  documentsServiceUrl: "http://127.0.0.1:3004",
  documentsTimeoutMs: 8000,
  sourcesServiceUrl: "http://127.0.0.1:3003",
  sourcesTimeoutMs: 8000,
};

function httpError(
  error: unknown,
  expectedStatus: number,
  text: RegExp,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    getStatus?: () => number;
    message?: unknown;
  };

  return (
    typeof candidate.getStatus === "function" &&
    candidate.getStatus() === expectedStatus &&
    typeof candidate.message === "string" &&
    text.test(candidate.message)
  );
}

function source(overrides: Partial<SourceDetail> = {}): SourceDetail {
  return {
    id: UUID_C,
    projectId: UUID_A,
    sourceType: "NOTE",
    title: "Fuente",
    description: null,
    classification: "REQUIREMENT",
    contentPreview: "Contenido",
    processingStatus: "READY",
    processingMessage: null,
    processedAt: "2026-08-06T12:00:00.000Z",
    status: "ACTIVE",
    originalFileName: null,
    fileExtension: null,
    mediaType: null,
    fileSizeBytes: null,
    sha256: null,
    pageCount: null,
    sheetCount: null,
    createdByUserId: UUID_B,
    updatedByUserId: UUID_B,
    createdAt: "2026-08-06T12:00:00.000Z",
    updatedAt: "2026-08-06T12:00:00.000Z",
    content: "Contenido",
    extractedText: null,
    storageContainer: null,
    storagePath: null,
    ...overrides,
  };
}

test("la creación normaliza UUID, fuentes y tipo de análisis", () => {
  assert.deepEqual(
    parseCreateAiAnalysisRequest({
      documentId: UUID_A.toUpperCase(),
      documentVersionId: UUID_B,
      sourceIds: [UUID_C],
    }),
    {
      analysisType: "REQUIREMENT_DOCUMENT",
      documentId: UUID_A,
      documentVersionId: UUID_B,
      sourceIds: [UUID_C],
    },
  );
});

test("la creación rechaza duplicados y listas vacías", () => {
  assert.throws(
    () =>
      parseCreateAiAnalysisRequest({
        documentId: UUID_A,
        documentVersionId: UUID_B,
        sourceIds: [],
      }),
    /entre 1 y 100/i,
  );

  assert.throws(
    () =>
      parseCreateAiAnalysisRequest({
        documentId: UUID_A,
        documentVersionId: UUID_B,
        sourceIds: [UUID_C, UUID_C],
      }),
    /duplicados/i,
  );
});

test("el listado valida estado y paginación", () => {
  assert.deepEqual(parseAiAnalysisRequestListQuery({}), {
    status: null,
    page: 1,
    pageSize: 25,
  });

  for (const status of AI_ANALYSIS_STATUSES) {
    assert.equal(parseAiAnalysisRequestListQuery({ status }).status, status);
  }

  assert.throws(
    () => parseAiAnalysisRequestListQuery({ pageSize: 101 }),
    /entre 1 y 100/i,
  );
});

test("la revisión humana valida concurrencia y comentario", () => {
  assert.deepEqual(
    parseReviewAiAnalysisResult({
      expectedDocumentRevision: 5,
      comment: "  Validado con el usuario  ",
    }),
    {
      expectedDocumentRevision: 5,
      comment: "Validado con el usuario",
    },
  );
  assert.deepEqual(parseReviewAiAnalysisResult({}), {
    expectedDocumentRevision: undefined,
    comment: null,
  });
  assert.throws(
    () => parseReviewAiAnalysisResult({ expectedDocumentRevision: 0 }),
    /expectedDocumentRevision/i,
  );
  assert.throws(
    () => parseReviewAiAnalysisResult({ comment: "x".repeat(2001) }),
    /2000/i,
  );
});

test("la configuración publica Projects, Documents y Sources", () => {
  const config = loadAiAnalysisAuthConfig({
    JWT_ACCESS_SECRET: CONFIG.accessSecret,
  });

  assert.equal(config.projectsServiceUrl, "http://127.0.0.1:3002");
  assert.equal(config.sourcesServiceUrl, "http://127.0.0.1:3003");
  assert.equal(config.documentsServiceUrl, "http://127.0.0.1:3004");
});

test("Documents Client exige proyecto y versión actual", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: UUID_B,
        projectId: UUID_A.toUpperCase(),
        status: "DRAFT",
        archivedAt: null,
        currentVersionDetail: {
          id: UUID_C.toUpperCase(),
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    const client = new AiAnalysisDocumentsAccessClient(CONFIG);

    await client.requireCurrentVersion(
      UUID_A,
      UUID_B,
      UUID_C,
      "token",
      "correlation",
    );

    await assert.rejects(
      client.requireCurrentVersion(
        UUID_A,
        UUID_B,
        UUID_B,
        "token",
        "correlation",
      ),
      (error: unknown) => httpError(error, 409, /versión actual/i),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sources Client exige ACTIVE y READY", async () => {
  const originalFetch = globalThis.fetch;
  let payload = source({
    projectId: UUID_A.toUpperCase(),
  });

  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const client = new AiAnalysisSourcesAccessClient(CONFIG);
    const result = await client.requireReadySources(
      UUID_A,
      [UUID_C],
      "token",
      "correlation",
    );

    assert.equal(result[0]?.id, UUID_C);

    payload = source({ processingStatus: "FAILED" });

    await assert.rejects(
      client.requireReadySources(UUID_A, [UUID_C], "token", "correlation"),
      (error: unknown) => httpError(error, 409, /READY/i),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST publica crear, listar, consultar, reintentar y revisar", async () => {
  const controller = await readFile(
    "apps/ai-analysis-service/src/analysis/ai-analysis.controller.ts",
    "utf8",
  );

  for (const fragment of [
    '@Post("projects/:projectId/analysis-requests")',
    '@Get("projects/:projectId/analysis-requests")',
    '@Get("projects/:projectId/analysis-requests/:analysisRequestId")',
    '"projects/:projectId/analysis-requests/:analysisRequestId/cancel"',
    '"projects/:projectId/analysis-requests/:analysisRequestId/retry"',
    '"projects/:projectId/analysis-requests/:analysisRequestId/result/accept"',
    '"projects/:projectId/analysis-requests/:analysisRequestId/result/reject"',
  ]) {
    assert.ok(
      controller.includes(fragment),
      `No se encontró la ruta esperada: ${fragment}`,
    );
  }
});

test("la API registra PENDING y no crea ejecuciones ni OpenAI", async () => {
  const service = await readFile(
    "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
    "utf8",
  );

  assert.match(service, /status: "PENDING"/);
  assert.match(service, /sourceUpdatedAt/);
  assert.match(service, /sourceSha256/);
  assert.match(service, /requireCurrentVersion/);
  assert.match(service, /requireReadySources/);
  assert.doesNotMatch(service, /OpenAI|ChatCompletion|Responses API/);
});

test("AppModule y AiAnalysisService comparten las referencias directas de entidades", async () => {
  const [moduleFile, service, servicePackage] = await Promise.all([
    readFile("apps/ai-analysis-service/src/app/app.module.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
      "utf8",
    ),
    readFile("apps/ai-analysis-service/package.json", "utf8"),
  ]);

  for (const entityModule of [
    "analysis-request.entity",
    "analysis-request-source.entity",
    "analysis-execution.entity",
  ]) {
    assert.match(moduleFile, new RegExp(`analysis/${entityModule}`));
    assert.match(service, new RegExp(`\\./${entityModule}`));
  }

  assert.doesNotMatch(moduleFile, /analysis\/entities/);
  assert.equal(
    JSON.parse(servicePackage).dependencies["supports-color"],
    "7.2.0",
    "AI Analysis debe resolver la misma instancia de Nest/TypeORM que shared-persistence",
  );
});
