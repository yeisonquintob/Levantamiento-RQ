/**
 * Comprobación de exposición: con el stack ya levantado, llama SIN sesión a todas las rutas del Gateway y de
 * los servicios (se enumeran desde su contrato OpenAPI) y falla si alguna no protegida responde algo distinto
 * de 401/403. Se prueban tres variantes: sin credenciales, con un token basura y con un JWT sin firma
 * (`alg: none`) que se hace pasar por administrador.
 *
 * Solo debe ejecutarse contra un stack desechable (CI o aislado): envía peticiones de escritura anónimas, que
 * deben ser rechazadas; si una ruta estuviera expuesta, esa petición la ejecutaría.
 */
import { PUBLIC_GATEWAY_ROUTES } from "../apps/gateway/src/security/gateway-security";

interface Target {
  name: string;
  port: number;
  /** Rutas públicas por diseño (relativas a /api/v1). */
  publicRoutes: readonly RegExp[];
  /** Mínimo de rutas esperadas: evita que la prueba pase en vacío si el contrato no se pudo leer. */
  minimumRoutes: number;
}

const BASE_PORT = Number(process.env.EXPOSURE_BASE_PORT ?? 3000);
const HEALTH = /^health(\/.*)?$/u;
const AUTH_PUBLIC =
  /^auth\/(sign-in|register|refresh|sign-out|microsoft\/.*)$/u;
const gatewayPublic = PUBLIC_GATEWAY_ROUTES.map(
  (route) =>
    new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"),
);

const TARGETS: readonly Target[] = [
  {
    name: "gateway",
    port: BASE_PORT,
    publicRoutes: gatewayPublic,
    minimumRoutes: 100,
  },
  {
    name: "identity-service",
    port: BASE_PORT + 1,
    publicRoutes: [HEALTH, AUTH_PUBLIC],
    minimumRoutes: 8,
  },
  {
    name: "projects-service",
    port: BASE_PORT + 2,
    publicRoutes: [HEALTH],
    minimumRoutes: 8,
  },
  {
    name: "sources-service",
    port: BASE_PORT + 3,
    publicRoutes: [HEALTH],
    minimumRoutes: 8,
  },
  {
    name: "documents-service",
    port: BASE_PORT + 4,
    publicRoutes: [HEALTH],
    minimumRoutes: 8,
  },
  {
    name: "ai-analysis-service",
    port: BASE_PORT + 5,
    publicRoutes: [HEALTH],
    minimumRoutes: 8,
  },
  {
    name: "workflow-service",
    port: BASE_PORT + 7,
    publicRoutes: [HEALTH],
    minimumRoutes: 4,
  },
  {
    name: "operations-service",
    port: BASE_PORT + 8,
    publicRoutes: [HEALTH],
    minimumRoutes: 4,
  },
  {
    name: "prototypes-service",
    port: BASE_PORT + 9,
    publicRoutes: [HEALTH],
    minimumRoutes: 4,
  },
];

const UUID = "00000000-0000-4000-8000-000000000001";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const FORGED_JWT = `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
  sub: UUID,
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  exp: 4_102_444_800,
})}.`;

const VARIANTS: readonly { label: string; headers: Record<string, string> }[] =
  [
    { label: "sin credenciales", headers: {} },
    { label: "token basura", headers: { authorization: "Bearer abc.def.ghi" } },
    {
      label: "JWT alg=none",
      headers: {
        authorization: `Bearer ${FORGED_JWT}`,
        cookie: `rq_access=${FORGED_JWT}`,
      },
    },
  ];

function fillParameters(path: string): string {
  return path.replace(/\{(\w+)\}/gu, (_match, name: string) =>
    /number/iu.test(name) ? "1" : /key|code/iu.test(name) ? "x" : UUID,
  );
}

async function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  const hasBody = method !== "GET" && method !== "DELETE";
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(hasBody ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  await response.arrayBuffer();
  return response.status;
}

async function readContract(
  target: Target,
): Promise<Record<string, Record<string, unknown>>> {
  const response = await fetch(
    `http://127.0.0.1:${target.port}/api/docs-json`,
    {
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `${target.name}: no se pudo leer el contrato OpenAPI (HTTP ${response.status}).`,
    );
  const document = (await response.json()) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  return document.paths ?? {};
}

/**
 * Servicios a comprobar. `EXPOSURE_SERVICES` limita la lista, pero un nombre desconocido (o una lista vacía)
 * es un error: antes se ignoraba y el script terminaba «con éxito» sin haber comprobado ninguna ruta.
 */
function selectTargets(requested: string | undefined): readonly Target[] {
  if (requested === undefined) return TARGETS;
  const names = requested.split(/\s+/u).filter(Boolean);
  const known = TARGETS.map((target) => target.name);
  const unknown = names.filter((name) => !known.includes(name));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(
      names.length === 0
        ? `EXPOSURE_SERVICES está vacío. Servicios válidos: ${known.join(", ")}.`
        : `EXPOSURE_SERVICES contiene servicios desconocidos: ${unknown.join(", ")}. Servicios válidos: ${known.join(", ")}.`,
    );
  }
  return TARGETS.filter((target) => names.includes(target.name));
}

async function main(): Promise<void> {
  const targets = selectTargets(process.env.EXPOSURE_SERVICES);
  const exposed: string[] = [];
  let routes = 0;
  let requests = 0;

  for (const target of targets) {
    const paths = await readContract(target);
    let count = 0;
    for (const [rawPath, operations] of Object.entries(paths)) {
      const relative = rawPath
        .replace(/^\/api\/v1\//u, "")
        .replace(/\/+$/u, "");
      if (target.publicRoutes.some((pattern) => pattern.test(relative)))
        continue;
      for (const method of METHODS) {
        if (!operations[method]) continue;
        count += 1;
        for (const variant of VARIANTS) {
          requests += 1;
          const status = await request(
            target.port,
            method.toUpperCase(),
            fillParameters(rawPath),
            variant.headers,
          );
          if (status !== 401 && status !== 403)
            exposed.push(
              `${target.name} ${method.toUpperCase()} ${rawPath} [${variant.label}] -> HTTP ${status}`,
            );
        }
      }
    }
    routes += count;
    console.log(`  ${target.name}: ${count} rutas protegidas comprobadas`);
    if (count < target.minimumRoutes)
      exposed.push(
        `${target.name}: solo se encontraron ${count} rutas (mínimo ${target.minimumRoutes}); contrato incompleto.`,
      );
  }

  console.log(`Exposición: ${routes} rutas, ${requests} peticiones anónimas.`);
  // Una comprobación que no probó nada no puede darse por buena.
  if (routes === 0 || requests === 0) {
    console.error("No se comprobó ninguna ruta: el resultado no es válido.");
    process.exitCode = 1;
    return;
  }
  if (exposed.length) {
    console.error(
      `\nRutas que NO rechazan una petición sin sesión (${exposed.length}):`,
    );
    for (const line of exposed.slice(0, 40)) console.error(`  - ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log("✓ Toda ruta no pública responde 401/403 sin sesión válida.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
