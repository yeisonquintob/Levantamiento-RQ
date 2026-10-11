import type { AnalysisRequestEntity } from "./analysis-request.entity";

type AnalysisRequestOriginFields = Pick<
  AnalysisRequestEntity,
  "purpose" | "idempotencyKey" | "documentSnapshotJson"
>;

const SOURCES_VERSION_CHANGE_SUMMARY =
  "Nueva versión generada con IA a partir de fuentes procesadas";

export function isSourcesGenerationRequest(
  request: AnalysisRequestOriginFields,
): boolean {
  if (request.purpose === "INITIAL_DRAFT") {
    return true;
  }

  if (request.idempotencyKey.startsWith("sources-")) {
    return true;
  }

  if (!request.documentSnapshotJson) {
    return false;
  }

  try {
    const snapshot = JSON.parse(request.documentSnapshotJson) as {
      currentVersionDetail?: {
        changeSummary?: unknown;
      };
    };

    return (
      snapshot.currentVersionDetail?.changeSummary ===
      SOURCES_VERSION_CHANGE_SUMMARY
    );
  } catch {
    return false;
  }
}
