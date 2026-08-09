import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type RequirementDocumentDetail,
} from "../libs/shared/contracts/src/index.js";
import dataSource from "../apps/ai-analysis-service/src/database/data-source.js";
import { AnalysisExecutionEntity } from "../apps/ai-analysis-service/src/analysis/analysis-execution.entity.js";
import { AnalysisPromptVersionEntity } from "../apps/ai-analysis-service/src/analysis/analysis-prompt-version.entity.js";
import { AnalysisRequestSourceEntity } from "../apps/ai-analysis-service/src/analysis/analysis-request-source.entity.js";
import { AnalysisRequestEntity } from "../apps/ai-analysis-service/src/analysis/analysis-request.entity.js";
import { AnalysisResultEntity } from "../apps/ai-analysis-service/src/analysis/analysis-result.entity.js";
import { AiAnalysisExecutionService } from "../apps/ai-analysis-service/src/execution/ai-analysis-execution.service.js";
import { parseAiAnalysisDraft } from "../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";

function documentSnapshot(
  projectId: string,
  documentId: string,
  versionId: string,
  actorId: string,
): RequirementDocumentDetail {
  const now = new Date().toISOString();
  return {
    id: documentId,
    projectId,
    title: "Documento E2E de IA",
    status: "DRAFT",
    revision: 1,
    currentVersionNumber: 1,
    currentVersion: "1.0.0",
    template: {
      id: randomUUID(),
      sourceTemplateId: randomUUID(),
      code: "RQ-MEDIUM",
      name: "Requerimiento mediano",
      version: "1.0.0",
      templateType: "MEDIUM_REQUIREMENT",
      appliedAt: now,
    },
    createdByUserId: actorId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    currentVersionDetail: {
      id: versionId,
      versionNumber: 1,
      version: "1.0.0",
      status: "DRAFT",
      revision: 1,
      changeSummary: "Versión inicial",
      createdByUserId: actorId,
      createdAt: now,
      updatedAt: now,
      approvedByUserId: null,
      approvedAt: null,
      sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
        id: randomUUID(),
        key: section.key,
        title: section.title,
        order: index + 1,
        content: {},
        templateControlled: index >= 10,
      })),
      fields: [],
      requirements: [],
      evidence: [],
    },
  };
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const requests = dataSource.getRepository(AnalysisRequestEntity);
  const sources = dataSource.getRepository(AnalysisRequestSourceEntity);
  const executions = dataSource.getRepository(AnalysisExecutionEntity);
  const prompts = dataSource.getRepository(AnalysisPromptVersionEntity);
  const results = dataSource.getRepository(AnalysisResultEntity);
  const analysisRequestId = randomUUID();
  const projectId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const actorId = randomUUID();
  const sourceId = randomUUID();
  const now = new Date();

  try {
    await requests.save(
      requests.create({
        id: analysisRequestId,
        projectId,
        documentId,
        documentVersionId: versionId,
        analysisType: "REQUIREMENT_DOCUMENT",
        status: "PENDING",
        requestedByUserId: actorId,
        documentSnapshotJson: JSON.stringify(
          documentSnapshot(projectId, documentId, versionId, actorId),
        ),
        createdAt: now,
        updatedAt: now,
        cancelledAt: null,
      }),
    );
    await sources.save(
      sources.create({
        id: randomUUID(),
        analysisRequestId,
        sourceId,
        sourceUpdatedAt: now,
        sourceSha256: "a".repeat(64),
        sourceTitle: "Entrevista de ventas",
        sourceClassification: "REQUIREMENT",
        snapshotText:
          "El asesor necesita registrar y consultar ventas perdidas.",
        position: 1,
        createdAt: now,
      }),
    );

    const service = new AiAnalysisExecutionService(
      requests,
      sources,
      executions,
      prompts,
      results,
      dataSource,
      {} as never,
      {
        vaultMode: "DISABLED",
        keychainService: "test",
        executionMode: "FAKE",
      },
    );
    await service.process(analysisRequestId, true);

    const [request, execution, result] = await Promise.all([
      requests.findOneByOrFail({ id: analysisRequestId }),
      executions.findOneByOrFail({ analysisRequestId }),
      results.findOneBy({ analysisRequestId }),
    ]);
    if (!result) {
      throw new Error(
        `La ejecución no produjo resultado (${execution.errorCode ?? "sin código"}: ${execution.errorMessage ?? "sin detalle"}).`,
      );
    }
    const draft = parseAiAnalysisDraft(JSON.parse(result.contentJson));

    assert.equal(request.status, "COMPLETED");
    assert.equal(execution.status, "COMPLETED");
    assert.equal(execution.provider, "FAKE");
    assert.equal(result.status, "GENERATED");
    assert.equal(draft.sections.length, 13);
    assert.deepEqual(draft.requirements[0]?.sourceIds, [sourceId]);
    console.log("✓ Ejecución FAKE completada de PENDING a COMPLETED.");
    console.log("✓ Resultado estructurado de 13 secciones persistido.");
    console.log("✓ Trazabilidad a la fuente preservada.");
  } finally {
    await requests.delete(analysisRequestId);
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo validar la ejecución de IA: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
