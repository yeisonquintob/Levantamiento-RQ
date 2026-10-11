import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { normalizedHeaderLabel, headerPersonFromText } from "./header-model";
import {
  EmptyValue,
  BusinessRecordCollectionEditor,
  type BusinessEditorProps,
} from "./primitives";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  stringValue,
  cleanDocumentText,
  displayText,
} from "./shared";

interface NormalizedApproval {
  name: string;
  position: string;
  responsibility: string;
  approvalMoment: string;
  status: string;
}

interface NormalizedChangeControl {
  version: string;
  date: string;
  description: string;
  approvedBy: string;
}

interface NormalizedApprovalsSection {
  approvals: NormalizedApproval[];
  changeControl: NormalizedChangeControl[];
}

const APPROVAL_RESPONSIBILITIES = [
  "Elaboración",
  "Revisión",
  "Aprobación",
] as const;

function emptyApproval(responsibility: string): NormalizedApproval {
  return {
    name: PENDING,
    position: PENDING,
    responsibility,
    approvalMoment: PENDING,
    status: PENDING,
  };
}

function normalizeApprovalRecord(
  value: DocumentJsonValue | undefined,
  fallbackResponsibility: string,
): NormalizedApproval {
  if (typeof value === "string") {
    const person = headerPersonFromText(value);
    return {
      ...emptyApproval(fallbackResponsibility),
      name: stringValue(person.name) || PENDING,
      position: stringValue(person.position) || PENDING,
    };
  }
  const record = recordValue(value);
  if (!record) return emptyApproval(fallbackResponsibility);
  return {
    name: stringValue(record.name ?? record.fullName) || PENDING,
    position:
      stringValue(record.position ?? record.role ?? record.jobTitle) || PENDING,
    responsibility:
      stringValue(record.responsibility ?? record.approvalType) ||
      fallbackResponsibility,
    approvalMoment:
      stringValue(record.approvalMoment ?? record.moment ?? record.when) ||
      PENDING,
    status: stringValue(record.status ?? record.decision) || PENDING,
  };
}

function approvalResponsibilityFromLabel(value: string): string | null {
  const label = normalizedHeaderLabel(value);
  if (label.includes("elabor") || label.includes("prepar"))
    return "Elaboración";
  if (label.includes("revis")) return "Revisión";
  if (label.includes("aprob")) return "Aprobación";
  return null;
}

function parseApprovalsNarrative(value: string): NormalizedApprovalsSection {
  const approvals: NormalizedApproval[] = [];
  const changes: NormalizedChangeControl[] = [];
  const pendingChange: NormalizedChangeControl = {
    version: PENDING,
    date: PENDING,
    description: PENDING,
    approvedBy: PENDING,
  };
  let hasPendingChange = false;

  cleanDocumentText(value)
    .split(/\r?\n/gu)
    .map((line) => line.replace(/^\s*[-*•]\s*/u, "").trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.includes("|") && /versi[oó]n/iu.test(line)) {
        const fields = Object.fromEntries(
          line
            .split("|")
            .map((part) => part.trim())
            .map((part) => {
              const separator = part.indexOf(":");
              return separator > 0
                ? [
                    normalizedHeaderLabel(part.slice(0, separator)),
                    part.slice(separator + 1).trim(),
                  ]
                : ["version", part.replace(/^versi[oó]n\s*/iu, "").trim()];
            }),
        );
        changes.push({
          version: fields.version || PENDING,
          date: fields.fecha || PENDING,
          description: fields.modificacion || fields.descripcion || PENDING,
          approvedBy: fields.aprobador || fields.responsable || PENDING,
        });
        return;
      }

      const separator = line.indexOf(":");
      if (separator <= 0) return;
      const rawLabel = line.slice(0, separator);
      const label = normalizedHeaderLabel(rawLabel);
      const content = line.slice(separator + 1).trim();
      const responsibility = approvalResponsibilityFromLabel(rawLabel);
      if (responsibility && /(?:por|elabor|revis|aprob)/u.test(label)) {
        approvals.push(normalizeApprovalRecord(content, responsibility));
        return;
      }
      if (label.includes("version")) {
        pendingChange.version = content;
        hasPendingChange = true;
      } else if (label.includes("fecha")) {
        pendingChange.date = content;
        hasPendingChange = true;
      } else if (
        label.includes("resumen") ||
        label.includes("modificacion") ||
        label.includes("cambio")
      ) {
        pendingChange.description = content;
        hasPendingChange = true;
      } else if (label.includes("responsable") || label.includes("aprobador")) {
        pendingChange.approvedBy = content;
        hasPendingChange = true;
      }
    });

  if (hasPendingChange) changes.push(pendingChange);
  return { approvals, changeControl: changes };
}

function ensureApprovalRoles(
  values: readonly NormalizedApproval[],
): NormalizedApproval[] {
  const available = [...values];
  return APPROVAL_RESPONSIBILITIES.map((responsibility) => {
    const matchingIndex = available.findIndex(
      (item) =>
        approvalResponsibilityFromLabel(item.responsibility) === responsibility,
    );
    if (matchingIndex >= 0) {
      const [item] = available.splice(matchingIndex, 1);
      return item ?? emptyApproval(responsibility);
    }
    const positional = available.shift();
    return positional
      ? { ...positional, responsibility }
      : emptyApproval(responsibility);
  });
}

export function normalizeApprovalsSection(
  value: DocumentJsonValue,
): NormalizedApprovalsSection {
  if (typeof value === "string") {
    const parsed = parseApprovalsNarrative(value);
    return {
      approvals: ensureApprovalRoles(parsed.approvals),
      changeControl:
        parsed.changeControl.length > 0
          ? parsed.changeControl
          : [
              {
                version: PENDING,
                date: PENDING,
                description: PENDING,
                approvedBy: PENDING,
              },
            ],
    };
  }

  const record = recordValue(value);
  const narrative = parseApprovalsNarrative(stringValue(record?.narrative));
  const rawApprovals = [
    ...(Array.isArray(record?.approvals) ? record.approvals : []),
    ...narrative.approvals,
  ];
  const approvals = rawApprovals.map((item, index) =>
    normalizeApprovalRecord(
      item,
      APPROVAL_RESPONSIBILITIES[index] ?? "Aprobación",
    ),
  );
  const rawChanges = [
    ...(Array.isArray(record?.changeControl) ? record.changeControl : []),
    ...narrative.changeControl,
  ];
  const changeControl = rawChanges.slice(-1).map((item) => {
    const change = recordValue(item);
    return {
      version: stringValue(change?.version) || PENDING,
      date: stringValue(change?.date) || PENDING,
      description:
        stringValue(change?.description ?? change?.modification) || PENDING,
      approvedBy:
        stringValue(change?.approvedBy ?? change?.responsible) || PENDING,
    };
  });

  return {
    approvals: ensureApprovalRoles(approvals),
    changeControl,
  };
}

function approvalsSectionToJson(value: NormalizedApprovalsSection): JsonRecord {
  return {
    approvals: value.approvals.map((approval) => ({ ...approval })),
    changeControl: value.changeControl.map((change) => ({ ...change })),
  };
}

export function ApprovalsView({ value }: { value: DocumentJsonValue }) {
  const normalized = normalizeApprovalsSection(value);
  return (
    <div className="rq-document-approvals-view">
      <section>
        <h3>Responsables y momento de aprobación</h3>
        <div className="rq-document-approval-cards">
          {normalized.approvals.map((approval) => (
            <article key={approval.responsibility}>
              <h4>{approval.responsibility}</h4>
              <dl>
                <div>
                  <dt>Responsable</dt>
                  <dd>{displayText(approval.name)}</dd>
                </div>
                <div>
                  <dt>Cargo</dt>
                  <dd>{displayText(approval.position)}</dd>
                </div>
                <div>
                  <dt>Momento</dt>
                  <dd>{displayText(approval.approvalMoment)}</dd>
                </div>
                <div>
                  <dt>Estado</dt>
                  <dd>{displayText(approval.status)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h3>Control de cambios</h3>
        {normalized.changeControl.length === 0 ? (
          <EmptyValue>
            Se registrará al aprobar una modificación de la versión.
          </EmptyValue>
        ) : (
          <div className="rq-document-change-cards">
            {normalized.changeControl.map((change, index) => (
              <article key={`${change.version}-${index}`}>
                <strong>{displayText(change.version)}</strong>
                <span>{displayText(change.date)}</span>
                <p>{displayText(change.description)}</p>
                <small>Aprobador: {displayText(change.approvedBy)}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ApprovalsEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const normalized = normalizeApprovalsSection(value);
  const normalizedJson = approvalsSectionToJson(normalized);
  const set = (key: "approvals" | "changeControl", next: DocumentJsonValue) =>
    onChange({ ...normalizedJson, [key]: next });
  return (
    <div className="rq-document-approvals-editor">
      <BusinessRecordCollectionEditor
        fields={[
          { key: "name", label: "Nombre" },
          { key: "position", label: "Cargo" },
          { key: "responsibility", label: "Responsabilidad" },
          { key: "approvalMoment", label: "Momento de aprobación" },
          { key: "status", label: "Estado" },
        ]}
        legend="Aprobaciones"
        onChange={(next) => set("approvals", next)}
        readOnly={readOnly}
        value={normalizedJson.approvals}
      />
      <BusinessRecordCollectionEditor
        fields={[
          { key: "version", label: "Versión" },
          { key: "date", label: "Fecha" },
          { key: "description", label: "Modificación" },
          { key: "approvedBy", label: "Responsable" },
        ]}
        legend="Control de cambios"
        onChange={(next) =>
          set("changeControl", Array.isArray(next) ? next.slice(-1) : next)
        }
        readOnly={readOnly}
        value={normalizedJson.changeControl}
      />
    </div>
  );
}
