import { randomUUID } from "node:crypto";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type AiAnalysisDraft,
} from "@levantamiento-rq/shared-contracts";

import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiTextProvider,
} from "./ai-text-provider";

export interface FakeAnalysisSource {
  id: string;
  title: string;
  text: string;
}

export class FakeAiProvider implements AiTextProvider {
  constructor(private readonly sources: readonly FakeAnalysisSource[]) {}

  async generate(_request: AiGenerationRequest): Promise<AiGenerationResponse> {
    const evidence = this.sources
      .map((source) => `${source.title}: ${source.text.slice(0, 500)}`)
      .join("\n");
    const content =
      evidence || "[PENDIENTE POR DEFINIR] No hay contenido de fuentes.";
    const draft: AiAnalysisDraft = {
      schemaVersion: "1.0.0",
      sections: DOCUMENT_SECTION_DEFINITIONS.map((section) => ({
        key: section.key,
        title: section.title,
        content:
          section.key === "header"
            ? "Borrador generado para revisión humana."
            : `${section.title}\n\n${content}`,
      })),
      requirements: this.sources.slice(0, 10).map((source, index) => ({
        clientId: `fake-${index + 1}`,
        sectionKey: "milestones",
        code: `RF-${String(index + 1).padStart(3, "0")}`,
        title: source.title,
        description: source.text.slice(0, 2000) || "[PENDIENTE POR DEFINIR]",
        requirementType: "FUNCTIONAL",
        acceptanceCriteria: ["Debe validarse con el responsable funcional."],
        sourceIds: [source.id],
      })),
      pendingQuestions: [
        "Validar el borrador generado antes de incorporarlo al documento.",
      ],
      contradictions: [],
      warnings: [
        "Resultado del proveedor FAKE; solo válido para pruebas automáticas.",
      ],
    };

    return {
      draft,
      providerRequestId: `fake-${randomUUID()}`,
      inputTokens: Math.ceil(_request.userPrompt.length / 4),
      outputTokens: Math.ceil(JSON.stringify(draft).length / 4),
    };
  }
}
