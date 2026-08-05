import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type RequirementDocumentDetail,
  type RequirementDocumentSummary,
} from "../../libs/shared/contracts/src/lib/documents.js";
import type {
  ProjectDetail,
  ProjectListResponse,
} from "../../libs/shared/contracts/src/lib/projects.js";
import { DocumentsWorkspace } from "../../apps/web/src/app/workspace/documents/documents-workspace.js";
import { ValidationWorkspace } from "../../apps/web/src/app/workspace/validation/validation-workspace.js";
import {
  analyzeContent,
  RequirementDocumentEditor,
} from "../../apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.js";

const project: ProjectDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "RQ-2026-000001",
  title: "Proyecto de prueba",
  requestingArea: "Operaciones",
  description: null,
  status: "DRAFT",
  template: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "RQ-SMALL",
    name: "Requerimiento pequeño",
    version: "1.0.0",
    templateType: "SMALL_REQUIREMENT",
  },
  ownerUserId: "33333333-3333-4333-8333-333333333333",
  participantCount: 1,
  participants: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      userId: "33333333-3333-4333-8333-333333333333",
      role: "OWNER",
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  ],
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

const document: RequirementDocumentDetail = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId: project.id,
  title: "Levantamiento de prueba",
  status: "DRAFT",
  revision: 1,
  currentVersionNumber: 1,
  currentVersion: "1.0.0",
  template: {
    id: "66666666-6666-4666-8666-666666666666",
    sourceTemplateId: project.template?.id ?? "",
    code: project.template?.code ?? "",
    name: project.template?.name ?? "",
    version: project.template?.version ?? "",
    templateType: "SMALL_REQUIREMENT",
    appliedAt: "2026-08-05T00:00:00.000Z",
  },
  createdByUserId: project.ownerUserId,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  archivedAt: null,
  currentVersionDetail: {
    id: "77777777-7777-4777-8777-777777777777",
    versionNumber: 1,
    version: "1.0.0",
    status: "DRAFT",
    revision: 1,
    changeSummary: "Versión inicial",
    createdByUserId: project.ownerUserId,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    approvedByUserId: null,
    approvedAt: null,
    sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
      id: `${String(index + 10).padStart(8, "0")}-0000-4000-8000-000000000000`,
      key: section.key,
      title: section.title,
      order: index + 1,
      content: { value: index === 0 ? "Definido" : "[PENDIENTE POR DEFINIR]" },
      templateControlled: index >= 10,
    })),
    fields: [],
    requirements: [],
    evidence: [],
  },
};

test("el listado renderiza proyecto, creación manual y estado vacío", () => {
  const projects: ProjectListResponse = {
    items: [project],
    page: 1,
    pageSize: 50,
    totalItems: 1,
    totalPages: 1,
  };
  const html = renderToStaticMarkup(
    <DocumentsWorkspace
      initialDocuments={{ items: [], totalItems: 0 }}
      initialProjectId={project.id}
      initialProjects={projects}
    />,
  );

  assert.match(html, /Nuevo documento/);
  assert.match(html, /Proyecto de prueba/);
  assert.match(html, /Requerimiento pequeño/);
  assert.match(html, /No hay documentos/);
});

test("el editor renderiza las trece secciones, avance y área futura de IA", () => {
  const html = renderToStaticMarkup(
    <RequirementDocumentEditor initialDocument={document} project={project} />,
  );

  for (const section of DOCUMENT_SECTION_DEFINITIONS) {
    assert.match(html, new RegExp(section.title));
  }
  assert.match(html, /13 secciones/);
  assert.match(html, /Cambios sin guardar|Sin cambios pendientes/);
  assert.match(html, /Propuestas de inteligencia artificial/);
  assert.match(
    html,
    /Las propuestas de inteligencia artificial se habilitarán en el Paso 18/,
  );
  assert.doesNotMatch(html, /Generar con IA|Analizar con IA/);
});

test("la bandeja de validación está habilitada y abre el flujo documental", async () => {
  const summary: RequirementDocumentSummary = document;
  const projects: ProjectListResponse = {
    items: [project],
    page: 1,
    pageSize: 50,
    totalItems: 1,
    totalPages: 1,
  };
  const html = renderToStaticMarkup(
    <ValidationWorkspace
      initialDocuments={[
        {
          ...summary,
          projectCode: project.code,
          projectTitle: project.title,
        },
      ]}
      initialProjects={projects}
    />,
  );
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");

  assert.match(html, /Bandeja de validación/);
  assert.match(html, /Preparar/);
  assert.match(html, /Proyecto de prueba/);
  assert.match(shell, /href="\/workspace\/validation"/);
  assert.doesNotMatch(shell, /futureNavigation/);
});

test("la validación distingue obligatorios, pendientes y avance", () => {
  const result = analyzeContent({
    title: "",
    objective: "[PENDIENTE POR DEFINIR]",
    scope: ["Elemento definido"],
  });

  assert.equal(result.total, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? "", /Título.*obligatorio/i);
});

test("navegación, guardado, concurrencia, bloqueo y confirmaciones están implementados", async () => {
  const editor = await readFile(
    "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
    "utf8",
  );

  assert.match(editor, /beforeunload/);
  assert.match(editor, /Cambios sin guardar/);
  assert.match(editor, /expectedRevision: version\.revision/);
  assert.match(editor, /response\.status === 409/);
  assert.match(editor, /Recargar versión/);
  assert.match(editor, /version\.status !== "DRAFT"/);
  assert.match(editor, /Esta versión está aprobada y bloqueada/);
  assert.match(editor, /window\.confirm/);
  assert.match(editor, /Motivo de la nueva versión/);
  assert.match(editor, /Confirmar nueva versión/);
  assert.match(editor, /Comparar versiones/);
  assert.match(editor, /Historial/);
});

test("el editor es responsive y Web solo consume Gateway", async () => {
  const styles = await readFile("libs/shared/ui/src/styles.css", "utf8");
  const editor = await readFile(
    "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
    "utf8",
  );
  const list = await readFile(
    "apps/web/src/app/workspace/documents/documents-workspace.tsx",
    "utf8",
  );

  assert.match(styles, /@media \(max-width: 980px\)/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /\.rq-document-editor__layout/);
  assert.match(editor, /NEXT_PUBLIC_GATEWAY_URL/);
  assert.match(list, /NEXT_PUBLIC_GATEWAY_URL/);
  assert.doesNotMatch(editor, /127\.0\.0\.1:3004|documentsServiceUrl/);
  assert.doesNotMatch(list, /127\.0\.0\.1:3004|documentsServiceUrl/);
});
