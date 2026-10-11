import assert from "node:assert/strict";
import test from "node:test";

import type { RequirementDocumentDetail } from "@levantamiento-rq/shared-contracts";

import {
  buildProjectPresentationOutline,
  presentationFileName,
} from "../../apps/web/src/app/workspace/validation/project-presentation-export";

function documentWith(
  contents: Record<string, unknown>,
  title = "Automatización SOAT / Ñandú",
): RequirementDocumentDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    title,
    status: "DRAFT",
    revision: 1,
    currentVersionNumber: 1,
    currentVersion: "1.0.0",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    currentVersionDetail: {
      version: "1.0.0",
      sections: Object.entries(contents).map(([key, content], order) => ({
        id: `00000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
        key,
        title: key,
        order,
        content,
        templateControlled: false,
      })),
      fields: [],
      requirements: [],
      evidence: [],
    },
  } as unknown as RequirementDocumentDetail;
}

test("el outline contiene las ocho secciones en el nuevo orden y no el plan de trabajo", () => {
  const outline = buildProjectPresentationOutline(documentWith({}));
  assert.deepEqual(outline.sections, [
    "cover",
    "objective",
    "problem",
    "solution",
    "flowAsIs",
    "flowToBe",
    "processes",
    "kpi",
  ]);
  assert.ok(!JSON.stringify(outline.sections).match(/work|plan|scrum/i));
});

test("usa los datos del documento y no inventa KPI", () => {
  const outline = buildProjectPresentationOutline(
    documentWith({
      objectives: { general: "Digitalizar el SOAT.", specific: ["Registrar", "Consultar"] },
      problemDescription: { currentState: "Proceso manual.", operationalImpact: "Demoras; Reprocesos" },
      solutionProposal: { objective: "Automatizar", description: "Portal web.", involvedElements: ["CRM"] },
      scope: {
        kpis: [
          { name: "Tiempo de emisión", target: "< 5 min", measurement: "Promedio", frequency: "Mensual" },
          { name: "Sin meta" },
          { name: "C" },
          { name: "D" },
        ],
      },
    }),
  );
  assert.equal(outline.objective.general, "Digitalizar el SOAT.");
  assert.deepEqual(outline.problem.impacts, ["Demoras", "Reprocesos"]);
  assert.deepEqual(outline.solution.elements, ["CRM"]);
  assert.equal(outline.kpis.length, 3);
  assert.deepEqual(outline.kpis[0], {
    name: "Tiempo de emisión",
    current: "0%",
    target: "< 5 min",
    method: "Promedio · Frecuencia: Mensual",
  });
  assert.equal(outline.kpis[1]?.target, "Pendiente de definición");
  assert.ok(outline.kpis.every((kpi) => kpi.current === "0%"));

  const empty = buildProjectPresentationOutline(documentWith({}));
  assert.equal(empty.kpis.length, 0);
  assert.equal(empty.objective.general, "Pendiente de definición");
  assert.equal(empty.problem.currentState, "Sin información registrada");
});

function decodeSvg(dataUri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  assert.ok(dataUri.startsWith(prefix));
  return Buffer.from(dataUri.slice(prefix.length), "base64").toString("utf8");
}

test("AS-IS y TO-BE se convierten en imágenes SVG por carriles distintas, o se marcan ausentes", () => {
  const outline = buildProjectPresentationOutline(
    documentWith({
      processFlow: {
        processFlows: {
          asIs: {
            title: "Registro manual",
            lanes: [{ id: "l1", name: "Analista", kind: "ACTOR" }],
            nodes: [
              { id: "a", kind: "START", label: "Inicio manual", laneId: "l1" },
              { id: "b", kind: "END", label: "Fin manual", laneId: "l1" },
            ],
            edges: [{ from: "a", to: "b", label: null }],
          },
          toBe: {
            title: "Registro automático",
            lanes: [
              { id: "l1", name: "Analista", kind: "ACTOR" },
              { id: "l2", name: "Portal", kind: "SYSTEM" },
            ],
            nodes: [
              { id: "a", kind: "START", label: "Inicio auto", laneId: "l1" },
              { id: "b", kind: "DECISION", label: "¿Completo? <ok>", laneId: "l2" },
              { id: "c", kind: "END", label: "Fin auto", laneId: "l2" },
            ],
            edges: [
              { from: "a", to: "b", label: null },
              { from: "b", to: "c", label: "Sí" },
              { from: "b", to: "z", label: "roto" },
            ],
          },
        },
      },
    }),
  );
  assert.equal(outline.flowAsIs.available, true);
  assert.equal(outline.flowToBe.available, true);
  assert.notEqual(outline.flowAsIs.dataUri, outline.flowToBe.dataUri);
  const asIs = decodeSvg(outline.flowAsIs.dataUri);
  const toBe = decodeSvg(outline.flowToBe.dataUri);
  assert.ok(asIs.startsWith("<svg") && asIs.includes("Inicio manual"));
  assert.ok(!asIs.includes("Inicio auto"));
  assert.ok(toBe.includes("Portal") && toBe.includes("Sistema"));
  assert.ok(toBe.includes("&lt;ok") && !toBe.includes("<ok"));
  assert.ok(!toBe.includes("roto"));
  assert.ok(outline.flowToBe.width > 0 && outline.flowToBe.height > 0);

  const empty = buildProjectPresentationOutline(documentWith({}));
  assert.equal(empty.flowAsIs.available, false);
  assert.equal(empty.flowToBe.available, false);
  assert.equal(empty.flowToBe.dataUri, "");
});

test("un flujo histórico único se muestra como TO-BE y deja AS-IS ausente", () => {
  const outline = buildProjectPresentationOutline(
    documentWith({
      processFlow: {
        title: "Antiguo",
        nodes: [{ id: "a", kind: "START", label: "Inicio" }],
        edges: [],
      },
    }),
  );
  assert.equal(outline.flowToBe.available, true);
  assert.equal(outline.flowAsIs.available, false);
});

test("los procesos a implementar se calculan desde backlogStructure con máximo tres épicas", () => {
  const story = (tasks: number) => ({
    code: "HU",
    title: "Historia",
    tasks: Array.from({ length: tasks }, () => ({ code: "T", title: "Tarea" })),
  });
  const epic = (n: number, features: unknown[]) => ({
    code: `EP-${n}`,
    title: `Épica ${n}`,
    description: `Descripción ${n}`,
    features,
  });
  const outline = buildProjectPresentationOutline(
    documentWith({
      backlogStructure: {
        epics: [
          epic(1, [
            { code: "F1", title: "F", userStories: [story(2), story(1)] },
            { code: "F2", title: "F", userStories: [story(0)] },
          ]),
          epic(2, [{ code: "F3", title: "F", userStories: [story(3)] }]),
          epic(3, []),
          epic(4, []),
        ],
      },
    }),
  );
  assert.equal(outline.backlog.available, true);
  assert.deepEqual(outline.backlog.counts, {
    epics: 4,
    features: 3,
    userStories: 4,
    tasks: 6,
  });
  assert.equal(outline.backlog.epics.length, 3);
  assert.deepEqual(outline.backlog.epics[0], {
    code: "EP-1",
    title: "Épica 1",
    description: "Descripción 1",
  });

  const empty = buildProjectPresentationOutline(documentWith({})).backlog;
  assert.equal(empty.available, false);
  assert.deepEqual(empty.counts, { epics: 0, features: 0, userStories: 0, tasks: 0 });
  assert.equal(empty.epics.length, 0);
});

test("el nombre de archivo es seguro y termina en -presentacion.pptx", () => {
  assert.equal(
    presentationFileName("Automatización SOAT / Ñandú"),
    "automatizacion-soat-nandu-presentacion.pptx",
  );
  assert.equal(presentationFileName("   "), "proyecto-presentacion.pptx");
  assert.equal(
    buildProjectPresentationOutline(documentWith({})).fileName,
    "automatizacion-soat-nandu-presentacion.pptx",
  );
});
