import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { NarrativeView } from "./narrative";
import {
  Tags,
  TextField,
  StringListEditor,
  SafeValueEditor,
  type BusinessEditorProps,
} from "./primitives";
import { recordValue, stringValue, stringList, displayText } from "./shared";

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

export function SolutionProposalView({ value }: { value: DocumentJsonValue }) {
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

export function SolutionProposalEditor({
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
