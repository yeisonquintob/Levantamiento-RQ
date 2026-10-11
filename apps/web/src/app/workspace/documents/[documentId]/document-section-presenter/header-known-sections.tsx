import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { HEADER_CORE_KEYS, normalizeHeaderRecord } from "./header-model";
import { NarrativeView } from "./narrative";
import {
  EmptyValue,
  HumanValue,
  TextField,
  StringListEditor,
  SafeValueEditor,
  type BusinessEditorProps,
} from "./primitives";
import {
  recordValue,
  stringValue,
  stringList,
  humanLabel,
  displayText,
} from "./shared";

export function HeaderView({ value }: { value: DocumentJsonValue }) {
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

export function HeaderEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
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

export function KnownSectionView({
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

export function KnownSectionEditor({
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
