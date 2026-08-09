import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeMetrics } from "../../libs/shared/observability/src/lib/runtime-metrics";

test("las métricas agregan HTTP, trabajos y operaciones sin rutas ni identificadores", () => {
  const metrics = new RuntimeMetrics("test-service");
  metrics.observeHttp("post", 201, 250);
  metrics.observeOperation("document_export", "succeeded", 500);
  metrics.recordQueueJob("exports", "enqueued");
  metrics.setQueueWorkerConnected("exports", true);

  const output = metrics.toPrometheus();
  assert.match(
    output,
    /rq_http_requests_total\{[^}]*method="POST"[^}]*status_class="2xx"[^}]*\} 1/,
  );
  assert.match(
    output,
    /rq_operation_total\{[^}]*operation="document_export"[^}]*result="succeeded"[^}]*\} 1/,
  );
  assert.match(
    output,
    /rq_queue_jobs_total\{[^}]*queue="exports"[^}]*state="enqueued"[^}]*\} 1/,
  );
  assert.match(
    output,
    /rq_queue_worker_connected\{[^}]*queue="exports"[^}]*\} 1/,
  );
  assert.doesNotMatch(
    output,
    /project_id|user_id|document_id|[\w.+-]+@[\w.-]+|\/[Aa][Pp][Ii]\//,
  );
});
