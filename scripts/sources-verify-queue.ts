import { Queue } from "bullmq";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import { loadSourcesProcessingConfig } from "../apps/sources-service/src/sources/sources-processing.config.js";

loadEnvironmentFiles({
  paths: [
    ".env",
    "infrastructure/docker/.env",
    "apps/sources-service/.env",
  ],
});

async function main(): Promise<void> {
  const config = loadSourcesProcessingConfig();
  const queue = new Queue(config.queueName, { connection: config.connection });

  try {
    const client = await queue.client;
    const pong = await client.ping();

    if (pong !== "PONG") {
      throw new Error(`Redis respondió ${pong}.`);
    }

    const counts = await queue.getJobCounts(
      "active",
      "completed",
      "delayed",
      "failed",
      "paused",
      "prioritized",
      "waiting",
    );

    console.log("Redis y BullMQ verificados correctamente.");
    console.log(`Cola confirmada: ${config.queueName}`);
    console.log(`Estado actual: ${JSON.stringify(counts)}`);
  } finally {
    await queue.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`No se pudo verificar BullMQ: ${message}`);
  process.exitCode = 1;
});
