import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectAiOutboundContent,
  resolveAiDlpPolicy,
} from "../../apps/ai-analysis-service/src/execution/ai-data-loss-prevention.js";

test("DLP permite contenido funcional sin secretos", () => {
  const decision = inspectAiOutboundContent(
    "El usuario requiere restablecer su contraseña mediante un flujo autorizado.",
    "BLOCK",
  );
  assert.equal(decision.action, "ALLOW");
  assert.equal(decision.findings.length, 0);
});

test("DLP bloquea credenciales antes de OpenAI sin devolver el valor", () => {
  const secret = "sk-proj-abcdefghijklmnopqrstuv";
  const decision = inspectAiOutboundContent(`Credencial: ${secret}`, "BLOCK");
  assert.equal(decision.action, "BLOCK");
  assert.equal(decision.content, "");
  assert.equal(decision.findings[0]?.category, "API_KEY");
  assert.doesNotMatch(JSON.stringify(decision.findings), new RegExp(secret));
});

test("DLP redacta JWT, claves privadas, conexiones y contraseñas", () => {
  const content = [
    "password=SuperSecreta123",
    "Server=sql.local;Database=Rq;User Id=sa;Password=OtraSecreta;",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    "-----BEGIN PRIVATE KEY-----\nABCDEF123456\n-----END PRIVATE KEY-----",
  ].join("\n");
  const decision = inspectAiOutboundContent(content, "REDACT");
  assert.equal(decision.action, "REDACT");
  assert.ok(decision.findings.length >= 4);
  assert.doesNotMatch(decision.content, /SuperSecreta|sql\.local|eyJhbGci|ABCDEF/);
  assert.match(decision.content, /\[REDACTED:/);
});

test("DLP usa BLOCK por defecto y rechaza configuración insegura", () => {
  assert.equal(resolveAiDlpPolicy({}), "BLOCK");
  assert.throws(() => resolveAiDlpPolicy({ AI_DLP_POLICY: "ALLOW" }));
});
