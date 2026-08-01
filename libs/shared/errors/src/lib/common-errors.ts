import { ApplicationError } from "./application-error.js";

export class ValidationApplicationError extends ApplicationError {
  constructor(
    message = "La solicitud no es válida.",
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message, {
      code: "VALIDATION_ERROR",
      statusCode: 400,
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class UnauthorizedApplicationError extends ApplicationError {
  constructor(message = "La autenticación es obligatoria.") {
    super(message, {
      code: "UNAUTHORIZED",
      statusCode: 401,
    });
  }
}

export class ForbiddenApplicationError extends ApplicationError {
  constructor(message = "No tiene permisos para realizar esta acción.") {
    super(message, {
      code: "FORBIDDEN",
      statusCode: 403,
    });
  }
}

export class NotFoundApplicationError extends ApplicationError {
  constructor(message = "El recurso solicitado no existe.") {
    super(message, {
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }
}

export class ConflictApplicationError extends ApplicationError {
  constructor(
    message = "La operación entra en conflicto con el estado actual.",
  ) {
    super(message, {
      code: "CONFLICT",
      statusCode: 409,
    });
  }
}

export class InternalApplicationError extends ApplicationError {
  constructor(message = "Ocurrió un error interno controlado.") {
    super(message, {
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
}
