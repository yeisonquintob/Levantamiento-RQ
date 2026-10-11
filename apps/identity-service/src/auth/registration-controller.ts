import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import type { RegisterAccountResponse } from "@levantamiento-rq/shared-contracts";

import { asRecord, email, text } from "../users/users-input";
import { UsersService } from "../users/users.service";

function securePassword(value: string): string {
  if (
    !/[a-z]/u.test(value) ||
    !/[A-Z]/u.test(value) ||
    !/[0-9]/u.test(value) ||
    !/[^A-Za-z0-9]/u.test(value)
  ) {
    throw new BadRequestException(
      "La contraseña debe incluir mayúscula, minúscula, número y símbolo.",
    );
  }
  return value;
}

@ApiTags("authentication")
@Controller("auth")
export class RegistrationController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({ summary: "Registrar una cuenta pendiente de activación" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["displayName", "email", "password"],
      properties: {
        displayName: { type: "string", minLength: 2, maxLength: 200 },
        email: { type: "string", format: "email", maxLength: 320 },
        password: { type: "string", format: "password", minLength: 12 },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      "Cuenta y rol registrados; activación administrativa pendiente.",
  })
  @Post("register")
  @HttpCode(201)
  register(@Body() body: unknown): Promise<RegisterAccountResponse> {
    const record = asRecord(body);
    return this.users.registerAccount({
      displayName: text(record, "displayName", 2, 200),
      email: email(text(record, "email", 3, 320)),
      password: securePassword(text(record, "password", 12, 256)),
    });
  }
}
