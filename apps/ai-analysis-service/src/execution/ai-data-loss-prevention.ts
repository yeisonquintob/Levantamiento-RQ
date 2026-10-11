import { createHash } from "node:crypto";

export type AiDlpPolicy = "BLOCK" | "REDACT";

export interface AiDlpFinding {
  category:
    | "API_KEY"
    | "CONNECTION_STRING"
    | "JWT"
    | "PASSWORD"
    | "PRIVATE_KEY";
  fingerprint: string;
}

export interface AiDlpDecision {
  action: "ALLOW" | "BLOCK" | "REDACT";
  content: string;
  findings: readonly AiDlpFinding[];
}

interface Detector {
  category: AiDlpFinding["category"];
  expression: RegExp;
}

const DETECTORS: readonly Detector[] = [
  {
    category: "PRIVATE_KEY",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    category: "API_KEY",
    expression: /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/gu,
  },
  {
    category: "CONNECTION_STRING",
    expression: /\b(?:DefaultEndpointsProtocol|Server|Data Source)\s*=\s*[^;\r\n]+(?:;[^\r\n]*){1,}/giu,
  },
  {
    category: "JWT",
    expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  },
  {
    category: "PASSWORD",
    expression: /\b(?:password|passwd|pwd|contrase(?:ña|na))\s*[:=]\s*(?!\[?REDACTED\]?|\*{3,}|<[^>]+>)[^\s,;]{8,}/giu,
  },
];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function resolveAiDlpPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): AiDlpPolicy {
  const value = environment.AI_DLP_POLICY?.trim().toUpperCase() || "BLOCK";
  if (value !== "BLOCK" && value !== "REDACT") {
    throw new Error("AI_DLP_POLICY debe ser BLOCK o REDACT.");
  }
  return value;
}

export function inspectAiOutboundContent(
  content: string,
  policy: AiDlpPolicy,
): AiDlpDecision {
  const findings: AiDlpFinding[] = [];
  let redacted = content;

  for (const detector of DETECTORS) {
    redacted = redacted.replace(detector.expression, (match) => {
      findings.push({
        category: detector.category,
        fingerprint: fingerprint(match),
      });
      return `[REDACTED:${detector.category}]`;
    });
  }

  if (findings.length === 0) {
    return { action: "ALLOW", content, findings };
  }

  if (policy === "BLOCK") {
    return { action: "BLOCK", content: "", findings };
  }

  return { action: "REDACT", content: redacted, findings };
}
