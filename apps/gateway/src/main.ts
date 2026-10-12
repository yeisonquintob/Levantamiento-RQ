import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import fastifyMultipart from "@fastify/multipart";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import {
  DEFAULT_JSON_BODY_LIMIT,
  limitBodyForPrototypeImport,
  loadEnvironmentFiles,
} from "@levantamiento-rq/shared-config";
import {
  ApplicationExceptionFilter,
  CorrelationIdInterceptor,
} from "@levantamiento-rq/shared-http";
import {
  createStructuredLogEntry,
  registerRuntimeTelemetry,
} from "@levantamiento-rq/shared-observability";

import { AppModule } from "./app/app.module";
import { ACCESS_COOKIE, hasCookie, REFRESH_COOKIE } from "./auth/cookies";
import { loadGatewayConfig } from "./config/gateway-config";
import { isBrowserMutationAllowed } from "./security/gateway-security";

loadEnvironmentFiles({
  paths: [".env", "apps/gateway/.env"],
});

async function bootstrap(): Promise<void> {
  const config = loadGatewayConfig();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // El resto de rutas conserva 20 MB; la importación de imágenes (base64) tiene su propio límite.
    new FastifyAdapter({ bodyLimit: DEFAULT_JSON_BODY_LIMIT }),
  );

  limitBodyForPrototypeImport(
    app.getHttpAdapter().getInstance() as never,
    process.env,
  );

  await app.register(fastifyMultipart as never, {
    limits: {
      files: config.sourcesMaxFilesPerUpload,
      fileSize: config.sourcesMaxFileBytes,
      parts: config.sourcesMaxFilesPerUpload + 5,
    },
  });

  const fastify = app.getHttpAdapter().getInstance();
  registerRuntimeTelemetry(fastify, {
    serviceName: config.serviceName,
    globalPrefix: config.globalPrefix,
  });
  fastify.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "private, no-store, max-age=0");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );

    if (config.environment === "production" && config.cookieSecure) {
      reply.header(
        "strict-transport-security",
        "max-age=31536000; includeSubDomains",
      );
    }

    const originHeader = request.headers.origin;
    const fetchSiteHeader = request.headers["sec-fetch-site"];
    const cookieHeader = request.headers.cookie;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const secFetchSite = Array.isArray(fetchSiteHeader)
      ? fetchSiteHeader[0]
      : fetchSiteHeader;

    if (
      !isBrowserMutationAllowed({
        hasSessionCookie:
          hasCookie(cookieHeader, ACCESS_COOKIE) ||
          hasCookie(cookieHeader, REFRESH_COOKIE),
        method: request.method,
        origin,
        secFetchSite,
        webOrigins: config.webOrigins,
      })
    ) {
      const correlationHeader = request.headers["x-correlation-id"];
      const correlationId =
        (Array.isArray(correlationHeader)
          ? correlationHeader[0]
          : correlationHeader) ?? randomUUID();

      await reply.status(403).send({
        type: "about:blank",
        title: "Solicitud rechazada",
        status: 403,
        detail: "El origen de la solicitud no está autorizado.",
        correlationId,
      });
    }
  });

  app.setGlobalPrefix(config.globalPrefix);
  app.enableCors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }

      callback(null, config.webOrigins.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-correlation-id",
      "x-idempotency-key",
    ],
  });
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new ApplicationExceptionFilter());

  if (config.environment === "development") {
    const openApiConfig = new DocumentBuilder()
      .setTitle("Levantamiento RQ - Gateway API")
      .setDescription(
        "Punto de entrada del frontend para identidad, proyectos, fuentes, documentos y análisis.",
      )
      .setVersion("1.0.0")
      .addTag("health", "Disponibilidad técnica del servicio")
      .addTag("authentication", "Identidad y sesiones")
      .addTag("projects", "Proyectos y participantes")
      .addTag("sources", "Fuentes textuales, archivos y procesamiento")
      .addTag("templates", "Catálogo de plantillas documentales versionadas")
      .addTag(
        "analysis",
        "Solicitudes controladas de análisis de requerimientos",
      )
      .addTag(
        "workflow",
        "Revisiones, comentarios, correcciones, aprobaciones y rechazos",
      )
      .addCookieAuth("rq_access")
      .addCookieAuth("rq_refresh")
      .addBearerAuth()
      .build();

    const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

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
      aiAnalysisServiceUrl: config.aiAnalysisServiceUrl,
      workflowServiceUrl: config.workflowServiceUrl,
      webOrigins: config.webOrigins,
    },
  });

  Logger.log(JSON.stringify(entry), "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
