import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  DOCUMENT_TEMPLATE_TYPES,
  type DocumentTemplateDetail,
  type DocumentTemplateType,
  type ProjectTemplateReference,
} from "@levantamiento-rq/shared-contracts";

function requiredText(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  ) {
    throw new ServiceUnavailableException(
      `Documents Service devolvió ${field} inválido.`,
    );
  }

  return value.trim();
}

function requiredTemplateType(value: unknown): DocumentTemplateType {
  if (
    typeof value !== "string" ||
    !DOCUMENT_TEMPLATE_TYPES.includes(value as DocumentTemplateType)
  ) {
    throw new ServiceUnavailableException(
      "Documents Service devolvió un tipo de plantilla inválido.",
    );
  }

  return value as DocumentTemplateType;
}

function payloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Readonly<Record<string, unknown>>;

  for (const field of ["detail", "message", "title"]) {
    const value = record[field];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

@Injectable()
export class DocumentTemplatesAccessClient {
  private readonly baseUrl =
    process.env.DOCUMENTS_SERVICE_URL?.trim() || "http://127.0.0.1:3004";

  private readonly timeoutMs = (() => {
    const value = Number(process.env.DOCUMENTS_SERVICE_TIMEOUT_MS ?? 5000);

    return Number.isInteger(value) && value >= 1000 && value <= 30000
      ? value
      : 5000;
  })();

  async requirePublished(
    templateId: string,
    accessToken: string,
  ): Promise<ProjectTemplateReference> {
    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl}/api/v1/templates/${encodeURIComponent(templateId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "No fue posible validar la plantilla porque Documents Service no está disponible.",
      );
    }

    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const detail = payloadMessage(payload);

      if (response.status === 404) {
        throw new BadRequestException(
          "La plantilla seleccionada no existe.",
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new BadRequestException(
          "No fue posible validar la plantilla con la sesión actual.",
        );
      }

      throw new ServiceUnavailableException(
        detail
          ? `No fue posible validar la plantilla: ${detail}`
          : "Documents Service rechazó la validación de la plantilla.",
      );
    }

    const template = payload as Partial<DocumentTemplateDetail> | null;

    if (!template || template.status !== "PUBLISHED") {
      throw new BadRequestException(
        "Selecciona una versión publicada de la plantilla.",
      );
    }

    return {
      id: requiredText(template.id, "id", 36).toLowerCase(),
      code: requiredText(template.code, "code", 40),
      name: requiredText(template.name, "name", 200),
      version: requiredText(template.version, "version", 32),
      templateType: requiredTemplateType(template.templateType),
    };
  }
}
