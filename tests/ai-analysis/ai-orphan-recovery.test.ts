import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisExecutionEntity } from "../../apps/ai-analysis-service/src/analysis/analysis-execution.entity.js";
import { AnalysisRequestEntity } from "../../apps/ai-analysis-service/src/analysis/analysis-request.entity.js";
import { AiAnalysisService } from "../../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";

test("el arranque conserva jobs activos y recupera solicitudes huérfanas", async () => {
  const activeId = "11111111-1111-4111-8111-111111111111";
  const pendingOrphanId = "22222222-2222-4222-8222-222222222222";
  const processingOrphanId = "33333333-3333-4333-8333-333333333333";
  const startedAt = new Date("2026-08-12T20:00:00.000Z");
  const enqueued: Array<{
    requestId: string;
    correlationId: string;
    discriminator: string;
  }> = [];
  const transactionUpdates: Array<{
    target: unknown;
    id: string;
    changes: Record<string, unknown>;
  }> = [];
  const directUpdates: Array<{
    id: string;
    changes: Record<string, unknown>;
  }> = [];
  const candidates = [
    {
      id: activeId,
      status: "PENDING",
      updatedAt: new Date("2026-08-12T19:00:00.000Z"),
    },
    {
      id: pendingOrphanId,
      status: "PENDING",
      updatedAt: new Date("2026-08-12T19:10:00.000Z"),
    },
    {
      id: processingOrphanId,
      status: "PROCESSING",
      updatedAt: new Date("2026-08-12T19:20:00.000Z"),
    },
  ];

  const service = new AiAnalysisService(
    {
      find: async () => candidates,
      update: async (id: string, changes: Record<string, unknown>) => {
        directUpdates.push({ id, changes });
        return { affected: 1 };
      },
    } as never,
    {} as never,
    {
      find: async ({ where }: { where: { analysisRequestId: string } }) =>
        where.analysisRequestId === processingOrphanId
          ? [
              {
                id: "44444444-4444-4444-8444-444444444444",
                status: "PROCESSING",
                startedAt,
              },
            ]
          : [],
    } as never,
    {} as never,
    {
      transaction: async (
        callback: (manager: {
          update: (
            target: unknown,
            id: string,
            changes: Record<string, unknown>,
          ) => Promise<{ affected: number }>;
        }) => Promise<void>,
      ) =>
        callback({
          update: async (target, id, changes) => {
            transactionUpdates.push({ target, id, changes });
            return { affected: 1 };
          },
        }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      hasRunnableJob: async (requestId: string) => requestId === activeId,
      enqueue: async (
        requestId: string,
        correlationId: string,
        discriminator: string,
      ) => {
        enqueued.push({ requestId, correlationId, discriminator });
        return {};
      },
    } as never,
    {} as never,
  );

  await service.onModuleInit();

  assert.deepEqual(
    enqueued.map(({ requestId, discriminator }) => ({
      requestId,
      discriminator,
    })),
    [
      {
        requestId: pendingOrphanId,
        discriminator: `recovery-pending-${new Date("2026-08-12T19:10:00.000Z").valueOf()}`,
      },
      {
        requestId: processingOrphanId,
        discriminator: `recovery-processing-${new Date("2026-08-12T19:20:00.000Z").valueOf()}`,
      },
    ],
  );
  assert.equal(
    transactionUpdates.some(
      ({ target, changes }) =>
        target === AnalysisExecutionEntity &&
        changes.status === "FAILED" &&
        changes.errorCode === "AI_EXECUTION_INTERRUPTED",
    ),
    true,
  );
  assert.equal(
    transactionUpdates.some(
      ({ target, id, changes }) =>
        target === AnalysisRequestEntity &&
        id === processingOrphanId &&
        changes.status === "PENDING",
    ),
    true,
  );
  assert.deepEqual(directUpdates, []);
});

test("si una solicitud huérfana no puede reencolarse queda FAILED", async () => {
  const requestId = "55555555-5555-4555-8555-555555555555";
  const updates: Array<Record<string, unknown>> = [];
  const service = new AiAnalysisService(
    {
      find: async () => [
        {
          id: requestId,
          status: "PENDING",
          updatedAt: new Date("2026-08-12T19:00:00.000Z"),
        },
      ],
      update: async (_id: string, changes: Record<string, unknown>) => {
        updates.push(changes);
        return { affected: 1 };
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      hasRunnableJob: async () => false,
      enqueue: async () => {
        throw new Error("Redis no disponible");
      },
    } as never,
    {} as never,
  );

  await service.onModuleInit();

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.status, "FAILED");
  assert.equal(updates[0]?.errorCode, "AI_QUEUE_UNAVAILABLE");
});
