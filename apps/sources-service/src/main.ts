import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app/app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const globalPrefix = "api/v1";
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3003);

  app.setGlobalPrefix(globalPrefix);
  app.enableShutdownHooks();

  await app.listen(port, host);

  Logger.log(
    `Sources Service disponible en http://${host}:${port}/${globalPrefix}`,
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, "Bootstrap");
  process.exitCode = 1;
});
