export const LOCAL_AI_CONFIG = Symbol("LOCAL_AI_CONFIG");

/** Transporte del servidor local: API propia de Ollama o compatible con OpenAI. */
export type LocalAiApi = "OLLAMA" | "OPENAI_COMPATIBLE";

export interface LocalAiConfig {
  /** Por defecto `OLLAMA`; `OPENAI_COMPATIBLE` para llama.cpp / llama-swap. */
  api?: LocalAiApi;
  enabled: boolean;
  baseUrl: string;
  model: string;
  maxConcurrentJobs: number;
  timeoutMs: number;
  contextTokens: number;
  maxOutputTokens?: number;
  fallbackToRawSources: boolean;
  maxResponseBytes: number;
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    "Las variables booleanas de IA local deben ser true o false.",
  );
}

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} debe estar entre ${min} y ${max}.`);
  return parsed;
}

const PRIVATE_IPV4 = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/u,
  /^192\.168\.\d{1,3}\.\d{1,3}$/u,
  /^169\.254\.\d{1,3}\.\d{1,3}$/u,
  // 100.64.0.0/10 (CGNAT): rango que usan las VPN tipo Tailscale.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/u,
];

/** IPv4 privada (10/8, 172.16/12, 192.168/16, 169.254/16), VPN (100.64/10) o nombre `.local`. */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  const octets = host.split(".");
  const isIpv4 =
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
  if (isIpv4) return PRIVATE_IPV4.some((range) => range.test(host));
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/u.test(host);
}

/**
 * Lista EXPLÍCITA de equipos de la red local autorizados para Ollama
 * (`LOCAL_AI_ALLOWED_HOSTS=192.168.1.50,mac-studio.local`). Solo se aceptan IPv4
 * privadas o nombres `.local`; una IP pública o un dominio cualquiera se rechaza
 * al arrancar, de modo que las fuentes nunca puedan enviarse a internet.
 */
export function parseAllowedLocalAiHosts(
  value: string | undefined = process.env.LOCAL_AI_ALLOWED_HOSTS,
): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const raw of (value ?? "").split(",")) {
    const host = raw.trim().toLowerCase();
    if (!host) continue;
    if (!isPrivateNetworkHost(host)) {
      throw new Error(
        `LOCAL_AI_ALLOWED_HOSTS solo admite IPv4 privadas (10.x, 172.16-31.x, 192.168.x) o nombres .local: «${host}» no es válido.`,
      );
    }
    hosts.add(host);
  }
  return hosts;
}

export function parseOllamaBaseUrl(
  value = "http://127.0.0.1:11434",
  allowDockerHost = false,
  allowedHosts: ReadonlySet<string> = parseAllowedLocalAiHosts(),
  /**
   * Solo para la configuración de proveedores (acción de administrador): acepta
   * cualquier equipo de la red local (IPv4 privada o `.local`) sin editar el
   * `.env`. Nunca acepta IP públicas ni dominios de internet.
   */
  allowPrivateNetwork = false,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OLLAMA_BASE_URL no es una URL válida.");
  }
  const hosts = new Set(["127.0.0.1", "localhost", "[::1]", ...allowedHosts]);
  if (allowDockerHost) hosts.add("host.docker.internal");
  const hostAllowed =
    hosts.has(url.hostname) ||
    (allowPrivateNetwork && isPrivateNetworkHost(url.hostname));
  if (
    url.protocol !== "http:" ||
    !hostAllowed ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "La URL de Ollama debe usar HTTP y apuntar a un host local, a un equipo autorizado en LOCAL_AI_ALLOWED_HOSTS o (en Proveedores de IA) a un equipo de la red local.",
    );
  }
  return url.origin;
}

export function loadLocalAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocalAiConfig {
  return {
    enabled: boolean(env.LOCAL_AI_ENABLED, false),
    baseUrl: parseOllamaBaseUrl(
      env.OLLAMA_BASE_URL,
      boolean(env.LOCAL_AI_ALLOW_DOCKER_HOST, false),
      parseAllowedLocalAiHosts(env.LOCAL_AI_ALLOWED_HOSTS),
    ),
    model: env.OLLAMA_MODEL?.trim() || "gemma4:12b",
    maxConcurrentJobs: integer(
      env.LOCAL_AI_MAX_CONCURRENT_JOBS,
      1,
      1,
      4,
      "LOCAL_AI_MAX_CONCURRENT_JOBS",
    ),
    timeoutMs: integer(
      env.LOCAL_AI_TIMEOUT_MS,
      600000,
      1000,
      900000,
      "LOCAL_AI_TIMEOUT_MS",
    ),
    contextTokens: integer(
      env.LOCAL_AI_CONTEXT_TOKENS,
      131072,
      1024,
      1048576,
      "LOCAL_AI_CONTEXT_TOKENS",
    ),
    maxOutputTokens: integer(
      env.LOCAL_AI_MAX_OUTPUT_TOKENS,
      8192,
      256,
      128000,
      "LOCAL_AI_MAX_OUTPUT_TOKENS",
    ),
    fallbackToRawSources: boolean(env.LOCAL_AI_FALLBACK_TO_RAW_SOURCES, false),
    maxResponseBytes: integer(
      env.LOCAL_AI_MAX_RESPONSE_BYTES,
      2097152,
      1024,
      8388608,
      "LOCAL_AI_MAX_RESPONSE_BYTES",
    ),
  };
}
