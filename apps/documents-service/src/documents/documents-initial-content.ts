import type {
  AuthenticatedUser,
  DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";

import { PENDING } from "./documents-constants";
import type { DocumentProjectAccess } from "./projects-access.client";

export function initialContent(
  key: string,
  project: DocumentProjectAccess["project"],
  actor: AuthenticatedUser,
  version: string,
  now: Date,
): DocumentJsonValue {
  switch (key) {
    case "header":
      return {
        title: project.title,
        projectCode: project.code,
        documentVersion: version,
        createdDate: now.toISOString().slice(0, 10),
        requestingArea: project.requestingArea,
        status: "BORRADOR",
      };
    case "objectives":
      return {
        general: PENDING,
        qualitative: [PENDING],
        quantitative: [PENDING],
      };
    case "problemDescription":
      return { currentState: PENDING, operationalImpact: [PENDING] };
    case "scope":
      return {
        included: [PENDING],
        excluded: [PENDING],
        involvedSystems: [PENDING],
        kpis: Array.from({ length: 3 }, () => ({
          name: PENDING,
          relatedObjective: PENDING,
          measurement: PENDING,
          target: PENDING,
        })),
      };
    case "solutionProposal":
      return {
        objective: PENDING,
        description: PENDING,
        involvedElements: [PENDING],
        flowAlignment: {
          currentState: PENDING,
          evaluation: PENDING,
          expectedResult: PENDING,
        },
      };
    case "processFlow":
      return {
        notation: "PENDING",
        content: PENDING,
        actors: [PENDING],
        inputs: [PENDING],
        outputs: [PENDING],
        systems: [PENDING],
      };
    case "milestones":
      return {
        functionalRequirements: [],
        nonFunctionalRequirements: [],
      };
    case "backlogStructure":
      return { epics: [] };
    case "nonFunctionalRequirements":
      return {
        security: [PENDING],
        traceability: [PENDING],
        performance: [PENDING],
        compatibility: [PENDING],
        availability: [PENDING],
        usability: [PENDING],
      };
    case "tests":
      return { objective: PENDING, minimumScenarios: [PENDING] };
    case "assumptionsDependenciesPending":
      return {
        assumptions: [PENDING],
        dependencies: [PENDING],
        pendingItems: [PENDING],
      };
    case "approvalsAndChangeControl":
      return {
        approvals: [
          {
            name: actor.displayName,
            position: "Responsable del documento",
            responsibility: "Elaboración",
            approvalMoment: "Al elaborar la versión documental",
            status: "REGISTRADO",
          },
          {
            name: PENDING,
            position: "Líder del responsable",
            responsibility: "Revisión",
            approvalMoment: "Durante la validación del documento",
            status: "PENDIENTE",
          },
          {
            name: PENDING,
            position: "Solicitante o líder de la persona solicitante",
            responsibility: "Aprobación",
            approvalMoment: "Al finalizar la revisión",
            status: "PENDIENTE",
          },
        ],
        changeControl: [],
      };
    case "writingRules":
    case "visualFormat":
    case "automationInstruction":
      return PENDING;
    case "scrumPlan":
      return {
        cadenceDays: 15,
        scheduleBasis: "RELATIVE_DAY",
        note: "Propuesta inicial sujeta a validación y estimación del equipo Scrum.",
        sprints: [],
      };
    default:
      return PENDING;
  }
}
