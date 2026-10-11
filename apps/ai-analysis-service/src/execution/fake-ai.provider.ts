import { randomUUID } from "node:crypto";

import {
  getDocumentSectionDefinitions,
  type AiAnalysisDraft,
  type DocumentJsonValue,
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
    const includesScrum = JSON.stringify(
      (
        _request.schema as {
          properties?: { sections?: unknown };
        }
      ).properties?.sections,
    ).includes('"scrumPlan"');
    const sections = getDocumentSectionDefinitions(includesScrum);
    const firstSource = this.sources[0];
    const sourceIds = firstSource ? [firstSource.id] : [];
    const storyCode = "HU-001";
    const criterionCode = "CA-001";
    const draft: AiAnalysisDraft = {
      schemaVersion: "4.0.0",
      sections: sections.map((section) => ({
        key: section.key,
        title: section.title,
        content: (section.key === "header"
          ? {
              title: "Borrador determinista de prueba",
              projectCode: "RQ-FAKE",
              documentVersion: "1.0.0",
              createdDate: "[PENDIENTE POR DEFINIR]",
              requestingArea: "[PENDIENTE POR DEFINIR]",
              status: "BORRADOR",
            }
          : section.key === "objectives"
            ? {
                general: "Validar el pipeline sin consumir una API real.",
                qualitative: [
                  "Permitir la revisión humana de un borrador determinista.",
                ],
                quantitative: [
                  "Procesar una ejecución de prueba con [PENDIENTE POR DEFINIR] como meta operativa.",
                ],
              }
            : section.key === "problemDescription"
              ? {
                  currentState: "Ejecución determinista para pruebas.",
                  operationalImpact: [
                    "La validación funcional depende de revisión humana.",
                  ],
                }
              : section.key === "scope"
                ? {
                    included: ["Generación determinista de prueba."],
                    excluded: ["Aprobación automática."],
                    involvedSystems: ["Proveedor FAKE"],
                    kpis: Array.from({ length: 3 }, (_, index) => ({
                      name: `Indicador de prueba ${index + 1}`,
                      relatedObjective:
                        "Permitir la revisión humana de un borrador determinista.",
                      measurement: `Conteo verificable del indicador ${index + 1} en la ejecución de prueba.`,
                      target: "[PENDIENTE POR DEFINIR]",
                    })),
                  }
                : section.key === "solutionProposal"
                  ? {
                      objective:
                        "Validar una solución de generación asistida sujeta a revisión humana.",
                      description:
                        "Generar un borrador estructurado desde las fuentes seleccionadas y presentarlo para revisión.",
                      involvedElements: ["Fuentes", "Proveedor FAKE", "Editor documental"],
                      flowAlignment: {
                        currentState: "La evidencia requiere consolidación manual.",
                        evaluation: "Se estructura la evidencia en un borrador verificable.",
                        expectedResult: "El borrador queda disponible para revisión humana.",
                      },
                    }
                : section.key === "assumptionsDependenciesPending"
                  ? {
                      assumptions: [
                        "El proveedor FAKE se usa únicamente en pruebas.",
                      ],
                      dependencies: ["Revisión humana del borrador."],
                      pendingItems: ["[PENDIENTE POR DEFINIR]"],
                    }
                  : section.key === "approvalsAndChangeControl"
                    ? {
                        approvals: [
                          "Elaboración",
                          "Revisión",
                          "Aprobación",
                        ].map((responsibility) => ({
                          name: "[PENDIENTE POR DEFINIR]",
                          position: "[PENDIENTE POR DEFINIR]",
                          responsibility,
                          approvalMoment: "[PENDIENTE POR DEFINIR]",
                          status: "PENDIENTE",
                        })),
                        changeControl: [],
                      }
                    : `${section.title}\n\n${content}`) as DocumentJsonValue,
      })),
      requirements: [],
      structuredAnalysis: {
        processFlows: {
          asIs: {
            title: "Flujo AS-IS determinista de prueba",
            objective: "Representar la revisión actual del borrador simulado.",
            lanes: [
              { id: "reviewer", name: "Persona revisora", kind: "ACTOR" },
            ],
            nodes: [
              {
                id: "start",
                kind: "START",
                label: "Inicio",
                laneId: "reviewer",
              },
              {
                id: "review",
                kind: "PROCESS",
                label: "Revisar necesidad",
                laneId: "reviewer",
              },
              {
                id: "end",
                kind: "END",
                label: "Fin",
                laneId: "reviewer",
              },
            ],
            edges: [
              { from: "start", to: "review", label: null },
              { from: "review", to: "end", label: null },
            ],
            problems: [],
            improvements: [],
            expectedResults: [],
            sourceIds,
          },
          toBe: {
            title: "Flujo TO-BE determinista de prueba",
            objective: "Representar la revisión futura del borrador simulado.",
            lanes: [
              { id: "reviewer", name: "Persona revisora", kind: "ACTOR" },
              { id: "platform", name: "Levantamiento RQ", kind: "SYSTEM" },
            ],
            nodes: [
              {
                id: "start",
                kind: "START",
                label: "Inicio",
                laneId: "reviewer",
              },
              {
                id: "generate",
                kind: "SYSTEM",
                label: "Generar borrador simulado",
                laneId: "platform",
              },
              {
                id: "review",
                kind: "PROCESS",
                label: "Revisar resultado",
                laneId: "reviewer",
              },
              {
                id: "end",
                kind: "END",
                label: "Fin",
                laneId: "reviewer",
              },
            ],
            edges: [
              { from: "start", to: "generate", label: null },
              { from: "generate", to: "review", label: null },
              { from: "review", to: "end", label: null },
            ],
            problems: [],
            improvements: ["Generación determinista para pruebas."],
            expectedResults: ["Borrador disponible para revisión humana."],
            sourceIds,
          },
        },
        entityRelationship: {
          title: "Modelo entidad-relación determinista de prueba",
          entities: firstSource
            ? [
                {
                  id: "source",
                  name: "Fuente",
                  description: "Fuente seleccionada para la simulación.",
                  attributes: [
                    {
                      name: "id",
                      dataType: "UUID",
                      primaryKey: true,
                      foreignKey: false,
                      required: true,
                    },
                    {
                      name: "titulo",
                      dataType: "Texto",
                      primaryKey: false,
                      foreignKey: false,
                      required: true,
                    },
                  ],
                },
              ]
            : [],
          relationships: [],
          sourceIds,
        },
        backlogStructure: {
          epics: [
            {
              code: "EP-001",
              title: "Epic de prueba",
              description: "Validar el pipeline determinista.",
              sourceIds,
              features: [
                {
                  code: "FE-001",
                  title: "Feature de prueba",
                  description: content.slice(0, 2_000),
                  sourceIds,
                  userStories: [
                    {
                      code: storyCode,
                      featureCode: "FE-001",
                      title: firstSource?.title ?? "Revisar borrador de prueba",
                      description: "Revisar el resultado generado.",
                      role: "persona revisora",
                      want: "revisar un borrador determinista",
                      benefit: "validar el flujo sin consumir una API real",
                      context: firstSource?.text.slice(0, 2_000) || content,
                      premises: ["El resultado es una simulación de pruebas."],
                      impactedSystems: [],
                      fields: [],
                      acceptanceCriteria: [
                        {
                          code: criterionCode,
                          given: "un análisis ejecutado en modo FAKE",
                          when: "se genera el borrador",
                          then: "el resultado queda identificado como simulación",
                          sourceIds,
                        },
                      ],
                      tasks: [
                        {
                          code: "T-001",
                          title: "Revisar contenido",
                          description: "Revisar el contenido generado.",
                          type: "ANALYSIS",
                          origin: "IMPLEMENTATION_PROPOSAL",
                          dependencyCodes: [],
                          sourceIds,
                        },
                      ],
                      sourceIds,
                    },
                  ],
                },
              ],
            },
          ],
        },
        features: [
          {
            code: "FE-001",
            title: "Feature de prueba",
            objective: "Validar el pipeline sin consumir una API real.",
            description: content.slice(0, 2_000),
            inScope: ["Generación determinista"],
            outOfScope: ["Aprobación automática"],
            userStoryCodes: [storyCode],
            sourceIds,
          },
        ],
        userStories: [
          {
            code: storyCode,
            featureCode: "FE-001",
            title: firstSource?.title ?? "Revisar borrador de prueba",
            role: "persona revisora",
            want: "revisar un borrador determinista",
            benefit: "validar el flujo sin consumir una API real",
            context: firstSource?.text.slice(0, 2_000) || content,
            premises: ["El resultado es una simulación de pruebas."],
            impactedSystems: [],
            fields: [],
            acceptanceCriteria: [
              {
                code: criterionCode,
                given: "un análisis ejecutado en modo FAKE",
                when: "se genera el borrador",
                then: "el resultado queda identificado como simulación",
                sourceIds,
              },
            ],
            sourceIds,
          },
        ],
        tests: [
          {
            code: "CP-001",
            title: "Validar borrador determinista",
            userStoryCodes: [storyCode],
            acceptanceCriterionCodes: [criterionCode],
            precondition: "El modo FAKE está habilitado fuera de producción.",
            action: "Ejecutar la generación del borrador.",
            expectedResult:
              "Se obtiene contenido trazable marcado como simulación.",
            sourceIds,
            taskCodes: ["T-001"],
          },
        ],
        scrumPlan: includesScrum
          ? {
              cadenceDays: 15,
              scheduleBasis: "RELATIVE_DAY",
              confirmedStartDate: null,
              sourceIds,
              sprints: [
                {
                  code: "SP-001",
                  number: 1,
                  period: "Día 1 al Día 15",
                  startDay: 1,
                  endDay: 15,
                  startDate: null,
                  endDate: null,
                  objective: "Revisar el borrador simulado.",
                  featureCodes: ["FE-001"],
                  userStoryCodes: [storyCode],
                  tasks: [
                    {
                      code: "T-001",
                      type: "ANALYSIS",
                      description: "Revisar el contenido generado.",
                      userStoryCode: storyCode,
                      suggestedRole: "Analista funcional",
                      dependencyCodes: [],
                      expectedResult: "Observaciones registradas.",
                      estimatedDurationDays: 3,
                      startDay: 1,
                      endDay: 3,
                      startDate: null,
                      endDate: null,
                    },
                  ],
                  dependencies: [],
                  testCodes: ["CP-001"],
                  deliverables: ["Borrador revisado"],
                  closingCriterion: "Revisión humana registrada.",
                  risks: ["El contenido es simulado."],
                },
              ],
            }
          : null,
      },
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
