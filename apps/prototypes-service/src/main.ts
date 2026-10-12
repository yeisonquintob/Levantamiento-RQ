import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  loadBaseServiceConfig,
  loadEnvironmentFiles,
  resolvePrototypeImageBodyLimit,
} from "@levantamiento-rq/shared-config";
import { registerRuntimeTelemetry } from "@levantamiento-rq/shared-observability";
loadEnvironmentFiles({
  paths: [".env", "infrastructure/docker/.env", "apps/prototypes-service/.env"],
});
async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "prototypes-service",
    defaultPort: 3009,
  });
  const { AppModule } = await import("./app/app.module.js");
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Una imagen importada viaja en base64 (+33 %): el límite sale de PROTOTYPE_IMAGE_MAX_BYTES.
    new FastifyAdapter({
      bodyLimit: resolvePrototypeImageBodyLimit(process.env),
    }),
  );
  const prefix = "api/v1";
  registerRuntimeTelemetry(app.getHttpAdapter().getInstance(), {
    serviceName: config.serviceName,
    globalPrefix: prefix,
  });
  app.setGlobalPrefix(prefix);
  if (config.environment === "development") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Levantamiento RQ - Prototypes Service API")
        .setVersion("1.0.0")
        .addBearerAuth()
        .addTag("prototypes")
        .build(),
    );
    SwaggerModule.setup("api/docs", app, document, {
      customSwaggerUiPath: resolve(
        __dirname,
        "../../../node_modules/swagger-ui-dist",
      ),
    });
  }
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  Logger.log(
    `Prototypes Service disponible en http://${config.host}:${config.port}/${prefix}`,
    "Bootstrap",
  );
}
void bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    "Bootstrap",
  );
  process.exitCode = 1;
});
