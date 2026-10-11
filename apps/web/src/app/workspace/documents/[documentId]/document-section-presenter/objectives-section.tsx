import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  EmptyValue,
  TextField,
  StringListEditor,
  type BusinessEditorProps,
} from "./primitives";
import {
  PENDING,
  recordValue,
  stringValue,
  stringList,
  cleanDocumentText,
  displayText,
} from "./shared";

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

export function ObjectivesView({ value }: { value: DocumentJsonValue }) {
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

export function ObjectivesEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
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
