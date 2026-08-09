import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DIALOG_FILES = [
  "apps/web/src/app/appearance-controls.tsx",
  "apps/web/src/app/workspace/projects-workspace.tsx",
  "apps/web/src/app/workspace/sources/sources-workspace.tsx",
  "apps/web/src/app/workspace/documents/documents-workspace.tsx",
  "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
  "apps/web/src/app/workspace/analysis/analysis-workspace.tsx",
  "apps/web/src/app/workspace/templates/templates-workspace.tsx",
  "apps/web/src/app/workspace/settings/users/users-workspace.tsx",
  "apps/web/src/app/workspace/settings/ai-providers/ai-providers-workspace.tsx",
] as const;

const TABLE_FILES = [
  "apps/web/src/app/workspace/home-workspace.tsx",
  "apps/web/src/app/workspace/projects-workspace.tsx",
  "apps/web/src/app/workspace/sources/sources-workspace.tsx",
  "apps/web/src/app/workspace/documents/documents-workspace.tsx",
  "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
  "apps/web/src/app/workspace/analysis/analysis-workspace.tsx",
  "apps/web/src/app/workspace/validation/validation-workspace.tsx",
  "apps/web/src/app/workspace/templates/templates-workspace.tsx",
  "apps/web/src/app/workspace/notifications/notifications-workspace.tsx",
  "apps/web/src/app/workspace/audit/audit-workspace.tsx",
  "apps/web/src/app/workspace/settings/users/users-workspace.tsx",
  "apps/web/src/app/workspace/settings/ai-providers/ai-providers-workspace.tsx",
] as const;

test("los diálogos gestionan Escape, foco atrapado y retorno de foco", async () => {
  const hook = await readFile(
    "apps/web/src/app/use-dialog-accessibility.ts",
    "utf8",
  );
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /event\.key !== "Tab"/);
  assert.match(hook, /previouslyFocused\?\.focus\(\)/);
  assert.match(hook, /document\.body\.style\.overflow = "hidden"/);

  for (const file of DIALOG_FILES) {
    const source = await readFile(file, "utf8");
    assert.match(source, /useDialogAccessibility/);
    assert.match(source, /role="dialog"/);
  }
});

test("todas las tablas declaran el alcance de sus encabezados", async () => {
  for (const file of TABLE_FILES) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /<th>/);
    if (source.includes("<table")) {
      assert.match(source, /<th scope="col">/);
    }
  }
});

test("el sistema visual conserva foco visible y salto al contenido", async () => {
  const styles = await readFile("libs/shared/ui/src/styles.css", "utf8");
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");

  assert.match(styles, /:focus-visible/);
  assert.match(styles, /outline: 2px solid var\(--rq-color-focus\)/);
  assert.match(shell, /className="rq-skip-link"/);
  assert.match(shell, /id="contenido-principal"/);
});
