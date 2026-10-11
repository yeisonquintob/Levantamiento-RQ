import React, { type ReactNode } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  stringList,
  humanLabel,
  cleanDocumentText,
  visibleEntries,
  displayText,
} from "./shared";

export function EmptyValue({
  children = "Sin información registrada.",
}: {
  children?: ReactNode;
}) {
  return <p className="rq-document-empty-value">{children}</p>;
}

export function TextList({
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

export function Tags({ values }: { values: readonly string[] }) {
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

export function HumanValue({
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

export function TextField({
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

export function EditorDisclosure({
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

export function BacklogWorkItemIcon({
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

export function EditorHint() {
  return (
    <p className="rq-document-editor-hint">
      Los registros están resumidos. Abre únicamente el que quieras modificar.
    </p>
  );
}

function isPendingValue(value: DocumentJsonValue | undefined) {
  return !cleanDocumentText(stringValue(value)).trim();
}

export function featureContextMeta(feature: JsonRecord) {
  const base = `${stringList(feature.userStoryCodes).length} HU · ${stringList(feature.inScope).length} incluidos`;
  return isPendingValue(feature.objective)
    ? `${base} · ⚠ Falta definir objetivo`
    : base;
}

export function storyContextMeta(story: JsonRecord) {
  const criteria = recordList(story.acceptanceCriteria).length;
  const fields = recordList(story.fields).length;
  return criteria === 0
    ? `${criteria} criterios · ${fields} campos · ⚠ Falta criterio de aceptación`
    : `${criteria} criterios · ${fields} campos`;
}

export function StringListEditor({
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

export function ReferenceListEditor({
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

export function SafeValueEditor({
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

export function BusinessRecordCollectionEditor({
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

export interface BusinessEditorProps {
  value: DocumentJsonValue;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}
