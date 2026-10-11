import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportJWK, generateKeyPair } from "jose";

const args = process.argv.slice(2);
const rotate = args.includes("--rotate");
const destination = resolve(
  args.find((argument) => argument !== "--rotate") ??
    "tmp/local-auth/jwt-keys.env",
);

const expectedKeys = [
  [
    "LOCAL_IDENTITY_JWT_PRIVATE_JWK_BASE64",
    "identity-local-ed25519-1",
    "identity",
  ],
  [
    "LOCAL_AI_WORKLOAD_JWT_PRIVATE_JWK_BASE64",
    "ai-analysis-local-ed25519-1",
    "ai-analysis-service",
  ],
  [
    "LOCAL_OPERATIONS_WORKLOAD_JWT_PRIVATE_JWK_BASE64",
    "operations-local-ed25519-1",
    "operations-service",
  ],
  [
    "LOCAL_PROTOTYPES_WORKLOAD_JWT_PRIVATE_JWK_BASE64",
    "prototypes-local-ed25519-1",
    "prototypes-service",
  ],
];

function parseEnvironment(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator < 1
          ? [line, ""]
          : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function hasValidExistingKeyset(contents) {
  try {
    const environment = parseEnvironment(contents);
    const jwks = decodeJson(environment.JWT_ACCESS_PUBLIC_JWKS_BASE64 ?? "");

    if (!Array.isArray(jwks.keys) || jwks.keys.length !== expectedKeys.length) {
      return false;
    }

    return expectedKeys.every(([variable, kid, principal]) => {
      const privateJwk = decodeJson(environment[variable] ?? "");
      const publicJwk = jwks.keys.find((candidate) => candidate?.kid === kid);

      return (
        privateJwk?.kty === "OKP" &&
        privateJwk?.crv === "Ed25519" &&
        privateJwk?.kid === kid &&
        typeof privateJwk?.d === "string" &&
        typeof privateJwk?.x === "string" &&
        publicJwk?.kty === "OKP" &&
        publicJwk?.crv === "Ed25519" &&
        publicJwk?.alg === "EdDSA" &&
        publicJwk?.use === "sig" &&
        publicJwk?.principal === principal &&
        publicJwk?.x === privateJwk.x
      );
    });
  } catch {
    return false;
  }
}

if (!rotate) {
  try {
    if (hasValidExistingKeyset(await readFile(destination, "utf8"))) {
      process.exit(0);
    }
  } catch {
    // El archivo se crea por primera vez.
  }
}

async function pair(kid, principal) {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const privateJwk = {
    ...(await exportJWK(privateKey)),
    kid,
    alg: "EdDSA",
    use: "sig",
  };
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: "EdDSA",
    use: "sig",
    principal,
  };
  return { privateJwk, publicJwk };
}

const identity = await pair("identity-local-ed25519-1", "identity");
const ai = await pair("ai-analysis-local-ed25519-1", "ai-analysis-service");
const operations = await pair(
  "operations-local-ed25519-1",
  "operations-service",
);
const prototypes = await pair(
  "prototypes-local-ed25519-1",
  "prototypes-service",
);
const encode = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const lines = [
  `LOCAL_IDENTITY_JWT_KEY_ID=${identity.privateJwk.kid}`,
  `LOCAL_IDENTITY_JWT_PRIVATE_JWK_BASE64=${encode(identity.privateJwk)}`,
  `LOCAL_AI_WORKLOAD_JWT_KEY_ID=${ai.privateJwk.kid}`,
  `LOCAL_AI_WORKLOAD_JWT_PRIVATE_JWK_BASE64=${encode(ai.privateJwk)}`,
  `LOCAL_OPERATIONS_WORKLOAD_JWT_KEY_ID=${operations.privateJwk.kid}`,
  `LOCAL_OPERATIONS_WORKLOAD_JWT_PRIVATE_JWK_BASE64=${encode(operations.privateJwk)}`,
  `LOCAL_PROTOTYPES_WORKLOAD_JWT_KEY_ID=${prototypes.privateJwk.kid}`,
  `LOCAL_PROTOTYPES_WORKLOAD_JWT_PRIVATE_JWK_BASE64=${encode(prototypes.privateJwk)}`,
  `JWT_ACCESS_PUBLIC_JWKS_BASE64=${encode({ keys: [identity.publicJwk, ai.publicJwk, operations.publicJwk, prototypes.publicJwk] })}`,
  "",
].join("\n");

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, lines, { encoding: "utf8", mode: 0o600 });
await chmod(destination, 0o600);
