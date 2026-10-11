import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { EmptyValue, Tags, HumanValue } from "./primitives";
import { normalizeStoryAcceptanceCriteria } from "./requirements-model";
import {
  type JsonRecord,
  recordList,
  stringValue,
  functionalStoryDescriptionForDisplay,
  stringList,
  displayText,
} from "./shared";

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
