import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export interface LoadEnvironmentFilesOptions {
  paths: readonly string[];
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface LoadedEnvironmentFiles {
  loadedFiles: readonly string[];
  loadedVariables: readonly string[];
}

export function loadEnvironmentFiles(
  options: LoadEnvironmentFilesOptions,
): LoadedEnvironmentFiles {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const fileValues: Record<string, string> = {};
  const loadedFiles: string[] = [];

  for (const configuredPath of options.paths) {
    const absolutePath = resolve(cwd, configuredPath);

    if (!existsSync(absolutePath)) {
      continue;
    }

    Object.assign(fileValues, parseEnv(readFileSync(absolutePath, "utf8")));
    loadedFiles.push(absolutePath);
  }

  const loadedVariables: string[] = [];

  for (const [key, value] of Object.entries(fileValues)) {
    if (environment[key] !== undefined) {
      continue;
    }

    environment[key] = value;
    loadedVariables.push(key);
  }

  return {
    loadedFiles,
    loadedVariables,
  };
}
