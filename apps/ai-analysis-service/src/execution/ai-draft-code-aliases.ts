import {
  AI_BACKLOG_CODE_PATTERNS,
  AI_FUNCTIONAL_CODE_PATTERNS,
  AI_PLANNING_CODE_PATTERNS,
} from "@levantamiento-rq/shared-contracts";
import { string } from "./ai-draft-parse-primitives";

type BacklogCodeKind = keyof typeof AI_BACKLOG_CODE_PATTERNS;

function normalizeBacklogCodeAlias(
  value: string,
  kind: BacklogCodeKind,
): string {
  let normalized = value
    .trim()
    .toUpperCase()
    .replace(/^\[|\]$/gu, "")
    .replaceAll(/\s+/gu, "-");

  const replacePrefix = (
    aliases: readonly string[],
    canonical: string,
  ): void => {
    for (const alias of aliases) {
      if (normalized.startsWith(`${alias}-`)) {
        normalized = `${canonical}-${normalized.slice(alias.length + 1)}`;
        return;
      }
    }
  };

  if (kind === "EPIC") replacePrefix(["EPIC", "E"], "EP");
  if (kind === "FEATURE") replacePrefix(["FEATURE", "F"], "FE");
  if (kind === "USER_STORY")
    replacePrefix(["USER-STORY", "USERSTORY", "STORY", "US"], "HU");
  if (kind === "ACCEPTANCE_CRITERION")
    replacePrefix(["ACCEPTANCE-CRITERION", "CRITERION", "AC"], "CA");
  if (kind === "TASK") replacePrefix(["TASK"], "T");

  // Models occasionally copy the human outline number into `code` or omit
  // the separator (EPIC1, F1, US1, T1). Keep sourceNumber independent while
  // recovering a deterministic technical identifier before graph validation.
  const compactAliases: Record<BacklogCodeKind, RegExp> = {
    EPIC: /^(?:EPIC|E)?-?(\d+(?:[.-]\d+)*)$/u,
    FEATURE: /^(?:FEATURE|FE|F)?-?(\d+(?:[.-]\d+)*)$/u,
    USER_STORY: /^(?:USER-?STORY|US|HU)?-?(\d+(?:[.-]\d+)*)$/u,
    ACCEPTANCE_CRITERION:
      /^(?:ACCEPTANCE-?CRITERION|AC|CA)?-?(\d+(?:[.-]\d+)*)$/u,
    TASK: /^(?:TASK|T)?-?(\d+(?:[.-]\d+)*)$/u,
  };
  const compactMatch = normalized.match(compactAliases[kind]);
  if (compactMatch?.[1]) {
    const suffix = compactMatch[1].replaceAll(".", "-");
    const prefixes: Record<BacklogCodeKind, string> = {
      EPIC: "EP",
      FEATURE: "FE",
      USER_STORY: "HU",
      ACCEPTANCE_CRITERION: "CA",
      TASK: "T",
    };
    normalized = `${prefixes[kind]}-${suffix}`;
  }

  // Drafts created before canonical code enforcement may contain a readable
  // placeholder such as "[PENDIENTE POR DEFINIR]". Preserve its meaning while
  // turning it into a stable code that historical results can still expose.
  if (!new RegExp(AI_BACKLOG_CODE_PATTERNS[kind], "u").test(normalized)) {
    const prefixes: Record<BacklogCodeKind, string> = {
      EPIC: "EP",
      FEATURE: "FE",
      USER_STORY: "HU",
      ACCEPTANCE_CRITERION: "CA",
      TASK: "T",
    };
    const safeSuffix = normalized
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/gu, "")
      .replaceAll(/[^A-Z0-9-]+/gu, "-")
      .replaceAll(/-+/gu, "-")
      .replace(/^-|-$/gu, "");
    if (safeSuffix) normalized = `${prefixes[kind]}-${safeSuffix}`;
  }

  return normalized;
}

export function canonicalBacklogCode(
  value: unknown,
  name: string,
  kind: BacklogCodeKind,
): string {
  const normalized = normalizeBacklogCodeAlias(string(value, name, 50), kind);
  if (!new RegExp(AI_BACKLOG_CODE_PATTERNS[kind], "u").test(normalized)) {
    throw new Error(
      `${name} no respeta el formato canónico ${AI_BACKLOG_CODE_PATTERNS[kind]}.`,
    );
  }
  return normalized;
}

export function canonicalReferenceCode(
  value: string,
  kind: BacklogCodeKind,
): string {
  return normalizeBacklogCodeAlias(value, kind);
}

export function canonicalFunctionalStoryCode(
  value: unknown,
  name: string,
): string {
  let normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (/^HU-(?!F-)/u.test(normalized))
    normalized = `HU-F-${normalized.slice(3)}`;
  if (
    !new RegExp(AI_FUNCTIONAL_CODE_PATTERNS.USER_STORY, "u").test(normalized)
  ) {
    throw new Error(`${name} no respeta el formato funcional HU-F-...`);
  }
  return normalized;
}

export function canonicalFunctionalCriterionCode(
  value: unknown,
  name: string,
): string {
  let normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (/^CA-(?!F-)/u.test(normalized))
    normalized = `CA-F-${normalized.slice(3)}`;
  if (
    !new RegExp(AI_FUNCTIONAL_CODE_PATTERNS.ACCEPTANCE_CRITERION, "u").test(
      normalized,
    )
  ) {
    throw new Error(`${name} no respeta el formato funcional CA-F-...`);
  }
  return normalized;
}

export function canonicalFunctionalNeedCode(
  value: unknown,
  name: string,
): string {
  const normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (!/^FN-[0-9]{3,}$/u.test(normalized)) {
    throw new Error(`${name} no respeta el formato funcional FN-###`);
  }
  return normalized;
}

export function canonicalPlanningStoryCode(
  value: unknown,
  name: string,
): string {
  let normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (/^HU-(?!P-)/u.test(normalized))
    normalized = `HU-P-${normalized.slice(3)}`;
  const compactMatch = normalized.match(
    /^(?:USER-?STORY|US|HU)?-?(\d+(?:[.-]\d+)*)$/u,
  );
  if (compactMatch?.[1]) {
    normalized = `HU-P-${compactMatch[1].replaceAll(".", "-")}`;
  }
  if (!new RegExp(AI_PLANNING_CODE_PATTERNS.USER_STORY, "u").test(normalized)) {
    throw new Error(`${name} no respeta el formato de planificación HU-P-...`);
  }
  return normalized;
}

export function canonicalFunctionalStoryReference(value: string): string {
  return canonicalFunctionalStoryCode(value, "referencia HU funcional");
}

export function canonicalFunctionalCriterionReference(value: string): string {
  return canonicalFunctionalCriterionCode(
    value,
    "referencia criterio funcional",
  );
}

export function canonicalPlanningStoryReference(value: string): string {
  return canonicalPlanningStoryCode(value, "referencia HU planificación");
}
