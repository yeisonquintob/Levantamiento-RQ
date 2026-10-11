import assert from "node:assert/strict";
import test from "node:test";
import type { AiAnalysisRequestSummary } from "@levantamiento-rq/shared-contracts";
import { latestVersionGeneration } from "../../apps/web/src/app/workspace/documents/document-generation-cells";

test("usa la última ejecución de la versión actual y no una aprobación o ejecución anterior", () => {
 const request = (version: number, date: string, status: string, documentId = "doc") => ({documentId, generatedVersionNumber: version, createdAt:date, status}) as AiAnalysisRequestSummary;
 const rows = [request(1,"2026-09-14","COMPLETED"),request(2,"2026-09-12","COMPLETED"),request(2,"2026-09-13","FAILED"),request(2,"2026-09-14","COMPLETED","other")];
 assert.equal(latestVersionGeneration(rows,"DOC",2)?.status,"FAILED");
 assert.equal(latestVersionGeneration(rows,"doc",3),undefined);
});

test("satisfactoria/fallida y Sí/No usan badges con tono success/danger", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  const { DocumentGenerationCells } = await import("../../apps/web/src/app/workspace/documents/document-generation-cells");
  assert.equal(typeof DocumentGenerationCells, "function");
  const source = (await import("node:fs")).readFileSync("apps/web/src/app/workspace/documents/document-generation-cells.tsx", "utf8");
  assert.match(source, /result\.tone === "danger" \|\| result\.tone === "success"/);
  assert.match(source, /<RqStatusBadge tone=\{result\.tone\}>/);
  const render = (hasPrototype: boolean) => renderToStaticMarkup(React.createElement("table", null, React.createElement("tbody", null, React.createElement("tr", null, React.createElement(DocumentGenerationCells, { gatewayUrl: "", projectId: "p", documentId: "d", versionNumber: 1, hasPrototype })))));
  assert.match(render(true), /data-rq-status="success">Sí</);
  assert.match(render(false), /data-rq-status="danger">No</);
});
