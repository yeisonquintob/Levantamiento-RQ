"use client";
import React, { useEffect, useState } from "react";
import type {
  AiAnalysisRequestListResponse,
  AiAnalysisRequestSummary,
  DocumentVersionSummary,
} from "@levantamiento-rq/shared-contracts";
import { RqStatusBadge } from "@levantamiento-rq/shared-ui";

export function latestVersionGeneration(
  requests: readonly AiAnalysisRequestSummary[],
  documentId: string,
  versionNumber: number,
) {
  return requests
    .filter(
      (item) =>
        item.documentId.toLowerCase() === documentId.toLowerCase() &&
        item.generatedVersionNumber === versionNumber,
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export function DocumentGenerationCells({
  gatewayUrl,
  projectId,
  documentId,
  versionNumber,
  hasPrototype,
}: {
  gatewayUrl: string;
  projectId: string;
  documentId: string;
  versionNumber: number;
  /** Cuando se informa, se muestra la columna Prototipo entre ejecución y borrador. */
  hasPrototype?: boolean;
}) {
  const [result, setResult] = useState<{
    execution: string;
    tone: "success" | "danger" | "pending" | "inactive";
    draft: boolean;
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError(false);
    const read = async (path: string) => {
      const response = await fetch(`${gatewayUrl}/api/v1/${path}`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("No disponible");
      return response.json();
    };
    void (async () => {
      const versions = (await read(
        `documents/${encodeURIComponent(documentId)}/versions`,
      )) as readonly DocumentVersionSummary[];
      const requests: AiAnalysisRequestSummary[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const data = (await read(
          `projects/${encodeURIComponent(projectId)}/analysis-requests?page=${page}&pageSize=100`,
        )) as AiAnalysisRequestListResponse;
        requests.push(...data.items);
        totalPages = data.totalPages;
        page++;
      } while (page <= totalPages);
      const latest = latestVersionGeneration(
        requests,
        documentId,
        versionNumber,
      );
      const execution = !latest
        ? "Sin ejecución registrada"
        : latest.status === "COMPLETED"
          ? "Satisfactoria"
          : latest.status === "FAILED"
            ? "Fallida"
            : latest.status === "CANCELLED"
              ? "Cancelada"
              : "En proceso";
      if (!controller.signal.aborted)
        setResult({
          execution,
          tone:
            !latest || latest.status === "CANCELLED"
              ? "inactive"
              : latest.status === "COMPLETED"
                ? "success"
                : latest.status === "FAILED"
                  ? "danger"
                  : "pending",
          draft: versions.some((version) => version.status === "DRAFT"),
        });
    })().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [gatewayUrl, projectId, documentId, versionNumber]);
  return (
    <>
      <td>
        {result ? (
          result.tone === "danger" || result.tone === "success" ? (
            <RqStatusBadge tone={result.tone}>{result.execution}</RqStatusBadge>
          ) : (
            result.execution
          )
        ) : error ? (
          "No disponible"
        ) : (
          "Cargando…"
        )}
      </td>
      {hasPrototype === undefined ? null : (
        <td>
          <RqStatusBadge tone={hasPrototype ? "success" : "danger"}>
            {hasPrototype ? "Sí" : "No"}
          </RqStatusBadge>
        </td>
      )}
      <td>
        {result ? (
          <RqStatusBadge tone={result.draft ? "success" : "inactive"}>
            {result.draft ? "Sí" : "No"}
          </RqStatusBadge>
        ) : error ? (
          "No disponible"
        ) : (
          "Cargando…"
        )}
      </td>
    </>
  );
}
