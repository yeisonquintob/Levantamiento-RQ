// Genera la configuración local que necesita el stack completo en CI (sin secretos reales):
// infrastructure/docker/.env y apps/<servicio>/.env a partir de los .env.example.
// Nunca sobrescribe un .env existente (protege equipos de desarrollo) salvo con --force.
//
// Uso: CI_SQL_PASSWORD=... node scripts/ci-prepare-env.mjs [--root <dir>] [--force]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const rootIndex = args.indexOf("--root");
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : ".");

const sqlPassword = process.env.CI_SQL_PASSWORD?.trim();
if (!sqlPassword) throw new Error("CI_SQL_PASSWORD es obligatorio.");
const sql = {
  host: process.env.CI_SQL_HOST?.trim() || "127.0.0.1",
  port: process.env.CI_SQL_PORT?.trim() || "1433",
  user: process.env.CI_SQL_USER?.trim() || "sa",
};
const random = () => randomBytes(24).toString("hex");

const SERVICES = [
  "identity-service",
  "projects-service",
  "sources-service",
  "documents-service",
  "ai-analysis-service",
  "workflow-service",
  "operations-service",
  "prototypes-service",
  "gateway",
];

function parse(content) {
  return content.split(/\r?\n/u).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    return match ? { key: match[1], value: match[2], line } : { line };
  });
}

function render(entries, overrides) {
  const lines = entries.map((entry) => {
    if (!entry.key || !(entry.key in overrides)) return entry.line;
    return `${entry.key}=${overrides[entry.key]}`;
  });
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function write(target, content) {
  if (existsSync(target) && !force) {
    console.log(`= ${target} ya existe; no se modifica.`);
    return;
  }
  writeFileSync(target, content, { mode: 0o600 });
  console.log(`✓ ${target}`);
}

function fromExample(relativeDirectory, overridesFor) {
  const example = resolve(root, relativeDirectory, ".env.example");
  if (!existsSync(example)) return;
  const entries = parse(readFileSync(example, "utf8"));
  const overrides = overridesFor(
    new Set(entries.flatMap((e) => (e.key ? [e.key] : []))),
  );
  write(resolve(root, relativeDirectory, ".env"), render(entries, overrides));
}

const redisPassword = random();
const rabbitPassword = random();
const infraExample = resolve(root, "infrastructure/docker/.env.example");
const infraDefaults = existsSync(infraExample)
  ? Object.fromEntries(
      parse(readFileSync(infraExample, "utf8")).flatMap((e) =>
        e.key ? [[e.key, e.value]] : [],
      ),
    )
  : {};
const redisPort = infraDefaults.RQ_REDIS_PORT ?? "6381";
const rabbitPort = infraDefaults.RQ_RABBITMQ_AMQP_PORT ?? "5673";
const azuriteAccount = infraDefaults.AZURITE_ACCOUNT_NAME ?? "devstoreaccount1";
// La clave de Azurite es la pública de desarrollo (viene en el .env.example).
const azuriteConnection = [
  "DefaultEndpointsProtocol=http",
  `AccountName=${azuriteAccount}`,
  `AccountKey=${infraDefaults.AZURITE_ACCOUNT_KEY ?? ""}`,
  `BlobEndpoint=http://127.0.0.1:${infraDefaults.RQ_AZURITE_BLOB_PORT ?? "10000"}/${azuriteAccount}`,
  `QueueEndpoint=http://127.0.0.1:${infraDefaults.RQ_AZURITE_QUEUE_PORT ?? "10001"}/${azuriteAccount}`,
  `TableEndpoint=http://127.0.0.1:${infraDefaults.RQ_AZURITE_TABLE_PORT ?? "10002"}/${azuriteAccount}`,
  "",
].join(";");

// Infraestructura (Redis, RabbitMQ, Azurite).
fromExample("infrastructure/docker", () => ({
  REDIS_PASSWORD: redisPassword,
  RABBITMQ_DEFAULT_PASS: rabbitPassword,
  SQL_SERVER_HOST: sql.host,
  SQL_SERVER_PORT: sql.port,
  SQL_SERVER_ADMIN_USER: sql.user,
  SQL_SERVER_ADMIN_PASSWORD: sqlPassword,
  SQL_SERVER_ENCRYPT: "true",
  SQL_SERVER_TRUST_SERVER_CERTIFICATE: "true",
}));

for (const service of SERVICES) {
  fromExample(`apps/${service}`, (keys) => {
    const overrides = {};
    if (keys.has("DB_HOST")) {
      Object.assign(overrides, {
        DATABASE_ENABLED: "true",
        DB_HOST: sql.host,
        DB_PORT: sql.port,
        DB_USERNAME: sql.user,
        DB_PASSWORD: sqlPassword,
        DB_ENCRYPT: "true",
        DB_TRUST_SERVER_CERTIFICATE: "true",
      });
    }
    if (keys.has("DATABASE_HOST")) {
      Object.assign(overrides, {
        DATABASE_ENABLED: "true",
        DATABASE_HOST: sql.host,
        DATABASE_PORT: sql.port,
        DATABASE_USER: sql.user,
        DATABASE_PASSWORD: sqlPassword,
      });
    }
    if (service === "identity-service") {
      Object.assign(overrides, {
        AUTH_ENABLED: "true",
        JWT_REFRESH_SECRET: random(),
      });
    }
    // El E2E de API valida el flujo con el proveedor simulado: en CI no hay IA real ni claves.
    if (service === "ai-analysis-service") overrides.AI_EXECUTION_MODE = "FAKE";
    // Las conexiones a Redis, Azurite y RabbitMQ deben coincidir con la infraestructura generada.
    for (const key of keys) {
      if (key.endsWith("REDIS_PASSWORD")) overrides[key] = redisPassword;
      if (key.endsWith("REDIS_PORT")) overrides[key] = redisPort;
      if (key === "AZURE_STORAGE_CONNECTION_STRING")
        overrides[key] = azuriteConnection;
    }
    if (keys.has("RABBITMQ_URL")) {
      overrides.RABBITMQ_URL = `amqp://${infraDefaults.RABBITMQ_DEFAULT_USER ?? "rqadmin"}:${rabbitPassword}@127.0.0.1:${rabbitPort}`;
    }
    // La creación de bases exige autorización explícita por servicio; en CI la BD es efímera.
    for (const key of keys) {
      if (key.endsWith("_CREATE_DATABASE")) overrides[key] = "true";
    }
    return overrides;
  });
}

// El frontend apunta al gateway local.
const web = resolve(root, "apps/web/.env.local");
write(web, "NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:3000\n");
