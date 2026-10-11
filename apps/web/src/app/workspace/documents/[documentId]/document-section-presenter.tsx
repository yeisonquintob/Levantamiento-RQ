"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  classifyProcessFlowEdgeVisualKind,
  conciseFunctionalStoryDescription,
  layoutProcessFlow,
  type ProcessFlowEdgeVisualKind,
  type ProcessFlowInput,
  type ProcessFlowLayoutResult as CanonicalProcessFlowLayout,
} from "@levantamiento-rq/shared-contracts";
import type {
  DocumentJsonValue,
  DocumentSectionKey,
} from "@levantamiento-rq/shared-contracts";

import { formatColombianCalendarDate } from "./colombian-business-calendar";
import { KpiRing } from "../../execution/execution-checklist";
import {
  computeWorkPlanTimeline,
  workPlanAxisLabels,
  type TimelineGranularity,
} from "../../work-plan-timeline";
import {
  computeExecutionKpis,
  loadExecutionDoneCodes,
} from "../../execution/execution-tracking";

const PENDING = "[PENDIENTE POR DEFINIR]";
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const UUID_TEST_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const TECHNICAL_KEYS = new Set([
  "sourceIds",
  "sourceIdsA",
  "sourceIdsB",
  "clientId",
  "structuredAnalysis",
  "id",
  "from",
  "to",
  "kind",
  "scheduleBasis",
  "startDay",
  "endDay",
  "startDate",
  "endDate",
  "period",
]);

const LABELS: Readonly<Record<string, string>> = {
  title: "Título",
  projectCode: "Código",
  documentVersion: "Versión",
  createdDate: "Fecha",
  requestingArea: "Área solicitante",
  preparedBy: "Elaborado por",
  reviewedBy: "Revisado por",
  approvedBy: "Aprobado por",
  status: "Estado",
  name: "Nombre",
  position: "Cargo",
  general: "Objetivo general",
  specific: "Objetivos específicos",
  qualitative: "Objetivos específicos cualitativos",
  quantitative: "Objetivos específicos cuantitativos",
  currentState: "Situación actual",
  operationalImpact: "Impacto operacional",
  included: "Incluye",
  excluded: "Fuera de alcance",
  involvedSystems: "Sistemas involucrados",
  involvedElements: "Elementos involucrados",
  flowAlignment: "Correspondencia con el flujo",
  evaluation: "Evaluación de la solución",
  kpis: "KPIs de estado",
  relatedObjective: "Objetivo relacionado",
  measurement: "Cómo se mide",
  target: "Meta",
  objective: "Objetivo",
  description: "Descripción",
  inScope: "Incluye",
  outOfScope: "Fuera de alcance",
  userStoryCodes: "Historias relacionadas",
  featureCode: "Funcionalidad relacionada",
  role: "Como",
  want: "Quiero",
  benefit: "Para",
  context: "Contexto",
  premises: "Premisas",
  impactedSystems: "Sistemas impactados",
  fields: "Campos",
  dataType: "Tipo de dato",
  required: "Obligatorio",
  validation: "Validación",
  acceptanceCriteria: "Criterios de aceptación",
  given: "Dado",
  when: "Cuando",
  then: "Entonces",
  scenarios: "Escenarios",
  precondition: "Precondición",
  action: "Acción",
  expectedResult: "Resultado esperado",
  userStoryCode: "Historia relacionada",
  acceptanceCriterionCodes: "Criterios relacionados",
  assumptions: "Supuestos",
  dependencies: "Dependencias",
  pendingItems: "Pendientes",
  pendingQuestions: "Preguntas pendientes",
  contradictions: "Contradicciones",
  warnings: "Aspectos por revisar",
  narrative: "Resumen",
  changeControl: "Control de cambios",
  approvals: "Aprobaciones",
  cadenceDays: "Cadencia",
  confirmedStartDate: "Fecha de inicio confirmada",
  sprints: "Sprints",
  number: "Número",
  featureCodes: "Funcionalidades",
  tasks: "Tareas",
  dependencyCodes: "Dependencias",
  testCodes: "Pruebas",
  deliverables: "Entregables",
  closingCriterion: "Criterio de cierre",
  risks: "Riesgos",
  suggestedRole: "Rol sugerido",
  statementA: "Información A",
  statementB: "Información B",
  decision: "Decisión",
};

const ENUM_LABELS: Readonly<Record<string, string>> = {
  START: "Inicio",
  END: "Fin",
  ACTOR: "Actor",
  PROCESS: "Proceso",
  DECISION: "Decisión",
  SYSTEM: "Sistema",
  ANALYSIS: "Análisis",
  DESIGN: "Diseño",
  DEVELOPMENT: "Desarrollo",
  CONFIGURATION: "Configuración",
  INTEGRATION: "Integración",
  DATA: "Datos",
  TESTING: "Pruebas",
  UAT: "Pruebas de usuario",
  DOCUMENTATION: "Documentación",
  DEPLOYMENT: "Despliegue",
  DRAFT: "Borrador",
  IN_REVIEW: "En validación",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  ARCHIVED: "Archivado",
};

type JsonRecord = Record<string, DocumentJsonValue>;

function isRecord(value: DocumentJsonValue): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: DocumentJsonValue | undefined): JsonRecord | null {
  return value && isRecord(value) ? value : null;
}

function recordList(value: DocumentJsonValue | undefined): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({ ...item }))
    : [];
}

function stringValue(value: DocumentJsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function functionalStoryDescriptionForDisplay(
  story: Readonly<Record<string, DocumentJsonValue>>,
): string {
  return conciseFunctionalStoryDescription({
    description: stringValue(story.description),
    title: stringValue(story.title),
    want: stringValue(story.want),
  });
}

function stringList(value: DocumentJsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: DocumentJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function humanLabel(key: string): string {
  return LABELS[key] ?? key.replace(/([a-z])([A-Z])/gu, "$1 $2");
}

export function cleanDocumentText(value: string): string {
  return value
    .replace(/\(?\s*source\s*ids?\s*:\s*\[[^\]]*\]\s*\)?/giu, "")
    .replace(
      /\(\s*(?:scheduleBasis|startDay|endDay|startDate|endDate|period|clientId)\s*:[^)]*\)/giu,
      "",
    )
    .replace(
      /(?:el\s+)?(?:plan\s+en\s+)?detalle\s+(?:está|se encuentra)\s+en\s+structuredAnalysis\.[\w.]+\s*\.?/giu,
      "",
    )
    .replace(/structuredAnalysis\.[\w.]+/giu, "")
    .replace(UUID_PATTERN, "")
    .replace(/\(\s*\)/gu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .trim();
}

export function presentSectionContent(
  value: DocumentJsonValue,
): DocumentJsonValue {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as DocumentJsonValue;
  } catch {
    return value;
  }
}

function restoreSectionContent(
  original: DocumentJsonValue,
  next: DocumentJsonValue,
): DocumentJsonValue {
  if (
    typeof original === "string" &&
    presentSectionContent(original) !== original &&
    typeof next !== "string"
  ) {
    return JSON.stringify(next);
  }
  return next;
}

function visibleEntries(value: JsonRecord): [string, DocumentJsonValue][] {
  return Object.entries(value).filter(
    ([key, item]) =>
      !TECHNICAL_KEYS.has(key) &&
      !(typeof item === "string" && UUID_TEST_PATTERN.test(item)),
  );
}

function displayText(value: string): string {
  const cleaned = cleanDocumentText(value);
  const visible = cleaned.replaceAll(PENDING, "Pendiente de definición");
  return ENUM_LABELS[visible] ?? visible;
}

const HEADER_CORE_KEYS = [
  "title",
  "projectCode",
  "documentVersion",
  "createdDate",
  "requestingArea",
  "status",
] as const;

const HEADER_PEOPLE = [
  ["preparedBy", "Elaborado por"],
  ["reviewedBy", "Revisado por"],
  ["approvedBy", "Aprobado por"],
] as const;

type HeaderCoreKey = (typeof HEADER_CORE_KEYS)[number];
type HeaderPersonKey = (typeof HEADER_PEOPLE)[number][0];
type HeaderStandardKey = HeaderCoreKey | HeaderPersonKey;

function normalizedHeaderLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "")
    .replace(/[*_]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

function headerKeyFromLabel(value: string): HeaderStandardKey | null {
  const label = normalizedHeaderLabel(value);
  const aliases: Readonly<Record<string, HeaderStandardKey>> = {
    titulo: "title",
    codigo: "projectCode",
    "codigo del proyecto": "projectCode",
    "codigo del documento": "projectCode",
    version: "documentVersion",
    "version del documento": "documentVersion",
    "version documento": "documentVersion",
    fecha: "createdDate",
    "fecha de creacion": "createdDate",
    "fecha del documento": "createdDate",
    "area solicitante": "requestingArea",
    area: "requestingArea",
    solicitante: "requestingArea",
    estado: "status",
    "estado del documento": "status",
    "elaborado por": "preparedBy",
    "preparado por": "preparedBy",
    "revisado por": "reviewedBy",
    "aprobado por": "approvedBy",
  };
  return aliases[label] ?? null;
}

function headerPersonFromText(value: string): JsonRecord {
  const text = value.trim();
  if (!text) return { name: "", position: "" };

  const labeled = text.match(
    /^(?:nombre\s*:\s*)?(.+?)\s*[,;]\s*cargo\s*:\s*(.+)$/iu,
  );
  if (labeled?.[1] && labeled[2]) {
    return { name: labeled[1].trim(), position: labeled[2].trim() };
  }

  const parenthesized = text.match(/^(.+?)\s+\(([^()]+)\)$/u);
  if (parenthesized?.[1] && parenthesized[2]) {
    return {
      name: parenthesized[1].trim(),
      position: parenthesized[2].trim(),
    };
  }

  const separated = text.match(/^(.+?)\s+(?:—|–|-|\||\/)\s+(.+)$/u);
  if (separated?.[1] && separated[2]) {
    return { name: separated[1].trim(), position: separated[2].trim() };
  }

  return { name: text, position: PENDING };
}

function emptyHeaderRecord(): JsonRecord {
  return {
    title: "",
    projectCode: "",
    documentVersion: "",
    createdDate: "",
    requestingArea: "",
    status: "",
    preparedBy: { name: "", position: "" },
    reviewedBy: { name: "", position: "" },
    approvedBy: { name: "", position: "" },
  };
}

function headerWithoutPeople(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    HEADER_CORE_KEYS.map((key) => [key, stringValue(value[key])]),
  );
}

function normalizedHeaderPerson(value: DocumentJsonValue | undefined) {
  if (typeof value === "string") return headerPersonFromText(value);
  const person = recordValue(value);
  return {
    name: stringValue(person?.name ?? person?.fullName),
    position: stringValue(person?.position ?? person?.role ?? person?.jobTitle),
  };
}

export function normalizeHeaderRecord(
  value: DocumentJsonValue,
): JsonRecord | null {
  const existing = recordValue(value);
  if (existing) {
    const normalized: JsonRecord = {
      title: stringValue(existing.title ?? existing.documentTitle),
      projectCode: stringValue(
        existing.projectCode ?? existing.documentCode ?? existing.code,
      ),
      documentVersion: stringValue(
        existing.documentVersion ?? existing.version,
      ),
      createdDate: stringValue(
        existing.createdDate ?? existing.creationDate ?? existing.date,
      ),
      requestingArea: stringValue(
        existing.requestingArea ?? existing.area ?? existing.requester,
      ),
      status: stringValue(existing.status ?? existing.documentStatus),
      preparedBy: normalizedHeaderPerson(
        existing.preparedBy ?? existing.elaboratedBy,
      ),
      reviewedBy: normalizedHeaderPerson(existing.reviewedBy),
      approvedBy: normalizedHeaderPerson(existing.approvedBy),
    };
    const hasCanonicalValue = Object.values(normalized).some((item) =>
      typeof item === "string"
        ? Boolean(item.trim())
        : Boolean(stringValue(recordValue(item)?.name).trim()),
    );
    const narrative = stringValue(
      existing.narrative ?? existing.content ?? existing.description,
    );
    return !hasCanonicalValue && narrative
      ? normalizeHeaderRecord(narrative)
      : headerWithoutPeople(normalized);
  }
  if (typeof value !== "string") return null;

  const lines = value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized = emptyHeaderRecord();
  let populatedFields = 0;

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const rawLabel = line.slice(0, separator);
    const normalizedLabel = normalizedHeaderLabel(rawLabel);
    const fieldValue = line.slice(separator + 1).trim();
    const positionMatch =
      /^(?:cargo|carga)\s+(elaborador|revisor|aprobador)$/u.exec(
        normalizedLabel,
      );
    if (positionMatch) {
      const personKey =
        positionMatch[1] === "elaborador"
          ? "preparedBy"
          : positionMatch[1] === "revisor"
            ? "reviewedBy"
            : "approvedBy";
      const person = normalizedHeaderPerson(normalized[personKey]);
      normalized[personKey] = { ...person, position: fieldValue };
      if (fieldValue) populatedFields += 1;
      continue;
    }
    const key = headerKeyFromLabel(rawLabel);
    if (!key) continue;

    normalized[key] = HEADER_PEOPLE.some(([personKey]) => personKey === key)
      ? headerPersonFromText(fieldValue)
      : fieldValue;
    if (fieldValue) populatedFields += 1;
  }

  if (populatedFields === 0 && lines.length > 0) {
    normalized.title = cleanDocumentText(value).trim();
    populatedFields = normalized.title ? 1 : 0;
  }

  return populatedFields > 0 ? headerWithoutPeople(normalized) : null;
}

function EmptyValue({
  children = "Sin información registrada.",
}: {
  children?: ReactNode;
}) {
  return <p className="rq-document-empty-value">{children}</p>;
}

function TextList({
  items,
  empty = "Sin información registrada.",
}: {
  items: readonly string[];
  empty?: string;
}) {
  const visible = items.map(displayText).filter(Boolean);
  if (visible.length === 0) return <EmptyValue>{empty}</EmptyValue>;
  return (
    <ul className="rq-document-human-list">
      {visible.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function Tags({ values }: { values: readonly string[] }) {
  const visible = values.map(displayText).filter(Boolean);
  if (visible.length === 0) return <EmptyValue />;
  return (
    <div className="rq-document-tags">
      {visible.map((value, index) => (
        <span key={`${value}-${index}`}>{value}</span>
      ))}
    </div>
  );
}

function HumanValue({
  value,
  label,
}: {
  value: DocumentJsonValue;
  label?: string;
}) {
  if (value === null || value === "") return <EmptyValue />;
  if (typeof value === "string") {
    const text = displayText(value);
    return text ? <p className="rq-document-prose">{text}</p> : <EmptyValue />;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <p className="rq-document-prose">
        {typeof value === "boolean" ? (value ? "Sí" : "No") : value}
      </p>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <EmptyValue />;
    if (value.every((item) => typeof item === "string")) {
      return <TextList items={value as readonly string[]} />;
    }
    return (
      <div className="rq-document-human-cards">
        {value.map((item, index) => (
          <article key={index}>
            <h4>{label ? `${label} ${index + 1}` : `Registro ${index + 1}`}</h4>
            <HumanValue value={item} />
          </article>
        ))}
      </div>
    );
  }
  const record = recordValue(value);
  if (!record) return <EmptyValue />;
  const entries = visibleEntries(record);
  if (entries.length === 0) return <EmptyValue />;
  return (
    <dl className="rq-document-human-details">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{humanLabel(key)}</dt>
          <dd>
            <HumanValue label={humanLabel(key)} value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  readOnly: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}

function TextField({
  label,
  value,
  readOnly,
  multiline = true,
  onChange,
}: TextFieldProps) {
  const visible = cleanDocumentText(value);
  return (
    <label className="rq-document-business-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          rows={Math.min(6, Math.max(2, Math.ceil(visible.length / 140)))}
          value={visible}
        />
      ) : (
        <input
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          value={visible}
        />
      )}
      {value.includes(PENDING) ? <small>Pendiente de definición</small> : null}
    </label>
  );
}

function EditorDisclosure({
  title,
  description,
  meta,
  id,
  leadingIcon,
  defaultOpen = false,
  onDelete,
  children,
}: {
  title: string;
  description?: string;
  meta?: string;
  id?: string;
  leadingIcon?: "epic" | "feature" | "product-backlog-item" | "task";
  defaultOpen?: boolean;
  onDelete?: () => void;
  children: ReactNode;
}) {
  return (
    <details
      className="rq-document-editor-disclosure"
      id={id}
      open={defaultOpen}
    >
      <summary>
        <span className="rq-document-editor-disclosure__title">
          {leadingIcon ? <BacklogWorkItemIcon kind={leadingIcon} /> : null}
          <span>
            <strong>{displayText(title)}</strong>
            {description ? <small>{displayText(description)}</small> : null}
          </span>
        </span>
        {meta ? <span>{meta}</span> : null}
      </summary>
      <div className="rq-document-editor-disclosure__body">
        {children}
        {onDelete ? (
          <footer>
            <button onClick={onDelete} type="button">
              Eliminar registro
            </button>
          </footer>
        ) : null}
      </div>
    </details>
  );
}

function BacklogWorkItemIcon({
  kind,
}: {
  kind: "epic" | "feature" | "product-backlog-item" | "task";
}) {
  if (kind === "product-backlog-item") {
    return (
      <span
        aria-label="Product Backlog Item"
        className="rq-work-item-icon rq-work-item-icon--pbi"
        role="img"
      >
        <i />
        <i />
        <i />
      </span>
    );
  }

  const labels = {
    epic: "Ícono de épica",
    feature: "Ícono de funcionalidad",
    task: "Ícono de tarea",
  } as const;
  const glyphs = { epic: "♛", feature: "🏆", task: "☑" } as const;

  return (
    <span
      aria-label={labels[kind]}
      className={`rq-work-item-icon rq-work-item-icon--${kind}`}
      role="img"
    >
      {glyphs[kind]}
    </span>
  );
}

function EditorHint() {
  return (
    <p className="rq-document-editor-hint">
      Los registros están resumidos. Abre únicamente el que quieras modificar.
    </p>
  );
}

function isPendingValue(value: DocumentJsonValue | undefined) {
  return !cleanDocumentText(stringValue(value)).trim();
}

function featureContextMeta(feature: JsonRecord) {
  const base = `${stringList(feature.userStoryCodes).length} HU · ${stringList(feature.inScope).length} incluidos`;
  return isPendingValue(feature.objective)
    ? `${base} · ⚠ Falta definir objetivo`
    : base;
}

function storyContextMeta(story: JsonRecord) {
  const criteria = recordList(story.acceptanceCriteria).length;
  const fields = recordList(story.fields).length;
  return criteria === 0
    ? `${criteria} criterios · ${fields} campos · ⚠ Falta criterio de aceptación`
    : `${criteria} criterios · ${fields} campos`;
}

function StringListEditor({
  label,
  value,
  readOnly,
  onChange,
  emptyLabel = "Sin registros.",
}: {
  label: string;
  value: readonly string[];
  readOnly: boolean;
  onChange: (value: string[]) => void;
  emptyLabel?: string;
}) {
  return (
    <fieldset className="rq-document-business-list">
      <legend>{label}</legend>
      {value.length === 0 ? <EmptyValue>{emptyLabel}</EmptyValue> : null}
      <div className="rq-document-editable-list">
        {value.map((item, index) => (
          <div key={index}>
            <textarea
              aria-label={`${label} ${index + 1}`}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  value.map((current, itemIndex) =>
                    itemIndex === index ? event.target.value : current,
                  ),
                )
              }
              rows={item.length > 110 ? 2 : 1}
              value={cleanDocumentText(item)}
            />
            {!readOnly ? (
              <button
                aria-label={`Quitar ${label.toLowerCase()} ${index + 1}`}
                onClick={() =>
                  onChange(value.filter((_, itemIndex) => itemIndex !== index))
                }
                title="Quitar"
                type="button"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {!readOnly ? (
        <button
          className="rq-document-add-item"
          onClick={() => onChange([...value, PENDING])}
          type="button"
        >
          + Agregar
        </button>
      ) : null}
    </fieldset>
  );
}

function ReferenceListEditor({
  label,
  value,
  options,
  readOnly,
  onChange,
}: {
  label: string;
  value: readonly string[];
  options: readonly { value: string; label: string }[];
  readOnly: boolean;
  onChange: (value: string[]) => void;
}) {
  const available = options.filter(
    (option) => option.value && !value.includes(option.value),
  );
  return (
    <fieldset className="rq-document-business-list rq-document-reference-list">
      <legend>{label}</legend>
      <div className="rq-document-reference-chips">
        {value.map((item) => {
          const option = options.find((candidate) => candidate.value === item);
          return (
            <span key={item}>
              {option?.label ?? displayText(item)}
              {!readOnly ? (
                <button
                  aria-label={`Quitar ${option?.label ?? item}`}
                  onClick={() =>
                    onChange(value.filter((current) => current !== item))
                  }
                  title="Quitar"
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      {!readOnly && available.length > 0 ? (
        <select
          aria-label={`Agregar ${label.toLowerCase()}`}
          onChange={(event) => {
            if (!event.target.value) return;
            onChange([...value, event.target.value]);
            event.target.value = "";
          }}
          value=""
        >
          <option value="">+ Agregar…</option>
          {available.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
    </fieldset>
  );
}

function SafeValueEditor({
  value,
  label,
  readOnly,
  onChange,
}: {
  value: DocumentJsonValue;
  label: string;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}) {
  if (typeof value === "string") {
    return (
      <TextField
        label={label}
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="rq-document-business-check">
        <input
          checked={value}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="rq-document-business-field">
        <span>{label}</span>
        <input
          disabled={readOnly}
          onChange={(event) => onChange(Number(event.target.value))}
          type="number"
          value={value}
        />
      </label>
    );
  }
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return (
        <StringListEditor
          label={label}
          onChange={onChange as (value: string[]) => void}
          readOnly={readOnly}
          value={value as readonly string[]}
        />
      );
    }
    return (
      <fieldset className="rq-document-business-list">
        <legend>{label}</legend>
        {value.map((item, index) => (
          <article className="rq-document-business-card" key={index}>
            <header>
              <strong>
                {label} {index + 1}
              </strong>
              {!readOnly ? (
                <button
                  aria-label={`Eliminar ${label} ${index + 1}`}
                  onClick={() => {
                    if (!globalThis.confirm(`¿Eliminar ${label} ${index + 1}?`))
                      return;
                    onChange(
                      value.filter((_, itemIndex) => itemIndex !== index),
                    );
                  }}
                  type="button"
                >
                  Eliminar
                </button>
              ) : null}
            </header>
            <SafeValueEditor
              label={label}
              onChange={(next) =>
                onChange(
                  value.map((current, itemIndex) =>
                    itemIndex === index ? next : current,
                  ),
                )
              }
              readOnly={readOnly}
              value={item}
            />
          </article>
        ))}
        {!readOnly ? (
          <button
            className="rq-document-add-item"
            onClick={() =>
              onChange([
                ...value,
                value.length > 0
                  ? (JSON.parse(
                      JSON.stringify(value.at(-1)),
                    ) as DocumentJsonValue)
                  : {},
              ])
            }
            type="button"
          >
            Agregar {label.toLowerCase()}
          </button>
        ) : null}
      </fieldset>
    );
  }
  const record = recordValue(value);
  if (!record) return null;
  return (
    <div className="rq-document-business-grid">
      {visibleEntries(record).map(([key, item]) => (
        <SafeValueEditor
          key={key}
          label={humanLabel(key)}
          onChange={(next) => onChange({ ...record, [key]: next })}
          readOnly={readOnly}
          value={item}
        />
      ))}
    </div>
  );
}

function HeaderView({ value }: { value: DocumentJsonValue }) {
  const record = normalizeHeaderRecord(value);
  if (!record) return <HumanValue value={value} />;
  return (
    <div className="rq-document-human-section">
      <div className="rq-document-header-grid">
        {HEADER_CORE_KEYS.map((key) => (
          <div key={key}>
            <span>{humanLabel(key)}</span>
            <strong>
              {displayText(stringValue(record[key])) || "Sin definir"}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeaderEditor({ value, readOnly, onChange }: BusinessEditorProps) {
  const record = normalizeHeaderRecord(value);

  if (!record)
    return (
      <SafeValueEditor
        label="Encabezado"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );

  const set = (key: string, next: DocumentJsonValue) =>
    onChange({ ...record, [key]: next });

  return (
    <div className="rq-document-human-editor rq-document-header-editor">
      <div className="rq-document-header-editor__core">
        {HEADER_CORE_KEYS.map((key) => (
          <TextField
            key={key}
            label={humanLabel(key)}
            multiline={false}
            onChange={(next) => set(key, next)}
            readOnly={readOnly}
            value={stringValue(record[key])}
          />
        ))}
      </div>
    </div>
  );
}

function KnownSectionView({
  value,
  fields,
}: {
  value: DocumentJsonValue;
  fields: readonly { key: string; label: string; empty?: string }[];
}) {
  const record = recordValue(value);
  if (!record) return <NarrativeView value={value} />;
  const hasContent = (item: DocumentJsonValue | undefined): boolean => {
    if (typeof item === "string") return Boolean(displayText(item));
    if (Array.isArray(item)) return item.length > 0;
    return item !== null && item !== undefined;
  };
  return (
    <div className="rq-document-known-section">
      {fields
        .filter(({ key, empty }) => Boolean(empty) || hasContent(record[key]))
        .map(({ key, label, empty }) => (
          <section data-section-field={key} key={key}>
            <h3>{label}</h3>
            {Array.isArray(record[key]) && record[key].length === 0 && empty ? (
              <EmptyValue>{empty}</EmptyValue>
            ) : (
              <HumanValue value={record[key] ?? ""} />
            )}
          </section>
        ))}
    </div>
  );
}

function KnownSectionEditor({
  value,
  readOnly,
  onChange,
  fields,
  narrativeLabel,
}: BusinessEditorProps & {
  fields: readonly { key: string; label: string; list?: boolean }[];
  narrativeLabel: string;
}) {
  if (typeof value === "string")
    return (
      <TextField
        label={narrativeLabel}
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  const record = recordValue(value);
  if (!record)
    return (
      <TextField
        label={narrativeLabel}
        onChange={onChange}
        readOnly={readOnly}
        value=""
      />
    );
  return (
    <div className="rq-document-business-grid">
      {fields.map(({ key, label, list }) =>
        list ? (
          <StringListEditor
            key={key}
            label={label}
            onChange={(next) => onChange({ ...record, [key]: next })}
            readOnly={readOnly}
            value={stringList(record[key])}
          />
        ) : (
          <TextField
            key={key}
            label={label}
            onChange={(next) => onChange({ ...record, [key]: next })}
            readOnly={readOnly}
            value={stringValue(record[key])}
          />
        ),
      )}
    </div>
  );
}

type NormalizedObjectives = {
  general: string;
  qualitative: string[];
  quantitative: string[];
};

function ensureObjectiveGroups(
  value: NormalizedObjectives,
): NormalizedObjectives {
  return {
    general: value.general,
    qualitative:
      value.qualitative.length > 0
        ? [...new Set(value.qualitative)]
        : [PENDING],
    quantitative:
      value.quantitative.length > 0
        ? [...new Set(value.quantitative)]
        : [PENDING],
  };
}

function splitObjectiveItems(value: string): string[] {
  const cleaned = cleanDocumentText(value).trim();
  if (!cleaned) return [];

  const numbered = cleaned
    .split(/(?=\b\d{1,2}[.)]\s*)/gu)
    .map((item) =>
      item
        .replace(/^\d{1,2}[.)]\s*/u, "")
        .replace(/^[;,\s]+|[;,\s]+$/gu, "")
        .trim(),
    )
    .filter(Boolean);
  if (numbered.length > 1) return numbered;

  return cleaned
    .split(/\s*(?:\r?\n+|[;•▪◦])\s*/gu)
    .map((item) => item.replace(/^[-–—*]\s*/u, "").trim())
    .filter(Boolean);
}

function isQuantitativeObjective(value: string): boolean {
  return /(?:\d+(?:[.,]\d+)?\s*(?:%|por\s+ciento|d[ií]as?|semanas?|meses?|a[nñ]os?|horas?|minutos?|segundos?|solicitudes?|registros?|usuarios?|casos?|errores?|cop|usd)|(?:reducir|aumentar|alcanzar|lograr|mantener|atender|procesar)\b[^.]{0,120}\d|porcentaje|cantidad|tasa|promedio|meta\s+de)/iu.test(
    value,
  );
}

function classifyLegacyObjectives(values: readonly string[]) {
  return values.reduce(
    (result, objective) => {
      if (isQuantitativeObjective(objective)) {
        result.quantitative.push(objective);
      } else {
        result.qualitative.push(objective);
      }
      return result;
    },
    { qualitative: [] as string[], quantitative: [] as string[] },
  );
}

function parseObjectivesNarrative(value: string): NormalizedObjectives {
  const text = cleanDocumentText(value).trim();

  if (!text) {
    return {
      general: "",
      qualitative: [],
      quantitative: [],
    };
  }

  const headingPattern =
    /\b(objetivo\s+general|objetivos?(?:\s+espec[ií]ficos?)?\s+cualitativos?|objetivos?(?:\s+espec[ií]ficos?)?\s+cuantitativos?|objetivos?\s+espec[ií]ficos?)\s*:?\s*/giu;
  const matches = [...text.matchAll(headingPattern)];

  if (matches.length === 0) {
    return { general: text, qualitative: [], quantitative: [] };
  }

  let general = text.slice(0, matches[0]?.index ?? 0).trim();
  let qualitative: string[] = [];
  let quantitative: string[] = [];
  let legacySpecific: string[] = [];

  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    const heading = match[1]?.toLocaleLowerCase("es") ?? "";

    if (heading.includes("general")) general = content;
    else if (heading.includes("cualitativ"))
      qualitative = splitObjectiveItems(content);
    else if (heading.includes("cuantitativ"))
      quantitative = splitObjectiveItems(content);
    else legacySpecific = splitObjectiveItems(content);
  });

  const classified = classifyLegacyObjectives(legacySpecific);

  return {
    general,
    qualitative: [...qualitative, ...classified.qualitative],
    quantitative: [...quantitative, ...classified.quantitative],
  };
}

export function normalizeObjectives(
  value: DocumentJsonValue,
): NormalizedObjectives {
  if (typeof value === "string") {
    return ensureObjectiveGroups(parseObjectivesNarrative(value));
  }

  const record = recordValue(value);

  if (!record) {
    return ensureObjectiveGroups({
      general: "",
      qualitative: [],
      quantitative: [],
    });
  }

  const legacy = classifyLegacyObjectives(
    stringList(record.specific ?? record.specificObjectives ?? []),
  );

  return ensureObjectiveGroups({
    general: stringValue(record.general ?? record.generalObjective ?? ""),
    qualitative: [
      ...stringList(record.qualitative ?? record.qualitativeObjectives ?? []),
      ...legacy.qualitative,
    ],
    quantitative: [
      ...stringList(record.quantitative ?? record.quantitativeObjectives ?? []),
      ...legacy.quantitative,
    ],
  });
}

function ObjectivesGroup({
  title,
  values,
  emptyLabel,
}: {
  title: string;
  values: readonly string[];
  emptyLabel: string;
}) {
  return (
    <section className="rq-document-objectives-specific">
      <div className="rq-document-objectives-specific__header">
        <h3>{title}</h3>
        <span>
          {values.length} {values.length === 1 ? "objetivo" : "objetivos"}
        </span>
      </div>
      {values.length > 0 ? (
        <ol className="rq-document-objectives-list">
          {values.map((objective, index) => (
            <li key={`${objective}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{displayText(objective)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyValue>{emptyLabel}</EmptyValue>
      )}
    </section>
  );
}

function ObjectivesView({ value }: { value: DocumentJsonValue }) {
  const objectives = normalizeObjectives(value);

  return (
    <div className="rq-document-objectives-view">
      <section className="rq-document-objective-general">
        <h3>Objetivo general</h3>

        {objectives.general ? (
          <p>{displayText(objectives.general)}</p>
        ) : (
          <EmptyValue>Sin objetivo general registrado.</EmptyValue>
        )}
      </section>

      <div className="rq-document-objectives-specific-grid">
        <ObjectivesGroup
          emptyLabel="Sin objetivos cualitativos registrados."
          title="Objetivos específicos cualitativos"
          values={objectives.qualitative}
        />
        <ObjectivesGroup
          emptyLabel="Sin objetivos cuantitativos registrados."
          title="Objetivos específicos cuantitativos"
          values={objectives.quantitative}
        />
      </div>
    </div>
  );
}

function ObjectivesEditor({ value, readOnly, onChange }: BusinessEditorProps) {
  const objectives = normalizeObjectives(value);

  const update = (next: Partial<NormalizedObjectives>) => {
    onChange({
      general: next.general ?? objectives.general,
      qualitative: next.qualitative ?? objectives.qualitative,
      quantitative: next.quantitative ?? objectives.quantitative,
    });
  };

  return (
    <div className="rq-document-objectives-editor">
      <TextField
        label="Objetivo general"
        onChange={(general) => update({ general })}
        readOnly={readOnly}
        value={objectives.general}
      />

      <div className="rq-document-objectives-editor__specific-grid">
        <StringListEditor
          emptyLabel="Sin objetivos cualitativos."
          label="Objetivos específicos cualitativos"
          onChange={(qualitative) => update({ qualitative })}
          readOnly={readOnly}
          value={objectives.qualitative}
        />
        <StringListEditor
          emptyLabel="Sin objetivos cuantitativos."
          label="Objetivos específicos cuantitativos"
          onChange={(quantitative) => update({ quantitative })}
          readOnly={readOnly}
          value={objectives.quantitative}
        />
      </div>
    </div>
  );
}
type NormalizedProblemDescription = {
  currentState: string;
  operationalImpact: string[];
};

function splitProblemItems(value: string): string[] {
  const cleaned = cleanDocumentText(value)
    .replace(/^[\s,;•-]+|[\s,;•-]+$/gu, "")
    .trim();

  if (!cleaned) return [];

  const primary = cleaned
    .split(/\s*(?:\r?\n+|[;•])\s*/gu)
    .map((item) => item.replace(/^\s*(?:[-–—•*]|\d{1,2}[.)])\s*/u, "").trim())
    .filter(Boolean);

  if (primary.length > 1) return primary;

  /*
   * Algunos levantamientos históricos guardaban los impactos
   * en una sola frase separados por comas.
   *
   * Solo los dividimos cuando claramente existen varios elementos.
   */
  const commaItems = cleaned
    .split(/,\s+/gu)
    .map((item) => item.trim())
    .filter(Boolean);

  return commaItems.length >= 3 ? commaItems : [cleaned];
}

export function parseProblemNarrative(
  value: string,
): NormalizedProblemDescription {
  const source = cleanDocumentText(value).trim();

  if (!source) {
    return {
      currentState: "",
      operationalImpact: [],
    };
  }

  const currentMatch =
    /\b(?:situaci[oó]n(?:\s+actual)?|estado\s+actual|contexto\s+actual)\s*:\s*/iu.exec(
      source,
    );

  const impactMatch =
    /\b(?:(?:impactos?(?:\s+(?:principal(?:es)?|operacional(?:es)?|operativo(?:s)?|observado(?:s)?))?)|(?:problemas?\s+identificados?))\s*:\s*/iu.exec(
      source,
    );

  const additionalMatch =
    /\b(?:(?:procesos?(?:\s+y\s+actores?)?|actores?)\s+afectados?|actores?\s+involucrados?|necesidad(?:\s+de\s+negocio|\s+identificada)?|casos?\s+de\s+uso\s+afectados?|vac[ií]os?(?:\s+identificados?)?|fuente\s+de\s+evidencia)\s*:\s*/iu.exec(
      source,
    );

  let currentState = source;
  let impactText = "";
  let processesText = "";

  if (currentMatch) {
    const currentStart = currentMatch.index + currentMatch[0].length;

    const currentEnd = Math.min(
      impactMatch?.index ?? source.length,
      additionalMatch?.index ?? source.length,
    );

    currentState = source.slice(currentStart, currentEnd).trim();
  } else if (impactMatch) {
    currentState = source.slice(0, impactMatch.index).trim();
  }

  if (impactMatch) {
    const impactStart = impactMatch.index + impactMatch[0].length;

    const impactEnd =
      additionalMatch && additionalMatch.index > impactMatch.index
        ? additionalMatch.index
        : source.length;

    impactText = source.slice(impactStart, impactEnd).trim();
  }

  /*
   * El contrato actual de IA NO tiene affectedProcesses.
   * Para documentos históricos preservamos esa información
   * dentro de currentState, que sí pertenece al contrato.
   */
  if (additionalMatch) {
    processesText = source.slice(additionalMatch.index).trim();

    if (processesText && !currentState.includes(processesText)) {
      currentState = [currentState, processesText].filter(Boolean).join("\n\n");
    }
  }

  return {
    currentState,
    operationalImpact: splitProblemItems(impactText),
  };
}

export function normalizeProblemDescription(
  value: DocumentJsonValue,
): NormalizedProblemDescription {
  if (typeof value === "string") {
    return parseProblemNarrative(value);
  }

  const record = recordValue(value);

  if (!record) {
    return {
      currentState: "",
      operationalImpact: [],
    };
  }

  const currentState = stringValue(record.currentState);
  const operationalImpact = stringList(record.operationalImpact);
  const narrative = [record.narrative, record.content, record.description]
    .map(stringValue)
    .find(Boolean);
  const parsedCurrentState = parseProblemNarrative(currentState);
  const parsed = narrative
    ? parseProblemNarrative(narrative)
    : { currentState: "", operationalImpact: [] };
  const canonicalCurrentState =
    parsedCurrentState.operationalImpact.length > 0
      ? parsedCurrentState.currentState
      : currentState;
  const normalizedCurrentState =
    !canonicalCurrentState || canonicalCurrentState === PENDING
      ? parsed.currentState || canonicalCurrentState
      : !parsed.currentState ||
          canonicalCurrentState.includes(parsed.currentState)
        ? canonicalCurrentState
        : parsed.currentState.includes(canonicalCurrentState)
          ? parsed.currentState
          : `${canonicalCurrentState}\n\n${parsed.currentState}`;
  const meaningfulImpacts = operationalImpact.filter(
    (impact) => impact !== PENDING,
  );
  const normalizedImpacts = [
    ...new Set([
      ...meaningfulImpacts,
      ...parsedCurrentState.operationalImpact,
      ...parsed.operationalImpact,
    ]),
  ];

  return {
    currentState: normalizedCurrentState,
    operationalImpact:
      normalizedImpacts.length > 0 ? normalizedImpacts : operationalImpact,
  };
}

function displayProblemText(value: string): string {
  const cleaned = cleanDocumentText(value);
  return cleaned === PENDING
    ? "Pendiente de definición"
    : cleaned.replaceAll(PENDING, "Pendiente de definición");
}

function ProblemDescriptionView({ value }: { value: DocumentJsonValue }) {
  const problem = normalizeProblemDescription(value);

  return (
    <div className="rq-document-problem-view">
      <section className="rq-document-problem-view__current">
        <div className="rq-document-problem-heading">
          <h3>Situación actual</h3>
        </div>

        {problem.currentState ? (
          <p>{displayProblemText(problem.currentState)}</p>
        ) : (
          <EmptyValue>Sin descripción de la situación actual.</EmptyValue>
        )}
      </section>

      <section className="rq-document-problem-view__impact">
        <div className="rq-document-problem-heading">
          <h3>Impactos operacionales</h3>

          <span>
            {problem.operationalImpact.length}{" "}
            {problem.operationalImpact.length === 1 ? "impacto" : "impactos"}
          </span>
        </div>

        {problem.operationalImpact.length > 0 ? (
          <ol className="rq-document-problem-impact-list">
            {problem.operationalImpact.map((impact, index) => (
              <li key={`${impact}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>

                <p>{displayProblemText(impact)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyValue>Sin impactos operacionales registrados.</EmptyValue>
        )}
      </section>
    </div>
  );
}

function ProblemDescriptionEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const problem = normalizeProblemDescription(value);

  const update = (next: Partial<NormalizedProblemDescription>) => {
    /*
     * IMPORTANTE:
     * Persistimos exactamente la estructura que espera la IA:
     *
     * {
     *   currentState: string,
     *   operationalImpact: string[]
     * }
     *
     * No agregamos campos visuales al contrato.
     */
    onChange({
      currentState: next.currentState ?? problem.currentState,
      operationalImpact: next.operationalImpact ?? problem.operationalImpact,
    });
  };

  return (
    <div className="rq-document-problem-editor">
      <section className="rq-document-problem-editor__current">
        <TextField
          label="Situación actual"
          onChange={(currentState) => update({ currentState })}
          readOnly={readOnly}
          value={problem.currentState}
        />
      </section>

      <section className="rq-document-problem-editor__impact">
        <StringListEditor
          emptyLabel="Sin impactos operacionales."
          label="Impactos operacionales"
          onChange={(operationalImpact) => update({ operationalImpact })}
          readOnly={readOnly}
          value={problem.operationalImpact}
        />
      </section>
    </div>
  );
}

type NormalizedScope = {
  included: string[];
  excluded: string[];
  involvedSystems: string[];
  kpis: NormalizedScopeKpi[];
};

type NormalizedScopeKpi = {
  name: string;
  relatedObjective: string;
  measurement: string;
  target: string;
};

const DEFAULT_SCOPE_KPIS: readonly NormalizedScopeKpi[] = [
  {
    name: "Avance general del proyecto",
    relatedObjective: "Completar la ejecución planificada del proyecto",
    measurement: "Tareas completadas / total de tareas planificadas × 100",
    target: "100%",
  },
  {
    name: "Cumplimiento de objetivos",
    relatedObjective:
      "Cumplir los objetivos cualitativos y cuantitativos mediante sus historias y tareas vinculadas",
    measurement:
      "Historias con todas sus tareas completadas / total de historias × 100",
    target: "100%",
  },
  {
    name: "Cumplimiento de entregables",
    relatedObjective: "Finalizar los hitos y entregables comprometidos",
    measurement: "Hitos finalizados / total de hitos planificados × 100",
    target: "100%",
  },
];

function resolvedKpiField(value: string, fallback: string): string {
  const normalized = value.trim();
  return !normalized ||
    normalized === PENDING ||
    /por definir/iu.test(normalized)
    ? fallback
    : normalized;
}

function ensureScopeKpis(values: readonly NormalizedScopeKpi[]) {
  return DEFAULT_SCOPE_KPIS.map((fallback, index) => {
    const value = values[index];
    if (!value) return { ...fallback };
    return {
      name: resolvedKpiField(value.name, fallback.name),
      relatedObjective: resolvedKpiField(
        value.relatedObjective,
        fallback.relatedObjective,
      ),
      measurement: resolvedKpiField(value.measurement, fallback.measurement),
      target: resolvedKpiField(value.target, fallback.target),
    };
  });
}

function normalizeScopeKpis(value: DocumentJsonValue | undefined) {
  return ensureScopeKpis(
    recordList(value).map((kpi) => ({
      name: stringValue(kpi.name ?? kpi.title),
      relatedObjective: stringValue(
        kpi.relatedObjective ?? kpi.objective ?? kpi.objectiveReference,
      ),
      measurement: stringValue(kpi.measurement ?? kpi.formula ?? kpi.metric),
      target: stringValue(kpi.target ?? kpi.goal),
    })),
  );
}

function parseScopeKpis(value: string): NormalizedScopeKpi[] {
  return splitScopeItems(value)
    .slice(0, 3)
    .map((item) => {
      const fields = Object.fromEntries(
        item
          .split(/\s*\|\s*/gu)
          .map((part) => {
            const separator = part.indexOf(":");
            return separator < 0
              ? ["name", part.trim()]
              : [
                  part.slice(0, separator).trim().toLocaleLowerCase("es"),
                  part.slice(separator + 1).trim(),
                ];
          })
          .filter((entry) => entry[1]),
      );
      return {
        name: fields.nombre ?? fields.indicador ?? fields.name ?? item,
        relatedObjective:
          fields.objetivo ??
          fields["objetivo relacionado"] ??
          fields.relatedobjective ??
          "",
        measurement:
          fields.medición ??
          fields.medicion ??
          fields.fórmula ??
          fields.formula ??
          fields.measurement ??
          "",
        target: fields.meta ?? fields.target ?? "",
      };
    });
}

function cleanScopeItem(value: string): string {
  return cleanDocumentText(value)
    .replace(/^\s*(?:[-•▪◦]|\d{1,2}[.)])\s*/u, "")
    .replace(/^[\s,;]+|[\s,;]+$/gu, "")
    .trim();
}

function splitScopeItems(
  value: string,
  options: {
    commaSeparated?: boolean;
  } = {},
): string[] {
  const cleaned = cleanDocumentText(value).trim();

  if (!cleaned) return [];

  /*
   * Primero separar listas numeradas:
   *
   * 1) Formulario...
   * 2) Consulta D365...
   * 3) Flujo...
   */
  const numbered = cleaned
    .split(/(?=\b\d{1,2}[.)]\s*)/gu)
    .map(cleanScopeItem)
    .filter(Boolean);

  if (numbered.length > 1) {
    return numbered;
  }

  /*
   * Luego listas por saltos, bullets o punto y coma.
   */
  const separated = cleaned
    .split(/\s*(?:\r?\n+|[;•▪◦])\s*/gu)
    .map(cleanScopeItem)
    .filter(Boolean);

  if (separated.length > 1) {
    return separated;
  }

  /*
   * Para sistemas sí permitimos separación por coma.
   */
  if (options.commaSeparated) {
    const commaItems = cleaned
      .split(/,\s+/gu)
      .map(cleanScopeItem)
      .filter(Boolean);

    if (commaItems.length > 1) {
      return commaItems;
    }
  }

  return [cleanScopeItem(cleaned)].filter(Boolean);
}

function parseScopeNarrative(value: string): NormalizedScope {
  const source = cleanDocumentText(value).trim();

  if (!source) {
    return {
      included: [],
      excluded: [],
      involvedSystems: [],
      kpis: [],
    };
  }

  const includedMatch = /\b(?:incluye|alcance incluido)\s*:\s*/iu.exec(source);

  const excludedMatch =
    /\b(?:excluye|fuera de alcance|no incluye)\s*:\s*/iu.exec(source);

  const systemsMatch =
    /\b(?:sistemas(?:\s+y\s+actores)?\s+involucrados|sistemas involucrados|sistemas y actores|sistemas)\s*:\s*/iu.exec(
      source,
    );
  const kpisMatch = /\b(?:kpis?|indicadores?)(?:\s+de\s+estado)?\s*:\s*/iu.exec(
    source,
  );

  let includedText = source;
  let excludedText = "";
  let systemsText = "";
  let kpisText = "";

  if (includedMatch) {
    const start = includedMatch.index + includedMatch[0].length;

    const end = Math.min(
      excludedMatch?.index ?? source.length,
      systemsMatch?.index ?? source.length,
      kpisMatch?.index ?? source.length,
    );

    includedText = source.slice(start, end).trim();
  }

  if (
    excludedMatch &&
    (!systemsMatch || excludedMatch.index < systemsMatch.index)
  ) {
    const start = excludedMatch.index + excludedMatch[0].length;

    const end = Math.min(
      systemsMatch?.index ?? source.length,
      kpisMatch?.index ?? source.length,
    );

    excludedText = source.slice(start, end).trim();
  }

  if (systemsMatch) {
    const start = systemsMatch.index + systemsMatch[0].length;

    const end = kpisMatch?.index ?? source.length;
    systemsText = source.slice(start, end).trim();
  }

  if (kpisMatch) {
    const start = kpisMatch.index + kpisMatch[0].length;
    kpisText = source.slice(start).trim();
  }

  return {
    included: splitScopeItems(includedText),
    excluded: splitScopeItems(excludedText),
    involvedSystems: splitScopeItems(systemsText, { commaSeparated: true }),
    kpis: parseScopeKpis(kpisText),
  };
}

export function normalizeScope(value: DocumentJsonValue): NormalizedScope {
  /*
   * Compatibilidad histórica:
   * algunas versiones guardaron Alcance como narrativa.
   */
  if (typeof value === "string") {
    const parsed = parseScopeNarrative(value);
    return { ...parsed, kpis: ensureScopeKpis(parsed.kpis) };
  }

  const record = recordValue(value);

  if (!record) {
    return {
      included: [],
      excluded: [],
      involvedSystems: [],
      kpis: ensureScopeKpis([]),
    };
  }

  /*
   * Este es exactamente el contrato actual que recibe
   * y devuelve la IA.
   */
  return {
    included: stringList(record.included),
    excluded: stringList(record.excluded),
    involvedSystems: stringList(record.involvedSystems),
    kpis: normalizeScopeKpis(record.kpis ?? record.indicators),
  };
}

function ScopeNumberedList({
  values,
  emptyLabel,
  twoColumns = false,
}: {
  values: readonly string[];
  emptyLabel: string;
  twoColumns?: boolean;
}) {
  if (values.length === 0) {
    return <EmptyValue>{emptyLabel}</EmptyValue>;
  }

  if (!twoColumns || values.length < 4) {
    return (
      <ol className="rq-document-scope-list">
        {values.map((item, index) => (
          <li key={`${item}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>

            <p>{displayText(item)}</p>
          </li>
        ))}
      </ol>
    );
  }

  /*
   * Reparto vertical:
   *
   * 01 06
   * 02 07
   * 03 08
   * 04 09
   * 05
   *
   * Evita el orden horizontal:
   * 01 02 / 03 04...
   */
  const splitIndex = Math.ceil(values.length / 2);

  const columns = [values.slice(0, splitIndex), values.slice(splitIndex)];

  return (
    <div className="rq-document-scope-list-columns">
      {columns.map((column, columnIndex) => (
        <ol
          className="rq-document-scope-list"
          key={`scope-column-${columnIndex}`}
        >
          {column.map((item, itemIndex) => {
            const absoluteIndex =
              columnIndex === 0 ? itemIndex : splitIndex + itemIndex;

            return (
              <li key={`${item}-${absoluteIndex}`}>
                <span>{String(absoluteIndex + 1).padStart(2, "0")}</span>

                <p>{displayText(item)}</p>
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

function ScopeSystems({ values }: { values: readonly string[] }) {
  if (values.length === 0) {
    return <EmptyValue>Sin sistemas involucrados registrados.</EmptyValue>;
  }

  return (
    <div className="rq-document-scope-systems">
      {values.map((item, index) => (
        <span key={`${item}-${index}`}>{displayText(item)}</span>
      ))}
    </div>
  );
}

function ScopeView({ value }: { value: DocumentJsonValue }) {
  const scope = normalizeScope(value);

  return (
    <div className="rq-document-scope-view">
      <section className="rq-document-scope-view__included">
        <div className="rq-document-scope-heading">
          <h3>Incluye</h3>

          <span>
            {scope.included.length}{" "}
            {scope.included.length === 1 ? "elemento" : "elementos"}
          </span>
        </div>

        <ScopeNumberedList
          emptyLabel="Sin elementos de alcance registrados."
          twoColumns
          values={scope.included}
        />
      </section>

      <div className="rq-document-scope-view__secondary">
        <section>
          <div className="rq-document-scope-heading">
            <h3>Fuera de alcance</h3>
          </div>

          <ScopeNumberedList
            emptyLabel="Sin exclusiones explícitamente definidas."
            values={scope.excluded}
          />
        </section>

        <section>
          <div className="rq-document-scope-heading">
            <h3>Sistemas involucrados</h3>

            <span>{scope.involvedSystems.length}</span>
          </div>

          <ScopeSystems values={scope.involvedSystems} />
        </section>
      </div>
    </div>
  );
}

function KpiDashboardView({
  value,
  scopeValue,
  backlogValue,
  projectId,
}: {
  value: DocumentJsonValue;
  scopeValue?: DocumentJsonValue | null;
  backlogValue?: DocumentJsonValue | null;
  projectId?: string;
}) {
  const record = recordValue(value);
  const source = record?.kpis
    ? normalizeScopeKpis(record.kpis)
    : scopeValue
      ? normalizeScope(scopeValue).kpis
      : ensureScopeKpis([]);
  const storedValues = Array.isArray(record?.currentValues)
    ? record.currentValues
    : [];
  const [executionValues, setExecutionValues] = useState<number[] | null>(null);

  useEffect(() => {
    if (!projectId || !backlogValue) return;
    let active = true;
    const backlog = recordValue(backlogValue);
    const epics = recordList(backlog?.epics).map((epic) => ({
      stories: recordList(epic.features).flatMap((feature) =>
        recordList(feature.userStories).map((story) =>
          recordList(story.tasks).map((task) => ({
            code: stringValue(task.code),
            title: stringValue(task.title),
          })),
        ),
      ),
    }));
    const tasks = epics.flatMap((epic) => epic.stories.flat());
    // Mismos KPI que Ejecución e Inicio: una sola fórmula sobre el estado guardado en el servidor.
    void loadExecutionDoneCodes(projectId, tasks)
      .then(({ done }) => {
        if (!active) return;
        const kpis = computeExecutionKpis(
          epics.map((epic) => ({
            stories: epic.stories.map((story) => story.map((task) => task.code)),
            loose: [],
          })),
          done,
        );
        setExecutionValues(
          kpis.doneTasks === 0 && done.size === 0
            ? null
            : [kpis.progress, kpis.objectiveCompliance, kpis.deliverableCompliance],
        );
      })
      .catch(() => {
        if (active) setExecutionValues(null);
      });
    return () => {
      active = false;
    };
  }, [backlogValue, projectId]);
  const rawValues = executionValues ?? storedValues;

  return (
    <div className="rq-document-kpi-dashboard">
      <header>
        <div>
          <span>Medición de ejecución</span>
          <h3>Indicadores del proyecto</h3>
        </div>
        <small>Fuente de actualización: seguimiento de ejecución del proyecto</small>
      </header>
      <div className="rq-document-kpi-dashboard__grid">
        {source.map((kpi, index) => {
          const current = Math.max(
            0,
            Math.min(100, numberValue(rawValues[index]) ?? 0),
          );
          return (
            <article
              data-complete={current >= 100}
              data-empty={current === 0}
              key={`${kpi.name}-${index}`}
            >
              <div
                aria-label={`${current}% de 100%`}
                className="rq-document-kpi-gauge"
                role="img"
              >
                <KpiRing value={current} />
                <strong>{current}%</strong>
              </div>
              <h4>{displayText(kpi.name)}</h4>
              <div className="rq-document-kpi-meter">
                <span style={{ width: `${current}%` }} />
              </div>
              <div className="rq-document-kpi-values">
                <span>
                  <strong>{current}%</strong> actual
                </span>
                <span>
                  <strong>{displayText(kpi.target)}</strong> meta
                </span>
              </div>
              <p>{displayText(kpi.measurement)}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function KpiDashboardEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const record = recordValue(value);
  const kpis = normalizeScopeKpis(record?.kpis);
  const update = (index: number, key: keyof NormalizedScopeKpi, next: string) =>
    onChange({
      ...(record ?? {}),
      kpis: kpis.map((kpi, itemIndex) =>
        itemIndex === index ? { ...kpi, [key]: next } : kpi,
      ),
      dataSource: "AZURE_DEVOPS_EXECUTION",
      currentValues: record?.currentValues ?? [0, 0, 0],
    });

  return (
    <div className="rq-document-kpi-dashboard-editor">
      {kpis.map((kpi, index) => (
        <section key={index}>
          <h4>KPI {index + 1}</h4>
          <TextField
            label="Nombre"
            multiline={false}
            onChange={(next) => update(index, "name", next)}
            readOnly={readOnly}
            value={kpi.name}
          />
          <TextField
            label="Objetivo relacionado"
            onChange={(next) => update(index, "relatedObjective", next)}
            readOnly={readOnly}
            value={kpi.relatedObjective}
          />
          <TextField
            label="Medición"
            onChange={(next) => update(index, "measurement", next)}
            readOnly={readOnly}
            value={kpi.measurement}
          />
          <TextField
            label="Meta"
            multiline={false}
            onChange={(next) => update(index, "target", next)}
            readOnly={readOnly}
            value={kpi.target}
          />
        </section>
      ))}
    </div>
  );
}

function ScopeEditor({ value, readOnly, onChange }: BusinessEditorProps) {
  const scope = normalizeScope(value);

  const update = (next: Partial<NormalizedScope>) => {
    /*
     * IMPORTANTE:
     *
     * Se persiste exactamente la estructura que
     * espera y devuelve la IA:
     *
     * {
     *   included: string[],
     *   excluded: string[],
     *   involvedSystems: string[]
     * }
     *
     * No agregamos campos únicamente visuales.
     */
    onChange({
      included: next.included ?? scope.included,
      excluded: next.excluded ?? scope.excluded,
      involvedSystems: next.involvedSystems ?? scope.involvedSystems,
      kpis: next.kpis ?? scope.kpis,
    });
  };

  return (
    <div className="rq-document-scope-editor">
      <section className="rq-document-scope-editor__included">
        <StringListEditor
          emptyLabel="Sin elementos incluidos."
          label="Incluye"
          onChange={(included) => update({ included })}
          readOnly={readOnly}
          value={scope.included}
        />
      </section>

      <div className="rq-document-scope-editor__secondary">
        <section>
          <StringListEditor
            emptyLabel="Sin exclusiones explícitamente definidas."
            label="Fuera de alcance"
            onChange={(excluded) => update({ excluded })}
            readOnly={readOnly}
            value={scope.excluded}
          />
        </section>

        <section>
          <StringListEditor
            emptyLabel="Sin sistemas involucrados."
            label="Sistemas involucrados"
            onChange={(involvedSystems) => update({ involvedSystems })}
            readOnly={readOnly}
            value={scope.involvedSystems}
          />
        </section>
      </div>
    </div>
  );
}

interface NormalizedSolutionProposal {
  objective: string;
  description: string;
  involvedElements: string[];
  flowAlignment: {
    currentState: string;
    evaluation: string;
    expectedResult: string;
  };
  prototypeMarkdown?: string | null;
}

function normalizeSolutionProposal(
  value: DocumentJsonValue,
): NormalizedSolutionProposal | null {
  const record = recordValue(value);
  if (!record) return null;
  const alignment = recordValue(record.flowAlignment);
  return {
    objective: stringValue(record.objective),
    description: stringValue(record.description),
    involvedElements: stringList(record.involvedElements),
    flowAlignment: {
      currentState: stringValue(alignment?.currentState),
      evaluation: stringValue(alignment?.evaluation),
      expectedResult: stringValue(alignment?.expectedResult),
    },
    ...(typeof record.prototypeMarkdown === "string" ||
    record.prototypeMarkdown === null
      ? { prototypeMarkdown: record.prototypeMarkdown }
      : {}),
  };
}

function SolutionProposalView({ value }: { value: DocumentJsonValue }) {
  const proposal = normalizeSolutionProposal(value);
  if (!proposal) return <NarrativeView value={value} />;
  return (
    <div className="rq-document-solution-proposal">
      <section>
        <span>Objetivo</span>
        <strong>{displayText(proposal.objective)}</strong>
        <p>{displayText(proposal.description)}</p>
        <Tags values={proposal.involvedElements} />
      </section>
      <ol aria-label="Correspondencia de la solución con los diagramas">
        {[
          ["Estado actual · AS-IS", proposal.flowAlignment.currentState],
          ["Evaluación", proposal.flowAlignment.evaluation],
          ["Resultado · TO-BE", proposal.flowAlignment.expectedResult],
        ].map(([label, text]) => (
          <li key={label}>
            <span>{label}</span>
            <p>{displayText(text)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SolutionProposalEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const proposal = normalizeSolutionProposal(value);
  if (!proposal)
    return (
      <SafeValueEditor
        label="Solución propuesta"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  const update = (next: Partial<NormalizedSolutionProposal>) =>
    onChange({ ...proposal, ...next });
  const updateAlignment = (
    next: Partial<NormalizedSolutionProposal["flowAlignment"]>,
  ) => update({ flowAlignment: { ...proposal.flowAlignment, ...next } });
  return (
    <div className="rq-document-solution-proposal-editor">
      <TextField
        label="Objetivo"
        onChange={(objective) => update({ objective })}
        readOnly={readOnly}
        value={proposal.objective}
      />
      <TextField
        label="Descripción breve"
        onChange={(description) => update({ description })}
        readOnly={readOnly}
        value={proposal.description}
      />
      <StringListEditor
        emptyLabel="Sin elementos involucrados."
        label="Elementos involucrados"
        onChange={(involvedElements) => update({ involvedElements })}
        readOnly={readOnly}
        value={proposal.involvedElements}
      />
      <div>
        <TextField
          label="Estado actual · AS-IS"
          onChange={(currentState) => updateAlignment({ currentState })}
          readOnly={readOnly}
          value={proposal.flowAlignment.currentState}
        />
        <TextField
          label="Evaluación"
          onChange={(evaluation) => updateAlignment({ evaluation })}
          readOnly={readOnly}
          value={proposal.flowAlignment.evaluation}
        />
        <TextField
          label="Resultado · TO-BE"
          onChange={(expectedResult) => updateAlignment({ expectedResult })}
          readOnly={readOnly}
          value={proposal.flowAlignment.expectedResult}
        />
      </div>
    </div>
  );
}

const NON_FUNCTIONAL_FIELDS = [
  { key: "security", label: "Seguridad", list: true },
  { key: "traceability", label: "Trazabilidad", list: true },
  { key: "performance", label: "Rendimiento", list: true },
  { key: "compatibility", label: "Compatibilidad", list: true },
  { key: "availability", label: "Disponibilidad", list: true },
  { key: "usability", label: "Usabilidad", list: true },
] as const;

type NonFunctionalFieldKey = (typeof NON_FUNCTIONAL_FIELDS)[number]["key"];

function normalizedNonFunctionalLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

function nonFunctionalKeys(value: string): NonFunctionalFieldKey[] {
  const label = normalizedNonFunctionalLabel(value);
  const keys: NonFunctionalFieldKey[] = [];
  const add = (key: NonFunctionalFieldKey) => {
    if (!keys.includes(key)) keys.push(key);
  };

  if (/seguridad|autentic|autoriz|credencial|cifrad/u.test(label))
    add("security");
  if (
    /trazabilidad|auditor|auditab|logging|registro de eventos|timestamp|historial|seguimiento|cambios? de estado/u.test(
      label,
    )
  )
    add("traceability");
  if (
    /rendimiento|desempeno|latencia|tiempo de respuesta|tiempos? maximos?|umbral|throughput/u.test(
      label,
    )
  )
    add("performance");
  if (
    /compatibilidad|integracion|interoperabilidad|multiplataforma/u.test(label)
  )
    add("compatibility");
  if (
    /disponibilidad|respaldo|recuperacion|continuidad|sla|rto|rpo/u.test(label)
  )
    add("availability");
  if (
    /usabilidad|accesibilidad|experiencia|navegacion|interfaz|conversacional/u.test(
      label,
    )
  )
    add("usability");

  return keys;
}

function cleanNonFunctionalItem(value: string): string {
  return cleanDocumentText(value)
    .replace(/^\s*(?:[-•▪◦]|\d{1,2}[.)])\s*/u, "")
    .replace(/^[\s,;:.]+|[\s,;]+$/gu, "")
    .trim();
}

function splitNonFunctionalItems(value: string): string[] {
  return value
    .split(/\s*(?:;|\r?\n+)\s*/gu)
    .map(cleanNonFunctionalItem)
    .filter(Boolean);
}

function emptyNonFunctionalRequirements(): Record<
  NonFunctionalFieldKey,
  string[]
> {
  return {
    security: [],
    traceability: [],
    performance: [],
    compatibility: [],
    availability: [],
    usability: [],
  };
}

function parseNonFunctionalNarrative(
  value: string,
): Record<NonFunctionalFieldKey, string[]> | null {
  const prepared = cleanDocumentText(value)
    .replace(/\r/gu, "")
    .replace(/\s+[-•▪◦]\s+(?=[\p{Lu}\p{Lt}])/gu, "\n- ");
  const lines = prepared
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;

  for (const originalLine of lines) {
    const line = originalLine.replace(/^[-•▪◦]\s*/u, "").trim();
    if (
      /^(?:atributos|requisitos|requerimientos)\s+no\s+funcionales(?:\s+identificados)?\s*:?$/iu.test(
        line,
      )
    )
      continue;

    const separator = line.indexOf(":");
    const heading = separator > 0 ? line.slice(0, separator).trim() : "";
    const keys = nonFunctionalKeys(heading);
    if (keys.length > 0) {
      if (current) entries.push(current);
      current = {
        heading,
        body: line.slice(separator + 1).trim(),
      };
      continue;
    }
    if (current) {
      current.body = `${current.body} ${line}`.trim();
      continue;
    }
    return null;
  }
  if (current) entries.push(current);
  if (entries.length === 0) return null;

  const result = emptyNonFunctionalRequirements();
  for (const entry of entries) {
    const headingKeys = nonFunctionalKeys(entry.heading);
    const items = splitNonFunctionalItems(entry.body);
    for (const item of items) {
      const itemKeys = nonFunctionalKeys(item);
      const targetKeys = itemKeys.length > 0 ? itemKeys : headingKeys;
      for (const key of targetKeys) {
        if (!result[key].includes(item)) result[key].push(item);
      }
    }
  }
  return result;
}

export function normalizeNonFunctionalRequirements(
  value: DocumentJsonValue,
): JsonRecord | null {
  if (typeof value === "string") return parseNonFunctionalNarrative(value);
  const record = recordValue(value);
  if (!record) return null;

  const normalized: JsonRecord = { ...record };
  for (const { key } of NON_FUNCTIONAL_FIELDS) {
    const current = record[key];
    normalized[key] = Array.isArray(current)
      ? stringList(current)
      : typeof current === "string"
        ? splitNonFunctionalItems(current)
        : [];
  }

  if (typeof record.narrative === "string") {
    const narrative = parseNonFunctionalNarrative(record.narrative);
    if (narrative) {
      for (const { key } of NON_FUNCTIONAL_FIELDS) {
        normalized[key] = [
          ...new Set([...stringList(normalized[key]), ...narrative[key]]),
        ];
      }
    }
  }
  return normalized;
}

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

function PendingView({ value }: { value: DocumentJsonValue }) {
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

function PendingEditor({ value, readOnly, onChange }: BusinessEditorProps) {
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

const FLOW_KIND_LABELS: Readonly<Record<string, string>> = {
  START: "Inicio",
  END: "Fin",
  ACTOR: "Actor",
  PROCESS: "Proceso",
  DECISION: "Decisión",
  SYSTEM: "Sistema",
};

interface FlowPosition {
  x: number;
  y: number;
}

interface FlowNodeGeometry extends FlowPosition {
  width: number;
  height: number;
  level: number;
}

type FlowEdgeKind = "normal" | "return" | "bypass";

interface FlowEdgeGeometry {
  path: string;
  labelX: number;
  labelY: number;
  kind: FlowEdgeKind;
  visualKind?: ProcessFlowEdgeVisualKind;
  sourcePoint?: FlowPosition;
  targetPoint?: FlowPosition;
}

interface FlowLayoutResult {
  positions: Map<string, FlowNodeGeometry>;
  routes: Map<number, FlowEdgeGeometry>;
  width: number;
  height: number;
}

function canonicalFlowLayoutToRenderer(
  layout: CanonicalProcessFlowLayout,
): FlowLayoutResult {
  return {
    positions: new Map(
      layout.nodes.map((node) => [
        node.id,
        {
          x: node.x + node.width / 2,
          y: node.y + node.height / 2,
          width: node.width,
          height: node.height,
          level: 0,
        },
      ]),
    ),
    routes: new Map(
      layout.edges.map((edge) => [
        edge.index,
        {
          path: edge.path,
          labelX: edge.labelX,
          labelY: edge.labelY,
          kind: edge.kind,
          visualKind: edge.visualKind,
          sourcePoint: edge.sourcePoint,
          targetPoint: edge.targetPoint,
        },
      ]),
    ),
    width: layout.width,
    height: layout.height,
  };
}

const FLOW_EDGE_VISUAL_STYLES: Readonly<
  Record<
    ProcessFlowEdgeVisualKind,
    { color: string; dashArray?: string; strokeWidth: number }
  >
> = {
  main: { color: "var(--rq-action-consult)", strokeWidth: 2.4 },
  condition: { color: "var(--rq-action-warning)", strokeWidth: 2 },
  affirmative: { color: "var(--rq-action-affirmative)", strokeWidth: 2 },
  negative: { color: "var(--rq-action-danger)", strokeWidth: 2 },
  information: { color: "var(--rq-action-information)", strokeWidth: 2 },
  alternate: {
    color: "var(--rq-action-operation)",
    dashArray: "3 4",
    strokeWidth: 1.9,
  },
  return: {
    color: "var(--rq-action-warning)",
    dashArray: "7 5",
    strokeWidth: 2,
  },
};

const FLOW_EDGE_VISUAL_KINDS = Object.keys(
  FLOW_EDGE_VISUAL_STYLES,
) as readonly ProcessFlowEdgeVisualKind[];

const FLOW_NODE_WIDTH = 184;
const FLOW_NODE_HEIGHT = 62;

const FLOW_DECISION_WIDTH = 204;
const FLOW_DECISION_HEIGHT = 66;

const FLOW_COLUMN_GAP = 68;

const FLOW_MIN_LEVEL_GAP = 96;
const FLOW_EDGE_CLEARANCE = 22;
const FLOW_EDGE_LANE_GAP = 30;

const FLOW_PADDING_Y = 42;

const FLOW_NODE_AREA_PADDING = 52;

const FLOW_SIDE_MARGIN = 126;
const FLOW_SPECIAL_RAIL_GAP = 18;

function flowNodeDimensions(kind: string): {
  width: number;
  height: number;
} {
  if (kind === "DECISION") {
    return {
      width: FLOW_DECISION_WIDTH,
      height: FLOW_DECISION_HEIGHT,
    };
  }

  return {
    width: FLOW_NODE_WIDTH,
    height: FLOW_NODE_HEIGHT,
  };
}

function graphHasPath(
  start: string,
  target: string,
  outgoing: Map<string, string[]>,
): boolean {
  if (start === target) {
    return true;
  }

  const visited = new Set<string>();

  const stack = [start];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const next of outgoing.get(current) ?? []) {
      if (next === target) {
        return true;
      }

      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

function flowPortOffset(
  index: number,
  count: number,
  nodeWidth: number,
): number {
  if (count <= 1) {
    return 0;
  }

  const maxSpread = Math.max(0, Math.min(58, nodeWidth / 2 - 18));

  const step = Math.min(22, (maxSpread * 2) / Math.max(1, count - 1));

  return (index - (count - 1) / 2) * step;
}

function flowTextLines(value: string, maxLength = 28, maxLines = 2): string[] {
  const words = value.split(/\s+/u).filter(Boolean);

  const lines: string[] = [];

  for (const rawWord of words) {
    const word =
      rawWord.length > maxLength
        ? `${rawWord.slice(0, maxLength - 1)}…`
        : rawWord;

    const current = lines.at(-1) ?? "";

    if (!current || `${current} ${word}`.length > maxLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visible = lines.slice(0, maxLines);

  const last = visible[maxLines - 1] ?? "";

  visible[maxLines - 1] = `${last.replace(/[.…]+$/u, "")}…`;

  return visible;
}

/*
 * MOTOR DE AUTO-LAYOUT GENÉRICO
 *
 * La IA continúa siendo la única fuente de:
 * - nodos
 * - tipos
 * - conexiones
 * - condiciones / etiquetas
 *
 * Este código solamente calcula:
 * - niveles
 * - orden visual
 * - posiciones
 * - puertos
 * - carriles
 * - rutas
 *
 * Nunca inventa ni elimina relaciones.
 */
function buildFlowLayout(
  nodes: JsonRecord[],
  edges: JsonRecord[],
): FlowLayoutResult {
  const ids = nodes.map((node) => stringValue(node.id)).filter(Boolean);

  const validIds = new Set(ids);

  const indexById = new Map(ids.map((id, index) => [id, index] as const));

  const outgoing = new Map(ids.map((id) => [id, [] as string[]] as const));

  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));

  const predecessor = new Map(ids.map((id) => [id, [] as string[]] as const));

  const successor = new Map(ids.map((id) => [id, [] as string[]] as const));

  const undirected = new Map(ids.map((id) => [id, [] as string[]] as const));

  const returnEdges = new Set<number>();

  const rankingPairs = new Set<string>();

  /*
   * Se genera un DAG solamente para calcular
   * posiciones.
   *
   * Las conexiones que cierren un ciclo NO
   * desaparecen: después se dibujan mediante
   * carriles laterales.
   */
  edges.forEach((edge, edgeIndex) => {
    const from = stringValue(edge.from);

    const to = stringValue(edge.to);

    if (!from || !to || !validIds.has(from) || !validIds.has(to)) {
      return;
    }

    if (from === to) {
      returnEdges.add(edgeIndex);
      return;
    }

    if (graphHasPath(to, from, outgoing)) {
      returnEdges.add(edgeIndex);
      return;
    }

    const pair = `${from}\u0000${to}`;

    if (rankingPairs.has(pair)) {
      return;
    }

    rankingPairs.add(pair);

    outgoing.get(from)?.push(to);

    predecessor.get(to)?.push(from);

    successor.get(from)?.push(to);

    undirected.get(from)?.push(to);

    undirected.get(to)?.push(from);

    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  });

  /*
   * Detecta componentes separados para
   * mantenerlos agrupados.
   */
  const componentById = new Map<string, number>();

  let componentIndex = 0;

  for (const rootId of ids) {
    if (componentById.has(rootId)) {
      continue;
    }

    const stack = [rootId];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current || componentById.has(current)) {
        continue;
      }

      componentById.set(current, componentIndex);

      for (const neighbour of undirected.get(current) ?? []) {
        if (!componentById.has(neighbour)) {
          stack.push(neighbour);
        }
      }
    }

    componentIndex += 1;
  }

  /*
   * Cálculo de niveles mediante longest-path.
   */
  const levelById = new Map<string, number>();

  const queue = ids
    .filter((id) => (incoming.get(id) ?? 0) === 0)
    .sort(
      (left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0),
    );

  if (queue.length === 0 && ids.length > 0) {
    queue.push(ids[0] ?? "");
  }

  queue.forEach((id) => {
    levelById.set(id, 0);
  });

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];

    if (!id) {
      continue;
    }

    const currentLevel = levelById.get(id) ?? 0;

    const targets = [...(outgoing.get(id) ?? [])].sort(
      (left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0),
    );

    for (const target of targets) {
      levelById.set(
        target,
        Math.max(levelById.get(target) ?? 0, currentLevel + 1),
      );

      incoming.set(target, Math.max(0, (incoming.get(target) ?? 1) - 1));

      if (incoming.get(target) === 0 && !queue.includes(target)) {
        queue.push(target);
      }
    }
  }

  /*
   * Nodos aislados o no alcanzables.
   */
  for (const id of ids) {
    if (!levelById.has(id)) {
      levelById.set(id, 0);
    }
  }

  const groups = new Map<number, string[]>();

  for (const id of ids) {
    const level = levelById.get(id) ?? 0;

    groups.set(level, [...(groups.get(level) ?? []), id]);
  }

  const levels = [...groups.keys()].sort((left, right) => left - right);

  /*
   * Barycentric ordering:
   * reduce cruces de líneas sin modificar
   * ninguna conexión.
   */
  const currentOrder = () => {
    const result = new Map<string, number>();

    for (const level of levels) {
      (groups.get(level) ?? []).forEach((id, index) => {
        result.set(id, index);
      });
    }

    return result;
  };

  const barycenter = (
    id: string,
    neighbours: Map<string, string[]>,
    order: Map<string, number>,
  ): number | null => {
    const items = neighbours.get(id) ?? [];

    if (items.length === 0) {
      return null;
    }

    const values = items
      .map((item) => order.get(item))
      .filter((value): value is number => value !== undefined);

    if (values.length === 0) {
      return null;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const sortLevel = (level: number, neighbours: Map<string, string[]>) => {
    const group = groups.get(level);

    if (!group) {
      return;
    }

    const order = currentOrder();

    group.sort((left, right) => {
      const leftComponent = componentById.get(left) ?? 0;

      const rightComponent = componentById.get(right) ?? 0;

      if (leftComponent !== rightComponent) {
        return leftComponent - rightComponent;
      }

      const leftBarycenter = barycenter(left, neighbours, order);

      const rightBarycenter = barycenter(right, neighbours, order);

      if (
        leftBarycenter !== null &&
        rightBarycenter !== null &&
        Math.abs(leftBarycenter - rightBarycenter) > 0.001
      ) {
        return leftBarycenter - rightBarycenter;
      }

      if (leftBarycenter !== null && rightBarycenter === null) {
        return -1;
      }

      if (leftBarycenter === null && rightBarycenter !== null) {
        return 1;
      }

      return (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0);
    });
  };

  /*
   * Varias pasadas arriba/abajo reducen
   * cruces en grafos con decisiones y
   * convergencias.
   */
  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let index = 1; index < levels.length; index += 1) {
      const level = levels[index];

      if (level !== undefined) {
        sortLevel(level, predecessor);
      }
    }

    for (let index = levels.length - 2; index >= 0; index -= 1) {
      const level = levels[index];

      if (level !== undefined) {
        sortLevel(level, successor);
      }
    }
  }

  interface EdgeMeta {
    edgeIndex: number;
    fromId: string;
    toId: string;
    fromLevel: number;
    toLevel: number;
    kind: "normal" | "return" | "bypass";
  }

  const edgeMeta: EdgeMeta[] = [];

  edges.forEach((edge, edgeIndex) => {
    const fromId = stringValue(edge.from);

    const toId = stringValue(edge.to);

    if (!validIds.has(fromId) || !validIds.has(toId)) {
      return;
    }

    const fromLevel = levelById.get(fromId) ?? 0;

    const toLevel = levelById.get(toId) ?? 0;

    let kind: EdgeMeta["kind"] = "normal";

    if (returnEdges.has(edgeIndex) || toLevel <= fromLevel) {
      kind = "return";
    } else if (toLevel > fromLevel + 1) {
      /*
       * Conexión válida que salta niveles.
       * Se saca por un lateral para evitar
       * atravesar nodos intermedios.
       */
      kind = "bypass";
    }

    edgeMeta.push({
      edgeIndex,
      fromId,
      toId,
      fromLevel,
      toLevel,
      kind,
    });
  });

  /*
   * Carriles laterales para ciclos y
   * conexiones que saltan niveles.
   */
  interface SpecialPlan {
    side: "left" | "right";
    lane: number;
    kind: "return" | "bypass";
  }

  const specialPlan = new Map<number, SpecialPlan>();

  let leftSpecialCount = 0;
  let rightSpecialCount = 0;

  for (const meta of edgeMeta) {
    if (meta.kind === "normal") {
      continue;
    }

    const group = groups.get(meta.fromLevel) ?? [];

    const sourceIndex = Math.max(0, group.indexOf(meta.fromId));

    const middle = (group.length - 1) / 2;

    let side: "left" | "right";

    if (group.length > 1 && sourceIndex < middle) {
      side = "left";
    } else if (group.length > 1 && sourceIndex > middle) {
      side = "right";
    } else {
      side = leftSpecialCount <= rightSpecialCount ? "left" : "right";
    }

    const lane = side === "left" ? leftSpecialCount++ : rightSpecialCount++;

    specialPlan.set(meta.edgeIndex, {
      side,
      lane,
      kind: meta.kind,
    });
  }

  const maxNodeWidth = Math.max(FLOW_NODE_WIDTH, FLOW_DECISION_WIDTH);

  const maxNodeHeight = Math.max(FLOW_NODE_HEIGHT, FLOW_DECISION_HEIGHT);

  const maxBreadth = Math.max(
    1,
    ...levels.map((level) => groups.get(level)?.length ?? 1),
  );

  const contentWidth =
    maxBreadth * maxNodeWidth + Math.max(0, maxBreadth - 1) * FLOW_COLUMN_GAP;

  const leftMargin =
    leftSpecialCount > 0
      ? FLOW_SIDE_MARGIN +
        Math.max(0, leftSpecialCount - 1) * FLOW_SPECIAL_RAIL_GAP
      : FLOW_NODE_AREA_PADDING;

  const rightMargin =
    rightSpecialCount > 0
      ? FLOW_SIDE_MARGIN +
        Math.max(0, rightSpecialCount - 1) * FLOW_SPECIAL_RAIL_GAP
      : FLOW_NODE_AREA_PADDING;

  const nodeAreaWidth = Math.max(
    560,
    contentWidth + FLOW_NODE_AREA_PADDING * 2,
  );

  const width = leftMargin + nodeAreaWidth + rightMargin;

  const nodeAreaCenter = leftMargin + nodeAreaWidth / 2;

  /*
   * Se agrupan las conexiones normales
   * por espacio entre niveles.
   *
   * Cada conexión obtiene un carril Y
   * independiente. Esto elimina el
   * solapamiento que tenía el renderer
   * anterior.
   */
  const adjacentByGap = new Map<number, number[]>();

  for (const meta of edgeMeta) {
    if (meta.kind !== "normal" || meta.toLevel !== meta.fromLevel + 1) {
      continue;
    }

    adjacentByGap.set(meta.fromLevel, [
      ...(adjacentByGap.get(meta.fromLevel) ?? []),
      meta.edgeIndex,
    ]);
  }

  const gapHeight = (level: number) => {
    const edgeCount = adjacentByGap.get(level)?.length ?? 0;

    return Math.max(
      FLOW_MIN_LEVEL_GAP,
      FLOW_EDGE_CLEARANCE * 2 + Math.max(1, edgeCount) * FLOW_EDGE_LANE_GAP,
    );
  };

  const levelY = new Map<number, number>();

  let currentY = FLOW_PADDING_Y + maxNodeHeight / 2;

  levels.forEach((level, levelIndex) => {
    if (levelIndex > 0) {
      const previousLevel = levels[levelIndex - 1];

      if (previousLevel !== undefined) {
        currentY += maxNodeHeight + gapHeight(previousLevel);
      }
    }

    levelY.set(level, currentY);
  });

  let height = Math.max(260, currentY + maxNodeHeight / 2 + FLOW_PADDING_Y);

  const positions = new Map<string, FlowNodeGeometry>();

  for (const level of levels) {
    const group = groups.get(level) ?? [];

    const groupWidth =
      group.length * maxNodeWidth +
      Math.max(0, group.length - 1) * FLOW_COLUMN_GAP;

    const firstX = nodeAreaCenter - groupWidth / 2 + maxNodeWidth / 2;

    group.forEach((id, index) => {
      const node = nodes.find((item) => stringValue(item.id) === id);

      const kind = stringValue(node?.kind) || "PROCESS";

      const dimensions = flowNodeDimensions(kind);

      positions.set(id, {
        x: firstX + index * (maxNodeWidth + FLOW_COLUMN_GAP),

        y: levelY.get(level) ?? currentY,

        width: dimensions.width,

        height: dimensions.height,

        level,
      });
    });
  }

  const metaByIndex = new Map(
    edgeMeta.map((meta) => [meta.edgeIndex, meta] as const),
  );

  const outgoingAdjacent = new Map(
    ids.map((id) => [id, [] as number[]] as const),
  );

  const incomingAdjacent = new Map(
    ids.map((id) => [id, [] as number[]] as const),
  );

  for (const meta of edgeMeta) {
    if (meta.kind !== "normal" || meta.toLevel !== meta.fromLevel + 1) {
      continue;
    }

    outgoingAdjacent.get(meta.fromId)?.push(meta.edgeIndex);

    incomingAdjacent.get(meta.toId)?.push(meta.edgeIndex);
  }

  /*
   * Ordena puertos según la posición del
   * nodo opuesto.
   */
  for (const edgeIndices of outgoingAdjacent.values()) {
    edgeIndices.sort((leftIndex, rightIndex) => {
      const left = metaByIndex.get(leftIndex);

      const right = metaByIndex.get(rightIndex);

      const leftX = left ? (positions.get(left.toId)?.x ?? 0) : 0;

      const rightX = right ? (positions.get(right.toId)?.x ?? 0) : 0;

      return leftX - rightX || leftIndex - rightIndex;
    });
  }

  for (const edgeIndices of incomingAdjacent.values()) {
    edgeIndices.sort((leftIndex, rightIndex) => {
      const left = metaByIndex.get(leftIndex);

      const right = metaByIndex.get(rightIndex);

      const leftX = left ? (positions.get(left.fromId)?.x ?? 0) : 0;

      const rightX = right ? (positions.get(right.fromId)?.x ?? 0) : 0;

      return leftX - rightX || leftIndex - rightIndex;
    });
  }

  const routes = new Map<number, FlowEdgeGeometry>();

  /*
   * CONEXIONES ENTRE NIVELES ADYACENTES
   *
   * Cada línea recibe:
   * - puerto de salida independiente
   * - carril horizontal independiente
   * - puerto de entrada independiente
   */
  for (const [fromLevel, edgeIndices] of adjacentByGap) {
    const orderedEdges = [...edgeIndices].sort((leftIndex, rightIndex) => {
      const left = metaByIndex.get(leftIndex);

      const right = metaByIndex.get(rightIndex);

      if (!left || !right) {
        return leftIndex - rightIndex;
      }

      const leftFromX = positions.get(left.fromId)?.x ?? 0;

      const rightFromX = positions.get(right.fromId)?.x ?? 0;

      const leftToX = positions.get(left.toId)?.x ?? 0;

      const rightToX = positions.get(right.toId)?.x ?? 0;

      return (
        leftFromX - rightFromX || leftToX - rightToX || leftIndex - rightIndex
      );
    });

    const firstMeta =
      orderedEdges.length > 0
        ? metaByIndex.get(orderedEdges[0] ?? -1)
        : undefined;

    const toLevel = firstMeta?.toLevel ?? fromLevel + 1;

    const upperCenterY = levelY.get(fromLevel) ?? 0;

    const lowerCenterY = levelY.get(toLevel) ?? upperCenterY;

    const gapTop = upperCenterY + maxNodeHeight / 2;

    const gapBottom = lowerCenterY - maxNodeHeight / 2;

    const laneStart = gapTop + FLOW_EDGE_CLEARANCE;

    const laneEnd = gapBottom - FLOW_EDGE_CLEARANCE;

    orderedEdges.forEach((edgeIndex, laneIndex) => {
      const meta = metaByIndex.get(edgeIndex);

      if (!meta) {
        return;
      }

      const from = positions.get(meta.fromId);

      const to = positions.get(meta.toId);

      if (!from || !to) {
        return;
      }

      const outgoingEdges = outgoingAdjacent.get(meta.fromId) ?? [];

      const incomingEdges = incomingAdjacent.get(meta.toId) ?? [];

      const outgoingIndex = Math.max(0, outgoingEdges.indexOf(edgeIndex));

      const incomingIndex = Math.max(0, incomingEdges.indexOf(edgeIndex));

      const x1 =
        from.x +
        flowPortOffset(outgoingIndex, outgoingEdges.length, from.width);

      const y1 = from.y + from.height / 2;

      const x2 =
        to.x + flowPortOffset(incomingIndex, incomingEdges.length, to.width);

      const y2 = to.y - to.height / 2;

      const channelY =
        orderedEdges.length <= 1
          ? (laneStart + laneEnd) / 2
          : laneStart +
            (laneEnd - laneStart) *
              (laneIndex / Math.max(1, orderedEdges.length - 1));

      const nearlyVertical = Math.abs(x2 - x1) < 8;

      const rawLabelX = nearlyVertical ? x1 : (x1 + x2) / 2;

      const labelX = Math.max(94, Math.min(width - 94, rawLabelX));

      routes.set(edgeIndex, {
        path:
          `M ${x1} ${y1} ` +
          `L ${x1} ${channelY} ` +
          `L ${x2} ${channelY} ` +
          `L ${x2} ${y2}`,

        labelX,
        labelY: channelY,
        kind: "normal",
      });
    });
  }

  /*
   * RETORNOS Y SALTOS DE NIVEL
   *
   * Se enrutan por carriles laterales.
   * No atraviesan nodos ni comparten
   * la misma línea principal.
   */
  for (const meta of edgeMeta) {
    if (meta.kind === "normal") {
      continue;
    }

    const plan = specialPlan.get(meta.edgeIndex);

    const from = positions.get(meta.fromId);

    const to = positions.get(meta.toId);

    if (!plan || !from || !to) {
      continue;
    }

    const nodeAreaLeft = leftMargin;

    const nodeAreaRight = width - rightMargin;

    const railX =
      plan.side === "left"
        ? nodeAreaLeft - 34 - plan.lane * FLOW_SPECIAL_RAIL_GAP
        : nodeAreaRight + 34 + plan.lane * FLOW_SPECIAL_RAIL_GAP;

    const sourceX = from.x;

    const sourceY = from.y + from.height / 2;

    const localLaneOffset = Math.min(3, plan.lane) * 8;

    const sourceLaneY = sourceY + 18 + localLaneOffset;

    const targetX = to.x;

    const targetY = to.y - to.height / 2;

    const targetLaneY = targetY - 18 - localLaneOffset;

    const sourceSegmentLength = Math.abs(sourceX - railX);

    const targetSegmentLength = Math.abs(targetX - railX);

    const edgeRecord = edges[meta.edgeIndex];

    const rawEdgeLabel = displayText(stringValue(edgeRecord?.label)).trim();

    const visibleEdgeLabel =
      rawEdgeLabel.length > 30 ? `${rawEdgeLabel.slice(0, 29)}…` : rawEdgeLabel;

    const estimatedLabelWidth = Math.max(
      38,
      Math.min(176, visibleEdgeLabel.length * 6.3 + 20),
    );

    const requiredHorizontalSpace = estimatedLabelWidth + 28;

    let labelX: number;
    let labelY: number;

    if (sourceSegmentLength >= requiredHorizontalSpace) {
      labelX = (sourceX + railX) / 2;

      labelY = sourceLaneY;
    } else if (targetSegmentLength >= requiredHorizontalSpace) {
      labelX = (targetX + railX) / 2;

      labelY = targetLaneY;
    } else {
      labelX =
        plan.side === "left"
          ? railX + estimatedLabelWidth / 2 + 12
          : railX - estimatedLabelWidth / 2 - 12;

      labelY = sourceLaneY + (targetLaneY - sourceLaneY) / 2;
    }

    labelX = Math.max(
      estimatedLabelWidth / 2 + 10,
      Math.min(width - estimatedLabelWidth / 2 - 10, labelX),
    );

    routes.set(meta.edgeIndex, {
      path:
        `M ${sourceX} ${sourceY} ` +
        `L ${sourceX} ${sourceLaneY} ` +
        `L ${railX} ${sourceLaneY} ` +
        `L ${railX} ${targetLaneY} ` +
        `L ${targetX} ${targetLaneY} ` +
        `L ${targetX} ${targetY}`,

      labelX,
      labelY,
      kind: plan.kind,
    });

    height = Math.max(height, labelY + 28 + FLOW_PADDING_Y);
  }

  return {
    positions,
    routes,
    width,
    height,
  };
}

/**
 * Arrastrar con clic sostenido desplaza el visor del diagrama (sin tocar los
 * nodos si el puntero apenas se movió).
 */
function useDragPan() {
  const drag = React.useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  return {
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      const element = event.currentTarget;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
        moved: false,
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
      const state = drag.current;
      if (!state) return;
      const element = event.currentTarget;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;
        state.moved = true;
        element.setPointerCapture(event.pointerId);
        element.dataset.panning = "true";
      }
      element.scrollLeft = state.left - dx;
      element.scrollTop = state.top - dy;
    },
    onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
      drag.current = null;
      delete event.currentTarget.dataset.panning;
    },
    onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
      drag.current = null;
      delete event.currentTarget.dataset.panning;
    },
  };
}

export function ProcessFlowDiagram({ value }: { value: DocumentJsonValue }) {
  const flow = recordValue(value);

  const nodes = recordList(flow?.nodes);

  const edges = recordList(flow?.edges);

  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useDiagramExpand();
  const pan = useDragPan();

  const viewportRef = React.useRef<HTMLDivElement>(null);

  const markerId = React.useId().replaceAll(":", "");

  const flowSignature = JSON.stringify({
    title: stringValue(flow?.title),
    nodes: nodes.map((node) => ({
      id: stringValue(node.id),
      kind: stringValue(node.kind),
      label: stringValue(node.label),
    })),
    edges: edges.map((edge) => ({
      from: stringValue(edge.from),
      to: stringValue(edge.to),
      label: edge.label === null ? null : stringValue(edge.label),
    })),
  });

  const flowInput = useMemo(
    () => JSON.parse(flowSignature) as ProcessFlowInput,
    [flowSignature],
  );

  const [elkLayoutState, setElkLayoutState] = useState<{
    signature: string;
    layout: CanonicalProcessFlowLayout | null;
  }>({ signature: "", layout: null });

  useEffect(() => {
    if (flowInput.nodes.length === 0) return;
    let cancelled = false;
    void layoutProcessFlow(flowInput)
      .then((layout) => {
        if (cancelled) return;

        setElkLayoutState({ signature: flowSignature, layout });
        setZoom(1);
      })
      .catch((error: unknown) => {
        globalThis.console.warn(
          "[process-flow] ELK no pudo calcular el layout; se conserva el renderer anterior.",
          error instanceof Error ? error.message : "Error desconocido",
        );
        if (!cancelled) {
          setElkLayoutState({ signature: flowSignature, layout: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [flowInput, flowSignature]);

  if (!flow || nodes.length === 0) {
    return (
      <EmptyValue>No existe un flujo estructurado para representar.</EmptyValue>
    );
  }

  const fallbackLayout = buildFlowLayout(nodes, edges);

  const isElkLayout =
    elkLayoutState.signature === flowSignature &&
    elkLayoutState.layout !== null;

  const currentLayout =
    isElkLayout && elkLayoutState.layout
      ? canonicalFlowLayoutToRenderer(elkLayoutState.layout)
      : fallbackLayout;

  const { positions, routes, width, height } = currentLayout;

  // 100 % = ancho disponible; acercar amplía y el visor se desplaza.
  const fitDiagram = () => setZoom(1);

  const validNodeIds = new Set(
    nodes.map((node) => stringValue(node.id)).filter(Boolean),
  );

  return (
    <figure
      className="rq-process-flow"
      aria-label={displayText(stringValue(flow.title)) || "Diagrama de flujo"}
      data-expanded={expanded}
    >
      <figcaption>
        <div className="rq-process-flow__heading">
          <strong>
            {displayText(stringValue(flow.title)) || "Flujo del proceso"}
          </strong>

          <small>
            Construido desde IA
            {" · "}
            {nodes.length} pasos
            {" · "}
            {edges.length} conexiones
          </small>
        </div>

        <div
          aria-label="Zoom del diagrama"
          className="rq-process-flow__controls"
        >
          <button
            aria-label="Alejar"
            disabled={zoom <= 0.25}
            onClick={() =>
              setZoom((current) =>
                Math.max(0.25, Number((current - 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            −
          </button>

          <output>{Math.round(zoom * 100)}%</output>

          <button
            aria-label="Acercar"
            disabled={zoom >= 2}
            onClick={() =>
              setZoom((current) =>
                Math.min(2, Number((current + 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            +
          </button>

          <button onClick={fitDiagram} type="button">
            Ajustar
          </button>

          <button
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "Cerrar" : "Ampliar"}
          </button>
        </div>
      </figcaption>

      <div
        className="rq-process-flow__viewport"
        data-layout-engine={isElkLayout ? "elk" : "fallback"}
        ref={viewportRef}
        {...pan}
      >
        <svg
          aria-label={
            displayText(stringValue(flow.title)) || "Flujo del proceso"
          }
          role="img"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `${Math.round(zoom * 100)}%`,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            {FLOW_EDGE_VISUAL_KINDS.map((visualKind) => {
              const visualStyle = FLOW_EDGE_VISUAL_STYLES[visualKind];
              return (
                <marker
                  id={`${markerId}-${visualKind}`}
                  key={visualKind}
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  markerWidth="9"
                  orient="auto"
                  refX="8"
                  refY="4.5"
                  viewBox="0 0 12 12"
                >
                  <path
                    d="M 0 0 L 12 6 L 0 12 L 3 6 z"
                    style={{ fill: visualStyle.color }}
                  />
                </marker>
              );
            })}
          </defs>

          <g className="rq-process-flow__edges">
            {edges.map((edge, edgeIndex) => {
              const fromId = stringValue(edge.from);

              const toId = stringValue(edge.to);

              if (!validNodeIds.has(fromId) || !validNodeIds.has(toId)) {
                return null;
              }

              const geometry = routes.get(edgeIndex);

              if (!geometry) {
                return null;
              }

              const rawLabel = displayText(stringValue(edge.label)).trim();

              const visualKind =
                geometry.visualKind ??
                classifyProcessFlowEdgeVisualKind(
                  rawLabel || null,
                  geometry.kind,
                );

              const visualStyle = FLOW_EDGE_VISUAL_STYLES[visualKind];

              const label =
                rawLabel.length > 30 ? `${rawLabel.slice(0, 29)}…` : rawLabel;

              const labelWidth = Math.max(
                38,
                Math.min(176, label.length * 6.3 + 20),
              );

              const edgeClass =
                `rq-process-flow__edge ` +
                `rq-process-flow__edge--${geometry.kind} ` +
                `rq-process-flow__edge--${visualKind}`;

              return (
                <g className={edgeClass} key={`${fromId}-${toId}-${edgeIndex}`}>
                  <title>
                    {`${displayText(stringValue(nodes.find((node) => node.id === fromId)?.label)) || fromId} → ${displayText(stringValue(nodes.find((node) => node.id === toId)?.label)) || toId}${rawLabel ? `: ${rawLabel}` : ""}`}
                  </title>

                  <path
                    d={geometry.path}
                    markerEnd={`url(#${markerId}-${visualKind})`}
                    style={{
                      stroke: visualStyle.color,
                      strokeDasharray: visualStyle.dashArray,
                      strokeWidth: visualStyle.strokeWidth,
                    }}
                  />

                  {geometry.sourcePoint ? (
                    <circle
                      className="rq-process-flow__edge-origin"
                      cx={geometry.sourcePoint.x}
                      cy={geometry.sourcePoint.y}
                      r="3"
                      style={{
                        fill: "var(--rq-color-surface)",
                        stroke: visualStyle.color,
                        strokeWidth: 1.6,
                      }}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}

                  {label ? (
                    <g
                      className="rq-process-flow__edge-label"
                      transform={
                        `translate(` +
                        `${geometry.labelX} ` +
                        `${geometry.labelY})`
                      }
                    >
                      <rect
                        height="22"
                        rx="11"
                        width={labelWidth}
                        x={-labelWidth / 2}
                        y="-11"
                        style={{ stroke: visualStyle.color }}
                      />

                      <text
                        dominantBaseline="middle"
                        style={{ fill: visualStyle.color }}
                        textAnchor="middle"
                        y="1"
                      >
                        {label}
                      </text>

                      <title>{rawLabel}</title>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="rq-process-flow__nodes">
            {nodes.map((node, index) => {
              const id = stringValue(node.id);

              const geometry = positions.get(id);

              if (!geometry) {
                return null;
              }

              const kind = stringValue(node.kind) || "PROCESS";

              const label =
                displayText(stringValue(node.label)) ||
                FLOW_KIND_LABELS[kind] ||
                "Paso";

              const lines = flowTextLines(
                label,
                kind === "DECISION" ? 27 : 29,
                isElkLayout ? 3 : 2,
              );

              const tag = FLOW_KIND_LABELS[kind] ?? "Proceso";
              // «Inicio / Inicio»: la etiqueta de tipo se omite si repite el texto.
              const showTag = label.trim().toLowerCase() !== tag.toLowerCase();

              const hasIncoming = edges.some(
                (edge) => stringValue(edge.to) === id,
              );

              const hasOutgoing = edges.some(
                (edge) => stringValue(edge.from) === id,
              );

              return (
                <g
                  className={
                    `rq-process-flow__node ` +
                    `rq-process-flow__node--${kind.toLowerCase()}`
                  }
                  key={id || index}
                  transform={`translate(` + `${geometry.x} ` + `${geometry.y})`}
                >
                  <rect
                    height={geometry.height}
                    rx={
                      kind === "START" || kind === "END"
                        ? geometry.height / 2
                        : 12
                    }
                    width={geometry.width}
                    x={-geometry.width / 2}
                    y={-geometry.height / 2}
                  />

                  <line
                    className="rq-process-flow__node-accent"
                    x1={-geometry.width / 2 + 15}
                    x2={geometry.width / 2 - 15}
                    y1={-geometry.height / 2 + 1}
                    y2={-geometry.height / 2 + 1}
                  />

                  {!isElkLayout && hasIncoming ? (
                    <circle
                      className="rq-process-flow__port rq-process-flow__port--in"
                      cx="0"
                      cy={-geometry.height / 2}
                      r="3"
                    />
                  ) : null}

                  {!isElkLayout && hasOutgoing ? (
                    <circle
                      className="rq-process-flow__port rq-process-flow__port--out"
                      cx="0"
                      cy={geometry.height / 2}
                      r="3"
                    />
                  ) : null}

                  {showTag ? (
                    <text
                      className="rq-process-flow__type"
                      textAnchor="middle"
                      x="0"
                      y="-9"
                    >
                      {tag}
                    </text>
                  ) : null}

                  <text
                    className="rq-process-flow__node-label"
                    textAnchor="middle"
                  >
                    {lines.map((line, lineIndex) => (
                      <tspan
                        key={lineIndex}
                        x="0"
                        y={(showTag ? 8 : 4) - (showTag ? 0 : (lines.length - 1) * 7) + lineIndex * 14}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>

                  <title>
                    {`${FLOW_KIND_LABELS[kind] ?? "Proceso"}: ${label}`}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </figure>
  );
}

type DiagramModelTab = "asIs" | "toBe" | "entityRelationship";

const DIAGRAM_MODEL_TABS: readonly {
  key: DiagramModelTab;
  label: string;
}[] = [
  { key: "asIs", label: "Flujo AS-IS" },
  { key: "toBe", label: "Flujo TO-BE" },
  { key: "entityRelationship", label: "Modelo entidad-relación" },
];

const HISTORICAL_TO_BE_MESSAGE =
  "No existe flujo TO-BE en esta versión histórica.";
const HISTORICAL_ER_MESSAGE =
  "No existe modelo entidad-relación en esta versión histórica.";
const NO_AS_IS_EVIDENCE_MESSAGE =
  "No hay información o evidencia suficiente para representar el flujo AS-IS.";
const NO_TO_BE_EVIDENCE_MESSAGE =
  "No hay información o evidencia suficiente para representar el flujo TO-BE.";
const NO_ER_EVIDENCE_MESSAGE =
  "No hay información o evidencia suficiente para representar el modelo entidad-relación.";

export function resolveDiagramModels(value: DocumentJsonValue) {
  const narrativeModels =
    typeof value === "string" ? processModelsFromNarrative(value) : null;
  const root = recordValue(value) ?? narrativeModels;
  const processFlows = recordValue(root?.processFlows);
  if (!root || !processFlows) {
    return {
      historical: true,
      root,
      processFlows: null,
      asIs: root,
      toBe: null,
      entityRelationship: null,
    };
  }
  return {
    historical: false,
    root,
    processFlows,
    asIs: recordValue(processFlows.asIs),
    toBe: recordValue(processFlows.toBe),
    entityRelationship: recordValue(root.entityRelationship),
  };
}

function processModelsFromNarrative(value: string): JsonRecord | null {
  const normalized = value.replace(/\r\n/gu, "\n");
  const asIsMatch = normalized.match(/Diagrama de flujo AS-IS:\s*\n([^\n]+)/iu);
  const toBeMatch = normalized.match(/Diagrama de flujo TO-BE:\s*\n([^\n]+)/iu);
  if (!asIsMatch && !toBeMatch) return null;

  const flow = (
    line: string | undefined,
    key: "as-is" | "to-be",
    title: string,
  ): JsonRecord => {
    const steps = (line ?? "")
      .split(/\s*->\s*/u)
      .map((step) =>
        step
          .replace(/^\[[^\]]+\]\s*/u, (match) => match.slice(1, -2))
          .replace(/^\(|\)$/gu, "")
          .replace(/\.$/u, "")
          .trim(),
      )
      .filter(Boolean);
    const laneId = `${key}-lane`;
    const nodes: JsonRecord[] = steps.map((label, index) => ({
      id: `${key}-${index + 1}`,
      laneId,
      kind:
        index === 0
          ? "START"
          : index === steps.length - 1
            ? "END"
            : label.includes("?")
              ? "DECISION"
              : "PROCESS",
      label,
    }));
    const edges: JsonRecord[] = nodes.slice(1).map((node, index) => ({
      from: stringValue(nodes[index]?.id),
      to: stringValue(node.id),
      label: "",
    }));
    return {
      title,
      objective:
        key === "as-is"
          ? "Representar el proceso actual identificado en la evidencia."
          : "Representar el proceso futuro identificado en la evidencia.",
      lanes: [
        {
          id: laneId,
          name: key === "as-is" ? "Proceso actual" : "Solución propuesta",
          kind: key === "as-is" ? "ACTOR" : "SYSTEM",
        },
      ],
      nodes,
      edges,
      problems: [],
      improvements: [],
      expectedResults: [],
      sourceIds: [],
    };
  };

  return {
    processFlows: {
      asIs: flow(asIsMatch?.[1], "as-is", "Flujo AS-IS"),
      toBe: flow(toBeMatch?.[1], "to-be", "Flujo TO-BE"),
    },
    entityRelationship: {
      title: "Modelo entidad-relación",
      entities: [],
      relationships: [],
      sourceIds: [],
    },
  };
}

export function hasProcessFlowModelContent(value: JsonRecord | null): boolean {
  return Boolean(
    value &&
    (recordList(value.nodes).length > 0 ||
      recordList(value.edges).length > 0 ||
      recordList(value.lanes).length > 0),
  );
}

export function hasEntityRelationshipModelContent(
  value: JsonRecord | null,
): boolean {
  return Boolean(
    value &&
    (recordList(value.entities).length > 0 ||
      recordList(value.relationships).length > 0),
  );
}

function DiagramModelTabs({
  active,
  includeEntityRelationship = true,
  onChange,
}: {
  active: DiagramModelTab;
  includeEntityRelationship?: boolean;
  onChange: (tab: DiagramModelTab) => void;
}) {
  return (
    <div
      aria-label="Modelos de la sección Diagramas"
      className="rq-diagram-model-tabs"
      role="tablist"
    >
      {DIAGRAM_MODEL_TABS.filter(
        (tab) => includeEntityRelationship || tab.key !== "entityRelationship",
      ).map((tab) => (
        <button
          aria-controls={`diagram-panel-${tab.key}`}
          aria-selected={active === tab.key}
          className={active === tab.key ? "is-active" : undefined}
          id={`diagram-tab-${tab.key}`}
          key={tab.key}
          onClick={() => onChange(tab.key)}
          role="tab"
          tabIndex={active === tab.key ? 0 : -1}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function flowDepths(
  nodes: JsonRecord[],
  edges: JsonRecord[],
): Map<string, number> {
  const ids = nodes.map((node) => stringValue(node.id)).filter(Boolean);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const from = stringValue(edge.from);
    const to = stringValue(edge.to);
    if (!indegree.has(from) || !indegree.has(to)) continue;
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const depths = new Map(ids.map((id) => [id, 0]));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    visited.add(id);
    for (const to of outgoing.get(id) ?? []) {
      depths.set(to, Math.max(depths.get(to) ?? 0, (depths.get(id) ?? 0) + 1));
      indegree.set(to, (indegree.get(to) ?? 1) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  ids.forEach((id, index) => {
    if (!visited.has(id)) depths.set(id, Math.max(depths.get(id) ?? 0, index));
  });
  return depths;
}

export interface SwimlaneBox {
  x: number;
  y: number;
  width: number;
  height: number;
  lane: number;
}

/** Texto visible y ancho de la pastilla de una etiqueta de conector. */
export function swimlaneEdgeLabel(label: string): {
  text: string;
  width: number;
} {
  const text = label.length > 26 ? `${label.slice(0, 25)}…` : label;
  return { text, width: Math.min(176, Math.max(52, text.length * 6.4 + 20)) };
}

/**
 * Disposición compacta por capas: cada paso avanza solo lo necesario respecto a sus
 * predecesores. Un paso en el mismo carril deja espacio para la flecha (y para la etiqueta del
 * conector si la tiene); uno en otro carril basta con que quede a la derecha del conector
 * vertical. Así el diagrama es mucho menos ancho y el texto se lee más grande al ajustarlo.
 */
export function swimlaneLayout(
  nodes: JsonRecord[],
  edges: JsonRecord[],
  laneIndexById: Map<string, number>,
  metrics: {
    laneHeight: number;
    labelWidth: number;
    padding: number;
    nodeWidth: number;
    nodeHeight: number;
    decisionHeight: number;
    sameLaneGap: number;
    crossLaneRun: number;
  },
): { boxes: Map<string, SwimlaneBox>; width: number } {
  const depths = flowDepths(nodes, edges);
  const ordered = nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (left, right) =>
        (depths.get(stringValue(left.node.id)) ?? 0) -
          (depths.get(stringValue(right.node.id)) ?? 0) ||
        left.index - right.index,
    )
    .map((entry) => entry.node);
  const boxes = new Map<string, SwimlaneBox>();
  const laneRight = new Map<number, number>();
  const firstX = metrics.labelWidth + metrics.padding + metrics.nodeWidth / 2;
  let rightmost = firstX + metrics.nodeWidth / 2;

  for (const node of ordered) {
    const id = stringValue(node.id);
    const lane = laneIndexById.get(stringValue(node.laneId)) ?? 0;
    const height =
      stringValue(node.kind) === "DECISION"
        ? metrics.decisionHeight
        : metrics.nodeHeight;
    let x = firstX;
    for (const edge of edges) {
      if (stringValue(edge.to) !== id) continue;
      const source = boxes.get(stringValue(edge.from));
      if (!source) continue;
      const label = displayText(stringValue(edge.label));
      const sameLaneGap = label
        ? Math.max(metrics.sameLaneGap, swimlaneEdgeLabel(label).width + 28)
        : metrics.sameLaneGap;
      x = Math.max(
        x,
        source.lane === lane
          ? source.x + metrics.nodeWidth + sameLaneGap
          : source.x + metrics.nodeWidth / 2 + metrics.crossLaneRun,
      );
    }
    const occupied = laneRight.get(lane);
    if (occupied !== undefined) {
      x = Math.max(
        x,
        occupied + metrics.sameLaneGap + metrics.nodeWidth / 2,
      );
    }
    laneRight.set(lane, x + metrics.nodeWidth / 2);
    rightmost = Math.max(rightmost, x + metrics.nodeWidth / 2);
    boxes.set(id, {
      x,
      y: lane * metrics.laneHeight + metrics.laneHeight / 2,
      width: metrics.nodeWidth,
      height,
      lane,
    });
  }

  return { boxes, width: rightmost + metrics.padding };
}

export interface SwimlaneRoute {
  path: string;
  points: readonly (readonly [number, number])[];
}

export function swimlaneRoute(from: SwimlaneBox, to: SwimlaneBox): SwimlaneRoute {
  const build = (points: readonly (readonly [number, number])[]) => ({
    path: points
      .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
      .join(" "),
    points,
  });
  if (from.lane === to.lane && to.x > from.x) {
    return build([
      [from.x + from.width / 2, from.y],
      [to.x - to.width / 2, to.y],
    ]);
  }
  if (to.x - to.width / 2 >= from.x + 20) {
    const y1 = from.y + (to.y > from.y ? from.height / 2 : -from.height / 2);
    return build([
      [from.x, y1],
      [from.x, to.y],
      [to.x - to.width / 2, to.y],
    ]);
  }
  // Retorno o bucle: sale por la derecha, rodea y entra por el lado derecho del destino.
  const x1 = from.x + from.width / 2;
  const turn = Math.max(x1, to.x + to.width / 2) + 30;
  return build([
    [x1, from.y],
    [turn, from.y],
    [turn, to.y],
    [to.x + to.width / 2, to.y],
  ]);
}

/**
 * Busca sobre el conector el punto donde la pastilla de la etiqueta no tapa ningún paso;
 * prefiere el centro del recorrido y, si no hay hueco, lo deja allí.
 */
export function swimlaneLabelPosition(
  points: readonly (readonly [number, number])[],
  pillWidth: number,
  boxes: readonly SwimlaneBox[],
): { x: number; y: number } {
  const samples: { x: number; y: number }[] = [];
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1] as readonly [number, number];
    const [bx, by] = points[index] as readonly [number, number];
    const segment = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(segment / 6));
    for (let step = 0; step <= steps; step += 1) {
      samples.push({
        x: ax + ((bx - ax) * step) / steps,
        y: ay + ((by - ay) * step) / steps,
      });
    }
    length += segment;
  }
  const middle = samples[Math.floor(samples.length / 2)] ?? { x: 0, y: 0 };
  const halfWidth = pillWidth / 2 + 4;
  const halfHeight = 11 + 4;
  const free = (candidate: { x: number; y: number }) =>
    boxes.every(
      (box) =>
        candidate.x + halfWidth <= box.x - box.width / 2 ||
        candidate.x - halfWidth >= box.x + box.width / 2 ||
        candidate.y + halfHeight <= box.y - box.height / 2 ||
        candidate.y - halfHeight >= box.y + box.height / 2,
    );
  const best = [...samples]
    .sort(
      (left, right) =>
        Math.hypot(left.x - middle.x, left.y - middle.y) -
        Math.hypot(right.x - middle.x, right.y - middle.y),
    )
    .find(free);
  return best ?? (length > 0 ? middle : (samples[0] ?? { x: 0, y: 0 }));
}

function SwimlaneProcessFlowDiagram({ value }: { value: DocumentJsonValue }) {
  const flow = recordValue(value);
  const lanes = recordList(flow?.lanes);
  const nodes = recordList(flow?.nodes);
  const edges = recordList(flow?.edges);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useDiagramExpand();
  const pan = useDragPan();
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const markerId = React.useId().replaceAll(":", "");

  if (!flow || lanes.length === 0 || nodes.length === 0) {
    return (
      <EmptyValue>No existe un flujo estructurado para representar.</EmptyValue>
    );
  }

  const minimumReadableZoom = 0.6;
  const metrics = {
    laneHeight: 116,
    labelWidth: 150,
    padding: 28,
    nodeWidth: 172,
    nodeHeight: 76,
    decisionHeight: 88,
    sameLaneGap: 46,
    crossLaneRun: 34,
  };
  const laneIndexById = new Map(
    lanes.map((lane, index) => [stringValue(lane.id), index]),
  );
  const { boxes, width: laidOutWidth } = swimlaneLayout(
    nodes,
    edges,
    laneIndexById,
    metrics,
  );
  const width = Math.max(640, laidOutWidth);
  const height = Math.max(240, lanes.length * metrics.laneHeight);
  // 100 % = ancho disponible; acercar amplía y el visor se desplaza.
  const fit = () => setZoom(1);

  return (
    <figure
      className="rq-process-flow rq-swimlane-flow"
      data-expanded={expanded}
    >
      <figcaption>
        <div className="rq-process-flow__heading">
          <strong>
            {displayText(stringValue(flow.title)) || "Flujo del proceso"}
          </strong>
          <small>
            {lanes.length} carriles · {nodes.length} pasos · {edges.length}{" "}
            conexiones
          </small>
        </div>
        <div
          aria-label="Zoom del diagrama"
          className="rq-process-flow__controls"
        >
          <button
            aria-label="Alejar"
            disabled={zoom <= minimumReadableZoom}
            onClick={() =>
              setZoom((current) =>
                Math.max(
                  minimumReadableZoom,
                  Number((current - 0.1).toFixed(2)),
                ),
              )
            }
            type="button"
          >
            −
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button
            aria-label="Acercar"
            disabled={zoom >= 2}
            onClick={() =>
              setZoom((current) =>
                Math.min(2, Number((current + 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            +
          </button>
          <button onClick={fit} type="button">
            Ajustar
          </button>
          <button
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "Cerrar" : "Ampliar"}
          </button>
        </div>
      </figcaption>
      {stringValue(flow.objective) ? (
        <p className="rq-swimlane-flow__objective">
          <strong>Objetivo:</strong> {displayText(stringValue(flow.objective))}
        </p>
      ) : null}
      <div
        className="rq-process-flow__viewport rq-swimlane-flow__viewport"
        ref={viewportRef}
        {...pan}
      >
        <svg
          aria-label={
            displayText(stringValue(flow.title)) || "Flujo por carriles"
          }
          role="img"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `${Math.round(zoom * 100)}%`,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <marker
              id={`${markerId}-arrow`}
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              markerWidth="9"
              orient="auto"
              refX="8"
              refY="4.5"
              viewBox="0 0 12 12"
            >
              <path d="M 0 0 L 12 6 L 0 12 L 3 6 z" />
            </marker>
          </defs>
          <g className="rq-swimlane-flow__lanes">
            {lanes.map((lane, index) => {
              const laneName =
                displayText(stringValue(lane.name)) || `Carril ${index + 1}`;
              const laneNameLines = flowTextLines(laneName, 16, 3);
              const laneCenter =
                index * metrics.laneHeight + metrics.laneHeight / 2;
              const laneNameStart =
                laneCenter - (laneNameLines.length - 1) * 8 - 6;

              return (
                <g key={stringValue(lane.id) || index}>
                  <rect
                    height={metrics.laneHeight}
                    width={width}
                    x="0"
                    y={index * metrics.laneHeight}
                  />
                  <rect
                    className="rq-swimlane-flow__lane-label"
                    height={metrics.laneHeight}
                    width={metrics.labelWidth}
                    x="0"
                    y={index * metrics.laneHeight}
                  />
                  <rect
                    className="rq-swimlane-flow__lane-accent"
                    height={metrics.laneHeight}
                    width="6"
                    x="0"
                    y={index * metrics.laneHeight}
                  />
                  <text
                    textAnchor="middle"
                    x={(metrics.labelWidth + 6) / 2}
                    y={laneNameStart}
                  >
                    {laneNameLines.map((line, lineIndex) => (
                      <tspan
                        key={`${line}-${lineIndex}`}
                        x={(metrics.labelWidth + 6) / 2}
                        y={laneNameStart + lineIndex * 16}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <text
                    className="rq-swimlane-flow__lane-kind"
                    textAnchor="middle"
                    x={(metrics.labelWidth + 6) / 2}
                    y={laneNameStart + laneNameLines.length * 16 + 4}
                  >
                    {stringValue(lane.kind) === "SYSTEM" ? "Sistema" : "Actor"}
                  </text>
                </g>
              );
            })}
          </g>
          <g className="rq-swimlane-flow__edges">
            {edges.map((edge, index) => {
              const from = boxes.get(stringValue(edge.from));
              const to = boxes.get(stringValue(edge.to));
              if (!from || !to) return null;
              const route = swimlaneRoute(from, to);
              const label = displayText(stringValue(edge.label));
              const pill = swimlaneEdgeLabel(label);
              const position = label
                ? swimlaneLabelPosition(route.points, pill.width, [
                    ...boxes.values(),
                  ])
                : null;
              return (
                <g
                  key={`${stringValue(edge.from)}-${stringValue(edge.to)}-${index}`}
                >
                  <path d={route.path} markerEnd={`url(#${markerId}-arrow)`} />
                  {position ? (
                    <g
                      className="rq-swimlane-flow__edge-label"
                      transform={`translate(${position.x} ${position.y})`}
                    >
                      <rect
                        height="22"
                        rx="11"
                        width={pill.width}
                        x={-pill.width / 2}
                        y="-11"
                      />
                      <text dominantBaseline="middle" textAnchor="middle">
                        {pill.text}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          <g className="rq-process-flow__nodes rq-swimlane-flow__nodes">
            {nodes.map((node, index) => {
              const geometry = boxes.get(stringValue(node.id));
              if (!geometry) return null;
              const kind = stringValue(node.kind) || "PROCESS";
              const label = displayText(stringValue(node.label)) || "Paso";
              const tag = FLOW_KIND_LABELS[kind] ?? "Proceso";
              // «Inicio / Inicio»: la etiqueta de tipo se omite si repite el texto.
              const showTag = label.trim().toLowerCase() !== tag.toLowerCase();
              const lines = flowTextLines(
                label,
                kind === "DECISION" ? 17 : 22,
                kind === "DECISION" ? 2 : 3,
              );
              const labelStartY =
                (showTag ? 9 : 4) - (lines.length - 1) * 8;
              return (
                <g
                  className={`rq-process-flow__node rq-process-flow__node--${kind.toLowerCase()}`}
                  key={stringValue(node.id) || index}
                  transform={`translate(${geometry.x} ${geometry.y})`}
                >
                  {kind === "DECISION" ? (
                    <polygon
                      points={`0,${-geometry.height / 2} ${geometry.width / 2},0 0,${geometry.height / 2} ${-geometry.width / 2},0`}
                    />
                  ) : (
                    <rect
                      height={geometry.height}
                      rx={
                        kind === "START" || kind === "END"
                          ? geometry.height / 2
                          : 12
                      }
                      width={geometry.width}
                      x={-geometry.width / 2}
                      y={-geometry.height / 2}
                    />
                  )}
                  {showTag ? (
                    <text
                      className="rq-process-flow__type"
                      textAnchor="middle"
                      y={-geometry.height / 2 + (kind === "DECISION" ? 22 : 18)}
                    >
                      {tag}
                    </text>
                  ) : null}
                  <text
                    className="rq-process-flow__node-label"
                    textAnchor="middle"
                  >
                    {lines.map((line, lineIndex) => (
                      <tspan
                        key={lineIndex}
                        x="0"
                        y={labelStartY + lineIndex * 16}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <title>{`${tag}: ${label}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </figure>
  );
}

function FlowEvidenceNotes({ value }: { value: DocumentJsonValue }) {
  const flow = recordValue(value);
  if (!flow) return null;
  const groups = [
    ["problems", "Problemas identificados"],
    ["improvements", "Mejoras del proceso"],
    ["expectedResults", "Resultados esperados"],
  ] as const;
  const visible = groups.filter(([key]) => stringList(flow[key]).length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="rq-diagram-evidence-notes">
      {visible.map(([key, label]) => (
        <section key={key}>
          <h3>{label}</h3>
          <ul>
            {stringList(flow[key]).map((item, index) => (
              <li key={`${item}-${index}`}>{displayText(item)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Vista ampliada de un diagrama (pantalla completa); Esc la cierra. */
function useDiagramExpand(): [boolean, (value: boolean | ((current: boolean) => boolean)) => void] {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  return [expanded, setExpanded];
}

type ErSide = "left" | "right" | "top" | "bottom";

export interface EntityBox {
  x: number;
  y: number;
  width: number;
  height: number;
  col: number;
  row: number;
}

export interface EntityRelationshipLayout {
  boxes: Map<string, EntityBox>;
  width: number;
  height: number;
  gapX: number;
  gapY: number;
  rowTops: readonly number[];
  rowHeights: readonly number[];
}

const ER_HEADER_HEIGHT = 46;
const ER_ROW_HEIGHT = 27;
const ER_FOOTER = 12;

/** Altura real de una entidad: encabezado, una fila por atributo y un pie. */
function entityHeight(entity: JsonRecord): number {
  return (
    ER_HEADER_HEIGHT +
    Math.max(1, recordList(entity.attributes).length) * ER_ROW_HEIGHT +
    ER_FOOTER
  );
}

/**
 * Disposición en cuadrícula: las entidades relacionadas quedan contiguas (se ordenan desde la
 * más conectada recorriendo sus vecinas) y cada fila toma la altura de su entidad más alta,
 * de modo que nunca se solapan.
 */
export function entityRelationshipLayout(
  entities: JsonRecord[],
  relationships: JsonRecord[],
): EntityRelationshipLayout {
  const ids = entities.map((entity) => stringValue(entity.id));
  const neighbours = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const relationship of relationships) {
    const from = stringValue(relationship.from);
    const to = stringValue(relationship.to);
    if (from === to || !neighbours.has(from) || !neighbours.has(to)) continue;
    neighbours.get(from)?.add(to);
    neighbours.get(to)?.add(from);
  }
  const degree = (id: string) => neighbours.get(id)?.size ?? 0;
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  const byDegree = [...ids].sort(
    (left, right) => degree(right) - degree(left) || ids.indexOf(left) - ids.indexOf(right),
  );
  for (const start of byDegree) {
    if (seen.has(start)) continue;
    seen.add(start);
    queue.push(start);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      order.push(id);
      const next = [...(neighbours.get(id) ?? [])]
        .filter((neighbour) => !seen.has(neighbour))
        .sort((left, right) => degree(right) - degree(left));
      for (const neighbour of next) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }

  const count = entities.length;
  const columns = count <= 3 ? Math.max(1, count) : count === 4 ? 2 : count <= 9 ? 3 : 4;
  const widest = entities.reduce((largest, entity) => {
    const attributes = recordList(entity.attributes);
    const row = attributes.reduce(
      (value, attribute) =>
        Math.max(
          value,
          stringValue(attribute.name).length * 7.4 +
            stringValue(attribute.dataType).length * 6.8,
        ),
      0,
    );
    return Math.max(largest, row + 104, stringValue(entity.name).length * 8.6 + 40);
  }, 0);
  const boxWidth = Math.round(Math.min(340, Math.max(250, widest)));
  const gapX = 120;
  const gapY = 84;
  const padding = 52;
  const entityById = new Map(entities.map((entity) => [stringValue(entity.id), entity]));
  const rows = Math.ceil(count / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    order
      .slice(row * columns, row * columns + columns)
      .reduce(
        (height, id) => Math.max(height, entityHeight(entityById.get(id) as JsonRecord)),
        0,
      ),
  );
  const rowTops: number[] = [];
  rowHeights.reduce((top, height) => {
    rowTops.push(top);
    return top + height + gapY;
  }, padding);

  const boxes = new Map<string, EntityBox>();
  order.forEach((id, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    boxes.set(id, {
      x: padding + col * (boxWidth + gapX),
      y: rowTops[row] as number,
      width: boxWidth,
      height: entityHeight(entityById.get(id) as JsonRecord),
      col,
      row,
    });
  });

  return {
    boxes,
    width: Math.max(640, padding * 2 + columns * boxWidth + (columns - 1) * gapX),
    height:
      padding * 2 +
      rowHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, rows - 1) * gapY,
    gapX,
    gapY,
    rowTops,
    rowHeights,
  };
}

/** Lados por los que sale y entra una relación, según la posición de ambas entidades. */
export function entityRelationshipSides(
  from: EntityBox,
  to: EntityBox,
): { from: ErSide; to: ErSide } {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc === 0) {
    if (dr === 0 || Math.abs(dr) > 1) return { from: "right", to: "right" };
    return dr > 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
  }
  if (dr === 0 && Math.abs(dc) > 1) return { from: "bottom", to: "bottom" };
  return dc > 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
}

function entityAnchor(
  box: EntityBox,
  side: ErSide,
  offset: number,
): readonly [number, number] {
  const limit = (size: number) => Math.max(0, size / 2 - 18);
  const clamp = (value: number, size: number) =>
    Math.max(-limit(size), Math.min(limit(size), value));
  if (side === "left") return [box.x, box.y + box.height / 2 + clamp(offset, box.height)];
  if (side === "right")
    return [box.x + box.width, box.y + box.height / 2 + clamp(offset, box.height)];
  if (side === "top") return [box.x + box.width / 2 + clamp(offset, box.width), box.y];
  return [box.x + box.width / 2 + clamp(offset, box.width), box.y + box.height];
}

/**
 * Conector ortogonal que viaja por los pasillos entre filas y columnas, así nunca atraviesa
 * otra entidad. `fromOffset` y `toOffset` reparten varias relaciones en un mismo lado.
 */
export function entityRelationshipRoute(
  from: EntityBox,
  to: EntityBox,
  layout: Pick<EntityRelationshipLayout, "gapX" | "gapY" | "rowTops" | "rowHeights">,
  fromOffset = 0,
  toOffset = 0,
): readonly (readonly [number, number])[] {
  const sides = entityRelationshipSides(from, to);
  const a = entityAnchor(from, sides.from, fromOffset);
  const b = entityAnchor(to, sides.to, toOffset);
  const rowBottom = (row: number) =>
    (layout.rowTops[row] as number) + (layout.rowHeights[row] as number);
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  const points: [number, number][] = [[a[0], a[1]]];

  if (sides.from === "right" && sides.to === "right") {
    const x = Math.max(a[0], b[0]) + layout.gapX / 2;
    points.push([x, a[1]], [x, b[1]]);
  } else if (sides.from === "bottom" && sides.to === "bottom") {
    const y = rowBottom(from.row) + layout.gapY / 2;
    points.push([a[0], y], [b[0], y]);
  } else if (sides.from === "bottom") {
    const y = rowBottom(from.row) + layout.gapY / 2;
    points.push([a[0], y], [b[0], y]);
  } else if (sides.from === "top") {
    const y = (layout.rowTops[from.row] as number) - layout.gapY / 2;
    points.push([a[0], y], [b[0], y]);
  } else {
    const direction = dc > 0 ? 1 : -1;
    const x0 = a[0] + (direction * layout.gapX) / 2;
    const x1 = b[0] - (direction * layout.gapX) / 2;
    if (Math.abs(dc) === 1) {
      points.push([x0, a[1]], [x0, b[1]]);
    } else {
      const y =
        dr > 0
          ? rowBottom(from.row) + layout.gapY / 2
          : dr < 0
            ? (layout.rowTops[from.row] as number) - layout.gapY / 2
            : rowBottom(from.row) + layout.gapY / 2;
      points.push([x0, a[1]], [x0, y], [x1, y], [x1, b[1]]);
    }
  }
  points.push([b[0], b[1]]);

  // Quita puntos repetidos o alineados para que el trazo sea limpio.
  const clean: [number, number][] = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    const before = clean[clean.length - 2];
    if (
      last &&
      before &&
      ((before[0] === last[0] && last[0] === point[0]) ||
        (before[1] === last[1] && last[1] === point[1]))
    ) {
      clean[clean.length - 1] = point;
      continue;
    }
    clean.push(point);
  }
  return clean;
}

/** Interpreta un lado de la cardinalidad: «1», «N», «0..1», «0..N», «*»… */
export function parseCardinality(token: string): {
  many: boolean;
  optional: boolean;
} {
  const value = token.trim().toLowerCase();
  return {
    many: /[nm*]|many|muchos/u.test(value),
    optional: /^0/u.test(value),
  };
}

/**
 * Marca de cardinalidad en notación pata de gallo, en el extremo `end` del conector.
 * `toward` es el punto siguiente del conector (para orientar la marca).
 */
export function cardinalityMark(
  end: readonly [number, number],
  toward: readonly [number, number],
  token: string,
): { path: string; circle: { cx: number; cy: number } | null } {
  const { many, optional } = parseCardinality(token);
  const length = Math.hypot(toward[0] - end[0], toward[1] - end[1]) || 1;
  // Vector unitario desde la entidad hacia el conector.
  const ux = (toward[0] - end[0]) / length;
  const uy = (toward[1] - end[1]) / length;
  const nx = -uy;
  const ny = ux;
  const at = (distance: number, side = 0) =>
    `${(end[0] + ux * distance + nx * side).toFixed(2)} ${(end[1] + uy * distance + ny * side).toFixed(2)}`;
  const parts: string[] = [];
  let circleDistance = 0;
  if (many) {
    parts.push(
      `M ${at(14, 0)} L ${at(0, 8)}`,
      `M ${at(14, 0)} L ${at(0, -8)}`,
      `M ${at(14, 0)} L ${at(0, 0)}`,
    );
    circleDistance = 22;
    if (!optional) parts.push(`M ${at(19, 7)} L ${at(19, -7)}`);
  } else {
    parts.push(`M ${at(13, 7)} L ${at(13, -7)}`);
    circleDistance = 21;
    if (!optional) parts.push(`M ${at(19, 7)} L ${at(19, -7)}`);
  }
  const circle = optional
    ? {
        cx: Number((end[0] + ux * circleDistance).toFixed(2)),
        cy: Number((end[1] + uy * circleDistance).toFixed(2)),
      }
    : null;
  return { path: parts.join(" "), circle };
}

function EntityRelationshipDiagram({ value }: { value: DocumentJsonValue }) {
  const model = recordValue(value);
  const entities = recordList(model?.entities);
  const relationships = recordList(model?.relationships);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useDiagramExpand();
  const pan = useDragPan();
  const viewportRef = React.useRef<HTMLDivElement>(null);
  if (!model || entities.length === 0) {
    return (
      <EmptyValue>
        No existe un modelo entidad-relación para representar.
      </EmptyValue>
    );
  }
  const layout = entityRelationshipLayout(entities, relationships);
  const { boxes, width, height } = layout;
  const boxList = [...boxes.values()];
  // 100 % = ancho disponible; acercar amplía y el visor se desplaza.
  const fit = () => setZoom(1);

  // Reparte las relaciones que comparten un mismo lado de una entidad.
  const resolved = relationships.flatMap((relationship, index) => {
    const from = boxes.get(stringValue(relationship.from));
    const to = boxes.get(stringValue(relationship.to));
    if (!from || !to) return [];
    const sides = entityRelationshipSides(from, to);
    return [
      {
        relationship,
        index,
        from,
        to,
        sides,
        fromKey: `${stringValue(relationship.from)}|${sides.from}`,
        toKey: `${stringValue(relationship.to)}|${sides.to}`,
      },
    ];
  });
  const usage = new Map<string, number[]>();
  for (const item of resolved) {
    for (const key of [item.fromKey, item.toKey]) {
      usage.set(key, [...(usage.get(key) ?? []), item.index]);
    }
  }
  const offsetFor = (key: string, index: number) => {
    const list = usage.get(key) ?? [];
    return (list.indexOf(index) - (list.length - 1) / 2) * 20;
  };

  return (
    <figure
      className="rq-process-flow rq-entity-relationship"
      data-expanded={expanded}
    >
      <figcaption>
        <div className="rq-process-flow__heading">
          <strong>
            {displayText(stringValue(model.title)) || "Modelo entidad-relación"}
          </strong>
          <small>
            {entities.length} entidades · {relationships.length} relaciones
          </small>
        </div>
        <div aria-label="Zoom del modelo" className="rq-process-flow__controls">
          <button
            aria-label="Alejar"
            disabled={zoom <= 0.35}
            onClick={() =>
              setZoom((current) =>
                Math.max(0.35, Number((current - 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            −
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button
            aria-label="Acercar"
            disabled={zoom >= 2}
            onClick={() =>
              setZoom((current) =>
                Math.min(2, Number((current + 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            +
          </button>
          <button onClick={fit} type="button">
            Ajustar
          </button>
          <button
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "Cerrar" : "Ampliar"}
          </button>
        </div>
      </figcaption>
      <div
        className="rq-process-flow__viewport rq-entity-relationship__viewport"
        ref={viewportRef}
        {...pan}
      >
        <svg
          aria-label={
            displayText(stringValue(model.title)) || "Modelo entidad-relación"
          }
          role="img"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `${Math.round(zoom * 100)}%`,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <g className="rq-er__relations">
            {resolved.map((item) => {
              const points = entityRelationshipRoute(
                item.from,
                item.to,
                layout,
                item.from === item.to ? -16 : offsetFor(item.fromKey, item.index),
                item.from === item.to ? 16 : offsetFor(item.toKey, item.index),
              );
              const [leftToken = "", rightToken = ""] = stringValue(
                item.relationship.cardinality,
              ).split(":");
              const first = points[0] as readonly [number, number];
              const second = points[1] as readonly [number, number];
              const last = points[points.length - 1] as readonly [number, number];
              const beforeLast = points[points.length - 2] as readonly [number, number];
              const marks = [
                cardinalityMark(first, second, leftToken),
                cardinalityMark(last, beforeLast, rightToken),
              ];
              const label = displayText(stringValue(item.relationship.label));
              const pill = swimlaneEdgeLabel(label);
              const position = label
                ? swimlaneLabelPosition(
                    points,
                    pill.width,
                    boxList.map((box) => ({ ...box, lane: 0 })),
                  )
                : null;
              return (
                <g
                  key={`${stringValue(item.relationship.from)}-${stringValue(item.relationship.to)}-${item.index}`}
                >
                  <path
                    className="rq-er__line"
                    d={points
                      .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
                      .join(" ")}
                  />
                  {marks.map((mark, markIndex) => (
                    <g className="rq-er__mark" key={markIndex}>
                      <path d={mark.path} />
                      {mark.circle ? (
                        <circle cx={mark.circle.cx} cy={mark.circle.cy} r="4" />
                      ) : null}
                    </g>
                  ))}
                  {position ? (
                    <g
                      className="rq-er__relation-label"
                      transform={`translate(${position.x} ${position.y})`}
                    >
                      <rect
                        height="22"
                        rx="11"
                        width={pill.width}
                        x={-pill.width / 2}
                        y="-11"
                      />
                      <text dominantBaseline="middle" textAnchor="middle">
                        {pill.text}
                      </text>
                    </g>
                  ) : null}
                  <title>{`${label}: ${stringValue(item.relationship.cardinality)}`}</title>
                </g>
              );
            })}
          </g>
          <g className="rq-er__entities">
            {entities.map((entity, index) => {
              const geometry = boxes.get(stringValue(entity.id));
              if (!geometry) return null;
              const attributes = recordList(entity.attributes);
              const radius = 12;
              return (
                <g
                  className="rq-er__entity"
                  key={stringValue(entity.id) || index}
                  transform={`translate(${geometry.x} ${geometry.y})`}
                >
                  <rect
                    className="rq-er__card"
                    height={geometry.height}
                    rx={radius}
                    width={geometry.width}
                  />
                  <path
                    className="rq-er__header"
                    d={`M 0 ${ER_HEADER_HEIGHT} V ${radius} a ${radius} ${radius} 0 0 1 ${radius} ${-radius} H ${geometry.width - radius} a ${radius} ${radius} 0 0 1 ${radius} ${radius} V ${ER_HEADER_HEIGHT} z`}
                  />
                  <text className="rq-er__name" x="16" y="29">
                    {displayText(stringValue(entity.name))}
                  </text>
                  {attributes.length === 0 ? (
                    <text
                      className="rq-er__empty"
                      x="16"
                      y={ER_HEADER_HEIGHT + 19}
                    >
                      Sin atributos sustentados
                    </text>
                  ) : (
                    attributes.map((attribute, attributeIndex) => {
                      const top = ER_HEADER_HEIGHT + attributeIndex * ER_ROW_HEIGHT;
                      const middle = top + ER_ROW_HEIGHT / 2 + 4.5;
                      const primary = attribute.primaryKey === true;
                      const foreign = attribute.foreignKey === true;
                      return (
                        <g
                          key={`${stringValue(attribute.name)}-${attributeIndex}`}
                        >
                          {attributeIndex % 2 === 1 ? (
                            <rect
                              className="rq-er__stripe"
                              height={ER_ROW_HEIGHT}
                              width={geometry.width}
                              x="0"
                              y={top}
                            />
                          ) : null}
                          {primary ? (
                            <g className="rq-er__badge rq-er__badge--pk">
                              <rect height="16" rx="5" width="24" x="12" y={top + 5.5} />
                              <text textAnchor="middle" x="24" y={top + 17}>
                                PK
                              </text>
                            </g>
                          ) : null}
                          {foreign ? (
                            <g className="rq-er__badge rq-er__badge--fk">
                              <rect height="16" rx="5" width="24" x="40" y={top + 5.5} />
                              <text textAnchor="middle" x="52" y={top + 17}>
                                FK
                              </text>
                            </g>
                          ) : null}
                          <text
                            className={
                              primary
                                ? "rq-er__attribute rq-er__attribute--key"
                                : "rq-er__attribute"
                            }
                            x="72"
                            y={middle}
                          >
                            {displayText(stringValue(attribute.name))}
                            {attribute.required === true ? (
                              <tspan className="rq-er__required"> *</tspan>
                            ) : null}
                          </text>
                          <text
                            className="rq-er__type"
                            textAnchor="end"
                            x={geometry.width - 14}
                            y={middle}
                          >
                            {displayText(stringValue(attribute.dataType))}
                          </text>
                        </g>
                      );
                    })
                  )}
                  <title>{displayText(stringValue(entity.description))}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </figure>
  );
}

function ProcessModelsView({ value }: { value: DocumentJsonValue }) {
  const models = resolveDiagramModels(value);
  const [active, setActive] = useState<DiagramModelTab>("asIs");
  const includeEntityRelationship =
    models.historical || models.root?.entityRelationship !== null;
  return (
    <div className="rq-diagram-models">
      <DiagramModelTabs
        active={active}
        includeEntityRelationship={includeEntityRelationship}
        onChange={setActive}
      />
      <section
        aria-labelledby={`diagram-tab-${active}`}
        id={`diagram-panel-${active}`}
        role="tabpanel"
      >
        {active === "asIs" ? (
          models.historical ? (
            <ProcessFlowDiagram value={models.asIs ?? {}} />
          ) : hasProcessFlowModelContent(models.asIs) ? (
            <>
              <SwimlaneProcessFlowDiagram value={models.asIs ?? {}} />
              <FlowEvidenceNotes value={models.asIs ?? {}} />
            </>
          ) : (
            <EmptyValue>{NO_AS_IS_EVIDENCE_MESSAGE}</EmptyValue>
          )
        ) : active === "toBe" ? (
          hasProcessFlowModelContent(models.toBe) ? (
            <>
              <SwimlaneProcessFlowDiagram value={models.toBe ?? {}} />
              <FlowEvidenceNotes value={models.toBe ?? {}} />
            </>
          ) : (
            <EmptyValue>
              {models.historical
                ? HISTORICAL_TO_BE_MESSAGE
                : NO_TO_BE_EVIDENCE_MESSAGE}
            </EmptyValue>
          )
        ) : hasEntityRelationshipModelContent(models.entityRelationship) ? (
          <EntityRelationshipDiagram value={models.entityRelationship ?? {}} />
        ) : (
          <EmptyValue>
            {models.historical ? HISTORICAL_ER_MESSAGE : NO_ER_EVIDENCE_MESSAGE}
          </EmptyValue>
        )}
      </section>
    </div>
  );
}

function ProcessFlowEditor({ value, readOnly, onChange }: BusinessEditorProps) {
  const flow = recordValue(value) ?? {
    title: "Flujo del proceso",
    nodes: [],
    edges: [],
    sourceIds: [],
  };
  const nodes = recordList(flow.nodes);
  const edges = recordList(flow.edges);
  const supportsSwimlanes = Array.isArray(flow.lanes);
  const lanes = recordList(flow.lanes);
  const update = (changes: JsonRecord) => onChange({ ...flow, ...changes });
  const updateNode = (index: number, changes: JsonRecord) =>
    update({
      nodes: nodes.map((node, itemIndex) =>
        itemIndex === index ? { ...node, ...changes } : node,
      ),
    });
  return (
    <div className="rq-process-flow-editor">
      {supportsSwimlanes ? (
        <SwimlaneProcessFlowDiagram value={flow} />
      ) : (
        <ProcessFlowDiagram value={flow} />
      )}
      <EditorHint />
      <TextField
        label="Nombre del flujo"
        onChange={(title) => update({ title })}
        readOnly={readOnly}
        value={stringValue(flow.title)}
      />
      {Object.hasOwn(flow, "objective") ? (
        <TextField
          label="Objetivo del flujo"
          onChange={(objective) =>
            update({ objective: objective.trim() ? objective : null })
          }
          readOnly={readOnly}
          value={stringValue(flow.objective)}
        />
      ) : null}
      {supportsSwimlanes ? (
        <section className="rq-process-flow-editor__lanes">
          <h3>Actores y sistemas ({lanes.length})</h3>
          <div className="rq-document-disclosure-list">
            {lanes.map((lane, index) => (
              <EditorDisclosure
                description={
                  stringValue(lane.kind) === "SYSTEM" ? "Sistema" : "Actor"
                }
                key={stringValue(lane.id) || index}
                onDelete={
                  readOnly
                    ? undefined
                    : () => {
                        const laneId = stringValue(lane.id);
                        update({
                          lanes: lanes.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                          nodes: nodes.map((node) =>
                            stringValue(node.laneId) === laneId
                              ? { ...node, laneId: null }
                              : node,
                          ),
                        });
                      }
                }
                title={
                  displayText(stringValue(lane.name)) || `Carril ${index + 1}`
                }
              >
                <TextField
                  label="Nombre"
                  multiline={false}
                  onChange={(name) =>
                    update({
                      lanes: lanes.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name } : item,
                      ),
                    })
                  }
                  readOnly={readOnly}
                  value={stringValue(lane.name)}
                />
                <label className="rq-document-business-field">
                  <span>Tipo</span>
                  <select
                    disabled={readOnly}
                    onChange={(event) =>
                      update({
                        lanes: lanes.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, kind: event.target.value }
                            : item,
                        ),
                      })
                    }
                    value={stringValue(lane.kind) || "ACTOR"}
                  >
                    <option value="ACTOR">Actor</option>
                    <option value="SYSTEM">Sistema</option>
                  </select>
                </label>
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  lanes: [
                    ...lanes,
                    {
                      id: `lane-${lanes.length + 1}-${Date.now()}`,
                      name: PENDING,
                      kind: "ACTOR",
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar actor o sistema
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="rq-process-flow-editor__columns">
        <section>
          <h3>Pasos del proceso ({nodes.length})</h3>
          <div className="rq-document-disclosure-list">
            {nodes.map((node, index) => (
              <EditorDisclosure
                description={FLOW_KIND_LABELS[stringValue(node.kind)]}
                key={stringValue(node.id) || index}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update({
                          nodes: nodes.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                          edges: edges.filter(
                            (edge) =>
                              edge.from !== node.id && edge.to !== node.id,
                          ),
                        })
                }
                title={`Paso ${index + 1}: ${displayText(stringValue(node.label)) || "Sin nombre"}`}
              >
                <label className="rq-document-business-field">
                  <span>Tipo</span>
                  <select
                    disabled={readOnly}
                    onChange={(event) =>
                      updateNode(index, { kind: event.target.value })
                    }
                    value={stringValue(node.kind)}
                  >
                    {Object.entries(FLOW_KIND_LABELS).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField
                  label={node.kind === "DECISION" ? "Pregunta" : "Nombre"}
                  onChange={(label) => updateNode(index, { label })}
                  readOnly={readOnly}
                  value={stringValue(node.label)}
                />
                {supportsSwimlanes ? (
                  <label className="rq-document-business-field">
                    <span>Actor o sistema responsable</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        updateNode(index, {
                          laneId: event.target.value || null,
                        })
                      }
                      value={stringValue(node.laneId)}
                    >
                      <option value="">Sin carril asignado</option>
                      {lanes.map((lane) => (
                        <option
                          key={stringValue(lane.id)}
                          value={stringValue(lane.id)}
                        >
                          {displayText(stringValue(lane.name))}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  nodes: [
                    ...nodes,
                    {
                      id: `step-${nodes.length + 1}-${Date.now()}`,
                      kind: "PROCESS",
                      label: PENDING,
                      ...(supportsSwimlanes
                        ? { laneId: stringValue(lanes[0]?.id) || null }
                        : {}),
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar paso
            </button>
          ) : null}
        </section>
        <section>
          <h3>Conexiones ({edges.length})</h3>
          <div className="rq-document-disclosure-list">
            {edges.map((edge, index) => (
              <EditorDisclosure
                description={`${displayText(stringValue(nodes.find((node) => node.id === edge.from)?.label)) || "Origen"} → ${displayText(stringValue(nodes.find((node) => node.id === edge.to)?.label)) || "Destino"}`}
                key={index}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update({
                          edges: edges.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                }
                title={`Conexión ${index + 1}`}
              >
                <div className="rq-document-flow-connections">
                  <label>
                    <span>De</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        update({
                          edges: edges.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, from: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={stringValue(edge.from)}
                    >
                      {nodes.map((node, nodeIndex) => (
                        <option
                          key={stringValue(node.id)}
                          value={stringValue(node.id)}
                        >
                          Paso {nodeIndex + 1}:{" "}
                          {displayText(stringValue(node.label))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextField
                    label="Condición opcional"
                    multiline={false}
                    onChange={(label) =>
                      update({
                        edges: edges.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, label: label.trim() ? label : null }
                            : item,
                        ),
                      })
                    }
                    readOnly={readOnly}
                    value={stringValue(edge.label)}
                  />
                  <label>
                    <span>A</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        update({
                          edges: edges.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, to: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={stringValue(edge.to)}
                    >
                      {nodes.map((node, nodeIndex) => (
                        <option
                          key={stringValue(node.id)}
                          value={stringValue(node.id)}
                        >
                          Paso {nodeIndex + 1}:{" "}
                          {displayText(stringValue(node.label))}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly && nodes.length > 1 ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  edges: [
                    ...edges,
                    {
                      from: stringValue(nodes[0]?.id),
                      to: stringValue(nodes[1]?.id),
                      label: null,
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar conexión
            </button>
          ) : null}
        </section>
      </div>
      {Object.hasOwn(flow, "problems") ? (
        <div className="rq-process-flow-editor__evidence">
          <StringListEditor
            emptyLabel="Sin problemas respaldados."
            label="Problemas identificados"
            onChange={(problems) => update({ problems })}
            readOnly={readOnly}
            value={stringList(flow.problems)}
          />
          <StringListEditor
            emptyLabel="Sin mejoras respaldadas."
            label="Mejoras del proceso"
            onChange={(improvements) => update({ improvements })}
            readOnly={readOnly}
            value={stringList(flow.improvements)}
          />
          <StringListEditor
            emptyLabel="Sin resultados esperados respaldados."
            label="Resultados esperados"
            onChange={(expectedResults) => update({ expectedResults })}
            readOnly={readOnly}
            value={stringList(flow.expectedResults)}
          />
        </div>
      ) : null}
    </div>
  );
}

function EntityRelationshipEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const model = recordValue(value) ?? {
    title: "Modelo entidad-relación",
    entities: [],
    relationships: [],
    sourceIds: [],
  };
  const entities = recordList(model.entities);
  const relationships = recordList(model.relationships);
  const update = (changes: JsonRecord) => onChange({ ...model, ...changes });
  const updateEntity = (index: number, changes: JsonRecord) =>
    update({
      entities: entities.map((entity, itemIndex) =>
        itemIndex === index ? { ...entity, ...changes } : entity,
      ),
    });

  return (
    <div className="rq-entity-relationship-editor">
      <EntityRelationshipDiagram value={model} />
      <EditorHint />
      <TextField
        label="Nombre del modelo"
        onChange={(title) => update({ title })}
        readOnly={readOnly}
        value={stringValue(model.title)}
      />
      <div className="rq-entity-relationship-editor__columns">
        <section>
          <h3>Entidades ({entities.length})</h3>
          <div className="rq-document-disclosure-list">
            {entities.map((entity, entityIndex) => {
              const attributes = recordList(entity.attributes);
              const entityId = stringValue(entity.id);
              return (
                <EditorDisclosure
                  description={`${attributes.length} atributos`}
                  key={entityId || entityIndex}
                  onDelete={
                    readOnly
                      ? undefined
                      : () =>
                          update({
                            entities: entities.filter(
                              (_, itemIndex) => itemIndex !== entityIndex,
                            ),
                            relationships: relationships.filter(
                              (relationship) =>
                                relationship.from !== entity.id &&
                                relationship.to !== entity.id,
                            ),
                          })
                  }
                  title={
                    displayText(stringValue(entity.name)) ||
                    `Entidad ${entityIndex + 1}`
                  }
                >
                  <TextField
                    label="Nombre"
                    multiline={false}
                    onChange={(name) => updateEntity(entityIndex, { name })}
                    readOnly={readOnly}
                    value={stringValue(entity.name)}
                  />
                  <TextField
                    label="Descripción"
                    onChange={(description) =>
                      updateEntity(entityIndex, { description })
                    }
                    readOnly={readOnly}
                    value={stringValue(entity.description)}
                  />
                  <h4>Atributos</h4>
                  <div className="rq-document-disclosure-list">
                    {attributes.map((attribute, attributeIndex) => (
                      <EditorDisclosure
                        description={displayText(
                          stringValue(attribute.dataType),
                        )}
                        key={`${stringValue(attribute.name)}-${attributeIndex}`}
                        onDelete={
                          readOnly
                            ? undefined
                            : () =>
                                updateEntity(entityIndex, {
                                  attributes: attributes.filter(
                                    (_, itemIndex) =>
                                      itemIndex !== attributeIndex,
                                  ),
                                })
                        }
                        title={
                          displayText(stringValue(attribute.name)) ||
                          `Atributo ${attributeIndex + 1}`
                        }
                      >
                        <div className="rq-entity-attribute-editor">
                          <TextField
                            label="Nombre"
                            multiline={false}
                            onChange={(name) =>
                              updateEntity(entityIndex, {
                                attributes: attributes.map((item, itemIndex) =>
                                  itemIndex === attributeIndex
                                    ? { ...item, name }
                                    : item,
                                ),
                              })
                            }
                            readOnly={readOnly}
                            value={stringValue(attribute.name)}
                          />
                          <TextField
                            label="Tipo de dato"
                            multiline={false}
                            onChange={(dataType) =>
                              updateEntity(entityIndex, {
                                attributes: attributes.map((item, itemIndex) =>
                                  itemIndex === attributeIndex
                                    ? { ...item, dataType }
                                    : item,
                                ),
                              })
                            }
                            readOnly={readOnly}
                            value={stringValue(attribute.dataType)}
                          />
                          {[
                            ["primaryKey", "Clave primaria (PK)"],
                            ["foreignKey", "Clave foránea (FK)"],
                            ["required", "Obligatorio"],
                          ].map(([key, label]) => (
                            <label className="rq-document-checkbox" key={key}>
                              <input
                                checked={attribute[key] === true}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateEntity(entityIndex, {
                                    attributes: attributes.map(
                                      (item, itemIndex) =>
                                        itemIndex === attributeIndex
                                          ? {
                                              ...item,
                                              [key]: event.target.checked,
                                            }
                                          : item,
                                    ),
                                  })
                                }
                                type="checkbox"
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </EditorDisclosure>
                    ))}
                  </div>
                  {!readOnly ? (
                    <button
                      className="rq-document-add-item"
                      onClick={() =>
                        updateEntity(entityIndex, {
                          attributes: [
                            ...attributes,
                            {
                              name: PENDING,
                              dataType: PENDING,
                              primaryKey: false,
                              foreignKey: false,
                              required: false,
                            },
                          ],
                        })
                      }
                      type="button"
                    >
                      Agregar atributo
                    </button>
                  ) : null}
                </EditorDisclosure>
              );
            })}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  entities: [
                    ...entities,
                    {
                      id: `entity-${entities.length + 1}-${Date.now()}`,
                      name: PENDING,
                      description: PENDING,
                      attributes: [],
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar entidad
            </button>
          ) : null}
        </section>
        <section>
          <h3>Relaciones ({relationships.length})</h3>
          <div className="rq-document-disclosure-list">
            {relationships.map((relationship, index) => (
              <EditorDisclosure
                description={`${displayText(stringValue(entities.find((entity) => entity.id === relationship.from)?.name)) || "Entidad"} → ${displayText(stringValue(entities.find((entity) => entity.id === relationship.to)?.name)) || "Entidad"}`}
                key={index}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update({
                          relationships: relationships.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                }
                title={
                  displayText(stringValue(relationship.label)) ||
                  `Relación ${index + 1}`
                }
              >
                <div className="rq-document-flow-connections">
                  {[
                    ["from", "Desde"],
                    ["to", "Hacia"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <select
                        disabled={readOnly}
                        onChange={(event) =>
                          update({
                            relationships: relationships.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, [key]: event.target.value }
                                  : item,
                            ),
                          })
                        }
                        value={stringValue(relationship[key])}
                      >
                        {entities.map((entity) => (
                          <option
                            key={stringValue(entity.id)}
                            value={stringValue(entity.id)}
                          >
                            {displayText(stringValue(entity.name))}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    <span>Cardinalidad</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        update({
                          relationships: relationships.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, cardinality: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={stringValue(relationship.cardinality) || "1:N"}
                    >
                      {(["1:1", "1:N", "N:1", "N:M"] as const).map(
                        (cardinality) => (
                          <option key={cardinality} value={cardinality}>
                            {cardinality}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <TextField
                  label="Nombre de la relación"
                  multiline={false}
                  onChange={(label) =>
                    update({
                      relationships: relationships.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label } : item,
                      ),
                    })
                  }
                  readOnly={readOnly}
                  value={stringValue(relationship.label)}
                />
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly && entities.length > 1 ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  relationships: [
                    ...relationships,
                    {
                      from: stringValue(entities[0]?.id),
                      to: stringValue(entities[1]?.id),
                      cardinality: "1:N",
                      label: PENDING,
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar relación
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ProcessModelsEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const models = resolveDiagramModels(value);
  const [active, setActive] = useState<DiagramModelTab>("asIs");
  const includeEntityRelationship =
    models.historical || models.root?.entityRelationship !== null;
  const updateFlow = (key: "asIs" | "toBe", next: DocumentJsonValue) => {
    if (!models.root || !models.processFlows) return;
    onChange({
      ...models.root,
      processFlows: { ...models.processFlows, [key]: next },
    });
  };
  const updateEntityRelationship = (next: DocumentJsonValue) => {
    if (!models.root) return;
    onChange({ ...models.root, entityRelationship: next });
  };
  return (
    <div className="rq-diagram-models rq-diagram-models--editor">
      <DiagramModelTabs
        active={active}
        includeEntityRelationship={includeEntityRelationship}
        onChange={setActive}
      />
      <section
        aria-labelledby={`diagram-tab-${active}`}
        id={`diagram-panel-${active}`}
        role="tabpanel"
      >
        {active === "asIs" ? (
          models.historical || hasProcessFlowModelContent(models.asIs) ? (
            <ProcessFlowEditor
              onChange={(next) =>
                models.historical ? onChange(next) : updateFlow("asIs", next)
              }
              readOnly={readOnly}
              value={models.asIs ?? {}}
            />
          ) : (
            <EmptyValue>{NO_AS_IS_EVIDENCE_MESSAGE}</EmptyValue>
          )
        ) : active === "toBe" ? (
          hasProcessFlowModelContent(models.toBe) ? (
            <ProcessFlowEditor
              onChange={(next) => updateFlow("toBe", next)}
              readOnly={readOnly}
              value={models.toBe ?? {}}
            />
          ) : (
            <EmptyValue>
              {models.historical
                ? HISTORICAL_TO_BE_MESSAGE
                : NO_TO_BE_EVIDENCE_MESSAGE}
            </EmptyValue>
          )
        ) : hasEntityRelationshipModelContent(models.entityRelationship) ? (
          <EntityRelationshipEditor
            onChange={updateEntityRelationship}
            readOnly={readOnly}
            value={models.entityRelationship ?? {}}
          />
        ) : (
          <EmptyValue>
            {models.historical ? HISTORICAL_ER_MESSAGE : NO_ER_EVIDENCE_MESSAGE}
          </EmptyValue>
        )}
      </section>
    </div>
  );
}

function StoryFieldsTable({ value }: { value: DocumentJsonValue | undefined }) {
  const fields = recordList(value);
  if (fields.length === 0)
    return <EmptyValue>Sin campos definidos.</EmptyValue>;
  return (
    <div className="rq-document-responsive-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Campo</th>
            <th scope="col">Tipo</th>
            <th scope="col">Obligatorio</th>
            <th scope="col">Validación</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, index) => (
            <tr key={`${stringValue(field.name)}-${index}`}>
              <td data-label="Campo">{displayText(stringValue(field.name))}</td>
              <td data-label="Tipo">
                {displayText(stringValue(field.dataType))}
              </td>
              <td data-label="Obligatorio">
                {field.required === true ? "Sí" : "No"}
              </td>
              <td data-label="Validación">
                {displayText(stringValue(field.validation))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/*
 * PUNTO_6_ACCEPTANCE_CRITERIA_COMPATIBILITY
 *
 * Versiones anteriores del Punto 6 pueden conservar criterios como:
 *
 * "DADO ..., CUANDO ..., ENTONCES ..."
 *
 * El backlog canónico usa objetos:
 * { code, given, when, then, sourceIds }.
 *
 * Esta normalización permite:
 * - mostrar criterios históricos;
 * - editarlos con StoryEditor;
 * - guardarlos posteriormente en la forma canónica;
 * - no perder información ya generada.
 */
export function normalizeStoryAcceptanceCriteria(
  value: DocumentJsonValue | undefined,
  storyCode = "HU",
): JsonRecord[] {
  if (!Array.isArray(value)) return [];

  const normalizedStoryCode =
    storyCode
      .replace(/^HU-/iu, "")
      .replace(/[^A-Z0-9-]/giu, "")
      .toUpperCase() || "HU";

  return value.flatMap((item, index) => {
    const record = recordValue(item);

    if (record) {
      return [record];
    }

    if (typeof item !== "string" || !item.trim()) {
      return [];
    }

    const source = item.trim();

    const match = source.match(
      /^\s*DADO\s+([\s\S]*?)\s*,?\s+CUANDO\s+([\s\S]*?)\s*,?\s+ENTONCES\s+([\s\S]*?)\s*$/iu,
    );

    return [
      {
        code: `CA-${normalizedStoryCode}-` + String(index + 1).padStart(3, "0"),

        /*
         * Si el texto sí tiene DADO/CUANDO/ENTONCES,
         * recuperamos las tres partes.
         *
         * Si es un criterio histórico libre, conservamos
         * literalmente la información y marcamos únicamente
         * las partes inexistentes como pendientes.
         */
        given: match?.[1]?.trim() || source,
        when: match?.[2]?.trim() || PENDING,
        then: match?.[3]?.trim() || PENDING,

        sourceIds: [],
      },
    ];
  });
}

function AcceptanceCriteriaView({
  value,
  storyCode = "HU",
}: {
  value: DocumentJsonValue | undefined;
  storyCode?: string;
}) {
  const criteria = normalizeStoryAcceptanceCriteria(value, storyCode);
  if (criteria.length === 0)
    return <EmptyValue>Sin criterios definidos.</EmptyValue>;
  return (
    <div className="rq-document-criteria-list">
      {criteria.map((criterion, index) => (
        <article key={stringValue(criterion.code) || index}>
          <strong>
            {displayText(stringValue(criterion.code)) ||
              `Criterio ${index + 1}`}
          </strong>
          {[
            ["Dado", criterion.given],
            ["Cuando", criterion.when],
            ["Entonces", criterion.then],
          ].map(([label, item]) => (
            <p key={String(label)}>
              <span>{String(label)}</span>
              {displayText(stringValue(item as DocumentJsonValue))}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

type RequirementsTab = "functional" | "nonFunctional";

function RequirementsTabList({
  active,
  onChange,
}: {
  active: RequirementsTab;
  onChange: (tab: RequirementsTab) => void;
}) {
  const tabs: readonly [RequirementsTab, string][] = [
    ["functional", "6.1 Requerimientos funcionales"],
    ["nonFunctional", "6.2 Requerimientos no funcionales"],
  ];
  return (
    <div
      aria-label="Tipos de requerimiento"
      className="rq-requirements-tabs"
      role="tablist"
    >
      {tabs.map(([id, label]) => (
        <button
          aria-controls={`requirements-panel-${id}`}
          aria-selected={active === id}
          id={`requirements-tab-${id}`}
          key={id}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const next = id === "functional" ? "nonFunctional" : "functional";
            onChange(next);
            globalThis.setTimeout(() =>
              globalThis.document
                ?.getElementById(`requirements-tab-${next}`)
                ?.focus(),
            );
          }}
          role="tab"
          tabIndex={active === id ? 0 : -1}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function composeRequirementsContent(
  value: DocumentJsonValue,
  backlogValue: DocumentJsonValue | null | undefined,
): DocumentJsonValue {
  const current = recordValue(value);
  const backlog = recordValue(backlogValue);

  if (!current || !backlog) return value;

  /*
   * POINT_6_7_INDEPENDENT_FRONTEND
   *
   * En el contrato 4.1 las HU-F del Punto 6 y las HU-P del Punto 7 son
   * colecciones distintas. La compatibilidad legacy de abajo solo aplica a
   * documentos 4.0, donde ambos puntos compartían el mismo código de HU.
   *
   * Sin este corte, la vista reemplazaba HU-F persistidas y completas por las
   * HU-P de planificación. El síntoma visible era exactamente: un Hito "Sin
   * código", campos COMO/QUIERO/PARA vacíos y criterios desaparecidos.
   */
  const independentPlanningBacklog = recordList(backlog.epics).some((epic) =>
    recordList(epic.features).some((feature) =>
      recordList(feature.userStories).some(
        (story) =>
          stringValue(story.code).trim().toUpperCase().startsWith("HU-P-") ||
          Array.isArray(story.functionalRequirementCodes),
      ),
    ),
  );

  if (independentPlanningBacklog) return value;

  const epics = recordList(backlog.epics);
  if (epics.length === 0) return value;

  const currentFunctional = recordList(current.functionalRequirements);

  const currentByCode = new Map(
    currentFunctional
      .map((item) => [stringValue(item.code).toUpperCase(), item] as const)
      .filter(([code]) => Boolean(code)),
  );

  const functionalRequirements = epics.flatMap((epic) =>
    recordList(epic.features).flatMap((feature) =>
      recordList(feature.userStories).map((story) => {
        const existing = currentByCode.get(
          stringValue(story.code).toUpperCase(),
        );

        /*
         * Si el usuario ya empezó a editar una HU completa,
         * se conserva su edición local.
         *
         * Si el Punto 6 todavía tiene la representación antigua,
         * se recupera la HU completa desde Punto 7.
         */
        const existingIsRich = Boolean(
          existing &&
          stringValue(existing.role) &&
          stringValue(existing.want) &&
          stringValue(existing.benefit),
        );

        const businessStory = existingIsRich
          ? { ...story, ...existing }
          : { ...story };

        const existingCriteria = normalizeStoryAcceptanceCriteria(
          existing?.acceptanceCriteria,
          stringValue(story.code),
        );

        const backlogCriteria = normalizeStoryAcceptanceCriteria(
          story.acceptanceCriteria,
          stringValue(story.code),
        );

        const result: JsonRecord = {
          ...businessStory,

          /*
           * PUNTO_6_BUSINESS_STORY_OWNERSHIP
           *
           * Punto 7 conserva:
           * - código HU;
           * - Epic padre;
           * - Feature padre;
           * - Tasks.
           *
           * Punto 6 conserva la definición funcional completa
           * de la HU, incluido título y descripción.
           */
          code: stringValue(story.code),

          epicCode: stringValue(epic.code),
          epicTitle: stringValue(epic.title),

          featureCode: stringValue(feature.code),
          featureTitle: stringValue(feature.title),

          requirementType: "USER_STORY",

          acceptanceCriteria:
            existingCriteria.length > 0 ? existingCriteria : backlogCriteria,

          /*
           * PUNTO_6_VIEW_PRESERVES_PERSISTED_MILESTONES
           *
           * La vista normal debe mostrar exactamente los mismos
           * Hitos persistidos que el modo Editar.
           *
           * No eliminamos ni reinterpretamos Hitos existentes.
           * Las nuevas generaciones ya tienen la regla HITO != FEATURE.
           */
          milestone: existing?.milestone ?? null,

          functionality: existing?.functionality ?? null,

          milestoneDescription: existing?.milestoneDescription ?? null,
        };

        /*
         * Estos campos son exclusivos del modelo RNF.
         * No deben aparecer ni generar pendientes en una HU.
         */
        delete result.category;
        delete result.measure;
        delete result.target;

        return result;
      }),
    ),
  );

  return {
    ...current,
    functionalRequirements,

    /*
     * Los RNF NO se mezclan con las HU.
     * Continúan exactamente en su pestaña.
     */
    nonFunctionalRequirements: current.nonFunctionalRequirements ?? [],
  };
}

function RequirementCards({ value }: { value: DocumentJsonValue | undefined }) {
  const items = recordList(value);

  if (items.length === 0) {
    return <EmptyValue>Sin requerimientos registrados.</EmptyValue>;
  }

  return (
    <div className="rq-document-master-list">
      {items.map((item, index) => {
        const fullUserStory = Boolean(
          stringValue(item.role) &&
          stringValue(item.want) &&
          stringValue(item.benefit),
        );

        return (
          <EditorDisclosure
            description={stringValue(item.title)}
            key={stringValue(item.code) || index}
            meta={stringValue(item.requirementType)}
            title={displayText(stringValue(item.code)) || `RQ-${index + 1}`}
          >
            {fullUserStory ? (
              <div>
                <div className="rq-document-detail-panel">
                  <p>
                    <strong>Epic:</strong>{" "}
                    {displayText(stringValue(item.epicCode))} ·{" "}
                    {displayText(stringValue(item.epicTitle))}
                  </p>

                  <p>
                    <strong>Feature:</strong>{" "}
                    {displayText(stringValue(item.featureCode))} ·{" "}
                    {displayText(stringValue(item.featureTitle))}
                  </p>
                </div>

                <RequirementStoryDetail story={item} />
              </div>
            ) : (
              /*
               * RNF:
               * conserva su presentación propia.
               */
              <div className="rq-document-detail-panel">
                <HumanValue value={item.description ?? ""} />

                {item.category ? (
                  <p>
                    <strong>Categoría:</strong>{" "}
                    {displayText(stringValue(item.category))}
                  </p>
                ) : null}

                {item.measure ? (
                  <p>
                    <strong>Medida:</strong>{" "}
                    {displayText(stringValue(item.measure))}
                  </p>
                ) : null}

                {item.target ? (
                  <p>
                    <strong>Objetivo:</strong>{" "}
                    {displayText(stringValue(item.target))}
                  </p>
                ) : null}

                <h4>Criterios de aceptación</h4>
                <TextList items={stringList(item.acceptanceCriteria)} />
              </div>
            )}
          </EditorDisclosure>
        );
      })}
    </div>
  );
}

/*
 * PUNTO_6_MILESTONE_GROUPS
 *
 * Persistencia:
 * functionalRequirements continúa siendo la colección de HU.
 *
 * Presentación:
 * Hito -> HU completa -> criterios.
 *
 * La estructura Epic -> Feature -> HU -> Task pertenece al Punto 7.
 */
type FunctionalMilestoneStory = {
  story: JsonRecord;
  index: number;
};

type FunctionalMilestoneGroup = {
  key: string;
  code: string;
  name: string;
  description: string;
  stories: FunctionalMilestoneStory[];
};

function isPendingFunctionalStory(story: JsonRecord): boolean {
  const status = stringValue(story.assignmentStatus).trim().toUpperCase();

  return (
    status === "PENDING_ASSIGNMENT" || !stringValue(story.milestone).trim()
  );
}

function pendingFunctionalStories(
  value: DocumentJsonValue | undefined,
): FunctionalMilestoneStory[] {
  return recordList(value)
    .map((story, index) => ({ story, index }))
    .filter(({ story }) => isPendingFunctionalStory(story));
}

function functionalMilestoneGroups(
  value: DocumentJsonValue | undefined,
): FunctionalMilestoneGroup[] {
  const stories = recordList(value);
  const groups = new Map<string, FunctionalMilestoneGroup>();

  stories.forEach((story, index) => {
    if (isPendingFunctionalStory(story)) return;

    const code = stringValue(story.milestone).trim();
    const name = stringValue(story.functionality).trim();
    const description = stringValue(story.milestoneDescription).trim();
    const key = code.toUpperCase();

    const existing = groups.get(key);
    if (existing) {
      existing.stories.push({ story, index });
      if (!existing.name && name) existing.name = name;
      if (!existing.description && description) {
        existing.description = description;
      }
      return;
    }

    groups.set(key, {
      key,
      code,
      name,
      description,
      stories: [{ story, index }],
    });
  });

  const milestoneNumber = (value: string) => {
    const match = /^H-([0-9]+)$/iu.exec(value);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };

  return [...groups.values()].sort(
    (left, right) => milestoneNumber(left.code) - milestoneNumber(right.code),
  );
}

export interface ConfirmedManualMilestoneOption {
  code: string;
  title: string;
  description: string;
}

/*
 * POINT_6_MANUAL_PARENT_ASSIGNMENT_V4_7_6
 *
 * Toda Epic visible ofrece una raíz Hito canónica. AI_SUGGESTED conserva su
 * carácter de propuesta, pero puede organizar Punto 6 sin atribuir una
 * confirmación humana inexistente.
 */
export function confirmedManualMilestoneOptions(
  backlogValue: DocumentJsonValue | null | undefined,
): ConfirmedManualMilestoneOption[] {
  const backlog = recordValue(backlogValue);
  if (!backlog) return [];

  return recordList(backlog.epics).map((epic, index) => ({
    code: `H-${String(index + 1).padStart(3, "0")}`,
    title: stringValue(epic.title),
    description: stringValue(epic.description),
  }));
}

/*
 * POINT_7_INTEGRATED_EPIC_MILESTONE_VIEW_V4_7_7
 *
 * Cierre visual y de diagnóstico de la raíz común:
 * - Punto 6: Hito -> HU-F -> CA-F.
 * - Punto 7: Epic -> Feature -> HU-P -> Task.
 *
 * Epic/Hito comparten únicamente la raíz y la posición canónica.
 * HU-F y HU-P continúan siendo conceptos distintos.
 */
export interface CommonEpicMilestoneRootSummary {
  milestoneCode: string;
  epicCode: string;
  title: string;
  description: string;
  functionalStoryCount: number;
  featureCount: number;
  planningStoryCount: number;
  taskCount: number;
}

function integratedFunctionalStories(
  value: DocumentJsonValue | null | undefined,
): JsonRecord[] {
  const record = recordValue(value);
  return record ? recordList(record.functionalRequirements) : recordList(value);
}

function integratedTitleKey(value: DocumentJsonValue | undefined): string {
  return stringValue(value)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function commonEpicMilestoneRoots(
  requirementsValue: DocumentJsonValue | null | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
): CommonEpicMilestoneRootSummary[] {
  const backlog = recordValue(backlogValue);
  if (!backlog) return [];

  const functionalStories = integratedFunctionalStories(requirementsValue);

  return recordList(backlog.epics).map((epic, index) => {
    const milestoneCode = `H-${String(index + 1).padStart(3, "0")}`;
    const features = recordList(epic.features);
    const planningStories = features.flatMap((feature) =>
      recordList(feature.userStories),
    );
    const tasks = planningStories.flatMap((story) => recordList(story.tasks));

    const functionalStoryCount = functionalStories.filter((story) => {
      const status =
        stringValue(story.assignmentStatus).trim().toUpperCase() ||
        (stringValue(story.milestone).trim()
          ? "ASSIGNED"
          : "PENDING_ASSIGNMENT");

      return (
        status === "ASSIGNED" &&
        stringValue(story.milestone).trim().toUpperCase() === milestoneCode
      );
    }).length;

    return {
      milestoneCode,
      epicCode:
        stringValue(epic.code).trim() ||
        `EP-${String(index + 1).padStart(3, "0")}`,
      title: stringValue(epic.title),
      description: stringValue(epic.description),
      functionalStoryCount,
      featureCount: features.length,
      planningStoryCount: planningStories.length,
      taskCount: tasks.length,
    };
  });
}

function functionalMilestoneGroupsWithRoots(
  value: DocumentJsonValue | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
): FunctionalMilestoneGroup[] {
  const groups = functionalMilestoneGroups(value);
  const groupByCode = new Map(
    groups.map((group) => [group.code.trim().toUpperCase(), group] as const),
  );

  for (const root of commonEpicMilestoneRoots(value, backlogValue)) {
    const code = root.milestoneCode.trim().toUpperCase();
    const representedByLegacyGroup = groups.some(
      (group) =>
        integratedTitleKey(group.name) === integratedTitleKey(root.title),
    );
    if (groupByCode.has(code) || representedByLegacyGroup) continue;

    const group: FunctionalMilestoneGroup = {
      key: code,
      code: root.milestoneCode,
      name: root.title,
      description: root.description,
      stories: [],
    };
    groups.push(group);
    groupByCode.set(code, group);
  }

  return groups.sort((left, right) =>
    left.code.localeCompare(right.code, "es", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/*
 * POINT_7_INTEGRATED_VALIDATION_V4_7_7
 *
 * Diagnóstico cruzado sin reasignaciones automáticas:
 * - una HU-F asignada debe usar un Hito de la raíz canónica y su mismo título;
 * - una HU-F pendiente no puede conservar datos de Hito;
 * - un work item pendiente no puede existir simultáneamente dentro del árbol.
 */
export function integratedPoint6Point7Issues(
  requirementsValue: DocumentJsonValue | null | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
): string[] {
  const backlog = recordValue(backlogValue);
  if (!backlog) return [];

  const issues: string[] = [];
  const functionalStories = integratedFunctionalStories(requirementsValue);
  const roots = commonEpicMilestoneRoots(requirementsValue, backlogValue);
  const rootByMilestone = new Map(
    roots.map((root) => [root.milestoneCode, root] as const),
  );

  for (const story of functionalStories) {
    const code = displayText(stringValue(story.code)) || "HU-F sin código";
    const storyStatus =
      stringValue(story.assignmentStatus).trim().toUpperCase() ||
      (stringValue(story.milestone).trim() ? "ASSIGNED" : "PENDING_ASSIGNMENT");
    const milestone = stringValue(story.milestone).trim().toUpperCase();

    if (storyStatus === "PENDING_ASSIGNMENT") {
      if (
        milestone ||
        stringValue(story.functionality).trim() ||
        stringValue(story.milestoneDescription).trim()
      ) {
        issues.push(
          `${code}: PENDING_ASSIGNMENT no puede conservar datos de Hito.`,
        );
      }
      continue;
    }

    if (storyStatus !== "ASSIGNED") continue;

    const root = rootByMilestone.get(milestone);
    if (!root) {
      issues.push(
        `${code}: ${milestone || "Hito vacío"} no pertenece a la raíz Epic/Hito disponible.`,
      );
      continue;
    }

    if (
      integratedTitleKey(story.functionality) !== integratedTitleKey(root.title)
    ) {
      issues.push(
        `${code}: el nombre del Hito debe coincidir con ${root.epicCode} · ${root.title}.`,
      );
    }
  }

  const epics = recordList(backlog.epics);
  const features = epics.flatMap((epic) => recordList(epic.features));
  const planningStories = features.flatMap((feature) =>
    recordList(feature.userStories),
  );
  const tasks = planningStories.flatMap((story) => recordList(story.tasks));
  const canonicalCodes = new Set(
    [...features, ...planningStories, ...tasks]
      .map((item) => stringValue(item.code).trim().toUpperCase())
      .filter(Boolean),
  );

  const pendingRoot = recordValue(backlog.pendingAssignments);
  for (const [kind, label] of [
    ["features", "Feature"],
    ["userStories", "HU-P"],
    ["tasks", "Task"],
  ] as const) {
    for (const envelope of recordList(pendingRoot?.[kind])) {
      const item = recordValue(envelope.item);
      const code = stringValue(item?.code).trim().toUpperCase();
      if (code && canonicalCodes.has(code)) {
        issues.push(
          `${label} ${code}: no puede existir a la vez en el árbol y en PENDING_ASSIGNMENT.`,
        );
      }
    }
  }

  return [...new Set(issues)];
}

export function IntegratedPoint6Point7Panel({
  requirementsValue,
  backlogValue,
  collapsed = false,
}: {
  requirementsValue?: DocumentJsonValue | null;
  backlogValue?: DocumentJsonValue | null;
  collapsed?: boolean;
}) {
  const roots = commonEpicMilestoneRoots(requirementsValue, backlogValue);
  const issues = integratedPoint6Point7Issues(requirementsValue, backlogValue);

  if (roots.length === 0 && issues.length === 0) return null;

  const content = (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Raíz común Epic ↔ Hito</strong>
          <p>
            Cada Epic corresponde al Hito de la misma posición y título. En
            estructuras sugeridas la raíz sigue siendo propuesta por IA; HU-F y
            HU-P permanecen separadas y solo comparten esa raíz.
          </p>
        </div>
        <span>{roots.length} raíz(es)</span>
      </div>

      {roots.length > 0 ? (
        <div className="rq-document-disclosure-list">
          {roots.map((root) => (
            <article
              className="rq-document-detail-panel"
              key={`${root.milestoneCode}-${root.epicCode}`}
            >
              <strong>
                {root.milestoneCode} ↔ {root.epicCode}
              </strong>
              <p>{displayText(root.title)}</p>
              <small>
                {root.functionalStoryCount} HU-F · {root.featureCount} Feature ·{" "}
                {root.planningStoryCount} HU-P · {root.taskCount} Task
              </small>
            </article>
          ))}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="rq-document-validation">
          <strong>Validación integrada requiere revisión</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Integración Punto 6 ↔ Punto 7 consistente.</p>
      )}
    </section>
  );

  if (!collapsed) return content;

  return (
    <details className="rq-document-selected-structure">
      <summary>
        <span>
          <strong>Estructura seleccionada</strong>
          <small>Relación técnica Epic ↔ Hito</small>
        </span>
        <small>{roots.length} raíz(es)</small>
      </summary>
      <div className="rq-document-selected-structure__body">{content}</div>
    </details>
  );
}

export function assignPendingFunctionalStoryToMilestone(
  value: DocumentJsonValue | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
  storyCode: string,
  milestoneCode: string,
): DocumentJsonValue {
  const milestone = confirmedManualMilestoneOptions(backlogValue).find(
    (candidate) => candidate.code === milestoneCode.trim().toUpperCase(),
  );
  if (!milestone) return value ?? [];

  return recordList(value).map((story) => {
    if (
      stringValue(story.code).trim().toUpperCase() !==
        storyCode.trim().toUpperCase() ||
      !isPendingFunctionalStory(story)
    ) {
      return story;
    }

    return {
      ...story,
      assignmentStatus: "ASSIGNED",
      milestone: milestone.code,
      functionality: milestone.title,
      milestoneDescription: milestone.description || null,
      assignmentObservation: null,
    };
  });
}

function PendingFunctionalNeedsView({
  value,
}: {
  value: DocumentJsonValue | undefined;
}) {
  const needs = recordList(value);
  if (needs.length === 0) return null;

  return (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Necesidades funcionales pendientes de documentar</strong>

          <p>
            Evidencia conservada que todavía no tiene una HU-F completa. No se
            inventa COMO, QUIERO, PARA ni criterios de aceptación.
          </p>
        </div>

        <span>{needs.length} FN</span>
      </div>

      <div className="rq-document-disclosure-list">
        {needs.map((need, index) => (
          <EditorDisclosure
            description={stringValue(need.description)}
            key={stringValue(need.code) || index}
            meta="Pendiente de documentar"
            title={
              `${displayText(stringValue(need.code)) || `FN-${index + 1}`} · ` +
              displayText(stringValue(need.description))
            }
          >
            <div className="rq-document-detail-panel">
              <h4>Estado</h4>
              <p>Pendiente de documentar como HU-F</p>

              <h4>Motivo</h4>
              <HumanValue
                value={
                  need.reason ??
                  "La necesidad se conserva para documentación posterior."
                }
              />

              {stringList(need.sourceIds).length > 0 ? (
                <p>
                  Evidencia conservada: {stringList(need.sourceIds).length}{" "}
                  fuente(s).
                </p>
              ) : null}
            </div>
          </EditorDisclosure>
        ))}
      </div>
    </section>
  );
}

function FunctionalRequirementsByMilestoneView({
  value,
  pendingNeeds,
  backlogValue,
}: {
  value: DocumentJsonValue | undefined;
  pendingNeeds?: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const groups = functionalMilestoneGroupsWithRoots(value, backlogValue);
  const pending = pendingFunctionalStories(value);
  const pendingNeedCount = recordList(pendingNeeds).length;

  if (groups.length === 0 && pending.length === 0 && pendingNeedCount === 0) {
    return <EmptyValue>Sin requerimientos funcionales registrados.</EmptyValue>;
  }

  return (
    <div className="rq-requirement-milestones">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>6.1 · Requerimientos funcionales por Hito</strong>

          <p>
            Cada bloque reúne el título y la descripción del Hito con todas sus
            Historias de Usuario y criterios de aceptación.
          </p>
        </div>

        <span>{groups.length} hito(s)</span>
      </div>

      {groups.map((group, groupIndex) => (
        <details
          className="rq-requirement-milestone"
          id={`functional-milestone-${groupIndex}`}
          key={group.key}
          open={groupIndex === 0}
        >
          <summary>
            <span
              aria-label="Hito"
              className="rq-work-item-icon rq-work-item-icon--milestone"
              role="img"
            >
              ♛
            </span>
            <span className="rq-requirement-milestone__identity">
              <span className="rq-requirement-milestone__kind">HITO</span>
              <strong>{displayText(group.code) || "Sin código"}</strong>
            </span>

            <span className="rq-requirement-milestone__title">
              <strong>{displayText(group.name)}</strong>
              <small>
                {displayText(group.description || "Sin descripción definida")}
              </small>
            </span>

            <span className="rq-requirement-milestone__count">
              {group.stories.length} HU
            </span>
          </summary>

          <div className="rq-requirement-milestone__body">
            <section className="rq-requirement-milestone__description">
              <h4>Descripción del hito</h4>

              <HumanValue value={group.description || PENDING} />
            </section>

            <section>
              <h4>Historias de usuario ({group.stories.length})</h4>

              {group.stories.length > 0 ? (
                <div className="rq-document-disclosure-list">
                  {group.stories.map(({ story, index }, storyPosition) => (
                    <article
                      className="rq-requirement-story-block"
                      key={stringValue(story.code) || index}
                    >
                      <EditorDisclosure
                        defaultOpen={groupIndex === 0 && storyPosition === 0}
                        description={functionalStoryDescriptionForDisplay(
                          story,
                        )}
                        id={`functional-story-${index}`}
                        leadingIcon="product-backlog-item"
                        meta={`${recordList(story.acceptanceCriteria).length} CA · ${recordList(story.fields).length} campos`}
                        title={
                          `${
                            displayText(stringValue(story.code)) ||
                            `HU-${index + 1}`
                          } · ` + displayText(stringValue(story.title))
                        }
                      >
                        <RequirementStoryDetail story={story} />
                      </EditorDisclosure>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyValue>
                  Hito confirmado sin Historias de Usuario documentadas.
                </EmptyValue>
              )}
            </section>
          </div>
        </details>
      ))}

      {pending.length > 0 ? (
        <section className="rq-requirement-milestone">
          <div className="rq-requirement-milestones__heading">
            <div>
              <strong>Historias de usuario pendientes por asignar</strong>

              <p>
                Historias funcionales completas y respaldadas que todavía no
                pueden ubicarse con seguridad en un Hito.
              </p>
            </div>

            <span>{pending.length} HU</span>
          </div>

          <div className="rq-document-disclosure-list">
            {pending.map(({ story, index }) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta="Pendiente por asignar"
                title={
                  `${
                    displayText(stringValue(story.code)) || `HU-${index + 1}`
                  } · ` + displayText(stringValue(story.title))
                }
              >
                <div className="rq-document-detail-panel">
                  <h4>Estado de asignación</h4>

                  <p>Pendiente por asignar</p>

                  <h4>Observación</h4>

                  <HumanValue
                    value={
                      story.assignmentObservation ??
                      "Pendiente de asignación estructural."
                    }
                  />

                  {stringList(story.functionalNeedCodes).length > 0 ? (
                    <>
                      <h4>Trazabilidad funcional</h4>
                      <Tags values={stringList(story.functionalNeedCodes)} />
                    </>
                  ) : null}

                  <RequirementStoryDetail story={story} />
                </div>
              </EditorDisclosure>
            ))}
          </div>
        </section>
      ) : null}

      <PendingFunctionalNeedsView value={pendingNeeds} />
    </div>
  );
}

function RequirementsTabsView({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const [active, setActive] = useState<RequirementsTab>("functional");
  const record = recordValue(value);
  if (!record) return <HumanValue value={value} />;
  return (
    <div className="rq-document-requirements-tabs-view">
      <RequirementsTabList active={active} onChange={setActive} />
      <section
        aria-labelledby="requirements-tab-functional"
        hidden={active !== "functional"}
        id="requirements-panel-functional"
        role="tabpanel"
      >
        <FunctionalRequirementsByMilestoneView
          backlogValue={backlogValue}
          pendingNeeds={record.pendingFunctionalNeeds}
          value={record.functionalRequirements}
        />
      </section>
      <section
        aria-labelledby="requirements-tab-nonFunctional"
        hidden={active !== "nonFunctional"}
        id="requirements-panel-nonFunctional"
        role="tabpanel"
      >
        <div className="rq-requirement-milestones">
          <div className="rq-requirement-milestones__heading">
            <div>
              <strong>6.2 · Requerimientos no funcionales</strong>
              <p>
                Condiciones de calidad, seguridad, rendimiento y operación que
                aplican de forma transversal a la solución.
              </p>
            </div>
            <span>
              {recordList(record.nonFunctionalRequirements).length} RNF
            </span>
          </div>
          <RequirementCards value={record.nonFunctionalRequirements} />
        </div>
      </section>
    </div>
  );
}

function backlogCounts(epics: readonly JsonRecord[]) {
  const features = epics.flatMap((epic) => recordList(epic.features));

  const stories = features.flatMap((feature) =>
    recordList(feature.userStories),
  );

  const tasks = stories.flatMap((story) => recordList(story.tasks));

  return {
    features,
    stories,
    tasks,
  };
}

function BacklogOverview({ epics }: { epics: readonly JsonRecord[] }) {
  const { features, stories, tasks } = backlogCounts(epics);

  const counters = [
    ["Epics", epics.length],
    ["Features", features.length],
    ["User Stories", stories.length],
    ["Tasks", tasks.length],
  ] as const;

  return (
    <div aria-label="Resumen del esquema" className="rq-backlog-overview">
      {counters.map(([label, count]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{count}</strong>
        </article>
      ))}
    </div>
  );
}

type BacklogViewTab = "tree" | "structure";

type BacklogTreeGrouping = "epics" | "sprints" | "stories";

/*
 * PUNTO_7_TWO_VIEW_TABS
 *
 * Vista normal:
 * - Árbol del proyecto: lectura ejecutiva compacta.
 * - Estructura: detalle jerárquico completo.
 *
 * El editor mantiene su implementación independiente.
 */
function _BacklogViewTabs({
  active,
  onChange,
}: {
  active: BacklogViewTab;
  onChange: (tab: BacklogViewTab) => void;
}) {
  const tabs = [
    ["tree", "Árbol del proyecto"],
    ["structure", "Estructura"],
  ] as const;

  return (
    <div
      aria-label="Vistas del esquema"
      className="rq-backlog-view-tabs"
      role="tablist"
    >
      {tabs.map(([key, label]) => (
        <button
          aria-controls={`backlog-panel-${key}`}
          aria-selected={active === key}
          id={`backlog-tab-${key}`}
          key={key}
          onClick={() => onChange(key)}
          role="tab"
          tabIndex={active === key ? 0 : -1}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BacklogVisualTree({ epics }: { epics: readonly JsonRecord[] }) {
  const nodeContent = (
    item: JsonRecord,
    kind: "Epic" | "Feature" | "User Story" | "Task",
  ) => (
    <>
      <BacklogWorkItemIcon
        kind={
          kind === "Epic"
            ? "epic"
            : kind === "Feature"
              ? "feature"
              : kind === "User Story"
                ? "product-backlog-item"
                : "task"
        }
      />
      <span className="rq-backlog-source-number">
        {displayText(stringValue(item.sourceNumber))}
      </span>
      <span className="rq-backlog-kind">{kind}</span>
      <div className="rq-backlog-visual-node__content">
        <strong>{displayText(stringValue(item.title))}</strong>
        <p>{displayText(stringValue(item.description))}</p>
      </div>
      <small>{displayText(stringValue(item.code))}</small>
    </>
  );
  return (
    <div className="rq-backlog-visual-tree">
      {epics.map((epic, epicIndex) => (
        <details
          className="rq-backlog-visual-tree__epic"
          key={stringValue(epic.code) || epicIndex}
          open={epicIndex === 0}
        >
          <summary className="rq-backlog-visual-node rq-backlog-visual-node--epic">
            {nodeContent(epic, "Epic")}
          </summary>

          <div className="rq-backlog-visual-children">
            {recordList(epic.features).map((feature, featureIndex) => (
              <details
                className="rq-backlog-visual-branch"
                key={stringValue(feature.code) || featureIndex}
                open
              >
                <summary className="rq-backlog-visual-node rq-backlog-visual-node--feature">
                  {nodeContent(feature, "Feature")}
                </summary>

                <div className="rq-backlog-visual-children">
                  {recordList(feature.userStories).map((story, storyIndex) => (
                    <details
                      className="rq-backlog-visual-branch"
                      key={stringValue(story.code) || storyIndex}
                      open
                    >
                      <summary className="rq-backlog-visual-node rq-backlog-visual-node--story">
                        {nodeContent(story, "User Story")}
                      </summary>

                      {recordList(story.tasks).length > 0 ? (
                        <div className="rq-backlog-visual-children rq-backlog-visual-children--tasks">
                          {recordList(story.tasks).map((task, taskIndex) => (
                            <div
                              className="rq-backlog-visual-branch"
                              key={stringValue(task.code) || taskIndex}
                            >
                              <div className="rq-backlog-visual-node rq-backlog-visual-node--task">
                                {nodeContent(task, "Task")}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function _BacklogGroupedTree({
  epics,
  grouping,
  scrumValue,
}: {
  epics: readonly JsonRecord[];
  grouping: Exclude<BacklogTreeGrouping, "epics">;
  scrumValue?: DocumentJsonValue | null;
}) {
  const features = epics.flatMap((epic) =>
    recordList(epic.features).map((feature) => ({ epic, feature })),
  );
  const stories = features.flatMap(({ epic, feature }) =>
    recordList(feature.userStories).map((story) => ({ epic, feature, story })),
  );
  type StoryEntry = (typeof stories)[number];
  const storyByCode = new Map(
    stories.map((entry) => [stringValue(entry.story.code), entry]),
  );

  const storyCard = (entry: StoryEntry, index: number) => (
    <article
      className="rq-backlog-grouped-story"
      key={stringValue(entry.story.code) || index}
    >
      <BacklogWorkItemIcon kind="product-backlog-item" />
      <span className="rq-backlog-source-number">
        {displayText(stringValue(entry.story.sourceNumber))}
      </span>
      <div>
        <strong>
          {displayText(stringValue(entry.story.code))} ·{" "}
          {displayText(stringValue(entry.story.title))}
        </strong>
        <small>
          {displayText(stringValue(entry.epic.code))} →{" "}
          {displayText(stringValue(entry.feature.code))} ·{" "}
          {recordList(entry.story.tasks).length} Task
        </small>
      </div>
    </article>
  );

  if (grouping === "stories") {
    return (
      <div className="rq-backlog-grouped-view">
        <header>
          <div>
            <strong>Historias de usuario</strong>
            <p>Vista directa con la Epic y Feature de origen.</p>
          </div>
          <span>{stories.length} HU</span>
        </header>
        <div className="rq-backlog-grouped-list">{stories.map(storyCard)}</div>
      </div>
    );
  }

  const scrum = recordValue(scrumValue);
  const sprints = recordList(scrum?.sprints);

  return (
    <div className="rq-backlog-grouped-view">
      <header>
        <div>
          <strong>Sprints</strong>
          <p>Historias organizadas según el plan de trabajo del documento.</p>
        </div>
        <span>{sprints.length} sprint(s)</span>
      </header>
      {sprints.length === 0 ? (
        <EmptyValue>Sin sprints definidos en el plan de trabajo.</EmptyValue>
      ) : (
        <div className="rq-backlog-sprint-groups">
          {sprints.map((sprint, sprintIndex) => {
            const number = numberValue(sprint.number) ?? sprintIndex + 1;
            const sprintStories = stringList(sprint.userStoryCodes)
              .map((code) => storyByCode.get(code))
              .filter((entry): entry is StoryEntry => Boolean(entry));
            return (
              <details
                className="rq-backlog-sprint-group"
                key={`${stringValue(sprint.code)}-${sprintIndex}`}
                open={sprintIndex === 0}
              >
                <summary>
                  <span className="rq-backlog-sprint-number">{number}</span>
                  <span>
                    <strong>Sprint {number}</strong>
                    <small>{displayText(stringValue(sprint.objective))}</small>
                  </span>
                  <strong>{sprintStories.length} HU</strong>
                </summary>
                <div className="rq-backlog-grouped-list">
                  {sprintStories.length > 0 ? (
                    sprintStories.map(storyCard)
                  ) : (
                    <EmptyValue>
                      Sin historias asociadas a este sprint.
                    </EmptyValue>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Conservadas únicamente como compatibilidad interna para versiones históricas;
// la vista activa del Punto 7 presenta solo el esquema detallado.
void [_BacklogViewTabs, _BacklogGroupedTree, BacklogStructureDetail];

function BacklogStructureDetail({ epics }: { epics: readonly JsonRecord[] }) {
  /*
   * PUNTO_7_STRUCTURE_TITLE_DESCRIPTION
   *
   * La estructura presenta únicamente:
   * - tipo
   * - código
   * - título
   * - descripción
   *
   * COMO / QUIERO / PARA, contexto, campos y criterios
   * pertenecen al Punto 6 y no se duplican aquí.
   */
  return (
    <div className="rq-backlog-tree rq-backlog-tree--detail">
      {epics.map((epic, epicIndex) => (
        <details
          className="rq-backlog-epic"
          key={stringValue(epic.code) || epicIndex}
          open={epicIndex === 0}
        >
          <summary>
            <BacklogWorkItemIcon kind="epic" />
            <span className="rq-backlog-source-number">
              {displayText(stringValue(epic.sourceNumber))}
            </span>
            <span className="rq-backlog-kind">EPIC</span>

            <strong>{displayText(stringValue(epic.code))}</strong>

            <span>{displayText(stringValue(epic.title))}</span>
          </summary>

          <div className="rq-backlog-node-body">
            <div className="rq-backlog-description">
              <strong>Descripción</strong>

              <HumanValue value={epic.description ?? ""} />
            </div>

            <div className="rq-backlog-detail-list">
              {recordList(epic.features).map((feature, featureIndex) => (
                <details
                  className="rq-backlog-feature"
                  key={stringValue(feature.code) || featureIndex}
                >
                  <summary>
                    <BacklogWorkItemIcon kind="feature" />
                    <span className="rq-backlog-source-number">
                      {displayText(stringValue(feature.sourceNumber))}
                    </span>
                    <span className="rq-backlog-kind">FEATURE</span>

                    <strong>{displayText(stringValue(feature.code))}</strong>

                    <span>{displayText(stringValue(feature.title))}</span>
                  </summary>

                  <div className="rq-backlog-node-body">
                    <div className="rq-backlog-description">
                      <strong>Descripción</strong>

                      <HumanValue value={feature.description ?? ""} />
                    </div>

                    <div className="rq-backlog-detail-list">
                      {recordList(feature.userStories).map(
                        (story, storyIndex) => (
                          <details
                            className="rq-backlog-story"
                            key={stringValue(story.code) || storyIndex}
                          >
                            <summary>
                              <BacklogWorkItemIcon kind="product-backlog-item" />
                              <span className="rq-backlog-source-number">
                                {displayText(stringValue(story.sourceNumber))}
                              </span>
                              <span className="rq-backlog-kind">HU</span>

                              <strong>
                                {displayText(stringValue(story.code))}
                              </strong>

                              <span>
                                {displayText(stringValue(story.title))}
                              </span>
                            </summary>

                            <div className="rq-backlog-node-body">
                              <div className="rq-backlog-description">
                                <strong>Descripción</strong>

                                <HumanValue value={story.description ?? ""} />
                              </div>

                              <div className="rq-backlog-task-structure">
                                {recordList(story.tasks).length === 0 ? (
                                  <EmptyValue>Sin tareas definidas.</EmptyValue>
                                ) : (
                                  recordList(story.tasks).map(
                                    (task, taskIndex) => (
                                      <details
                                        className="rq-backlog-task-detail"
                                        key={
                                          stringValue(task.code) || taskIndex
                                        }
                                      >
                                        <summary>
                                          <BacklogWorkItemIcon kind="task" />
                                          <span className="rq-backlog-source-number">
                                            {displayText(
                                              stringValue(task.sourceNumber),
                                            )}
                                          </span>
                                          <span className="rq-backlog-kind">
                                            TASK
                                          </span>

                                          <strong>
                                            {displayText(
                                              stringValue(task.code),
                                            )}
                                          </strong>

                                          <span>
                                            {displayText(
                                              stringValue(task.title),
                                            )}
                                          </span>
                                        </summary>

                                        <div className="rq-backlog-description">
                                          <strong>Descripción</strong>

                                          <HumanValue
                                            value={task.description ?? ""}
                                          />
                                        </div>
                                      </details>
                                    ),
                                  )
                                )}
                              </div>
                            </div>
                          </details>
                        ),
                      )}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

/*
 * POINT_5_PENDING_PLANNING_ASSIGNMENTS_V4_7_5
 *
 * Los work items sin padre inequívoco se muestran debajo del árbol. En este
 * punto son de solo consulta estructural; crear/asignar padres se implementa
 * en el Punto 6 sin ocultarlos ni forzar una relación automática.
 */
/** Lista de elementos pendientes por asignar. Va fuera del componente para no remontarse en cada render. */
const PendingItems = ({
  assignments,
  kind,
}: {
  assignments: readonly JsonRecord[];
  kind: "Feature" | "HU-P" | "Task";
}) => (
  <div className="rq-document-disclosure-list">
    {assignments.map((assignment, index) => {
      const item = recordValue(assignment.item) ?? {};
      const code = stringValue(item.code);
      const childCount =
        kind === "Feature"
          ? recordList(item.userStories).length
          : kind === "HU-P"
            ? recordList(item.tasks).length
            : 0;

      return (
        <EditorDisclosure
          description={stringValue(item.title)}
          key={code || `${kind}-${index}`}
          meta="Pendiente por asignar"
          title={
            `${kind} ${displayText(code) || index + 1} · ` +
            displayText(stringValue(item.title))
          }
        >
          <div className="rq-document-detail-panel">
            <h4>Estado</h4>
            <p>Pendiente por asignar</p>

            <h4>Descripción</h4>
            <HumanValue value={item.description ?? ""} />

            <h4>Motivo</h4>
            <HumanValue
              value={
                assignment.assignmentObservation ??
                "No existe un padre inequívoco en la evidencia."
              }
            />

            <h4>Ruta de origen conocida</h4>
            <HumanValue
              value={
                stringValue(assignment.sourceParentPath) ||
                "Padre no identificado"
              }
            />

            {childCount > 0 ? (
              <p>
                Se conservan {childCount} descendiente(s) cuyo padre inmediato
                sí es conocido.
              </p>
            ) : null}
          </div>
        </EditorDisclosure>
      );
    })}
  </div>
);

function PendingPlanningAssignmentsView({
  value,
}: {
  value: DocumentJsonValue;
}) {
  const root = recordValue(value);
  const pending = recordValue(root?.pendingAssignments);
  const featureAssignments = recordList(pending?.features);
  const storyAssignments = recordList(pending?.userStories);
  const taskAssignments = recordList(pending?.tasks);
  const total =
    featureAssignments.length +
    storyAssignments.length +
    taskAssignments.length;

  if (total === 0) return null;

  return (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Elementos de planificación pendientes por asignar</strong>
          <p>
            Se conservan fuera del árbol hasta que una persona defina su padre.
            No se crean Epic, Feature o HU-P artificiales para acomodarlos.
          </p>
        </div>
        <span>{total} pendiente(s)</span>
      </div>

      {featureAssignments.length > 0 ? (
        <div className="rq-backlog-pending-group">
          <h4>Features sin Epic ({featureAssignments.length})</h4>
          <PendingItems assignments={featureAssignments} kind="Feature" />
        </div>
      ) : null}

      {storyAssignments.length > 0 ? (
        <div className="rq-backlog-pending-group">
          <h4>HU-P sin Feature ({storyAssignments.length})</h4>
          <PendingItems assignments={storyAssignments} kind="HU-P" />
        </div>
      ) : null}

      {taskAssignments.length > 0 ? (
        <div className="rq-backlog-pending-group">
          <h4>Tasks sin HU-P ({taskAssignments.length})</h4>
          <PendingItems assignments={taskAssignments} kind="Task" />
        </div>
      ) : null}
    </section>
  );
}

function PendingPlanningAssignmentsEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const root = recordValue(value) ?? { epics: [] };
  const pending = planningPendingRecord(root);
  const epics = recordList(root.epics);
  const features = epics.flatMap((epic) => recordList(epic.features));
  const stories = features.flatMap((feature) =>
    recordList(feature.userStories),
  );

  const epicOptions = epics.map((epic) => ({
    value: stringValue(epic.code),
    label:
      `${displayText(stringValue(epic.code))} · ` +
      displayText(stringValue(epic.title)),
  }));
  const featureOptions = features.map((feature) => ({
    value: stringValue(feature.code),
    label:
      `${displayText(stringValue(feature.code))} · ` +
      displayText(stringValue(feature.title)),
  }));
  const storyOptions = stories.map((story) => ({
    value: stringValue(story.code),
    label:
      `${displayText(stringValue(story.code))} · ` +
      displayText(stringValue(story.title)),
  }));

  const groups: Array<{
    kind: PendingPlanningAssignmentKind;
    label: string;
    singular: string;
    parentLabel: string;
    parentOptions: Array<{ value: string; label: string }>;
    newParentLabel: string;
    containerLabel: string;
    containerOptions: Array<{ value: string; label: string }>;
  }> = [
    {
      kind: "features",
      label: "Features sin Epic",
      singular: "Feature",
      parentLabel: "Epic existente",
      parentOptions: epicOptions,
      newParentLabel: "Nombre de la nueva Epic",
      containerLabel: "",
      containerOptions: [],
    },
    {
      kind: "userStories",
      label: "HU-P sin Feature",
      singular: "HU-P",
      parentLabel: "Feature existente",
      parentOptions: featureOptions,
      newParentLabel: "Nombre de la nueva Feature",
      containerLabel: "Epic para la nueva Feature",
      containerOptions: epicOptions,
    },
    {
      kind: "tasks",
      label: "Tasks sin HU-P",
      singular: "Task",
      parentLabel: "HU-P existente",
      parentOptions: storyOptions,
      newParentLabel: "Nombre de la nueva HU-P",
      containerLabel: "Feature para la nueva HU-P",
      containerOptions: featureOptions,
    },
  ];

  const total = groups.reduce(
    (sum, group) => sum + recordList(pending[group.kind]).length,
    0,
  );
  if (total === 0) return null;

  return (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Elementos de planificación pendientes por asignar</strong>
          <p>
            La asignación solo ocurre cuando una persona selecciona el padre.
            También puedes crear el padre inmediato y ubicar el work item en una
            sola operación.
          </p>
        </div>
        <span>{total} pendiente(s)</span>
      </div>

      {groups.map((group) => {
        const assignments = recordList(pending[group.kind]);
        if (assignments.length === 0) return null;

        return (
          <div className="rq-backlog-pending-group" key={group.kind}>
            <h4>
              {group.label} ({assignments.length})
            </h4>

            <div className="rq-document-disclosure-list">
              {assignments.map((assignment, index) => {
                const item = recordValue(assignment.item) ?? {};
                const code = stringValue(item.code);

                return (
                  <EditorDisclosure
                    description={stringValue(item.title)}
                    key={code || `${group.kind}-${index}`}
                    meta="Pendiente por asignar"
                    title={
                      `${group.singular} ${displayText(code) || index + 1} · ` +
                      displayText(stringValue(item.title))
                    }
                  >
                    <div className="rq-requirement-milestone-editor">
                      <HumanValue
                        label="Motivo"
                        value={
                          assignment.assignmentObservation ??
                          "No existe un padre inequívoco en la evidencia."
                        }
                      />

                      {!readOnly && group.parentOptions.length > 0 ? (
                        <form
                          className="rq-document-business-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            const parentCode = String(
                              data.get("parentCode") ?? "",
                            );
                            onChange(
                              assignPendingPlanningItem(
                                value,
                                group.kind,
                                index,
                                parentCode,
                              ),
                            );
                          }}
                        >
                          <label className="rq-document-business-field">
                            <span>{group.parentLabel}</span>
                            <select defaultValue="" name="parentCode" required>
                              <option disabled value="">
                                Selecciona el padre
                              </option>
                              {group.parentOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            className="rq-document-add-item"
                            type="submit"
                          >
                            Asignar a padre existente
                          </button>
                        </form>
                      ) : null}

                      {!readOnly &&
                      (group.kind === "features" ||
                        group.containerOptions.length > 0) ? (
                        <form
                          className="rq-document-business-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            const parentTitle = String(
                              data.get("parentTitle") ?? "",
                            );
                            const containerCode = String(
                              data.get("containerCode") ?? "",
                            );

                            onChange(
                              createParentForPendingPlanningItem(
                                value,
                                group.kind,
                                index,
                                containerCode || null,
                                parentTitle,
                              ),
                            );
                          }}
                        >
                          {group.kind !== "features" ? (
                            <label className="rq-document-business-field">
                              <span>{group.containerLabel}</span>
                              <select
                                defaultValue=""
                                name="containerCode"
                                required
                              >
                                <option disabled value="">
                                  Selecciona dónde crear el padre
                                </option>
                                {group.containerOptions.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}

                          <label className="rq-document-business-field">
                            <span>{group.newParentLabel}</span>
                            <input
                              maxLength={300}
                              minLength={2}
                              name="parentTitle"
                              required
                            />
                          </label>

                          <button
                            className="rq-document-add-item"
                            type="submit"
                          >
                            Crear padre y asignar
                          </button>
                        </form>
                      ) : null}

                      {!readOnly &&
                      group.kind !== "features" &&
                      group.containerOptions.length === 0 ? (
                        <p className="rq-document-prose">
                          Primero crea el nivel superior necesario en el árbol.
                        </p>
                      ) : null}
                    </div>
                  </EditorDisclosure>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function BacklogStructureView({ value }: { value: DocumentJsonValue }) {
  const structureRef = useRef<HTMLDivElement>(null);
  const root = recordValue(value);
  const epics = recordList(root?.epics);
  const structureStatus = stringValue(root?.structureStatus)
    .trim()
    .toUpperCase();
  const suggested = structureStatus === "AI_SUGGESTED";
  const pendingRoot = recordValue(root?.pendingAssignments);
  const pendingAssignmentCount =
    recordList(pendingRoot?.features).length +
    recordList(pendingRoot?.userStories).length +
    recordList(pendingRoot?.tasks).length;

  if (epics.length === 0 && pendingAssignmentCount === 0) {
    return <EmptyValue>Sin elementos en el esquema.</EmptyValue>;
  }

  return (
    <div className="rq-backlog-workspace">
      <BacklogOverview epics={epics} />

      <div className="rq-backlog-purpose">
        <strong>
          {suggested ? "Estructura sugerida por IA" : "Esquema del proyecto"}
        </strong>

        <p>
          {suggested
            ? "Propuesta no confirmada por una persona. Sus Epic organizan el Punto 6 como Hitos sugeridos por posición y mantienen la trazabilidad 1:1 entre HU-P y HU-F."
            : "Jerarquía confirmada preparada para Azure DevOps con número de origen, tipo de work item, concepto, descripción y código técnico único."}
        </p>

        {suggested ? (
          <p>
            Hitos sugeridos:{" "}
            {epics
              .map(
                (epic, index) =>
                  `H-${String(index + 1).padStart(3, "0")} · ${displayText(stringValue(epic.title))}`,
              )
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <section className="rq-backlog-view-panel" ref={structureRef}>
        <div className="rq-backlog-structure-heading rq-backlog-structure-heading--actions">
          <div>
            <strong>Estructura detallada</strong>

            <p>
              Epic → Feature → Historia de usuario → Tarea, con sus
              descripciones.
            </p>
          </div>
          <div className="rq-backlog-expand-actions">
            <button
              onClick={() =>
                structureRef.current
                  ?.querySelectorAll("details")
                  .forEach((item) => {
                    item.open = true;
                  })
              }
              type="button"
            >
              Expandir todo
            </button>
            <button
              onClick={() =>
                structureRef.current
                  ?.querySelectorAll("details")
                  .forEach((item) => {
                    item.open = false;
                  })
              }
              type="button"
            >
              Comprimir todo
            </button>
          </div>
        </div>

        <BacklogVisualTree epics={epics} />
      </section>

      <PendingPlanningAssignmentsView value={value} />
    </div>
  );
}

function RequirementsView({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const record = recordValue(value);
  if (!record) return <HumanValue label="Funcionalidad" value={value} />;
  if (
    "functionalRequirements" in record ||
    "nonFunctionalRequirements" in record
  ) {
    return <RequirementsTabsView backlogValue={backlogValue} value={value} />;
  }
  const features = recordList(record.features);
  const stories = recordList(record.userStories);
  return (
    <div className="rq-document-requirements-view">
      <div className="rq-requirements-dual-column">
        <section>
          <h3>Funcionalidades ({features.length})</h3>
          {features.length === 0 ? <EmptyValue /> : null}
          <div className="rq-document-master-list">
            {features.map((feature, index) => (
              <EditorDisclosure
                description={stringValue(feature.title)}
                key={stringValue(feature.code) || index}
                meta={featureContextMeta(feature)}
                title={
                  displayText(stringValue(feature.code)) ||
                  `Funcionalidad ${index + 1}`
                }
              >
                <div className="rq-document-detail-panel">
                  <h4>Objetivo</h4>
                  <HumanValue value={feature.objective ?? ""} />
                  <h4>Descripción</h4>
                  <HumanValue value={feature.description ?? ""} />
                  <h4>Incluye</h4>
                  <TextList items={stringList(feature.inScope)} />
                  <h4>Fuera de alcance</h4>
                  <TextList
                    empty="Sin exclusiones explícitamente definidas."
                    items={stringList(feature.outOfScope)}
                  />
                  <h4>Historias relacionadas</h4>
                  <Tags values={stringList(feature.userStoryCodes)} />
                </div>
              </EditorDisclosure>
            ))}
          </div>
        </section>
        <section>
          <h3>Historias de usuario ({stories.length})</h3>
          {stories.length === 0 ? <EmptyValue /> : null}
          <div className="rq-document-master-list">
            {stories.map((story, index) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta={storyContextMeta(story)}
                title={
                  displayText(stringValue(story.code)) || `HU ${index + 1}`
                }
              >
                <RequirementStoryDetail story={story} />
              </EditorDisclosure>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function RequirementStoryDetail({ story }: { story: JsonRecord }) {
  const pendingDocumentation =
    stringValue(story.documentationStatus).trim().toUpperCase() ===
    "PENDING_DOCUMENTATION";

  return (
    <div className="rq-document-detail-panel rq-requirement-story-detail">
      {pendingDocumentation ? (
        <div className="rq-document-callout rq-document-callout-warning">
          <strong>Estado documental: Pendiente de documentación</strong>
          <p>{displayText(stringValue(story.documentationObservation))}</p>
        </div>
      ) : null}

      <section className="rq-requirement-story-detail__narrative">
        <div>
          <h4>Descripción funcional breve</h4>
          <HumanValue value={functionalStoryDescriptionForDisplay(story)} />
        </div>
        <div>
          <h4>Historia de usuario</h4>
          <blockquote>
            <strong>Como</strong> {displayText(stringValue(story.role))}
            <br />
            <strong>Quiero</strong> {displayText(stringValue(story.want))}
            <br />
            <strong>Para</strong> {displayText(stringValue(story.benefit))}
          </blockquote>
        </div>
      </section>

      <section className="rq-requirement-story-detail__context">
        <div>
          <h4>Contexto</h4>
          <HumanValue value={story.context ?? ""} />
        </div>
        <div>
          <h4>Premisas</h4>
          <Tags values={stringList(story.premises)} />
        </div>
        <div>
          <h4>Sistemas impactados</h4>
          <Tags values={stringList(story.impactedSystems)} />
        </div>
      </section>

      <section className="rq-requirement-story-detail__full">
        <h4>Campos</h4>
        <StoryFieldsTable value={story.fields} />
      </section>

      <section className="rq-requirement-story-detail__full">
        <h4>Criterios de aceptación</h4>
        {pendingDocumentation &&
        recordList(story.acceptanceCriteria).length === 0 ? (
          <p>Pendientes de documentación.</p>
        ) : (
          <AcceptanceCriteriaView
            storyCode={stringValue(story.code)}
            value={story.acceptanceCriteria}
          />
        )}
      </section>
    </div>
  );
}

function FeatureEditor({
  feature,
  storyOptions,
  readOnly,
  onChange,
}: {
  feature: JsonRecord;
  storyOptions: readonly { value: string; label: string }[];
  readOnly: boolean;
  onChange: (feature: JsonRecord) => void;
}) {
  const set = (key: string, value: DocumentJsonValue) =>
    onChange({ ...feature, [key]: value });
  return (
    <div className="rq-document-business-grid">
      <TextField
        label="Código"
        multiline={false}
        onChange={(value) => set("code", value)}
        readOnly={readOnly}
        value={stringValue(feature.code)}
      />
      <TextField
        label="Nombre"
        multiline={false}
        onChange={(value) => set("title", value)}
        readOnly={readOnly}
        value={stringValue(feature.title)}
      />
      <TextField
        label="Objetivo"
        onChange={(value) => set("objective", value)}
        readOnly={readOnly}
        value={stringValue(feature.objective)}
      />
      <TextField
        label="Descripción"
        onChange={(value) => set("description", value)}
        readOnly={readOnly}
        value={stringValue(feature.description)}
      />
      <StringListEditor
        label="Incluye"
        onChange={(value) => set("inScope", value)}
        readOnly={readOnly}
        value={stringList(feature.inScope)}
      />
      <StringListEditor
        emptyLabel="Sin exclusiones explícitamente definidas."
        label="Fuera de alcance"
        onChange={(value) => set("outOfScope", value)}
        readOnly={readOnly}
        value={stringList(feature.outOfScope)}
      />
      <ReferenceListEditor
        label="Historias relacionadas"
        onChange={(value) => set("userStoryCodes", value)}
        options={storyOptions}
        readOnly={readOnly}
        value={stringList(feature.userStoryCodes)}
      />
    </div>
  );
}

function StoryEditor({
  story,
  featureOptions,
  readOnly,
  lockStructure = false,
  onChange,
}: {
  story: JsonRecord;
  featureOptions: readonly { value: string; label: string }[];
  readOnly: boolean;
  lockStructure?: boolean;
  onChange: (story: JsonRecord) => void;
}) {
  const set = (key: string, value: DocumentJsonValue) =>
    onChange({ ...story, [key]: value });
  const fields = recordList(story.fields);
  const criteria = normalizeStoryAcceptanceCriteria(
    story.acceptanceCriteria,
    stringValue(story.code),
  );
  const pendingDocumentation =
    stringValue(story.documentationStatus).trim().toUpperCase() ===
    "PENDING_DOCUMENTATION";
  return (
    <div>
      {pendingDocumentation ? (
        <div className="rq-document-callout rq-document-callout-warning">
          <strong>Estado documental: Pendiente de documentación</strong>
          <p>{displayText(stringValue(story.documentationObservation))}</p>
        </div>
      ) : null}
      <div className="rq-document-business-grid">
        {[
          "code",
          "title",
          "description",
          "role",
          "want",
          "benefit",
          "context",
        ].map((key) => (
          <TextField
            key={key}
            label={humanLabel(key)}
            multiline={!["code", "featureCode", "title"].includes(key)}
            onChange={(value) => set(key, value)}
            readOnly={readOnly || (lockStructure && key === "code")}
            value={stringValue(story[key])}
          />
        ))}
        {!lockStructure ? (
          <label className="rq-document-business-field">
            <span>Funcionalidad relacionada</span>
            <select
              disabled={readOnly}
              onChange={(event) => set("featureCode", event.target.value)}
              value={stringValue(story.featureCode)}
            >
              <option value="">Seleccionar…</option>
              {featureOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <StringListEditor
          label="Premisas"
          onChange={(value) => set("premises", value)}
          readOnly={readOnly}
          value={stringList(story.premises)}
        />
        <StringListEditor
          label="Sistemas impactados"
          onChange={(value) => set("impactedSystems", value)}
          readOnly={readOnly}
          value={stringList(story.impactedSystems)}
        />
      </div>
      <fieldset className="rq-document-business-list">
        <legend>Campos ({fields.length})</legend>
        {fields.map((field, index) => (
          <EditorDisclosure
            description={stringValue(field.dataType)}
            key={index}
            onDelete={
              readOnly
                ? undefined
                : () =>
                    set(
                      "fields",
                      fields.filter((_, itemIndex) => itemIndex !== index),
                    )
            }
            title={displayText(stringValue(field.name)) || `Campo ${index + 1}`}
          >
            <TextField
              label="Nombre"
              multiline={false}
              onChange={(value) =>
                set(
                  "fields",
                  fields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: value } : item,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(field.name)}
            />
            <TextField
              label="Tipo de dato"
              multiline={false}
              onChange={(value) =>
                set(
                  "fields",
                  fields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, dataType: value } : item,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(field.dataType)}
            />
            <label className="rq-document-business-check">
              <input
                checked={field.required === true}
                disabled={readOnly}
                onChange={(event) =>
                  set(
                    "fields",
                    fields.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, required: event.target.checked }
                        : item,
                    ),
                  )
                }
                type="checkbox"
              />
              <span>Obligatorio</span>
            </label>
            <TextField
              label="Validación"
              onChange={(value) =>
                set(
                  "fields",
                  fields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, validation: value } : item,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(field.validation)}
            />
          </EditorDisclosure>
        ))}
        {!readOnly ? (
          <button
            className="rq-document-add-item"
            onClick={() =>
              set("fields", [
                ...fields,
                {
                  name: PENDING,
                  dataType: PENDING,
                  required: false,
                  validation: PENDING,
                  sourceIds: [],
                },
              ])
            }
            type="button"
          >
            Agregar campo
          </button>
        ) : null}
      </fieldset>
      <fieldset className="rq-document-business-list">
        <legend>Criterios de aceptación ({criteria.length})</legend>
        {pendingDocumentation && criteria.length === 0 ? (
          <p>Pendientes de documentación.</p>
        ) : null}
        {criteria.map((criterion, index) => (
          <EditorDisclosure
            description={stringValue(criterion.given)}
            key={index}
            onDelete={
              readOnly
                ? undefined
                : () =>
                    set(
                      "acceptanceCriteria",
                      criteria.filter((_, itemIndex) => itemIndex !== index),
                    )
            }
            title={
              displayText(stringValue(criterion.code)) ||
              `Criterio ${index + 1}`
            }
          >
            {["code", "given", "when", "then"].map((key) => (
              <TextField
                key={key}
                label={humanLabel(key)}
                multiline={key !== "code"}
                onChange={(value) =>
                  set(
                    "acceptanceCriteria",
                    criteria.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [key]: value } : item,
                    ),
                  )
                }
                readOnly={readOnly}
                value={stringValue(criterion[key])}
              />
            ))}
          </EditorDisclosure>
        ))}
        {!readOnly ? (
          <button
            className="rq-document-add-item"
            onClick={() =>
              set("acceptanceCriteria", [
                ...criteria,
                {
                  code: `CA-${stringValue(story.code).replace(/^HU-/u, "") || "HU"}-${String(criteria.length + 1).padStart(3, "0")}`,
                  given: PENDING,
                  when: PENDING,
                  then: PENDING,
                  sourceIds: [],
                },
              ])
            }
            type="button"
          >
            Agregar criterio
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}

function RequirementsEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: BusinessEditorProps & {
  backlogValue?: DocumentJsonValue | null;
}) {
  const record = recordValue(value);
  if (!record)
    return (
      <SafeValueEditor
        label="Requerimientos"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  if (
    "functionalRequirements" in record ||
    "nonFunctionalRequirements" in record
  ) {
    return (
      <RequirementsTabsEditor
        backlogValue={backlogValue}
        onChange={onChange}
        readOnly={readOnly}
        value={record}
      />
    );
  }
  const features = recordList(record.features);
  const stories = recordList(record.userStories);
  const featureOptions = features.map((feature, index) => ({
    value: stringValue(feature.code),
    label: `${displayText(stringValue(feature.code)) || `F-${index + 1}`} · ${displayText(stringValue(feature.title))}`,
  }));
  const storyOptions = stories.map((story, index) => ({
    value: stringValue(story.code),
    label: `${displayText(stringValue(story.code)) || `HU-${index + 1}`} · ${displayText(stringValue(story.title))}`,
  }));
  const update = (key: string, next: DocumentJsonValue) =>
    onChange({ ...record, [key]: next });
  return (
    <div className="rq-document-requirements-editor">
      <EditorHint />
      <div className="rq-requirements-dual-column">
        <section>
          <h3>Funcionalidades ({features.length})</h3>
          <div className="rq-document-disclosure-list">
            {features.map((feature, index) => (
              <EditorDisclosure
                description={stringValue(feature.title)}
                key={stringValue(feature.code) || index}
                meta={featureContextMeta(feature)}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update(
                          "features",
                          features.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                }
                title={`Funcionalidad ${displayText(stringValue(feature.code)) || index + 1}`}
              >
                <FeatureEditor
                  feature={feature}
                  onChange={(next) =>
                    update(
                      "features",
                      features.map((item, itemIndex) =>
                        itemIndex === index ? next : item,
                      ),
                    )
                  }
                  readOnly={readOnly}
                  storyOptions={storyOptions}
                />
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update("features", [
                  ...features,
                  {
                    code: `F-${String(features.length + 1).padStart(3, "0")}`,
                    title: PENDING,
                    objective: PENDING,
                    description: PENDING,
                    inScope: [],
                    outOfScope: [],
                    userStoryCodes: [],
                    sourceIds: [],
                  },
                ])
              }
              type="button"
            >
              Agregar funcionalidad
            </button>
          ) : null}
        </section>
        <section>
          <h3>Historias de usuario ({stories.length})</h3>
          <div className="rq-document-disclosure-list">
            {stories.map((story, index) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta={storyContextMeta(story)}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update(
                          "userStories",
                          stories.filter((_, itemIndex) => itemIndex !== index),
                        )
                }
                title={`Historia ${displayText(stringValue(story.code)) || index + 1}`}
              >
                <StoryEditor
                  featureOptions={featureOptions}
                  onChange={(next) =>
                    update(
                      "userStories",
                      stories.map((item, itemIndex) =>
                        itemIndex === index ? next : item,
                      ),
                    )
                  }
                  readOnly={readOnly}
                  story={story}
                />
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update("userStories", [
                  ...stories,
                  {
                    code: `HU-${String(stories.length + 1).padStart(3, "0")}`,
                    featureCode: stringValue(features.at(-1)?.code),
                    title: PENDING,
                    role: PENDING,
                    want: PENDING,
                    benefit: PENDING,
                    context: PENDING,
                    premises: [],
                    impactedSystems: [],
                    fields: [],
                    acceptanceCriteria: [],
                    sourceIds: [],
                  },
                ])
              }
              type="button"
            >
              Agregar historia de usuario
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function FunctionalRequirementsEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: {
  value: DocumentJsonValue | undefined;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
  backlogValue?: DocumentJsonValue | null;
}) {
  /*
   * PUNTO_6_MILESTONE_EDITOR
   *
   * Punto 6 administra:
   * - Hito: código, nombre, descripción.
   * - HU: título, descripción, COMO, QUIERO, PARA.
   * - contexto, premisas, sistemas y campos.
   * - criterios de aceptación.
   *
   * Punto 7 continúa administrando:
   * - Epic;
   * - Feature;
   * - ubicación estructural de HU;
   * - Tasks y dependencias.
   */
  const stories = recordList(value);

  const groups = functionalMilestoneGroups(value);
  const pending = pendingFunctionalStories(value);
  const confirmedMilestones = confirmedManualMilestoneOptions(backlogValue);
  const integratedRoots = commonEpicMilestoneRoots(value, backlogValue);

  if (stories.length === 0 && integratedRoots.length === 0) {
    return <EmptyValue>Sin historias de usuario funcionales.</EmptyValue>;
  }

  if (stories.length === 0) {
    return (
      <div className="rq-document-requirements-editor rq-requirement-milestones">
        <EditorHint />
        <EmptyValue>
          Hitos confirmados sin HU-F documentadas todavía.
        </EmptyValue>
      </div>
    );
  }

  const updateGroup = (
    group: FunctionalMilestoneGroup,
    changes: JsonRecord,
  ) => {
    const indexes = new Set(group.stories.map(({ index }) => index));

    onChange(
      stories.map((story, index) =>
        indexes.has(index)
          ? {
              ...story,
              ...changes,
            }
          : story,
      ),
    );
  };

  const updateStory = (storyIndex: number, next: JsonRecord) => {
    onChange(
      stories.map((story, index) => (index === storyIndex ? next : story)),
    );
  };

  return (
    <div className="rq-document-requirements-editor rq-requirement-milestones">
      <EditorHint />

      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>6.1 · Hitos y requerimientos funcionales</strong>

          <p>
            Cada Hito agrupa una o varias Historias de Usuario completas. Las HU
            completas sin ubicación segura se muestran al final como pendientes
            por asignar. Epic, Feature y Tasks se administran en el Punto 7 ·
            Esquema.
          </p>
        </div>

        <span>{groups.length} hito(s)</span>
      </div>

      {groups.map((group, groupIndex) => (
        <EditorDisclosure
          description={group.name || "Hito pendiente de definición"}
          key={group.key}
          meta={`${group.stories.length} ` + "Historia(s) de Usuario"}
          title={`Hito ${displayText(group.code) || groupIndex + 1}`}
        >
          <div className="rq-requirement-milestone-editor">
            <div className="rq-document-business-grid">
              <TextField
                label="Código del hito"
                multiline={false}
                onChange={(milestone) => updateGroup(group, { milestone })}
                readOnly={readOnly}
                value={group.code}
              />

              <TextField
                label="Nombre del hito"
                multiline={false}
                onChange={(functionality) =>
                  updateGroup(group, { functionality })
                }
                readOnly={readOnly}
                value={group.name}
              />

              <TextField
                label="Descripción del hito"
                onChange={(milestoneDescription) =>
                  updateGroup(group, {
                    milestoneDescription,
                  })
                }
                readOnly={readOnly}
                value={group.description}
              />
            </div>

            <div className="rq-requirement-milestone-editor__stories">
              <h4>Historias de usuario ({group.stories.length})</h4>

              <div className="rq-document-disclosure-list">
                {group.stories.map(({ story, index }) => (
                  <EditorDisclosure
                    description={stringValue(story.title)}
                    key={stringValue(story.code) || index}
                    meta="HU completa"
                    title={`Historia ${
                      displayText(stringValue(story.code)) || index + 1
                    }`}
                  >
                    <StoryEditor
                      featureOptions={[]}
                      lockStructure
                      onChange={(next) => updateStory(index, next)}
                      readOnly={readOnly}
                      story={story}
                    />
                  </EditorDisclosure>
                ))}
              </div>
            </div>
          </div>
        </EditorDisclosure>
      ))}

      {pending.length > 0 ? (
        <section className="rq-requirement-milestone">
          <div className="rq-requirement-milestones__heading">
            <div>
              <strong>Historias de usuario pendientes por asignar</strong>

              <p>
                Se conservan totalmente documentadas. Solo está pendiente su
                ubicación estructural.
              </p>
            </div>

            <span>{pending.length} HU</span>
          </div>

          <div className="rq-document-disclosure-list">
            {pending.map(({ story, index }) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta="Pendiente por asignar"
                title={
                  `${
                    displayText(stringValue(story.code)) || `HU-${index + 1}`
                  } · ` + displayText(stringValue(story.title))
                }
              >
                <div className="rq-requirement-milestone-editor">
                  <TextField
                    label="Observación de asignación"
                    onChange={(assignmentObservation) =>
                      updateStory(index, {
                        ...story,
                        assignmentObservation,
                      })
                    }
                    readOnly={readOnly}
                    value={stringValue(story.assignmentObservation)}
                  />

                  {!readOnly ? (
                    confirmedMilestones.length > 0 ? (
                      <form
                        className="rq-document-business-grid"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const milestoneCode = String(
                            data.get("milestoneCode") ?? "",
                          );

                          onChange(
                            assignPendingFunctionalStoryToMilestone(
                              value,
                              backlogValue,
                              stringValue(story.code),
                              milestoneCode,
                            ),
                          );
                        }}
                      >
                        <label className="rq-document-business-field">
                          <span>Asignar a Hito confirmado</span>
                          <select defaultValue="" name="milestoneCode" required>
                            <option disabled value="">
                              Selecciona un Hito
                            </option>
                            {confirmedMilestones.map((milestone) => (
                              <option
                                key={milestone.code}
                                value={milestone.code}
                              >
                                {milestone.code} · {milestone.title}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button className="rq-document-add-item" type="submit">
                          Asignar HU-F
                        </button>
                      </form>
                    ) : (
                      <p className="rq-document-prose">
                        No existe un Hito confirmado disponible. Crea o confirma
                        la Epic/Hito correspondiente en el Punto 7 antes de
                        asignar esta HU-F.
                      </p>
                    )
                  ) : null}

                  {stringList(story.functionalNeedCodes).length > 0 ? (
                    <div>
                      <h4>Trazabilidad funcional</h4>

                      <Tags values={stringList(story.functionalNeedCodes)} />
                    </div>
                  ) : null}

                  <StoryEditor
                    featureOptions={[]}
                    lockStructure
                    onChange={(next) => updateStory(index, next)}
                    readOnly={readOnly}
                    story={story}
                  />
                </div>
              </EditorDisclosure>
            ))}
          </div>
        </section>
      ) : null}

      <p className="rq-document-prose">
        La creación o reorganización estructural de Epic, Feature, HU y Task
        continúa en el Punto 7 · Esquema. El Punto 6 define el contenido
        funcional del Hito y de cada HU. Las HU pendientes permanecen
        documentadas hasta contar con evidencia suficiente para ubicarlas.
      </p>
    </div>
  );
}

function NonFunctionalRequirementsEditor({
  value,
  readOnly,
  onChange,
}: {
  value: DocumentJsonValue | undefined;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}) {
  const requirements = recordList(value);

  if (requirements.length === 0) {
    return (
      <EmptyValue>Sin requerimientos no funcionales registrados.</EmptyValue>
    );
  }

  const updateRequirement = (
    index: number,
    key: string,
    next: DocumentJsonValue,
  ) => {
    onChange(
      requirements.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: next } : item,
      ),
    );
  };

  return (
    <div className="rq-document-requirements-editor">
      <EditorHint />

      <p className="rq-document-prose">
        Los requerimientos no funcionales permanecen separados de las Historias
        de Usuario. Aquí se documentan categoría, medida y objetivo verificable
        sin mezclar Hito o Feature.
      </p>

      <div className="rq-document-disclosure-list">
        {requirements.map((requirement, index) => (
          <EditorDisclosure
            description={stringValue(requirement.title)}
            key={stringValue(requirement.code) || index}
            meta={displayText(stringValue(requirement.category))}
            title={
              displayText(stringValue(requirement.code)) || `RNF ${index + 1}`
            }
          >
            <div className="rq-document-business-grid">
              <TextField
                label="Código"
                multiline={false}
                onChange={() => undefined}
                readOnly
                value={stringValue(requirement.code)}
              />

              <TextField
                label="Título"
                multiline={false}
                onChange={(next) => updateRequirement(index, "title", next)}
                readOnly={readOnly}
                value={stringValue(requirement.title)}
              />

              <TextField
                label="Descripción"
                onChange={(next) =>
                  updateRequirement(index, "description", next)
                }
                readOnly={readOnly}
                value={stringValue(requirement.description)}
              />

              <TextField
                label="Tipo"
                multiline={false}
                onChange={(next) =>
                  updateRequirement(index, "requirementType", next)
                }
                readOnly={readOnly}
                value={stringValue(requirement.requirementType)}
              />

              <TextField
                label="Categoría"
                multiline={false}
                onChange={(next) => updateRequirement(index, "category", next)}
                readOnly={readOnly}
                value={stringValue(requirement.category)}
              />

              <TextField
                label="Medida"
                onChange={(next) => updateRequirement(index, "measure", next)}
                readOnly={readOnly}
                value={stringValue(requirement.measure)}
              />

              <TextField
                label="Objetivo / Meta"
                onChange={(next) => updateRequirement(index, "target", next)}
                readOnly={readOnly}
                value={stringValue(requirement.target)}
              />

              <StringListEditor
                label="Criterios de aceptación"
                onChange={(next) =>
                  updateRequirement(index, "acceptanceCriteria", next)
                }
                readOnly={readOnly}
                value={stringList(requirement.acceptanceCriteria)}
              />
            </div>
          </EditorDisclosure>
        ))}
      </div>
    </div>
  );
}

function RequirementsTabsEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: BusinessEditorProps & {
  backlogValue?: DocumentJsonValue | null;
}) {
  const [active, setActive] = useState<RequirementsTab>("functional");

  const record = recordValue(value) ?? {
    functionalRequirements: [],
    nonFunctionalRequirements: [],
  };

  return (
    <div className="rq-document-requirements-tabs-editor">
      <RequirementsTabList active={active} onChange={setActive} />

      <section
        aria-labelledby={`requirements-tab-${active}`}
        id={`requirements-panel-${active}`}
        role="tabpanel"
      >
        {active === "functional" ? (
          <>
            <FunctionalRequirementsEditor
              backlogValue={backlogValue}
              onChange={(next) =>
                onChange({
                  ...record,
                  functionalRequirements: next,
                })
              }
              readOnly={readOnly}
              value={record.functionalRequirements}
            />

            <PendingFunctionalNeedsView value={record.pendingFunctionalNeeds} />
          </>
        ) : (
          <NonFunctionalRequirementsEditor
            onChange={(next) =>
              onChange({
                ...record,
                nonFunctionalRequirements: next,
              })
            }
            readOnly={readOnly}
            value={record.nonFunctionalRequirements ?? []}
          />
        )}
      </section>
    </div>
  );
}

function nextBacklogCode(items: readonly JsonRecord[], prefix: string): string {
  const maximum = items.reduce((currentMaximum, item) => {
    const code = stringValue(item.code);

    const match = code.match(new RegExp(`^${prefix}-(\\d+)$`, "u"));

    return Math.max(currentMaximum, match ? Number(match[1]) : 0);
  }, 0);

  return `${prefix}-` + String(maximum + 1).padStart(3, "0");
}

export type PendingPlanningAssignmentKind =
  "features" | "userStories" | "tasks";

function planningPendingRecord(root: JsonRecord): JsonRecord {
  return (
    recordValue(root.pendingAssignments) ?? {
      features: [],
      userStories: [],
      tasks: [],
    }
  );
}

function planningItemFromEnvelope(
  envelope: JsonRecord | undefined,
): JsonRecord | null {
  return envelope ? recordValue(envelope.item) : null;
}

function replacePendingPlanningCollection(
  root: JsonRecord,
  kind: PendingPlanningAssignmentKind,
  nextItems: readonly JsonRecord[],
): JsonRecord {
  const pending = planningPendingRecord(root);
  return {
    ...root,
    pendingAssignments: {
      ...pending,
      features:
        kind === "features" ? [...nextItems] : recordList(pending.features),
      userStories:
        kind === "userStories"
          ? [...nextItems]
          : recordList(pending.userStories),
      tasks: kind === "tasks" ? [...nextItems] : recordList(pending.tasks),
    },
  };
}

/*
 * POINT_6_MANUAL_PLANNING_ASSIGNMENT_V4_7_6
 *
 * Estas funciones realizan únicamente una decisión humana explícita:
 * mover un work item pendiente al padre seleccionado o crear el padre
 * inmediato solicitado. Nunca infieren relaciones ni convierten HU-P en HU-F.
 */
export function assignPendingPlanningItem(
  value: DocumentJsonValue,
  kind: PendingPlanningAssignmentKind,
  pendingIndex: number,
  parentCode: string,
): DocumentJsonValue {
  const root = recordValue(value);
  if (!root) return value;

  const pending = planningPendingRecord(root);
  const collection = recordList(pending[kind]);
  const envelope = collection[pendingIndex];
  const item = planningItemFromEnvelope(envelope);
  if (!item) return value;

  const normalizedParent = parentCode.trim().toUpperCase();
  let assigned = false;
  let epics = recordList(root.epics);

  if (kind === "features") {
    epics = epics.map((epic) => {
      if (stringValue(epic.code).trim().toUpperCase() !== normalizedParent) {
        return epic;
      }
      assigned = true;
      return {
        ...epic,
        features: [...recordList(epic.features), item],
      };
    });
  } else if (kind === "userStories") {
    epics = epics.map((epic) => ({
      ...epic,
      features: recordList(epic.features).map((feature) => {
        if (
          stringValue(feature.code).trim().toUpperCase() !== normalizedParent
        ) {
          return feature;
        }
        assigned = true;
        return {
          ...feature,
          userStories: [...recordList(feature.userStories), item],
        };
      }),
    }));
  } else {
    epics = epics.map((epic) => ({
      ...epic,
      features: recordList(epic.features).map((feature) => ({
        ...feature,
        userStories: recordList(feature.userStories).map((story) => {
          if (
            stringValue(story.code).trim().toUpperCase() !== normalizedParent
          ) {
            return story;
          }
          assigned = true;
          return {
            ...story,
            tasks: [...recordList(story.tasks), item],
          };
        }),
      })),
    }));
  }

  if (!assigned) return value;

  const nextRoot = replacePendingPlanningCollection(
    {
      ...root,
      epics,
    },
    kind,
    collection.filter((_, index) => index !== pendingIndex),
  );

  return nextRoot;
}

export function createParentForPendingPlanningItem(
  value: DocumentJsonValue,
  kind: PendingPlanningAssignmentKind,
  pendingIndex: number,
  containerCode: string | null,
  parentTitle: string,
): DocumentJsonValue {
  const root = recordValue(value);
  if (!root) return value;

  const title = parentTitle.trim();
  if (title.length < 2) return value;

  const pending = planningPendingRecord(root);
  const collection = recordList(pending[kind]);
  const envelope = collection[pendingIndex];
  const item = planningItemFromEnvelope(envelope);
  if (!item) return value;

  const epics = recordList(root.epics);
  const normalizedContainer = containerCode?.trim().toUpperCase() ?? "";

  if (kind === "features") {
    const code = nextBacklogCode(epics, "EP");
    const nextRoot = replacePendingPlanningCollection(
      {
        ...root,
        structureStatus:
          stringValue(root.structureStatus).trim().toUpperCase() ===
            "AI_SUGGESTED" && epics.length === 0
            ? "CONFIRMED"
            : root.structureStatus,
        epics: [
          ...epics,
          {
            code,
            title,
            description: PENDING,
            sourceNumber: null,
            sourceIds: [],
            features: [item],
          },
        ],
      },
      kind,
      collection.filter((_, index) => index !== pendingIndex),
    );
    return nextRoot;
  }

  if (kind === "userStories") {
    const allFeatures = [
      ...epics.flatMap((epic) => recordList(epic.features)),
      ...recordList(pending.features).flatMap((candidate) => {
        const pendingFeature = planningItemFromEnvelope(candidate);
        return pendingFeature ? [pendingFeature] : [];
      }),
    ];
    const code = nextBacklogCode(allFeatures, "FE");
    let created = false;
    const nextEpics = epics.map((epic) => {
      if (stringValue(epic.code).trim().toUpperCase() !== normalizedContainer) {
        return epic;
      }
      created = true;
      return {
        ...epic,
        features: [
          ...recordList(epic.features),
          {
            code,
            title,
            description: PENDING,
            sourceNumber: null,
            sourceIds: [],
            userStories: [item],
          },
        ],
      };
    });
    if (!created) return value;

    return replacePendingPlanningCollection(
      {
        ...root,
        epics: nextEpics,
      },
      kind,
      collection.filter((_, index) => index !== pendingIndex),
    );
  }

  const allStories = [
    ...epics.flatMap((epic) =>
      recordList(epic.features).flatMap((feature) =>
        recordList(feature.userStories),
      ),
    ),
    ...recordList(pending.features).flatMap((candidate) => {
      const pendingFeature = planningItemFromEnvelope(candidate);
      return pendingFeature ? recordList(pendingFeature.userStories) : [];
    }),
    ...recordList(pending.userStories).flatMap((candidate) => {
      const pendingStory = planningItemFromEnvelope(candidate);
      return pendingStory ? [pendingStory] : [];
    }),
  ];
  const code = nextBacklogCode(allStories, "HU-P");
  let created = false;
  const nextEpics = epics.map((epic) => ({
    ...epic,
    features: recordList(epic.features).map((feature) => {
      if (
        stringValue(feature.code).trim().toUpperCase() !== normalizedContainer
      ) {
        return feature;
      }
      created = true;
      return {
        ...feature,
        userStories: [
          ...recordList(feature.userStories),
          {
            code,
            title,
            description: PENDING,
            sourceNumber: null,
            functionalRequirementCodes: [],
            sourceIds: [],
            tasks: [item],
          },
        ],
      };
    }),
  }));
  if (!created) return value;

  return replacePendingPlanningCollection(
    {
      ...root,
      epics: nextEpics,
    },
    kind,
    collection.filter((_, index) => index !== pendingIndex),
  );
}

/*
 * PUNTO_7_CANONICAL_EDITOR
 *
 * Propiedad funcional:
 *
 * Punto 6:
 * - COMO
 * - QUIERO
 * - PARA
 * - contexto
 * - premisas
 * - sistemas
 * - campos
 * - criterios
 *
 * Punto 7:
 * - Epic
 * - Feature
 * - ubicación de HU
 * - identidad/título HU
 * - Task
 * - dependencias
 *
 * Los códigos existentes quedan bloqueados porque son
 * referencias canónicas usadas por Pruebas y Scrum.
 */
function BacklogStructureEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const root = recordValue(value) ?? { epics: [] };

  const epics = recordList(root.epics);

  const { features, stories, tasks } = backlogCounts(epics);

  const updateEpics = (next: JsonRecord[]) =>
    onChange({
      ...root,
      epics: next,
    });

  const updateEpic = (epicIndex: number, changes: JsonRecord) =>
    updateEpics(
      epics.map((epic, index) =>
        index === epicIndex ? { ...epic, ...changes } : epic,
      ),
    );

  const updateFeature = (
    epicIndex: number,
    featureIndex: number,
    changes: JsonRecord,
  ) => {
    const epic = epics[epicIndex];

    if (!epic) return;

    const currentFeatures = recordList(epic.features);

    updateEpic(epicIndex, {
      features: currentFeatures.map((feature, index) =>
        index === featureIndex
          ? {
              ...feature,
              ...changes,
            }
          : feature,
      ),
    });
  };

  const updateStory = (
    epicIndex: number,
    featureIndex: number,
    storyIndex: number,
    changes: JsonRecord,
  ) => {
    const epic = epics[epicIndex];

    if (!epic) return;

    const feature = recordList(epic.features)[featureIndex];

    if (!feature) return;

    const currentStories = recordList(feature.userStories);

    updateFeature(epicIndex, featureIndex, {
      userStories: currentStories.map((story, index) =>
        index === storyIndex
          ? {
              ...story,
              ...changes,
            }
          : story,
      ),
    });
  };

  const updateTask = (
    epicIndex: number,
    featureIndex: number,
    storyIndex: number,
    taskIndex: number,
    changes: JsonRecord,
  ) => {
    const epic = epics[epicIndex];

    if (!epic) return;

    const feature = recordList(epic.features)[featureIndex];

    if (!feature) return;

    const story = recordList(feature.userStories)[storyIndex];

    if (!story) return;

    const currentTasks = recordList(story.tasks);

    updateStory(epicIndex, featureIndex, storyIndex, {
      tasks: currentTasks.map((task, index) =>
        index === taskIndex
          ? {
              ...task,
              ...changes,
            }
          : task,
      ),
    });
  };

  const epicOptions = epics.map((epic, index) => ({
    value: stringValue(epic.code),
    label:
      `${displayText(stringValue(epic.code)) || `EP-${index + 1}`} · ` +
      displayText(stringValue(epic.title)),
  }));

  const featureOptions = features.map((feature, index) => ({
    value: stringValue(feature.code),
    label:
      `${displayText(stringValue(feature.code)) || `FE-${index + 1}`} · ` +
      displayText(stringValue(feature.title)),
  }));

  const taskOptions = tasks.map((task, index) => ({
    value: stringValue(task.code),
    label:
      `${displayText(stringValue(task.code)) || `T-${index + 1}`} · ` +
      displayText(stringValue(task.title)),
  }));

  const moveFeature = (featureCode: string, targetEpicCode: string) => {
    const moving = features.find(
      (feature) => stringValue(feature.code) === featureCode,
    );

    if (!moving) return;

    updateEpics(
      epics.map((epic) => {
        const currentFeatures = recordList(epic.features).filter(
          (feature) => stringValue(feature.code) !== featureCode,
        );

        if (stringValue(epic.code) !== targetEpicCode) {
          return {
            ...epic,
            features: currentFeatures,
          };
        }

        return {
          ...epic,
          features: [...currentFeatures, moving],
        };
      }),
    );
  };

  const moveStory = (storyCode: string, targetFeatureCode: string) => {
    const moving = stories.find(
      (story) => stringValue(story.code) === storyCode,
    );

    if (!moving) return;

    updateEpics(
      epics.map((epic) => ({
        ...epic,

        features: recordList(epic.features).map((feature) => {
          const currentStories = recordList(feature.userStories).filter(
            (story) => stringValue(story.code) !== storyCode,
          );

          if (stringValue(feature.code) !== targetFeatureCode) {
            return {
              ...feature,
              userStories: currentStories,
            };
          }

          return {
            ...feature,

            userStories: [
              ...currentStories,
              {
                ...moving,
                featureCode: targetFeatureCode,
              },
            ],
          };
        }),
      })),
    );
  };

  return (
    <div className="rq-backlog-editor">
      <EditorHint />

      <BacklogOverview epics={epics} />

      <div className="rq-backlog-purpose">
        <strong>Administración estructural</strong>

        <p>
          Organiza Epic → Feature → HU → Task. Los códigos existentes no se
          editan para proteger referencias. El detalle funcional de la HU se
          mantiene en el Punto 6.
        </p>
      </div>

      <div className="rq-backlog-tree">
        {epics.map((epic, epicIndex) => {
          const currentFeatures = recordList(epic.features);

          const epicStoryCount = currentFeatures.flatMap((feature) =>
            recordList(feature.userStories),
          ).length;

          return (
            <EditorDisclosure
              description={stringValue(epic.title)}
              key={stringValue(epic.code) || epicIndex}
              meta={
                `${currentFeatures.length} Feature · ` + `${epicStoryCount} HU`
              }
              leadingIcon="epic"
              title={
                `${stringValue(epic.sourceNumber).trim() ? `${displayText(stringValue(epic.sourceNumber))} · ` : ""}Epic ` +
                (displayText(stringValue(epic.code)) || epicIndex + 1)
              }
            >
              <div className="rq-document-business-grid">
                <TextField
                  label="Código"
                  multiline={false}
                  onChange={() => undefined}
                  readOnly
                  value={stringValue(epic.code)}
                />

                <TextField
                  label="Número de origen"
                  multiline={false}
                  onChange={(sourceNumber) =>
                    updateEpic(epicIndex, { sourceNumber })
                  }
                  readOnly={readOnly}
                  value={stringValue(epic.sourceNumber)}
                />

                <TextField
                  label="Nombre"
                  multiline={false}
                  onChange={(title) => updateEpic(epicIndex, { title })}
                  readOnly={readOnly}
                  value={stringValue(epic.title)}
                />

                <TextField
                  label="Descripción"
                  onChange={(description) =>
                    updateEpic(epicIndex, { description })
                  }
                  readOnly={readOnly}
                  value={stringValue(epic.description)}
                />
              </div>

              <fieldset className="rq-document-business-list rq-backlog-level-editor">
                <legend>Features ({currentFeatures.length})</legend>

                {currentFeatures.map((feature, featureIndex) => {
                  const currentStories = recordList(feature.userStories);

                  return (
                    <EditorDisclosure
                      description={stringValue(feature.title)}
                      key={stringValue(feature.code) || featureIndex}
                      meta={`${currentStories.length} HU`}
                      leadingIcon="feature"
                      title={
                        `${stringValue(feature.sourceNumber).trim() ? `${displayText(stringValue(feature.sourceNumber))} · ` : ""}Feature ` +
                        (displayText(stringValue(feature.code)) ||
                          featureIndex + 1)
                      }
                    >
                      <div className="rq-document-business-grid">
                        <TextField
                          label="Código"
                          multiline={false}
                          onChange={() => undefined}
                          readOnly
                          value={stringValue(feature.code)}
                        />

                        <TextField
                          label="Número de origen"
                          multiline={false}
                          onChange={(sourceNumber) =>
                            updateFeature(epicIndex, featureIndex, {
                              sourceNumber,
                            })
                          }
                          readOnly={readOnly}
                          value={stringValue(feature.sourceNumber)}
                        />

                        <TextField
                          label="Nombre"
                          multiline={false}
                          onChange={(title) =>
                            updateFeature(epicIndex, featureIndex, {
                              title,
                            })
                          }
                          readOnly={readOnly}
                          value={stringValue(feature.title)}
                        />

                        <TextField
                          label="Descripción"
                          onChange={(description) =>
                            updateFeature(epicIndex, featureIndex, {
                              description,
                            })
                          }
                          readOnly={readOnly}
                          value={stringValue(feature.description)}
                        />

                        <label className="rq-document-business-field">
                          <span>Epic padre</span>

                          <select
                            disabled={readOnly}
                            onChange={(event) => {
                              const next = event.target.value;

                              if (next && next !== stringValue(epic.code)) {
                                moveFeature(stringValue(feature.code), next);
                              }
                            }}
                            value={stringValue(epic.code)}
                          >
                            {epicOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <fieldset className="rq-document-business-list rq-backlog-level-editor">
                        <legend>
                          Historias de usuario ({currentStories.length})
                        </legend>

                        {currentStories.map((story, storyIndex) => {
                          const currentTasks = recordList(story.tasks);

                          return (
                            <EditorDisclosure
                              description={stringValue(story.title)}
                              key={stringValue(story.code) || storyIndex}
                              meta={`${currentTasks.length} Task`}
                              leadingIcon="product-backlog-item"
                              title={
                                `${stringValue(story.sourceNumber).trim() ? `${displayText(stringValue(story.sourceNumber))} · ` : ""}HU ` +
                                (displayText(stringValue(story.code)) ||
                                  storyIndex + 1)
                              }
                            >
                              <div className="rq-document-business-grid">
                                <TextField
                                  label="Código"
                                  multiline={false}
                                  onChange={() => undefined}
                                  readOnly
                                  value={stringValue(story.code)}
                                />

                                <TextField
                                  label="Número de origen"
                                  multiline={false}
                                  onChange={(sourceNumber) =>
                                    updateStory(
                                      epicIndex,
                                      featureIndex,
                                      storyIndex,
                                      { sourceNumber },
                                    )
                                  }
                                  readOnly={readOnly}
                                  value={stringValue(story.sourceNumber)}
                                />

                                <TextField
                                  label="Título"
                                  multiline={false}
                                  onChange={(title) =>
                                    updateStory(
                                      epicIndex,
                                      featureIndex,
                                      storyIndex,
                                      {
                                        title,
                                      },
                                    )
                                  }
                                  readOnly={readOnly}
                                  value={stringValue(story.title)}
                                />

                                <TextField
                                  label="Descripción estructural"
                                  onChange={(description) =>
                                    updateStory(
                                      epicIndex,
                                      featureIndex,
                                      storyIndex,
                                      {
                                        description,
                                      },
                                    )
                                  }
                                  readOnly={readOnly}
                                  value={stringValue(story.description)}
                                />

                                <label className="rq-document-business-field">
                                  <span>Feature padre</span>

                                  <select
                                    disabled={readOnly}
                                    onChange={(event) => {
                                      const next = event.target.value;

                                      if (
                                        next &&
                                        next !== stringValue(feature.code)
                                      ) {
                                        moveStory(
                                          stringValue(story.code),
                                          next,
                                        );
                                      }
                                    }}
                                    value={stringValue(feature.code)}
                                  >
                                    {featureOptions.map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <fieldset className="rq-document-business-list rq-backlog-task-editor">
                                <legend>Tareas ({currentTasks.length})</legend>

                                {currentTasks.map((task, taskIndex) => (
                                  <EditorDisclosure
                                    description={stringValue(task.title)}
                                    key={stringValue(task.code) || taskIndex}
                                    meta={displayText(stringValue(task.type))}
                                    leadingIcon="task"
                                    title={
                                      `${stringValue(task.sourceNumber).trim() ? `${displayText(stringValue(task.sourceNumber))} · ` : ""}Task ` +
                                      (displayText(stringValue(task.code)) ||
                                        taskIndex + 1)
                                    }
                                  >
                                    <div className="rq-document-business-grid">
                                      <TextField
                                        label="Código"
                                        multiline={false}
                                        onChange={() => undefined}
                                        readOnly
                                        value={stringValue(task.code)}
                                      />

                                      <TextField
                                        label="Número de origen"
                                        multiline={false}
                                        onChange={(sourceNumber) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              sourceNumber,
                                              origin: sourceNumber.trim()
                                                ? "EVIDENCE"
                                                : task.origin,
                                            },
                                          )
                                        }
                                        readOnly={readOnly}
                                        value={stringValue(task.sourceNumber)}
                                      />

                                      <TextField
                                        label="Título"
                                        multiline={false}
                                        onChange={(title) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              title,
                                            },
                                          )
                                        }
                                        readOnly={readOnly}
                                        value={stringValue(task.title)}
                                      />

                                      <TextField
                                        label="Descripción"
                                        onChange={(description) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              description,
                                            },
                                          )
                                        }
                                        readOnly={readOnly}
                                        value={stringValue(task.description)}
                                      />

                                      <label className="rq-document-business-field">
                                        <span>Tipo</span>

                                        <select
                                          disabled={readOnly}
                                          onChange={(event) =>
                                            updateTask(
                                              epicIndex,
                                              featureIndex,
                                              storyIndex,
                                              taskIndex,
                                              {
                                                type: event.target.value,
                                              },
                                            )
                                          }
                                          value={stringValue(task.type)}
                                        >
                                          {[
                                            ["ANALYSIS", "Análisis"],
                                            ["DESIGN", "Diseño"],
                                            ["DEVELOPMENT", "Desarrollo"],
                                            ["CONFIGURATION", "Configuración"],
                                            ["INTEGRATION", "Integración"],
                                            ["DATA", "Datos"],
                                            ["TESTING", "Pruebas"],
                                            ["UAT", "Pruebas de usuario"],
                                            ["DOCUMENTATION", "Documentación"],
                                            ["DEPLOYMENT", "Despliegue"],
                                          ].map(([code, label]) => (
                                            <option key={code} value={code}>
                                              {label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <label className="rq-document-business-field">
                                        <span>Origen</span>

                                        <select
                                          disabled={readOnly}
                                          onChange={(event) =>
                                            updateTask(
                                              epicIndex,
                                              featureIndex,
                                              storyIndex,
                                              taskIndex,
                                              {
                                                origin: event.target.value,
                                              },
                                            )
                                          }
                                          value={stringValue(task.origin)}
                                        >
                                          <option value="EVIDENCE">
                                            Evidencia
                                          </option>

                                          <option value="IMPLEMENTATION_PROPOSAL">
                                            Propuesta de implementación
                                          </option>
                                        </select>
                                      </label>

                                      <ReferenceListEditor
                                        label="Dependencias"
                                        onChange={(dependencyCodes) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              dependencyCodes,
                                            },
                                          )
                                        }
                                        options={taskOptions.filter(
                                          (option) =>
                                            option.value !==
                                            stringValue(task.code),
                                        )}
                                        readOnly={readOnly}
                                        value={stringList(task.dependencyCodes)}
                                      />
                                    </div>
                                  </EditorDisclosure>
                                ))}

                                {!readOnly ? (
                                  <button
                                    className="rq-document-add-item"
                                    onClick={() => {
                                      const code = nextBacklogCode(tasks, "T");

                                      updateStory(
                                        epicIndex,
                                        featureIndex,
                                        storyIndex,
                                        {
                                          tasks: [
                                            ...currentTasks,
                                            {
                                              code,
                                              title: PENDING,
                                              description: PENDING,
                                              type: "ANALYSIS",
                                              origin: "IMPLEMENTATION_PROPOSAL",
                                              dependencyCodes: [],
                                              sourceIds: [],
                                            },
                                          ],
                                        },
                                      );
                                    }}
                                    type="button"
                                  >
                                    Agregar Task
                                  </button>
                                ) : null}
                              </fieldset>
                            </EditorDisclosure>
                          );
                        })}

                        {!readOnly ? (
                          <button
                            className="rq-document-add-item"
                            onClick={() => {
                              const code = nextBacklogCode(stories, "HU");

                              const criterionCode = `CA-${code}-001`;

                              updateFeature(epicIndex, featureIndex, {
                                userStories: [
                                  ...currentStories,
                                  {
                                    code,
                                    featureCode: stringValue(feature.code),
                                    title: PENDING,
                                    description: PENDING,
                                    role: PENDING,
                                    want: PENDING,
                                    benefit: PENDING,
                                    context: PENDING,
                                    premises: [],
                                    impactedSystems: [],
                                    fields: [],
                                    acceptanceCriteria: [
                                      {
                                        code: criterionCode,
                                        given: PENDING,
                                        when: PENDING,
                                        then: PENDING,
                                        sourceIds: [],
                                      },
                                    ],
                                    sourceIds: [],
                                    tasks: [],
                                  },
                                ],
                              });
                            }}
                            type="button"
                          >
                            Agregar Historia de Usuario
                          </button>
                        ) : null}
                      </fieldset>
                    </EditorDisclosure>
                  );
                })}

                {!readOnly ? (
                  <button
                    className="rq-document-add-item"
                    onClick={() => {
                      const code = nextBacklogCode(features, "FE");

                      updateEpic(epicIndex, {
                        features: [
                          ...currentFeatures,
                          {
                            code,
                            title: PENDING,
                            description: PENDING,
                            sourceIds: [],
                            userStories: [],
                          },
                        ],
                      });
                    }}
                    type="button"
                  >
                    Agregar Feature
                  </button>
                ) : null}
              </fieldset>
            </EditorDisclosure>
          );
        })}
      </div>

      {!readOnly ? (
        <button
          className="rq-document-add-item rq-backlog-add-epic"
          onClick={() => {
            const code = nextBacklogCode(epics, "EP");

            updateEpics([
              ...epics,
              {
                code,
                title: PENDING,
                description: PENDING,
                sourceIds: [],
                features: [],
              },
            ]);
          }}
          type="button"
        >
          Agregar Epic
        </button>
      ) : null}

      <PendingPlanningAssignmentsEditor
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />

      <p className="rq-document-prose">
        La eliminación estructural no se habilita desde este editor para evitar
        romper referencias existentes en Pruebas, Scrum o trazabilidad.
      </p>
    </div>
  );
}

function TestsView({ value }: { value: DocumentJsonValue }) {
  const record = recordValue(value);
  const scenarios = Array.isArray(value)
    ? recordList(value)
    : recordList(record?.scenarios);
  if (scenarios.length === 0) return <HumanValue value={value} />;
  return (
    <div className="rq-document-tests-view">
      <div className="rq-document-master-list">
        {scenarios.map((scenario, index) => (
          <EditorDisclosure
            description={stringValue(scenario.title)}
            key={stringValue(scenario.code) || index}
            meta={`${stringList(scenario.userStoryCodes).length} HU · Definida`}
            title={
              displayText(stringValue(scenario.code)) || `Prueba ${index + 1}`
            }
          >
            <div className="rq-document-detail-panel">
              <h4>Historias verificadas</h4>
              <Tags values={stringList(scenario.userStoryCodes)} />
              <h4>Criterios verificados</h4>
              <Tags values={stringList(scenario.acceptanceCriterionCodes)} />
              <h4>Tareas verificadas</h4>
              <Tags values={stringList(scenario.taskCodes)} />
              <h4>Precondición</h4>
              <HumanValue value={scenario.precondition ?? ""} />
              <h4>Acción</h4>
              <HumanValue value={scenario.action ?? ""} />
              <h4>Resultado esperado</h4>
              <HumanValue value={scenario.expectedResult ?? ""} />
            </div>
          </EditorDisclosure>
        ))}
      </div>
    </div>
  );
}

function TestsEditor({ value, readOnly, onChange }: BusinessEditorProps) {
  const record = recordValue(value);
  if (!record)
    return (
      <SafeValueEditor
        label="Escenarios de prueba"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  const scenarios = recordList(record.scenarios);
  const updateScenarios = (next: JsonRecord[]) =>
    onChange({ ...record, scenarios: next });
  return (
    <div className="rq-document-tests-editor">
      <EditorHint />
      <div className="rq-document-editor-collection-heading">
        <h3>Escenarios de prueba</h3>
        <span>{scenarios.length} registro(s)</span>
      </div>
      <div className="rq-document-disclosure-list">
        {scenarios.map((scenario, index) => {
          const update = (key: string, next: DocumentJsonValue) =>
            updateScenarios(
              scenarios.map((item, itemIndex) =>
                itemIndex === index ? { ...item, [key]: next } : item,
              ),
            );
          return (
            <EditorDisclosure
              description={stringValue(scenario.title)}
              key={stringValue(scenario.code) || index}
              meta={`${stringList(scenario.userStoryCodes).length} HU · ${stringList(scenario.acceptanceCriterionCodes).length} criterio(s)`}
              onDelete={
                readOnly
                  ? undefined
                  : () =>
                      updateScenarios(
                        scenarios.filter((_, itemIndex) => itemIndex !== index),
                      )
              }
              title={`Escenario ${displayText(stringValue(scenario.code)) || index + 1}`}
            >
              <div className="rq-document-business-grid">
                <TextField
                  label="Código"
                  multiline={false}
                  onChange={(next) => update("code", next)}
                  readOnly={readOnly}
                  value={stringValue(scenario.code)}
                />
                <TextField
                  label="Nombre"
                  multiline={false}
                  onChange={(next) => update("title", next)}
                  readOnly={readOnly}
                  value={stringValue(scenario.title)}
                />
                <StringListEditor
                  label="Historias verificadas"
                  onChange={(next) => update("userStoryCodes", next)}
                  readOnly={readOnly}
                  value={stringList(scenario.userStoryCodes)}
                />
                <StringListEditor
                  label="Criterios verificados"
                  onChange={(next) => update("acceptanceCriterionCodes", next)}
                  readOnly={readOnly}
                  value={stringList(scenario.acceptanceCriterionCodes)}
                />
                {[
                  ["precondition", "Precondición"],
                  ["action", "Acción"],
                  ["expectedResult", "Resultado esperado"],
                ].map(([key, label]) => (
                  <TextField
                    key={key}
                    label={label}
                    onChange={(next) => update(key, next)}
                    readOnly={readOnly}
                    value={stringValue(scenario[key])}
                  />
                ))}
              </div>
            </EditorDisclosure>
          );
        })}
      </div>
      {!readOnly ? (
        <button
          className="rq-document-add-item"
          onClick={() =>
            updateScenarios([
              ...scenarios,
              {
                code: `CP-${String(scenarios.length + 1).padStart(3, "0")}`,
                title: PENDING,
                userStoryCodes: [],
                acceptanceCriterionCodes: [],
                precondition: PENDING,
                action: PENDING,
                expectedResult: PENDING,
                sourceIds: [],
              },
            ])
          }
          type="button"
        >
          Agregar escenario
        </button>
      ) : null}
    </div>
  );
}

function TasksTable({ value }: { value: DocumentJsonValue | undefined }) {
  const tasks = recordList(value);
  if (tasks.length === 0) return <EmptyValue>Sin tareas definidas.</EmptyValue>;
  return (
    <div className="rq-document-responsive-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Tipo</th>
            <th scope="col">Tarea</th>
            <th scope="col">HU</th>
            <th scope="col">Rol</th>
            <th scope="col">Programación</th>
            <th scope="col">Depende de</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, index) => (
            <tr key={stringValue(task.code) || index}>
              <td data-label="Código">{displayText(stringValue(task.code))}</td>
              <td data-label="Tipo">{displayText(stringValue(task.type))}</td>
              <td data-label="Tarea">
                {displayText(stringValue(task.description))}
              </td>
              <td data-label="HU">
                {displayText(stringValue(task.userStoryCode))}
              </td>
              <td data-label="Rol">
                {displayText(stringValue(task.suggestedRole))}
              </td>
              <td data-label="Programación">
                {numberValue(task.startDay) !== null &&
                numberValue(task.endDay) !== null ? (
                  <span>
                    {stringValue(task.startDate) && stringValue(task.endDate)
                      ? `${formatColombianCalendarDate(stringValue(task.startDate))} al ${formatColombianCalendarDate(stringValue(task.endDate))}`
                      : `Día ${numberValue(task.startDay)} al Día ${numberValue(task.endDay)}`}
                    {numberValue(task.estimatedDurationDays) !== null
                      ? ` · ${numberValue(task.estimatedDurationDays)} día(s)`
                      : ""}
                  </span>
                ) : (
                  "-"
                )}
              </td>
              <td data-label="Depende de">
                {stringList(task.dependencyCodes).join(", ") || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScrumView({ value }: { value: DocumentJsonValue }) {
  const plan = recordValue(value);
  if (!plan) return <HumanValue value={value} />;
  const sprints = recordList(plan.sprints);
  const usesColombianBusinessCalendar =
    plan.calendarMode === "COLOMBIA_BUSINESS_DAYS";
  const selectedStartDate = stringValue(plan.confirmedStartDate);
  const operationalStartDate = stringValue(sprints[0]?.startDate);
  return (
    <div className="rq-document-scrum-view">
      <div className="rq-document-cadence">
        <span>Cadencia</span>
        <strong>
          {numberValue(plan.cadenceDays) ?? 15}{" "}
          {usesColombianBusinessCalendar
            ? "días hábiles · calendario Colombia"
            : "días calendario"}
        </strong>
      </div>
      {plan.scheduleBasis === "CONFIRMED_DATE" && plan.confirmedStartDate ? (
        <p>
          Fecha de inicio confirmada:{" "}
          <strong>
            {usesColombianBusinessCalendar
              ? formatColombianCalendarDate(
                  stringValue(plan.confirmedStartDate),
                )
              : stringValue(plan.confirmedStartDate)}
          </strong>
          {usesColombianBusinessCalendar
            ? " · Se excluyen sábados, domingos y festivos nacionales."
            : ""}
          {usesColombianBusinessCalendar &&
          operationalStartDate &&
          operationalStartDate !== selectedStartDate
            ? ` Inicio operativo ajustado al ${formatColombianCalendarDate(operationalStartDate)}.`
            : ""}
        </p>
      ) : null}
      <div className="rq-document-sprint-timeline">
        {sprints.map((sprint, index) => {
          const number = numberValue(sprint.number) ?? index + 1;
          const startDate = stringValue(sprint.startDate);
          const endDate = stringValue(sprint.endDate);
          const period =
            usesColombianBusinessCalendar && startDate && endDate
              ? `${formatColombianCalendarDate(startDate)} al ${formatColombianCalendarDate(endDate)}`
              : stringValue(sprint.period) ||
                `Día ${(number - 1) * 15 + 1} al Día ${number * 15}`;
          const excludedDates = recordList(sprint.calendarExcludedDates);
          return (
            <EditorDisclosure
              description={stringValue(sprint.objective)}
              key={`${stringValue(sprint.code)}-${index}`}
              meta={`${recordList(sprint.tasks).length} tareas · ${stringList(sprint.testCodes).length} pruebas`}
              title={`Sprint ${number} · ${period}`}
            >
              <div className="rq-document-detail-panel">
                <h4>Objetivo</h4>
                <HumanValue value={sprint.objective ?? ""} />
                {usesColombianBusinessCalendar ? (
                  <>
                    <h4>Calendario laboral colombiano</h4>
                    <p>
                      {excludedDates.length > 0
                        ? `${excludedDates.length} día(s) no laborable(s) excluido(s): ${excludedDates
                            .map((day) => {
                              const date = stringValue(day.date);
                              const reason = stringValue(day.reason);
                              return date
                                ? `${formatColombianCalendarDate(date)} (${reason})`
                                : reason;
                            })
                            .join(", ")}.`
                        : "El periodo no contiene días no laborables nacionales."}
                    </p>
                  </>
                ) : null}
                <h4>Funcionalidades</h4>
                <Tags values={stringList(sprint.featureCodes)} />
                <h4>Historias de usuario</h4>
                <Tags values={stringList(sprint.userStoryCodes)} />
                <h4>Tareas</h4>
                <TasksTable value={sprint.tasks} />
                <h4>Dependencias</h4>
                <TextList
                  empty="Sin dependencias previas."
                  items={stringList(sprint.dependencies)}
                />
                <h4>Pruebas</h4>
                <Tags values={stringList(sprint.testCodes)} />
                <h4>Entregables</h4>
                <TextList items={stringList(sprint.deliverables)} />
                <h4>Criterio de cierre</h4>
                <HumanValue value={sprint.closingCriterion ?? ""} />
              </div>
            </EditorDisclosure>
          );
        })}
      </div>
    </div>
  );
}

type WorkPlanTab = "SPRINT" | "STAGES";
function WorkPlanTimeline({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const [granularity, setGranularity] = useState<TimelineGranularity>("EPIC");
  const { sprints, items, timelineStart, timelineEnd } = useMemo(
    () => computeWorkPlanTimeline(value, backlogValue, granularity),
    [value, backlogValue, granularity],
  );
  const timelineLength = Math.max(1, timelineEnd - timelineStart);
  const axisLabels = workPlanAxisLabels(timelineStart, timelineEnd);

  return (
    <section
      className="rq-work-plan-timeline"
      aria-labelledby="work-plan-timeline-title"
    >
      <header>
        <div>
          <span>Línea de tiempo</span>
          <h3 id="work-plan-timeline-title">Programación según las tareas</h3>
          <p>
            El inicio y el cierre se calculan con los Sprints que contienen las
            tareas de cada elemento.
          </p>
        </div>
        <div
          aria-label="Nivel de la línea de tiempo"
          className="rq-work-plan-granularity"
          role="group"
        >
          {(
            [
              ["EPIC", "Épicas"],
              ["FEATURE", "Features"],
              ["USER_STORY", "Historias de usuario"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-pressed={granularity === key}
              key={key}
              onClick={() => setGranularity(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {sprints.length === 0 || items.length === 0 ? (
        <EmptyValue>
          Aún no hay tareas calendarizadas para este nivel del plan.
        </EmptyValue>
      ) : (
        <div className="rq-work-plan-timeline__viewport">
          <div className="rq-work-plan-timeline__axis">
            <strong>Elemento</strong>
            <div>
              {axisLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
          </div>
          <div className="rq-work-plan-timeline__rows">
            {items.map((item, index) => {
              const left =
                ((item.start - timelineStart) / timelineLength) * 100;
              const width = Math.max(
                3,
                ((item.end - item.start) / timelineLength) * 100,
              );
              return (
                <article key={`${granularity}-${item.code}`}>
                  <div className="rq-work-plan-timeline__label">
                    <strong>{displayText(item.code)}</strong>
                    <span title={item.title}>{displayText(item.title)}</span>
                  </div>
                  <div className="rq-work-plan-timeline__track">
                    <div
                      className="rq-work-plan-timeline__bar"
                      data-color={String((index % 3) + 1)}
                      style={{
                        left: `${left}%`,
                        width: `${Math.min(width, 100 - left)}%`,
                      }}
                    >
                      <span>{item.startLabel}</span>
                      <span>{item.endLabel}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function WorkPlanStages({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  return (
    <div className="rq-work-plan-stages">
      <WorkPlanTimeline backlogValue={backlogValue} value={value} />
    </div>
  );
}

function WorkPlanTabs({
  activeTab,
  idPrefix,
  onChange,
}: {
  activeTab: WorkPlanTab;
  idPrefix: string;
  onChange: (tab: WorkPlanTab) => void;
}) {
  return (
    <div
      aria-label="Vistas del plan de trabajo"
      className="rq-work-plan-tabs"
      role="tablist"
    >
      <button
        aria-controls={`${idPrefix}-panel`}
        aria-selected={activeTab === "SPRINT"}
        id={`${idPrefix}-tab-SPRINT`}
        onClick={() => onChange("SPRINT")}
        role="tab"
        type="button"
      >
        Sprint
      </button>
      <button
        aria-controls={`${idPrefix}-panel`}
        aria-selected={activeTab === "STAGES"}
        id={`${idPrefix}-tab-STAGES`}
        onClick={() => onChange("STAGES")}
        role="tab"
        type="button"
      >
        Etapas
      </button>
    </div>
  );
}

function WorkPlanView({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const [activeTab, setActiveTab] = useState<WorkPlanTab>("STAGES");
  const idPrefix = React.useId();
  return (
    <div className="rq-work-plan">
      <WorkPlanTabs
        activeTab={activeTab}
        idPrefix={idPrefix}
        onChange={setActiveTab}
      />
      <div
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
        id={`${idPrefix}-panel`}
        role="tabpanel"
      >
        {activeTab === "SPRINT" ? (
          <ScrumView value={value} />
        ) : (
          <WorkPlanStages backlogValue={backlogValue} value={value} />
        )}
      </div>
    </div>
  );
}

export function ScrumEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const plan = recordValue(value);
  if (!plan)
    return (
      <SafeValueEditor
        label="Plan de trabajo"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  const sprints = recordList(plan.sprints);
  const allTasks = sprints.flatMap((sprint) => recordList(sprint.tasks));
  const nextTaskNumber =
    allTasks.reduce((maximum, task) => {
      const match = stringValue(task.code).match(/(\d+)$/);
      return Math.max(maximum, match ? Number(match[1]) : 0);
    }, 0) + 1;
  const updatePlan = (changes: JsonRecord) => onChange({ ...plan, ...changes });
  const updateSprint = (index: number, changes: JsonRecord) =>
    updatePlan({
      sprints: sprints.map((sprint, itemIndex) =>
        itemIndex === index ? { ...sprint, ...changes } : sprint,
      ),
    });
  return (
    <div className="rq-document-scrum-editor">
      <EditorHint />
      <div className="rq-document-cadence">
        <span>Cadencia</span>
        <strong>
          {numberValue(plan.cadenceDays) ?? 15}{" "}
          {plan.calendarMode === "COLOMBIA_BUSINESS_DAYS"
            ? "días hábiles · calendario Colombia"
            : "días calendario"}
        </strong>
      </div>
      {plan.scheduleBasis === "CONFIRMED_DATE" ? (
        <p className="rq-document-calendar-note">
          La fecha y los periodos se administran desde el calendario ubicado
          junto al botón Editar sección.
        </p>
      ) : null}
      <div className="rq-document-editor-collection-heading">
        <h3>Sprints sugeridos</h3>
        <span>{sprints.length} registro(s)</span>
      </div>
      <div className="rq-document-disclosure-list">
        {sprints.map((sprint, index) => {
          const number = numberValue(sprint.number) ?? index + 1;
          const tasks = recordList(sprint.tasks);
          const taskOptions = allTasks.map((task, taskIndex) => ({
            value: stringValue(task.code),
            label: `${displayText(stringValue(task.code)) || `T-${taskIndex + 1}`} · ${displayText(stringValue(task.description))}`,
          }));
          const storyOptions = stringList(sprint.userStoryCodes).map(
            (code) => ({
              value: code,
              label: code,
            }),
          );
          return (
            <EditorDisclosure
              description={stringValue(sprint.objective)}
              key={`${stringValue(sprint.code)}-${index}`}
              meta={
                stringValue(sprint.period) ||
                `Día ${(number - 1) * 15 + 1} al Día ${number * 15}`
              }
              title={`Sprint ${number}`}
            >
              <TextField
                label="Objetivo"
                onChange={(objective) => updateSprint(index, { objective })}
                readOnly={readOnly}
                value={stringValue(sprint.objective)}
              />
              <StringListEditor
                label="Funcionalidades"
                onChange={(featureCodes) =>
                  updateSprint(index, { featureCodes })
                }
                readOnly={readOnly}
                value={stringList(sprint.featureCodes)}
              />
              <StringListEditor
                label="Historias de usuario"
                onChange={(userStoryCodes) =>
                  updateSprint(index, { userStoryCodes })
                }
                readOnly={readOnly}
                value={stringList(sprint.userStoryCodes)}
              />
              <fieldset className="rq-document-business-list">
                <legend>Tareas ({tasks.length})</legend>
                {tasks.map((task, taskIndex) => (
                  <EditorDisclosure
                    description={stringValue(task.description)}
                    key={stringValue(task.code) || taskIndex}
                    meta={displayText(stringValue(task.type))}
                    onDelete={
                      readOnly
                        ? undefined
                        : () =>
                            updateSprint(index, {
                              tasks: tasks.filter(
                                (_, itemIndex) => itemIndex !== taskIndex,
                              ),
                            })
                    }
                    title={`Tarea ${stringValue(task.code) || taskIndex + 1}`}
                  >
                    {[
                      "code",
                      "description",
                      "suggestedRole",
                      "expectedResult",
                    ].map((key) => (
                      <TextField
                        key={key}
                        label={humanLabel(key)}
                        multiline={
                          !["code", "userStoryCode", "suggestedRole"].includes(
                            key,
                          )
                        }
                        onChange={(next) =>
                          updateSprint(index, {
                            tasks: tasks.map((item, itemIndex) =>
                              itemIndex === taskIndex
                                ? { ...item, [key]: next }
                                : item,
                            ),
                          })
                        }
                        readOnly={readOnly}
                        value={stringValue(task[key])}
                      />
                    ))}
                    <div className="rq-document-task-schedule-editor">
                      {(
                        [
                          [
                            "estimatedDurationDays",
                            "Duración estimada (días)",
                            15,
                          ],
                          ["startDay", "Día de inicio", 1_500],
                          ["endDay", "Día de finalización", 1_500],
                        ] as const
                      ).map(([key, label, maximum]) => (
                        <label className="rq-document-business-field" key={key}>
                          <span>{label}</span>
                          <input
                            disabled={readOnly}
                            max={maximum}
                            min={1}
                            onChange={(event) =>
                              updateSprint(index, {
                                tasks: tasks.map((item, itemIndex) =>
                                  itemIndex === taskIndex
                                    ? {
                                        ...item,
                                        [key]: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      }
                                    : item,
                                ),
                              })
                            }
                            type="number"
                            value={numberValue(task[key]) ?? ""}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="rq-document-business-field">
                      <span>Historia relacionada</span>
                      <select
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSprint(index, {
                            tasks: tasks.map((item, itemIndex) =>
                              itemIndex === taskIndex
                                ? {
                                    ...item,
                                    userStoryCode: event.target.value,
                                  }
                                : item,
                            ),
                          })
                        }
                        value={stringValue(task.userStoryCode)}
                      >
                        <option value="">Seleccionar…</option>
                        {storyOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rq-document-business-field">
                      <span>Tipo</span>
                      <select
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSprint(index, {
                            tasks: tasks.map((item, itemIndex) =>
                              itemIndex === taskIndex
                                ? { ...item, type: event.target.value }
                                : item,
                            ),
                          })
                        }
                        value={stringValue(task.type)}
                      >
                        {[
                          ["ANALYSIS", "Análisis"],
                          ["DESIGN", "Diseño"],
                          ["DEVELOPMENT", "Desarrollo"],
                          ["CONFIGURATION", "Configuración"],
                          ["INTEGRATION", "Integración"],
                          ["DATA", "Datos"],
                          ["TESTING", "Pruebas"],
                          ["UAT", "Pruebas de usuario"],
                          ["DOCUMENTATION", "Documentación"],
                          ["DEPLOYMENT", "Despliegue"],
                        ].map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ReferenceListEditor
                      label="Dependencias"
                      onChange={(dependencyCodes) =>
                        updateSprint(index, {
                          tasks: tasks.map((item, itemIndex) =>
                            itemIndex === taskIndex
                              ? { ...item, dependencyCodes }
                              : item,
                          ),
                        })
                      }
                      options={taskOptions.filter(
                        (option) => option.value !== stringValue(task.code),
                      )}
                      readOnly={readOnly}
                      value={stringList(task.dependencyCodes)}
                    />
                  </EditorDisclosure>
                ))}
                {!readOnly ? (
                  <button
                    className="rq-document-add-item"
                    onClick={() =>
                      updateSprint(index, {
                        tasks: [
                          ...tasks,
                          {
                            code: `T-${String(nextTaskNumber).padStart(3, "0")}`,
                            description: PENDING,
                            userStoryCode: storyOptions[0]?.value ?? "",
                            suggestedRole: PENDING,
                            expectedResult: PENDING,
                            type: "ANALYSIS",
                            dependencyCodes: [],
                            estimatedDurationDays: 1,
                            startDay: Math.min(
                              (numberValue(sprint.startDay) ??
                                (number - 1) * 15 + 1) + tasks.length,
                              numberValue(sprint.endDay) ?? number * 15,
                            ),
                            endDay: Math.min(
                              (numberValue(sprint.startDay) ??
                                (number - 1) * 15 + 1) + tasks.length,
                              numberValue(sprint.endDay) ?? number * 15,
                            ),
                            sourceIds: [],
                          },
                        ],
                      })
                    }
                    type="button"
                  >
                    Agregar tarea
                  </button>
                ) : null}
              </fieldset>
              <StringListEditor
                emptyLabel="Sin dependencias previas."
                label="Dependencias del Sprint"
                onChange={(dependencies) =>
                  updateSprint(index, { dependencies })
                }
                readOnly={readOnly}
                value={stringList(sprint.dependencies)}
              />
              <StringListEditor
                label="Pruebas"
                onChange={(testCodes) => updateSprint(index, { testCodes })}
                readOnly={readOnly}
                value={stringList(sprint.testCodes)}
              />
              <StringListEditor
                label="Entregables"
                onChange={(deliverables) =>
                  updateSprint(index, { deliverables })
                }
                readOnly={readOnly}
                value={stringList(sprint.deliverables)}
              />
              <TextField
                label="Criterio de cierre"
                onChange={(closingCriterion) =>
                  updateSprint(index, { closingCriterion })
                }
                readOnly={readOnly}
                value={stringValue(sprint.closingCriterion)}
              />
              <StringListEditor
                label="Riesgos"
                onChange={(risks) => updateSprint(index, { risks })}
                readOnly={readOnly}
                value={stringList(sprint.risks)}
              />
            </EditorDisclosure>
          );
        })}
      </div>
    </div>
  );
}

function WorkPlanEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: BusinessEditorProps & {
  backlogValue?: DocumentJsonValue | null;
}) {
  const [activeTab, setActiveTab] = useState<WorkPlanTab>("STAGES");
  const idPrefix = React.useId();
  return (
    <div className="rq-work-plan">
      <WorkPlanTabs
        activeTab={activeTab}
        idPrefix={idPrefix}
        onChange={setActiveTab}
      />
      <div
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
        id={`${idPrefix}-panel`}
        role="tabpanel"
      >
        {activeTab === "SPRINT" ? (
          <ScrumEditor onChange={onChange} readOnly={readOnly} value={value} />
        ) : (
          <WorkPlanStages backlogValue={backlogValue} value={value} />
        )}
      </div>
    </div>
  );
}

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

function ApprovalsView({ value }: { value: DocumentJsonValue }) {
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

function BusinessRecordCollectionEditor({
  legend,
  value,
  fields,
  readOnly,
  onChange,
}: {
  legend: string;
  value: DocumentJsonValue | undefined;
  fields: readonly { key: string; label: string }[];
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}) {
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return (
      <StringListEditor
        label={legend}
        onChange={onChange as (value: string[]) => void}
        readOnly={readOnly}
        value={value as readonly string[]}
      />
    );
  const items = recordList(value);
  return (
    <fieldset className="rq-document-business-list">
      <legend>{legend}</legend>
      {items.length === 0 ? <EmptyValue>Sin registros.</EmptyValue> : null}
      {items.map((item, index) => (
        <EditorDisclosure
          description={
            fields
              .map(({ key }) => displayText(stringValue(item[key])))
              .find(Boolean) ?? "Registro pendiente"
          }
          key={index}
          onDelete={
            readOnly
              ? undefined
              : () =>
                  onChange(items.filter((_, itemIndex) => itemIndex !== index))
          }
          title={`${legend} ${index + 1}`}
        >
          {fields.map(({ key, label }) => (
            <TextField
              key={key}
              label={label}
              multiline={
                !["version", "date", "name", "position", "status"].includes(key)
              }
              onChange={(next) =>
                onChange(
                  items.map((current, itemIndex) =>
                    itemIndex === index ? { ...current, [key]: next } : current,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(item[key])}
            />
          ))}
        </EditorDisclosure>
      ))}
      {!readOnly ? (
        <button
          className="rq-document-add-item"
          onClick={() =>
            onChange([
              ...items,
              Object.fromEntries(fields.map(({ key }) => [key, PENDING])),
            ])
          }
          type="button"
        >
          Agregar registro
        </button>
      ) : null}
    </fieldset>
  );
}

function ApprovalsEditor({ value, readOnly, onChange }: BusinessEditorProps) {
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

// Punto 13 «Prototipo»: la solicitud de prototipo llega como texto con bloques
// fijos (resumen, funciones por módulo, estilo visual). Se muestra por bloques
// leyendo las líneas tal cual, sin buscar palabras sueltas como «Sistemas» o
// «incluye», que partían el texto en títulos falsos.
const PROTOTYPE_BRIEF_MARKER = "SOLICITUD DE PROTOTIPO";

interface PrototypeBriefModule {
  title: string;
  items: Array<{ text: string; detail: string | null }>;
}

function parsePrototypeBrief(text: string) {
  const summary: Array<{ label: string; value: string }> = [];
  const modules: PrototypeBriefModule[] = [];
  const notes: string[] = [];
  const style: string[] = [];
  let styleTitle = "Estilo visual";
  let area: "summary" | "modules" | "style" = "summary";
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line === PROTOTYPE_BRIEF_MARKER) continue;
    if (/^FUNCIONES POR M[OÓ]DULO/iu.test(line)) {
      area = "modules";
      continue;
    }
    if (/^ESTILO VISUAL/iu.test(line)) {
      area = "style";
      styleTitle = "Estilo visual";
      continue;
    }
    if (area === "summary") {
      const pair = /^([^:]{2,60}):\s*(.+)$/u.exec(line);
      if (pair?.[1] && pair[2]) {
        summary.push({ label: pair[1], value: pair[2].replace(/\.$/u, "") });
      }
    } else if (area === "modules") {
      const module = /^M[oó]dulo:\s*(.+)$/u.exec(line);
      const fields = /^Campos:\s*(.+)$/u.exec(line);
      if (module?.[1]) modules.push({ title: module[1], items: [] });
      else if (fields?.[1]) {
        const last = modules[modules.length - 1]?.items.at(-1);
        if (last) last.detail = fields[1].replace(/\.$/u, "");
      } else if (line.startsWith("-")) {
        modules[modules.length - 1]?.items.push({
          text: line.replace(/^-\s*/u, ""),
          detail: null,
        });
      } else notes.push(line.replace(/^\(|\)$/gu, ""));
    } else {
      style.push(line.replace(/^-\s*/u, ""));
    }
  }
  return { summary, modules, notes, style, styleTitle };
}

function PrototypeRequestView({ text }: { text: string }) {
  const { summary, modules, notes, style, styleTitle } =
    parsePrototypeBrief(text);
  return (
    <div className="rq-document-known-section rq-document-prototype-brief">
      {summary.length > 0 ? (
        <section>
          <h3>Resumen</h3>
          <dl>
            {summary.map((entry) => (
              <div key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {modules.length > 0 ? (
        <section>
          <h3>Funciones por módulo</h3>
          {modules.map((module) => (
            <article key={module.title}>
              <h4>{module.title}</h4>
              <ul>
                {module.items.map((item) => (
                  <li key={item.text}>
                    {item.text}
                    {item.detail ? <small>Campos: {item.detail}</small> : null}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {notes.map((note) => (
            <p className="rq-document-prose" key={note}>
              {note}
            </p>
          ))}
        </section>
      ) : null}
      {style.length > 0 ? (
        <section>
          <h3>{styleTitle}</h3>
          <ul>
            {style.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NarrativeView({ value }: { value: DocumentJsonValue }) {
  if (typeof value === "string" && value.includes(PROTOTYPE_BRIEF_MARKER)) {
    return <PrototypeRequestView text={value} />;
  }
  if (typeof value === "string") {
    const text = displayText(value);
    const headingPattern =
      /(objetivo general|objetivos específicos|situación actual|impacto(?: operacional)?|procesos afectados|incluye|fuera de alcance|sistemas(?: involucrados)?|actores|seguridad|usabilidad|compatibilidad|rendimiento|disponibilidad|trazabilidad)\s*:?/giu;
    const matches = [...text.matchAll(headingPattern)];
    if (matches.length > 1) {
      return (
        <div className="rq-document-known-section rq-document-narrative-sections">
          {matches.map((match, index) => {
            const start = (match.index ?? 0) + match[0].length;
            const end = matches[index + 1]?.index ?? text.length;
            const content = text.slice(start, end).trim();
            const numbered = content
              .split(/(?=\b\d{1,2}[.)]\s+)/gu)
              .map((item) => item.replace(/^\d{1,2}[.)]\s*/u, "").trim())
              .filter(Boolean);
            return (
              <section key={`${match[1]}-${index}`}>
                <h3>{match[1]}</h3>
                {numbered.length > 1 ? (
                  <ol className="rq-document-numbered-list">
                    {numbered.map((item, itemIndex) => (
                      <li key={`${item}-${itemIndex}`}>{item}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="rq-document-prose">{content}</p>
                )}
              </section>
            );
          })}
        </div>
      );
    }
  }
  return (
    <div className="rq-document-narrative">
      <HumanValue value={value} />
    </div>
  );
}

function editableTemplateSectionValue(
  sectionKey: DocumentSectionKey,
  value: DocumentJsonValue,
): DocumentJsonValue {
  if (
    sectionKey !== "writingRules" &&
    sectionKey !== "visualFormat" &&
    sectionKey !== "automationInstruction"
  ) {
    return value;
  }
  const record = recordValue(value);
  return record?.templateControlled === true && Object.keys(record).length === 1
    ? PENDING
    : value;
}

export function DocumentHumanValue({ value }: { value: DocumentJsonValue }) {
  return <HumanValue value={presentSectionContent(value)} />;
}

interface BusinessEditorProps {
  value: DocumentJsonValue;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}

export function DocumentSectionView({
  sectionKey,
  value,
  context,
}: {
  sectionKey: DocumentSectionKey;
  value: DocumentJsonValue;
  templateControlled?: boolean;
  context?: {
    projectId?: string;
    backlogStructure?: DocumentJsonValue | null;
    milestones?: DocumentJsonValue | null;
    scope?: DocumentJsonValue | null;
    solutionProposal?: DocumentJsonValue | null;
    templateName?: string;
    templateVersion?: string;
  };
}) {
  const presented = presentSectionContent(value);
  if (sectionKey === "automationInstruction")
    return (
      <KpiDashboardView
        backlogValue={context?.backlogStructure}
        projectId={context?.projectId}
        scopeValue={context?.scope}
        value={presented}
      />
    );
  if (sectionKey === "writingRules" || sectionKey === "visualFormat")
    return (
      <NarrativeView
        value={editableTemplateSectionValue(sectionKey, presented)}
      />
    );
  if (sectionKey === "header") return <HeaderView value={presented} />;
  if (sectionKey === "objectives") return <ObjectivesView value={presented} />;
  if (sectionKey === "problemDescription")
    return <ProblemDescriptionView value={presented} />;
  if (sectionKey === "scope") return <ScopeView value={presented} />;
  if (sectionKey === "solutionProposal")
    return <SolutionProposalView value={presented} />;
  if (sectionKey === "processFlow")
    return <ProcessModelsView value={presented} />;
  if (sectionKey === "milestones")
    return (
      <RequirementsView
        backlogValue={context?.backlogStructure}
        value={presented}
      />
    );
  if (sectionKey === "backlogStructure")
    return <BacklogStructureView value={presented} />;
  if (sectionKey === "nonFunctionalRequirements") {
    const normalized = normalizeNonFunctionalRequirements(presented);
    return (
      <KnownSectionView
        fields={NON_FUNCTIONAL_FIELDS}
        value={normalized ?? presented}
      />
    );
  }
  if (sectionKey === "tests") return <TestsView value={presented} />;
  if (sectionKey === "assumptionsDependenciesPending")
    return <PendingView value={presented} />;
  if (sectionKey === "scrumPlan")
    return (
      <WorkPlanView
        backlogValue={context?.backlogStructure}
        value={presented}
      />
    );
  if (sectionKey === "approvalsAndChangeControl")
    return <ApprovalsView value={presented} />;
  return <NarrativeView value={presented} />;
}

export function DocumentSectionBusinessEditor({
  sectionKey,
  value,
  readOnly,
  onChange,
  context,
}: {
  sectionKey: DocumentSectionKey;
  context?: {
    projectId?: string;
    backlogStructure?: DocumentJsonValue | null;
    milestones?: DocumentJsonValue | null;
    scope?: DocumentJsonValue | null;
    solutionProposal?: DocumentJsonValue | null;
    templateName?: string;
    templateVersion?: string;
  };
} & BusinessEditorProps) {
  const presented = presentSectionContent(value);
  const change = (next: DocumentJsonValue) =>
    onChange(restoreSectionContent(value, next));
  if (sectionKey === "header")
    return (
      <HeaderEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "objectives")
    return (
      <ObjectivesEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "problemDescription")
    return (
      <ProblemDescriptionEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "scope")
    return (
      <ScopeEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "solutionProposal")
    return (
      <SolutionProposalEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "processFlow")
    return (
      <ProcessModelsEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "milestones")
    return (
      <RequirementsEditor
        backlogValue={context?.backlogStructure}
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "backlogStructure")
    return (
      <BacklogStructureEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "nonFunctionalRequirements") {
    const normalized = normalizeNonFunctionalRequirements(presented);
    return (
      <KnownSectionEditor
        fields={NON_FUNCTIONAL_FIELDS}
        narrativeLabel="Requerimientos no funcionales"
        onChange={change}
        readOnly={readOnly}
        value={normalized ?? presented}
      />
    );
  }
  if (sectionKey === "tests")
    return (
      <TestsEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "assumptionsDependenciesPending")
    return (
      <PendingEditor onChange={change} readOnly={readOnly} value={presented} />
    );
  if (sectionKey === "approvalsAndChangeControl")
    return (
      <ApprovalsEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "automationInstruction")
    return (
      <KpiDashboardEditor
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "scrumPlan")
    return (
      <WorkPlanEditor
        backlogValue={context?.backlogStructure}
        onChange={change}
        readOnly={readOnly}
        value={presented}
      />
    );
  if (sectionKey === "writingRules" || sectionKey === "visualFormat")
    return (
      <SafeValueEditor
        label="Contenido de la sección"
        onChange={change}
        readOnly={readOnly}
        value={editableTemplateSectionValue(sectionKey, presented)}
      />
    );
  return (
    <SafeValueEditor
      label="Contenido de la sección"
      onChange={change}
      readOnly={readOnly}
      value={presented}
    />
  );
}
