import assert from "node:assert/strict";
import test from "node:test";

import { loadAiUsageLimits } from "../../apps/ai-analysis-service/src/security/ai-usage-guard.service.js";

test("los límites de IA tienen defaults conservadores", () => {
  assert.deepEqual(loadAiUsageLimits({}), {
    userRequestsHour: 5,
    userRequestsDay: 20,
    projectRequestsHour: 10,
    projectRequestsDay: 50,
    globalRequestsHour: 50,
    globalRequestsDay: 200,
    userTokensDay: 500_000,
    projectTokensDay: 2_000_000,
    globalTokensDay: 10_000_000,
    userConcurrent: 1,
    projectConcurrent: 2,
    globalConcurrent: 4,
    dailyBudgetUsd: 50,
    monthlyBudgetUsd: 500,
  });
});

test("los límites de IA rechazan cero, negativos y fracciones", () => {
  for (const invalid of ["0", "-1", "1.5", "texto"]) {
    assert.throws(() =>
      loadAiUsageLimits({ AI_QUOTA_USER_REQUESTS_HOUR: invalid }),
    );
  }
});
