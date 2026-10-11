// Punto 13 «Prototipo»: la solicitud de prototipo se muestra por bloques y no se
// parte en títulos falsos («Actores», «Sistemas», «incluye») por palabras sueltas.
import assert from "node:assert/strict";
import test from "node:test";

import * as ReactAll from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as unknown as { React: unknown }).React = ReactAll;

import { DocumentSectionView } from "../../apps/web/src/app/workspace/documents/[documentId]/document-section-presenter";

const brief = [
  "SOLICITUD DE PROTOTIPO",
  "Aplicación: Proceso de Soat.",
  "Propósito: Controlar solicitudes.",
  "Actores: Usuario solicitante; Administrador.",
  "Sistemas e integraciones visibles: Microsoft Dynamics 365 (D365); Cero Papel.",
  "",
  "FUNCIONES POR MÓDULO (cada módulo es un Hito de Requerimientos)",
  "Módulo: Gestión de Solicitudes",
  "- HU-F-009 Registro inicial — registrar una solicitud",
  "  Campos: Nombre (obligatorio), Fecha.",
  "- HU-F-010 Control de habilitación",
  "(+3 funciones más en Requerimientos)",
  "",
  "ESTILO VISUAL (sistema de diseño corporativo, CORPORATE_DEFAULT_V1)",
  "- Todas las pantallas siempre incluyen estados vacío, de error y de éxito.",
].join("\n");

test("el punto 13 muestra resumen, módulos y estilo en su bloque", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentSectionView, {
      sectionKey: "visualFormat",
      value: brief,
    }),
  );
  assert.match(html, /<h3>Resumen<\/h3>/u);
  assert.match(
    html,
    /<dt>Actores<\/dt><dd>Usuario solicitante; Administrador<\/dd>/u,
  );
  assert.match(html, /<h3>Funciones por módulo<\/h3>/u);
  assert.match(html, /<h4>Gestión de Solicitudes<\/h4>/u);
  assert.match(html, /Campos: Nombre \(obligatorio\), Fecha/u);
  assert.match(html, /<h3>Estilo visual<\/h3>/u);
  // La palabra «incluyen» dentro del estilo no crea un título «incluye».
  assert.doesNotMatch(html, /<h3>incluye<\/h3>/u);
});

test("el texto «Prototipo no solicitado» se muestra como texto normal", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentSectionView, {
      sectionKey: "visualFormat",
      value: "Prototipo no solicitado en esta generación.",
    }),
  );
  assert.match(html, /Prototipo no solicitado/u);
  assert.doesNotMatch(html, /Funciones por módulo/u);
});
