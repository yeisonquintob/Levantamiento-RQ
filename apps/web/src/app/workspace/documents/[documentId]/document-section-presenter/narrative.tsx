import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { HumanValue } from "./primitives";
import { displayText } from "./shared";

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

export function NarrativeView({ value }: { value: DocumentJsonValue }) {
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
