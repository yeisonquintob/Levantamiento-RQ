import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import source from "../apps/documents-service/src/database/data-source";
import { DocumentsService } from "../apps/documents-service/src/documents/documents.service";
import * as entities from "../apps/documents-service/src/documents/document.entities";
import { DocumentTemplateEntity } from "../apps/documents-service/src/templates/document-template.entity";
import {
  renderPdf,
  type RenderApprovedDocumentInput,
} from "../apps/operations-service/src/operations/export-document.renderer";

async function main() {
  const documentId = process.argv[2];
  if (!documentId || !/^[a-f0-9-]{36}$/iu.test(documentId))
    throw new Error("Indica el UUID del documento.");
  source.setOptions({
    entities: [...Object.values(entities), DocumentTemplateEntity],
  });
  await source.initialize();
  try {
    const repo = <T extends object>(entity: new () => T) =>
      source.getRepository(entity);
    const service = new DocumentsService(
      source,
      repo(entities.RequirementDocumentEntity),
      repo(entities.DocumentVersionEntity),
      repo(entities.DocumentSectionEntity),
      repo(entities.DocumentFieldEntity),
      repo(entities.DocumentRequirementEntity),
      repo(entities.AcceptanceCriterionEntity),
      repo(entities.DocumentEvidenceEntity),
      repo(entities.DocumentHistoryEntity),
      repo(entities.AppliedDocumentTemplateEntity),
      repo(entities.AppliedAiAnalysisResultEntity),
      repo(DocumentTemplateEntity),
      null as never,
      null as never,
    );
    // Local preview reads the exact stored version without changing it or requesting AI.
    const document = await service["loadDetail"](documentId);
    if (document.currentVersionDetail.status !== "APPROVED")
      throw new Error("La versión debe estar aprobada.");
    const [projectRow] = await source.query(
      "SELECT * FROM RqProjectsDb.dbo.Projects WHERE Id = @0",
      [document.projectId],
    );
    if (!projectRow) throw new Error("Proyecto inexistente.");
    const template = await repo(DocumentTemplateEntity).findOneBy({
      id: document.template.sourceTemplateId,
    });
    const input = {
      document,
      version: document.currentVersionDetail,
      project: {
        id: projectRow.Id,
        code: projectRow.Code,
        title: projectRow.Title,
        requestingArea: projectRow.RequestingArea,
        description: projectRow.Description,
        status: projectRow.Status,
        ownerUserId: projectRow.OwnerUserId,
        template: null,
        participantCount: 0,
        participants: [],
        createdAt: projectRow.CreatedAt.toISOString(),
        updatedAt: projectRow.UpdatedAt.toISOString(),
      },
      generatedAt: new Date(),
      templateDescription: template?.description ?? null,
    } satisfies RenderApprovedDocumentInput;
    await mkdir("tmp/pdfs", { recursive: true });
    await writeFile(
      "tmp/pdfs/approved-preview-input.json",
      JSON.stringify(input),
    );
    if (process.argv.includes("--snapshot-only")) {
      console.log(
        JSON.stringify({
          version: input.version.version,
          sections: input.version.sections.map((s) => ({
            key: s.key,
            fields: Object.keys(s.content as object),
          })),
        }),
      );
      return;
    }
    const pdf = await renderPdf(input);
    await mkdir("output/pdf", { recursive: true });
    const path = resolve(
      `output/pdf/${input.project.code}-v${input.version.version}-mejorado.pdf`,
    );
    await writeFile(path, pdf.buffer);
    console.log(path);
  } finally {
    await source.destroy();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "No se pudo generar el PDF",
  );
  process.exitCode = 1;
});
