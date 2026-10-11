export const MICROSOFT_AUTH_CONFIG = Symbol("MICROSOFT_AUTH_CONFIG");

export interface MicrosoftAuthConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmailDomains: readonly string[];
  transactionSecret: string;
  transactionTtlSeconds: number;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function readBoolean(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("MICROSOFT_AUTH_ENABLED debe ser true o false.");
}

export function loadMicrosoftAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MicrosoftAuthConfig {
  const authEnabled = environment.AUTH_ENABLED?.trim().toLowerCase() === "true";
  const requested = readBoolean(environment.MICROSOFT_AUTH_ENABLED);

  const disabled: MicrosoftAuthConfig = {
    enabled: false,
    tenantId: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    allowedEmailDomains: [],
    transactionSecret: "",
    transactionTtlSeconds: 600,
  };

  if (!requested || !authEnabled) return disabled;

  const tenantId = environment.MICROSOFT_TENANT_ID?.trim() ?? "";
  // Un tenant explícito evita aceptar cuentas de otros directorios ("common"/"organizations").
  if (!GUID.test(tenantId)) {
    throw new Error("MICROSOFT_TENANT_ID debe ser el GUID del tenant corporativo.");
  }

  const clientId = environment.MICROSOFT_CLIENT_ID?.trim() ?? "";
  if (!GUID.test(clientId)) {
    throw new Error("MICROSOFT_CLIENT_ID debe ser el GUID de la aplicación registrada.");
  }

  const clientSecret = environment.MICROSOFT_CLIENT_SECRET?.trim() ?? "";
  if (clientSecret.length < 8) {
    throw new Error("MICROSOFT_CLIENT_SECRET es obligatorio.");
  }

  const redirectUri = environment.MICROSOFT_REDIRECT_URI?.trim() ?? "";
  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new Error("MICROSOFT_REDIRECT_URI debe ser una URL absoluta válida.");
  }
  if (
    parsedRedirect.search ||
    parsedRedirect.hash ||
    (environment.NODE_ENV === "production" && parsedRedirect.protocol !== "https:")
  ) {
    throw new Error(
      "MICROSOFT_REDIRECT_URI no puede incluir parámetros y debe usar HTTPS en producción.",
    );
  }

  const refreshSecret = environment.JWT_REFRESH_SECRET?.trim() ?? "";
  if (refreshSecret.length < 32) {
    throw new Error("JWT_REFRESH_SECRET debe tener mínimo 32 caracteres.");
  }

  const allowedEmailDomains = (environment.MICROSOFT_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return {
    enabled: true,
    tenantId,
    clientId,
    clientSecret,
    redirectUri: parsedRedirect.toString(),
    allowedEmailDomains,
    transactionSecret: refreshSecret,
    transactionTtlSeconds: 600,
  };
}
