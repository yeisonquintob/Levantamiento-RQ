import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { normalizedHeaderLabel } from "./header-model";
import {
  TextList,
  HumanValue,
  TextField,
  StringListEditor,
  BusinessRecordCollectionEditor,
  type BusinessEditorProps,
} from "./primitives";
import { splitProblemItems } from "./problem-description-section";
import {
  PENDING,
  type JsonRecord,
  isRecord,
  recordValue,
  recordList,
  stringValue,
  stringList,
  cleanDocumentText,
  displayText,
} from "./shared";

type NormalizedPendingSection = {
  narrative: string;
  assumptions: string[];
  dependencies: string[];
  pendingItems: string[];
  pendingQuestions: string[];
  warnings: string[];
  contradictions: JsonRecord[];
};

const PENDING_SUMMARY_LIMIT = 3;

const CONTRADICTION_SUMMARY_LIMIT = 2;

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function emptyPendingSection(): NormalizedPendingSection {
  return {
    narrative: "",
    assumptions: [],
    dependencies: [],
    pendingItems: [],
    pendingQuestions: [],
    warnings: [],
    contradictions: [],
  };
}

function pendingHeadingKey(
  value: string,
):
  | "assumptions"
  | "dependencies"
  | "pendingItems"
  | "pendingQuestions"
  | "warnings" {
  const label = normalizedHeaderLabel(value);
  if (label.includes("supuesto")) return "assumptions";
  if (label.includes("dependencia")) return "dependencies";
  if (label.includes("pregunta")) return "pendingQuestions";
  if (
    label.includes("riesgo") ||
    label.includes("revisar") ||
    label.includes("advertencia") ||
    label.includes("mejora")
  )
    return "warnings";
  return "pendingItems";
}

function parsePendingNarrative(value: string): NormalizedPendingSection {
  const source = cleanDocumentText(value).trim();
  const result = emptyPendingSection();
  if (!source) return result;

  const headingPattern =
    /(?:^|\n)\s*(supuestos?(?:\s+(?:expl[ií]citos?|respaldados?))?|dependencias?(?:\s+confirmadas?)?|pendientes?(?:\s+(?:abiertos?|funcionales?|documentales?(?:\s+y\s+de\s+negocio)?))?|preguntas?\s+pendientes?|riesgos?|advertencias?|aspectos?\s+por\s+(?:revisar|mejorar)|puntos?\s+por\s+mejorar)\s*:\s*/gimu;
  const matches = [...source.matchAll(headingPattern)];
  if (matches.length === 0) {
    result.narrative = source;
    return result;
  }

  result.narrative = source.slice(0, matches[0]?.index ?? 0).trim();
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const key = pendingHeadingKey(match[1] ?? "");
    result[key].push(...splitProblemItems(source.slice(start, end)));
  });

  result.assumptions = uniqueStrings(result.assumptions).slice(
    0,
    PENDING_SUMMARY_LIMIT,
  );
  result.dependencies = uniqueStrings(result.dependencies).slice(
    0,
    PENDING_SUMMARY_LIMIT,
  );
  result.pendingItems = uniqueStrings(result.pendingItems).slice(
    0,
    PENDING_SUMMARY_LIMIT,
  );
  result.pendingQuestions = uniqueStrings(result.pendingQuestions).slice(
    0,
    PENDING_SUMMARY_LIMIT,
  );
  result.warnings = uniqueStrings(result.warnings).slice(
    0,
    PENDING_SUMMARY_LIMIT,
  );
  return result;
}

export function normalizePendingSection(
  value: DocumentJsonValue,
): NormalizedPendingSection {
  if (typeof value === "string") return parsePendingNarrative(value);
  const record = recordValue(value);
  if (!record) return emptyPendingSection();

  const parsed = parsePendingNarrative(stringValue(record.narrative));
  const contradictionValues = Array.isArray(record.contradictions)
    ? record.contradictions
    : [];
  const contradictions = contradictionValues
    .slice(0, CONTRADICTION_SUMMARY_LIMIT)
    .map((item) =>
      isRecord(item)
        ? { ...item }
        : {
            statementA: stringValue(item),
            statementB: PENDING,
            decision: PENDING,
          },
    );

  return {
    narrative: parsed.narrative,
    assumptions: uniqueStrings([
      ...stringList(record.assumptions),
      ...parsed.assumptions,
    ]).slice(0, PENDING_SUMMARY_LIMIT),
    dependencies: uniqueStrings([
      ...stringList(record.dependencies),
      ...parsed.dependencies,
    ]).slice(0, PENDING_SUMMARY_LIMIT),
    pendingItems: uniqueStrings([
      ...stringList(record.pendingItems),
      ...parsed.pendingItems,
    ]).slice(0, PENDING_SUMMARY_LIMIT),
    pendingQuestions: uniqueStrings([
      ...stringList(record.pendingQuestions),
      ...parsed.pendingQuestions,
    ]).slice(0, PENDING_SUMMARY_LIMIT),
    warnings: uniqueStrings([
      ...stringList(record.warnings),
      ...parsed.warnings,
    ]).slice(0, PENDING_SUMMARY_LIMIT),
    contradictions,
  };
}

const PENDING_LISTS = [
  ["assumptions", "Supuestos"],
  ["dependencies", "Dependencias"],
  ["pendingItems", "Pendientes funcionales"],
  ["pendingQuestions", "Preguntas pendientes"],
  ["warnings", "Aspectos por revisar"],
] as const;

export function PendingView({ value }: { value: DocumentJsonValue }) {
  const pending = normalizePendingSection(value);
  return (
    <div className="rq-document-pending-view">
      {pending.narrative ? (
        <section className="rq-document-pending-view__context">
          <h3>Contexto adicional</h3>
          <p>{displayText(pending.narrative)}</p>
        </section>
      ) : null}
      {PENDING_LISTS.map(([key, label]) => (
        <section key={key}>
          <h3>{label}</h3>
          <TextList items={pending[key]} />
        </section>
      ))}
      <section className="rq-document-pending-view__contradictions">
        <h3>Contradicciones por resolver</h3>
        <HumanValue label="Contradicción" value={pending.contradictions} />
      </section>
    </div>
  );
}

export function PendingEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const pending = normalizePendingSection(value);
  const update = (next: Partial<NormalizedPendingSection>) =>
    onChange({
      narrative: next.narrative ?? pending.narrative,
      assumptions: next.assumptions ?? pending.assumptions,
      dependencies: next.dependencies ?? pending.dependencies,
      pendingItems: next.pendingItems ?? pending.pendingItems,
      pendingQuestions: next.pendingQuestions ?? pending.pendingQuestions,
      warnings: next.warnings ?? pending.warnings,
      contradictions: next.contradictions ?? pending.contradictions,
    });

  return (
    <div className="rq-document-pending-editor">
      {pending.narrative ? (
        <TextField
          label="Contexto adicional"
          onChange={(narrative) => update({ narrative })}
          readOnly={readOnly}
          value={pending.narrative}
        />
      ) : null}
      <div className="rq-document-pending-editor__grid">
        {PENDING_LISTS.map(([key, label]) => (
          <StringListEditor
            key={key}
            label={label}
            onChange={(items) => update({ [key]: items })}
            readOnly={readOnly}
            value={pending[key]}
          />
        ))}
      </div>
      <BusinessRecordCollectionEditor
        fields={[
          { key: "statementA", label: "Información A" },
          { key: "statementB", label: "Información B" },
          { key: "decision", label: "Decisión" },
        ]}
        legend="Contradicciones por resolver"
        onChange={(contradictions) =>
          update({ contradictions: recordList(contradictions) })
        }
        readOnly={readOnly}
        value={pending.contradictions}
      />
    </div>
  );
}
