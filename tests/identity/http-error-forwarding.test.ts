import assert from "node:assert/strict";
import test from "node:test";

import { HttpException } from "@nestjs/common";

import { ApplicationExceptionFilter } from "../../libs/shared/http/src/lib/application-exception.filter";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

function capture(exception: HttpException): CapturedResponse {
  const captured: CapturedResponse = {
    statusCode: 0,
    body: null,
  };

  const response = {
    status(statusCode: number) {
      captured.statusCode = statusCode;
      return this;
    },
    send(body: unknown) {
      captured.body = body;
      return body;
    },
  };

  const host = {
    switchToHttp() {
      return {
        getRequest() {
          return {
            headers: {},
            url: "/api/v1/auth/sign-in",
          };
        },
        getResponse() {
          return response;
        },
      };
    },
  };

  new ApplicationExceptionFilter().catch(exception, host as never);

  return captured;
}

test("conserva Problem Details recibido desde Identity Service", () => {
  const captured = capture(
    new HttpException(
      {
        title: "Autenticación requerida",
        status: 401,
        detail: "Credenciales incorrectas.",
      },
      401,
    ),
  );

  assert.equal(captured.statusCode, 401);

  const body = captured.body as {
    title: string;
    detail: string;
  };

  assert.equal(body.title, "Autenticación requerida");
  assert.equal(body.detail, "Credenciales incorrectas.");
});

test("conserva mensajes HTTP tradicionales", () => {
  const captured = capture(
    new HttpException(
      {
        error: "Bad Request",
        message: "El correo no es válido.",
      },
      400,
    ),
  );

  assert.equal(captured.statusCode, 400);

  const body = captured.body as {
    title: string;
    detail: string;
  };

  assert.equal(body.title, "Bad Request");
  assert.equal(body.detail, "El correo no es válido.");
});
