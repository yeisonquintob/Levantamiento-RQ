import { ConflictException, ForbiddenException } from "@nestjs/common";

import type {
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "./document.entities";
import type { DocumentProjectAccess } from "./projects-access.client";

export function requireEdit(access: DocumentProjectAccess): void {
  if (!access.canEdit) {
    throw new ForbiddenException(
      "No tienes autorización para editar documentos de este proyecto.",
    );
  }
}

export function requireReview(access: DocumentProjectAccess): void {
  if (!access.canReview) {
    throw new ForbiddenException(
      "No tienes autorización para revisar o aprobar este documento.",
    );
  }
}

export function requireActive(document: RequirementDocumentEntity): void {
  if (document.status === "ARCHIVED") {
    throw new ConflictException("El documento está archivado y es inmutable.");
  }
}

export function requireCurrent(
  document: RequirementDocumentEntity,
  version: DocumentVersionEntity,
): void {
  if (document.currentVersionNumber !== version.versionNumber) {
    throw new ConflictException(
      "Solo la versión actual puede modificarse o cambiar de estado.",
    );
  }
}

export function requireDraft(version: DocumentVersionEntity): void {
  if (version.status === "APPROVED") {
    throw new ConflictException(
      "La versión aprobada es inmutable; crea una nueva versión.",
    );
  }
  if (version.status !== "DRAFT") {
    throw new ConflictException("Solo una versión en borrador puede editarse.");
  }
}

export function requireEditable(
  version: DocumentVersionEntity,
): "DRAFT" | "CHANGES_REQUESTED" {
  if (version.status !== "DRAFT" && version.status !== "CHANGES_REQUESTED") {
    throw new ConflictException(
      "Solo una versión en borrador o con correcciones solicitadas puede editarse.",
    );
  }
  return version.status;
}

export function stale(): never {
  throw new ConflictException(
    "La revisión enviada está desactualizada. Recarga el documento antes de guardar.",
  );
}
