import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";

import {
  asUtcIsoDateString,
  type ProblemDetails,
} from "@levantamiento-rq/shared-contracts";
import { ApplicationError } from "@levantamiento-rq/shared-errors";

import {
  CORRELATION_ID_HEADER,
  type CorrelationAwareRequest,
  resolveCorrelationId,
} from "./correlation-id.js";

interface SendableResponse {
  status(statusCode: number): SendableResponse;
  send(body: unknown): unknown;
}

interface ResolvedError {
  statusCode: number;
  code: string;
  title: string;
  detail: string;
  errors?: Readonly<Record<string, readonly string[]>>;
}

function titleForStatus(statusCode: number): string {
  const titles: Readonly<Record<number, string>> = {
    400: "La solicitud no es válida",
    401: "Autenticación requerida",
    403: "Acceso denegado",
    404: "Recurso no encontrado",
    409: "Conflicto",
    500: "Error interno",
  };

  return titles[statusCode] ?? "Error de solicitud";
}

function resolveHttpException(exception: HttpException): ResolvedError {
  const statusCode = exception.getStatus();
  const response = exception.getResponse();

  if (typeof response === "string") {
    return {
      statusCode,
      code: "HTTP_ERROR",
      title: titleForStatus(statusCode),
      detail: response,
    };
  }

  const record = response as Readonly<Record<string, unknown>>;
  const rawMessage = record.message;

  if (Array.isArray(rawMessage)) {
    const messages = rawMessage.map(String);

    return {
      statusCode,
      code: "VALIDATION_ERROR",
      title: titleForStatus(statusCode),
      detail: "Uno o más campos presentan errores.",
      errors: {
        request: messages,
      },
    };
  }

  return {
    statusCode,
    code: "HTTP_ERROR",
    title:
      typeof record.error === "string"
        ? record.error
        : titleForStatus(statusCode),
    detail: typeof rawMessage === "string" ? rawMessage : exception.message,
  };
}

function resolveError(exception: unknown): ResolvedError {
  if (exception instanceof ApplicationError) {
    return {
      statusCode: exception.statusCode,
      code: exception.code,
      title: titleForStatus(exception.statusCode),
      detail: exception.message,
    };
  }

  if (exception instanceof HttpException) {
    return resolveHttpException(exception);
  }

  return {
    statusCode: 500,
    code: "UNHANDLED_ERROR",
    title: titleForStatus(500),
    detail: "Ocurrió un error inesperado.",
  };
}

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<CorrelationAwareRequest>();
    const response = http.getResponse<SendableResponse>();
    const resolved = resolveError(exception);

    const correlationId =
      request.correlationId ??
      resolveCorrelationId(request.headers?.[CORRELATION_ID_HEADER]);

    const body: ProblemDetails = {
      type: `https://errors.levantamiento-rq.local/${resolved.code.toLowerCase()}`,
      title: resolved.title,
      status: resolved.statusCode,
      detail: resolved.detail,
      instance: request.url ?? request.raw?.url ?? "",
      correlationId,
      timestampUtc: asUtcIsoDateString(new Date().toISOString()),
      metadata: {
        code: resolved.code,
      },
      ...(resolved.errors === undefined ? {} : { errors: resolved.errors }),
    };

    response.status(resolved.statusCode).send(body);
  }
}
