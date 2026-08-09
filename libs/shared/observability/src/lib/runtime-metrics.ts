import type { FastifyInstance, FastifyRequest } from "fastify";

type OperationResult = "failed" | "succeeded";
type QueueJobState = "completed" | "enqueued" | "failed";

interface Aggregate {
  count: number;
  durationSeconds: number;
}

interface RuntimeTelemetryOptions {
  serviceName: string;
  globalPrefix?: string;
}

const registries = new Map<string, RuntimeMetrics>();

function label(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function metricLabels(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}="${label(value)}"`)
    .join(",");
}

export class RuntimeMetrics {
  private readonly startedAt = Date.now();
  private readonly http = new Map<string, Aggregate>();
  private readonly operations = new Map<string, Aggregate>();
  private readonly queueJobs = new Map<string, number>();
  private readonly queueWorkers = new Map<string, number>();

  constructor(readonly serviceName: string) {}

  observeHttp(method: string, statusCode: number, durationMs: number): void {
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    this.add(this.http, `${method.toUpperCase()}|${statusClass}`, durationMs);
  }

  observeOperation(
    operation: string,
    result: OperationResult,
    durationMs: number,
  ): void {
    this.add(this.operations, `${operation}|${result}`, durationMs);
  }

  recordQueueJob(queue: string, state: QueueJobState): void {
    const key = `${queue}|${state}`;
    this.queueJobs.set(key, (this.queueJobs.get(key) ?? 0) + 1);
  }

  setQueueWorkerConnected(queue: string, connected: boolean): void {
    this.queueWorkers.set(queue, connected ? 1 : 0);
  }

  toPrometheus(): string {
    const service = label(this.serviceName);
    const lines = [
      "# HELP rq_service_up Whether the service process is running.",
      "# TYPE rq_service_up gauge",
      `rq_service_up{service="${service}"} 1`,
      "# HELP rq_process_uptime_seconds Process uptime observed by the service.",
      "# TYPE rq_process_uptime_seconds gauge",
      `rq_process_uptime_seconds{service="${service}"} ${Math.max(0, (Date.now() - this.startedAt) / 1000)}`,
      "# HELP rq_http_requests_total HTTP requests grouped without paths or user data.",
      "# TYPE rq_http_requests_total counter",
    ];

    for (const [key, aggregate] of this.http) {
      const [method = "UNKNOWN", statusClass = "unknown"] = key.split("|");
      const labels = metricLabels({
        service: this.serviceName,
        method,
        status_class: statusClass,
      });
      lines.push(`rq_http_requests_total{${labels}} ${aggregate.count}`);
      lines.push(
        `rq_http_request_duration_seconds_sum{${labels}} ${aggregate.durationSeconds}`,
      );
      lines.push(
        `rq_http_request_duration_seconds_count{${labels}} ${aggregate.count}`,
      );
    }

    lines.push(
      "# HELP rq_operation_total Background operations by result.",
      "# TYPE rq_operation_total counter",
    );
    for (const [key, aggregate] of this.operations) {
      const [operation = "unknown", result = "failed"] = key.split("|");
      const labels = metricLabels({
        service: this.serviceName,
        operation,
        result,
      });
      lines.push(`rq_operation_total{${labels}} ${aggregate.count}`);
      lines.push(
        `rq_operation_duration_seconds_sum{${labels}} ${aggregate.durationSeconds}`,
      );
      lines.push(
        `rq_operation_duration_seconds_count{${labels}} ${aggregate.count}`,
      );
    }

    lines.push(
      "# HELP rq_queue_jobs_total Queue jobs observed since process start.",
      "# TYPE rq_queue_jobs_total counter",
    );
    for (const [key, count] of this.queueJobs) {
      const [queue = "unknown", state = "unknown"] = key.split("|");
      lines.push(
        `rq_queue_jobs_total{${metricLabels({ service: this.serviceName, queue, state })}} ${count}`,
      );
    }

    lines.push(
      "# HELP rq_queue_worker_connected Whether a local queue worker is connected.",
      "# TYPE rq_queue_worker_connected gauge",
    );
    for (const [queue, connected] of this.queueWorkers) {
      lines.push(
        `rq_queue_worker_connected{${metricLabels({ service: this.serviceName, queue })}} ${connected}`,
      );
    }

    return `${lines.join("\n")}\n`;
  }

  private add(
    target: Map<string, Aggregate>,
    key: string,
    durationMs: number,
  ): void {
    const current = target.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += Math.max(0, durationMs) / 1000;
    target.set(key, current);
  }
}

export function getRuntimeMetrics(serviceName: string): RuntimeMetrics {
  const existing = registries.get(serviceName);
  if (existing) return existing;
  const created = new RuntimeMetrics(serviceName);
  registries.set(serviceName, created);
  return created;
}

export function registerRuntimeTelemetry(
  fastifyInstance: unknown,
  options: RuntimeTelemetryOptions,
): RuntimeMetrics {
  const fastify = fastifyInstance as FastifyInstance;
  const metrics = getRuntimeMetrics(options.serviceName);
  const starts = new WeakMap<FastifyRequest, bigint>();
  const prefix = (options.globalPrefix ?? "api/v1").replace(/^\/+|\/+$/g, "");

  fastify.addHook("onRequest", (request, _reply, done) => {
    starts.set(request, process.hrtime.bigint());
    done();
  });
  fastify.addHook("onResponse", (request, reply, done) => {
    const started = starts.get(request);
    const durationMs = started
      ? Number(process.hrtime.bigint() - started) / 1_000_000
      : 0;
    metrics.observeHttp(request.method, reply.statusCode, durationMs);
    done();
  });

  fastify.get(`/${prefix}/health/ready`, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return {
      service: options.serviceName,
      status: "ready",
      timestampUtc: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
    };
  });
  fastify.get(`/${prefix}/metrics`, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return metrics.toPrometheus();
  });

  return metrics;
}
