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
} from "./shared";

type NormalizedProblemDescription = {
  currentState: string;
  operationalImpact: string[];
};

export function splitProblemItems(value: string): string[] {
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

export function ProblemDescriptionView({
  value,
}: {
  value: DocumentJsonValue;
}) {
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

export function ProblemDescriptionEditor({
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
