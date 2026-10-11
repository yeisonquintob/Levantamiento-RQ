"use client";

import React, { useEffect, useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { KpiRing } from "../../../execution/execution-checklist";
import {
  computeExecutionKpis,
  loadExecutionDoneCodes,
} from "../../../execution/execution-tracking";
import {
  EmptyValue,
  TextField,
  StringListEditor,
  type BusinessEditorProps,
} from "./primitives";
import {
  PENDING,
  recordValue,
  recordList,
  stringValue,
  stringList,
  numberValue,
  cleanDocumentText,
  displayText,
} from "./shared";

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

export function ScopeView({ value }: { value: DocumentJsonValue }) {
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

export function KpiDashboardView({
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
            stories: epic.stories.map((story) =>
              story.map((task) => task.code),
            ),
            loose: [],
          })),
          done,
        );
        setExecutionValues(
          kpis.doneTasks === 0 && done.size === 0
            ? null
            : [
                kpis.progress,
                kpis.objectiveCompliance,
                kpis.deliverableCompliance,
              ],
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
        <small>
          Fuente de actualización: seguimiento de ejecución del proyecto
        </small>
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

export function KpiDashboardEditor({
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

export function ScopeEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
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
