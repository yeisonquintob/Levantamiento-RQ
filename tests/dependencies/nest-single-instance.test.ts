import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";

/**
 * Dos copias de Nest en el árbol de dependencias (p. ej. @nestjs/common 11.1.28 y 11.2.7) hacen que
 * @nestjs/typeorm guarde sus entidades por separado: forFeature registra en una copia y forRoot lee
 * de otra, y el servicio no arranca (EntityMetadataNotFoundError). Ocurrió al actualizar solo parte
 * de los package.json del monorepo.
 */
const root = process.cwd();

function workspaceDirectories(): string[] {
  const result: string[] = [];
  for (const group of ["apps", "libs", "libs/shared"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const dir = join(base, name.name);
      if (existsSync(join(dir, "package.json"))) result.push(dir);
    }
  }
  return result;
}

function declaresNest(dir: string): boolean {
  const manifest = JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8"),
  ) as Record<string, Record<string, string> | undefined>;
  return (
    Object.values({
      ...manifest["dependencies"],
      ...manifest["devDependencies"],
      ...manifest["peerDependencies"],
    }).length > 0 &&
    ["dependencies", "devDependencies", "peerDependencies"].some((section) =>
      Object.keys(manifest[section] ?? {}).some((name) =>
        name.startsWith("@nestjs/"),
      ),
    )
  );
}

function resolvedPackage(dir: string, name: string): string | null {
  try {
    return realpathSync(createRequire(join(dir, "package.json")).resolve(name));
  } catch {
    return null;
  }
}

const nestDirectories = workspaceDirectories().filter(declaresNest);

function packageVersion(location: string): string {
  // Sube desde el archivo resuelto hasta el package.json del paquete.
  let dir = location;
  for (let depth = 0; depth < 8; depth += 1) {
    dir = resolve(dir, "..");
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (parsed.name?.startsWith("@nestjs/")) return parsed.version ?? "?";
    }
  }
  return "?";
}

test("todo el monorepo usa una sola versión de @nestjs/common y de @nestjs/core", () => {
  assert.ok(
    nestDirectories.length >= 10,
    "se esperaban las aplicaciones y librerías de Nest",
  );
  for (const name of ["@nestjs/common", "@nestjs/core"]) {
    const versions = new Map<string, string[]>();
    for (const dir of nestDirectories) {
      const location = resolvedPackage(dir, name);
      if (!location) continue;
      const version = packageVersion(location);
      versions.set(version, [
        ...(versions.get(version) ?? []),
        dir.replace(`${root}/`, ""),
      ]);
    }
    assert.equal(
      versions.size,
      1,
      `${name} resuelve a versiones distintas:\n${[...versions].map(([version, users]) => `  ${version} ← ${users.join(", ")}`).join("\n")}`,
    );
  }
});

test("cada @nestjs/typeorm usa la misma copia de @nestjs/common que su aplicación", () => {
  for (const dir of nestDirectories) {
    const typeorm = resolvedPackage(dir, "@nestjs/typeorm");
    if (!typeorm) continue;
    const common = resolvedPackage(dir, "@nestjs/common");
    // Desde la carpeta real de @nestjs/typeorm se resuelve el @nestjs/common del que depende.
    const fromTypeorm = realpathSync(
      createRequire(join(typeorm, "package.json")).resolve("@nestjs/common"),
    );
    assert.equal(
      fromTypeorm,
      common,
      `${dir.replace(`${root}/`, "")}: @nestjs/typeorm está atado a otra copia de @nestjs/common`,
    );
  }
});

test("el lockfile no conserva versiones antiguas de Nest", () => {
  const lock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  const versions = new Set(
    [
      ...lock.matchAll(
        /@nestjs\/(?:common|core|platform-fastify|platform-express)@(\d+\.\d+\.\d+)/gu,
      ),
    ].map((match) => match[1]),
  );
  assert.equal(
    versions.size,
    1,
    `versiones de Nest en el lockfile: ${[...versions].join(", ")}`,
  );
});
