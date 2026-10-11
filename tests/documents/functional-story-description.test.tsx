import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RequirementStoryDetail } from "../../apps/web/src/app/workspace/documents/[documentId]/document-section-presenter";

test("el documento histórico no duplica Como Quiero Para en la descripción", () => {
  const markup = renderToStaticMarkup(
    <RequirementStoryDetail
      story={{
        title: "Estandarizar proceso compra de herramientas",
        description:
          "COMO responsable del proceso de compra de herramientas, QUIERO estandarizar el proceso de compra de herramientas, incluyendo catálogo, códigos y aprobaciones, PARA contar con un flujo uniforme.",
        role: "responsable del proceso de compra de herramientas",
        want: "estandarizar el proceso de compra de herramientas, incluyendo catálogo, códigos y aprobaciones",
        benefit: "contar con un flujo uniforme",
        context: "Proceso de compra de herramientas",
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [],
      }}
    />,
  );

  assert.match(markup, /Descripción funcional breve/u);
  assert.match(markup, /Estandarizar el proceso de compra de herramientas/u);
  assert.equal((markup.match(/Como/g) ?? []).length, 1);
  assert.equal((markup.match(/Quiero/g) ?? []).length, 1);
  assert.equal((markup.match(/Para/g) ?? []).length, 1);
});
