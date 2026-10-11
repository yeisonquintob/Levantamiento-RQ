import type {
  AuthenticatedUser,
  DocumentJsonValue,
  DocumentStatus,
} from "@levantamiento-rq/shared-contracts";

import type { DocumentVersionEntity } from "./document.entities";
import { PENDING } from "./documents-constants";
import { documentRecord, documentRecords } from "./documents-json";

export function headerForNewVersion(
  content: DocumentJsonValue,
  version: string,
): DocumentJsonValue {
  if (!content || typeof content !== "object" || Array.isArray(content))
    return content;
  const normalized = { ...content } as Record<string, DocumentJsonValue>;
  delete normalized.preparedBy;
  delete normalized.reviewedBy;
  delete normalized.approvedBy;
  return {
    ...normalized,
    documentVersion: version,
    status: "BORRADOR",
  };
}

export function headerForTransition(
  content: DocumentJsonValue,
  status: DocumentStatus,
): DocumentJsonValue {
  if (!content || typeof content !== "object" || Array.isArray(content))
    return content;
  const visibleStatus =
    status === "IN_REVIEW"
      ? "EN VALIDACIÓN"
      : status === "APPROVED"
        ? "APROBADO"
        : status === "CHANGES_REQUESTED"
          ? "CORRECCIONES SOLICITADAS"
          : status === "REJECTED"
            ? "BORRADOR"
            : "BORRADOR";
  const normalized = { ...content } as Record<string, DocumentJsonValue>;
  delete normalized.preparedBy;
  delete normalized.reviewedBy;
  delete normalized.approvedBy;
  return { ...normalized, status: visibleStatus };
}

export function contentFromAi(
  key: string,
  current: DocumentJsonValue,
  proposed: DocumentJsonValue,
): DocumentJsonValue {
  if (key === "header") {
    if (!proposed || typeof proposed !== "object" || Array.isArray(proposed))
      return proposed;
    const normalized = { ...proposed } as Record<string, DocumentJsonValue>;
    delete normalized.preparedBy;
    delete normalized.reviewedBy;
    delete normalized.approvedBy;
    return normalized;
  }
  if (key !== "approvalsAndChangeControl") return proposed;
  const proposedRecord = documentRecord(proposed);
  const currentRecord = documentRecord(current);
  const proposedApprovals = documentRecords(proposedRecord?.approvals);
  const currentApprovals = documentRecords(currentRecord?.approvals);
  const proposedByResponsibility = new Map(
    proposedApprovals.map((approval) => [
      String(approval.responsibility),
      approval,
    ]),
  );
  const currentByResponsibility = new Map(
    currentApprovals.map((approval) => [
      String(approval.responsibility),
      approval,
    ]),
  );
  const responsibilities = ["Elaboración", "Revisión", "Aprobación"];
  return {
    approvals: responsibilities.map((responsibility) => {
      const currentApproval = currentByResponsibility.get(responsibility);
      const proposedApproval = proposedByResponsibility.get(responsibility);
      const workflowHasDecided =
        currentApproval && currentApproval.status !== "PENDIENTE";
      return {
        ...(proposedApproval ?? currentApproval ?? {}),
        ...(responsibility === "Elaboración" || workflowHasDecided
          ? (currentApproval ?? {})
          : {}),
        responsibility,
      };
    }),
    // Generar o regenerar contenido no constituye un cambio aprobado.
    changeControl: [],
  };
}

export function approvalsForNewVersion(
  content: DocumentJsonValue,
  actor: AuthenticatedUser,
): DocumentJsonValue {
  const record = documentRecord(content);
  const approvals = documentRecords(record?.approvals);
  const byResponsibility = new Map(
    approvals.map((approval) => [String(approval.responsibility), approval]),
  );
  return {
    approvals: [
      {
        ...(byResponsibility.get("Elaboración") ?? {}),
        name: actor.displayName,
        position: "Responsable del documento",
        responsibility: "Elaboración",
        approvalMoment: "Al elaborar la versión documental",
        status: "REGISTRADO",
      },
      {
        ...(byResponsibility.get("Revisión") ?? {}),
        responsibility: "Revisión",
        approvalMoment: "Durante la validación del documento",
        status: "PENDIENTE",
      },
      {
        ...(byResponsibility.get("Aprobación") ?? {}),
        responsibility: "Aprobación",
        approvalMoment: "Al finalizar la revisión",
        status: "PENDIENTE",
      },
    ],
    changeControl: [],
  };
}

export function approvalsForTransition(
  content: DocumentJsonValue,
  status: DocumentStatus,
  actor: AuthenticatedUser,
  version: DocumentVersionEntity,
  now: Date,
): DocumentJsonValue {
  const record = documentRecord(content);
  const approvals = documentRecords(record?.approvals).map((item) => ({
    ...item,
  }));
  const update = (
    responsibility: "Revisión" | "Aprobación",
    changes: Readonly<Record<string, DocumentJsonValue>>,
  ) => {
    const index = approvals.findIndex(
      (approval) => approval.responsibility === responsibility,
    );
    if (index >= 0) {
      approvals[index] = { ...approvals[index], ...changes };
      return;
    }
    approvals.push({
      name: PENDING,
      position:
        responsibility === "Revisión"
          ? "Líder del responsable"
          : "Solicitante o líder de la persona solicitante",
      responsibility,
      approvalMoment:
        responsibility === "Revisión"
          ? "Durante la validación del documento"
          : "Al finalizar la revisión",
      status: "PENDIENTE",
      ...changes,
    });
  };

  if (status === "IN_REVIEW") {
    const elaborationIndex = approvals.findIndex(
      (approval) => approval.responsibility === "Elaboración",
    );
    const elaboration = {
      name: actor.displayName,
      position: "Responsable del documento",
      responsibility: "Elaboración",
      approvalMoment: now.toISOString(),
      status: "REGISTRADO",
    };
    if (elaborationIndex >= 0) {
      approvals[elaborationIndex] = {
        ...approvals[elaborationIndex],
        ...elaboration,
      };
    } else {
      approvals.push(elaboration);
    }
    update("Revisión", {
      approvalMoment: "Durante la validación del documento",
      status: "EN REVISIÓN",
    });
  } else if (status === "CHANGES_REQUESTED") {
    update("Revisión", {
      name: actor.displayName,
      position: "Líder del responsable",
      approvalMoment: now.toISOString(),
      status: "CAMBIOS SOLICITADOS",
    });
  } else if (status === "APPROVED") {
    update("Aprobación", {
      name: actor.displayName,
      position: "Solicitante o líder de la persona solicitante",
      approvalMoment: now.toISOString(),
      status: "APROBADO",
    });
  }

  return {
    approvals: ["Elaboración", "Revisión", "Aprobación"].map(
      (responsibility) =>
        approvals.find(
          (approval) => approval.responsibility === responsibility,
        ) ?? {
          name: PENDING,
          position: PENDING,
          responsibility,
          approvalMoment: PENDING,
          status: "PENDIENTE",
        },
    ),
    changeControl:
      status === "APPROVED" && version.versionNumber > 1
        ? [
            {
              version: version.version,
              date: now.toISOString().slice(0, 10),
              description: version.changeSummary,
              approvedBy: actor.displayName,
            },
          ]
        : (record?.changeControl ?? []),
  };
}
