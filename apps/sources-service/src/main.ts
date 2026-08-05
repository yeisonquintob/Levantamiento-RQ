import { resolve } from "node:path";

import fastifyMultipart from "@fastify/multipart";
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
} from "@levantamiento-rq/shared-config";

import { loadSourcesStorageConfig } from "./sources/sources-storage.config";

loadEnvironmentFiles({
  paths: [
    ".env",
    "infrastructure/docker/.env",
    "apps/sources-service/.env",
  ],
});

async function bootstrap(): Promise<void> {
  const config = loadBaseServiceConfig({
    serviceName: "sources-service",
    defaultPort: 3003,
  });
  const storageConfig = loadSourcesStorageConfig();
  const { AppModule } = await import("./app/app.module.js");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(fastifyMultipart as never, {
    limits: {
      files: storageConfig.maxFilesPerUpload,
      fileSize: storageConfig.maxFileBytes,
      parts: storageConfig.maxFilesPerUpload + 5,
    },
  });

  const globalPrefix = "api/v1";

  app.setGlobalPrefix(globalPrefix);

  if (config.environment === "development") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("Levantamiento RQ - Sources Service API")
      .setDescription(
        "Fuentes textuales, archivos, almacenamiento y extracción.",
      )
      .setVersion("1.0.0")
      .addBearerAuth()
      .addTag("health", "Disponibilidad técnica del servicio")
      .addTag(
        "sources",
        "Fuentes textuales, archivos y contenido extraído",
      )
      .build();

    const openApiDocument = SwaggerModule.createDocument(
      app,
      openApiConfig,
    );

    SwaggerModule.setup("api/docs", app, openApiDocument, {
      customSwaggerUiPath: resolve(
        __dirname,
        "../../../node_modules/swagger-ui-dist",
      ),
      customSiteTitle: "Levantamiento RQ - Sources Service API",
      swaggerOptions: {
        displayRequestDuration: true,
        persistAuthorization: false,
        withCredentials: true,
      },
    });
  }

  app.enableShutdownHooks();
  await app.listen(config.port, config.host);

  Logger.log(
    `Sources Service disponible en http://${config.host}:${config.port}/${globalPrefix} (${config.environment})`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
