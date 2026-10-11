import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? sources(path)
      : /\.(ts|tsx)$/u.test(name)
        ? [path]
        : [];
  });
}

test("ninguna pantalla usa el cuadro nativo window.confirm", () => {
  const offenders = sources("apps/web/src").filter((file) =>
    /window\.confirm\(/u.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, []);
});

test("el diálogo propio es accesible: alertdialog modal, Escape/foco por el hook y portal al body", () => {
  const source = readFileSync("apps/web/src/app/confirm-dialog.tsx", "utf8");
  assert.match(source, /role="alertdialog"/u);
  assert.match(source, /aria-modal="true"/u);
  assert.match(source, /aria-labelledby="rq-confirm-title"/u);
  assert.match(source, /aria-describedby="rq-confirm-message"/u);
  assert.match(source, /useDialogAccessibility/u);
  assert.match(source, /createPortal\(/u);
  assert.match(source, /request\.destructive \? "danger" : "operation"/u);
  assert.match(readFileSync("apps/web/src/app/app-shell.tsx", "utf8"), /<ConfirmDialogProvider>\{children\}<\/ConfirmDialogProvider>/u);
});

test("las acciones destructivas piden un botón rojo con verbo propio, no «Continuar»", () => {
  const projects = readFileSync("apps/web/src/app/workspace/projects-workspace.tsx", "utf8");
  assert.match(projects, /confirmLabel: "Marcar como eliminado",\s+destructive: true/u);
  const documents = readFileSync("apps/web/src/app/workspace/documents/documents-workspace.tsx", "utf8");
  assert.match(documents, /confirmLabel: "Eliminar definitivamente",\s+destructive: true/u);
  // Salir del editor con cambios sin guardar espera la respuesta antes de navegar.
  const editor = readFileSync("apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx", "utf8");
  assert.match(editor, /event\.preventDefault\(\);[\s\S]{0,800}router\.push\(destination\)/u);
});
