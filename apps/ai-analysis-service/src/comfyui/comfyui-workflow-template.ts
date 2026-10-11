import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { ConflictException } from "@nestjs/common";

export interface ComfyUiWorkflowReference {
  fileName: string;
  model: string | null;
}

export interface ComfyUiWorkflowRuntimeValues {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  model: string | null;
}

const WORKFLOW_PREFIX = "workflow:";
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u;

export function parseComfyUiWorkflowReference(
  configured: string,
): ComfyUiWorkflowReference | null {
  const normalized = configured.trim();
  if (!normalized.toLowerCase().startsWith(WORKFLOW_PREFIX)) return null;

  const payload = normalized.slice(WORKFLOW_PREFIX.length).trim();
  const separator = payload.indexOf("|");
  const rawFileName =
    separator >= 0 ? payload.slice(0, separator).trim() : payload;
  const rawModel =
    separator >= 0 ? payload.slice(separator + 1).trim() : "";

  if (
    !rawFileName ||
    basename(rawFileName) !== rawFileName ||
    !SAFE_FILE_NAME.test(rawFileName)
  ) {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_REFERENCE_INVALID",
      message:
        "El workflow de ComfyUI debe usar el formato workflow:archivo.json o workflow:archivo.json|modelo.",
    });
  }

  if (rawModel.length > 180 || rawModel.includes("\0")) {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_MODEL_INVALID",
      message: "El modelo asociado al workflow de ComfyUI no es válido.",
    });
  }

  return {
    fileName: rawFileName,
    model: rawModel || null,
  };
}

function workflowCandidates(fileName: string): string[] {
  return [
    join(__dirname, "assets", "comfyui-workflows", fileName),
    join(__dirname, "..", "assets", "comfyui-workflows", fileName),
    join(
      process.cwd(),
      "apps",
      "ai-analysis-service",
      "src",
      "assets",
      "comfyui-workflows",
      fileName,
    ),
    join(process.cwd(), "src", "assets", "comfyui-workflows", fileName),
  ];
}

export function loadComfyUiWorkflowTemplate(
  reference: ComfyUiWorkflowReference,
): Record<string, unknown> {
  const path = workflowCandidates(reference.fileName).find((candidate) =>
    existsSync(candidate),
  );

  if (!path) {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_NOT_FOUND",
      message: `No existe el workflow local "${reference.fileName}".`,
    });
  }

  const raw = readFileSync(path);
  if (raw.byteLength === 0 || raw.byteLength > MAX_WORKFLOW_BYTES) {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_SIZE_INVALID",
      message: `El workflow "${reference.fileName}" está vacío o supera 1 MB.`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_JSON_INVALID",
      message: `El workflow "${reference.fileName}" no contiene JSON válido.`,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_ROOT_INVALID",
      message: `El workflow "${reference.fileName}" debe ser un objeto JSON de API de ComfyUI.`,
    });
  }

  return parsed as Record<string, unknown>;
}

function replaceStringToken(
  value: string,
  values: ComfyUiWorkflowRuntimeValues,
): string | number {
  const numeric: Record<string, number> = {
    "{{RQ_WIDTH}}": values.width,
    "{{RQ_HEIGHT}}": values.height,
    "{{RQ_SEED}}": values.seed,
  };
  if (value in numeric) return numeric[value];

  if (value === "{{RQ_MODEL}}") {
    if (!values.model) {
      throw new ConflictException({
        errorCode: "COMFYUI_WORKFLOW_MODEL_REQUIRED",
        message:
          "El workflow requiere {{RQ_MODEL}}. Configura el proveedor como workflow:archivo.json|modelo.",
      });
    }
    return values.model;
  }

  return value
    .replaceAll("{{RQ_PROMPT}}", values.prompt)
    .replaceAll("{{RQ_NEGATIVE_PROMPT}}", values.negativePrompt)
    .replaceAll("{{RQ_MODEL}}", values.model ?? "");
}

function renderValue(
  value: unknown,
  values: ComfyUiWorkflowRuntimeValues,
): unknown {
  if (typeof value === "string") return replaceStringToken(value, values);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        renderValue(item, values),
      ]),
    );
  }
  return value;
}

export function renderComfyUiWorkflowTemplate(
  template: Record<string, unknown>,
  values: ComfyUiWorkflowRuntimeValues,
): Record<string, unknown> {
  const rendered = renderValue(template, values);
  if (!rendered || typeof rendered !== "object" || Array.isArray(rendered)) {
    throw new ConflictException({
      errorCode: "COMFYUI_WORKFLOW_RENDER_INVALID",
      message: "No fue posible preparar el workflow de ComfyUI.",
    });
  }
  return rendered as Record<string, unknown>;
}
