import { resolve } from "node:path";

import fastifyMultipart from "@fastify/multipart";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  ApplicationExceptionFilter,
  CorrelationIdInterceptor,
} from "@levantamiento-rq/shared-http";
import { createStructuredLogEntry } from "@levantamiento-rq/shared-observability";

import { AppModule } from "./app/app.module";
import { loadGatewayConfig } from "./config/gateway-config";

loadEnvironmentFiles({
  paths: [".env", "apps/gateway/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadGatewayConfig();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(fastifyMultipart as never, {
    limits: {
      files: config.sourcesMaxFilesPerUpload,
      fileSize: config.sourcesMaxFileBytes,
      parts: config.sourcesMaxFilesPerUpload + 5,
    },
  });

  app.setGlobalPrefix(config.globalPrefix);
  app.enableCors({
    origin: config.webOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-correlation-id",
    ],
  });
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new ApplicationExceptionFilter());

  if (config.environment === "development") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("Levantamiento RQ - Gateway API")
      .setDescription(
        "Punto de entrada del frontend para identidad, proyectos y fuentes.",
      )
      .setVersion("1.0.0")
      .addTag("health", "Disponibilidad técnica del servicio")
      .addTag("authentication", "Identidad y sesiones")
      .addTag("projects", "Proyectos y participantes")
      .addTag(
        "sources",
        "Fuentes textuales, archivos y procesamiento",
      )
      .addTag(
        "templates",
        "Catálogo de plantillas documentales versionadas",
      )
      .addCookieAuth("rq_access")
      .addCookieAuth("rq_refresh")
      .addBearerAuth()
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
      customSiteTitle: "Levantamiento RQ - Gateway API",
      swaggerOptions: {
        displayRequestDuration: true,
        persistAuthorization: false,
        withCredentials: true,
      },
    });
  }

  app.enableShutdownHooks();
  await app.listen(config.port, config.host);

  const entry = createStructuredLogEntry("info", "Gateway iniciado", {
    service: config.serviceName,
    operation: "bootstrap",
    metadata: {
      environment: config.environment,
      host: config.host,
      port: config.port,
      globalPrefix: config.globalPrefix,
      version: config.version,
      identityServiceUrl: config.identityServiceUrl,
      projectsServiceUrl: config.projectsServiceUrl,
      sourcesServiceUrl: config.sourcesServiceUrl,
      documentsServiceUrl: config.documentsServiceUrl,
      webOrigin: config.webOrigin,
    },
  });

  Logger.log(JSON.stringify(entry), "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
