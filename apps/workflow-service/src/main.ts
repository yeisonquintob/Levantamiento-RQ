import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import {
  loadBaseServiceConfig,
  loadEnvironmentFiles,
} from "@levantamiento-rq/shared-config";

loadEnvironmentFiles({
  paths: [".env", "apps/workflow-service/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "workflow-service",
    defaultPort: 3007,
  });

  const { AppModule } = await import("./app/app.module.js");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const globalPrefix = "api/v1";

  app.setGlobalPrefix(globalPrefix);
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  Logger.log(
    `Workflow Service disponible en http://${config.host}:${config.port}/${globalPrefix} (${config.environment})`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
