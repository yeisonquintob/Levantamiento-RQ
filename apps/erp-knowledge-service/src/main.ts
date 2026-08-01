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

import { AppModule } from "./app/app.module";

loadEnvironmentFiles({
  paths: [".env", "apps/erp-knowledge-service/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "erp-knowledge-service",
    defaultPort: 3006,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const globalPrefix = "api/v1";

  app.setGlobalPrefix(globalPrefix);
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  Logger.log(
    `ERP Knowledge Service disponible en http://${config.host}:${config.port}/${globalPrefix} (${config.environment})`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
