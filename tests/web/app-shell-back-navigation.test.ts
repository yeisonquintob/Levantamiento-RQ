import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveWorkspaceBackTarget as back } from "../../apps/web/src/app/workspace-navigation-transition";
import { readStylesSync } from "../support/read-styles";

const read = (path: string): string => readFileSync(path, "utf8");
const at = (pathname: string, search = ""): string | null =>
  back({ pathname, search });

test("Inicio no tiene destino de retorno", () => {
  assert.equal(at("/workspace"), null);
  assert.equal(at("/workspace/"), null);
});

test("la raíz de cada menú vuelve a Inicio", () => {
  for (const root of [
    "projects",
    "discussion",
    "sources",
    "documents",
    "validation",
    "execution",
    "prototype",
    "settings",
    "notifications",
  ]) {
    assert.equal(at(`/workspace/${root}`), "/workspace");
  }
});

test("quitar projectId vuelve a la raíz del módulo", () => {
  assert.equal(at("/workspace/sources", "projectId=p1"), "/workspace/sources");
  assert.equal(
    at("/workspace/documents", "projectId=p1"),
    "/workspace/documents",
  );
});

test("discusión, configuración y documentos vuelven a su padre semántico", () => {
  assert.equal(
    at("/workspace/projects/p1/discussion"),
    "/workspace/discussion",
  );
  assert.equal(at("/workspace/settings/users"), "/workspace/settings");
  assert.equal(at("/workspace/settings/templates/"), "/workspace/settings");
  assert.equal(at("/workspace/documents/d1"), "/workspace/documents");
  assert.equal(
    at("/workspace/documents/d1", "projectId=p1"),
    "/workspace/documents",
  );
});

test("el shell contrae con el icono de panel lateral junto a la marca y la flecha lateral no rota", () => {
  const shell = read("apps/web/src/app/app-shell.tsx");
  const css = readStylesSync();
  const identity = shell.slice(
    shell.indexOf('className="rq-topbar__identity"'),
    shell.indexOf('className="rq-topbar__page"'),
  );
  assert.match(identity, /rq-topbar__collapse/u);
  assert.match(identity, /setSidebarCollapsed/u);
  assert.match(identity, /<SidebarIcon \/>[\s\S]*Levantamiento RQ/u);
  assert.match(shell, /resolveWorkspaceBackTarget\(/u);
  assert.match(shell, /className="rq-sidebar__back"/u);
  assert.match(shell, /disabled/u);
  const sidebar = shell.slice(shell.indexOf('id="rq-sidebar"'));
  assert.doesNotMatch(sidebar.slice(0, 1200), /setSidebarCollapsed/u);
  assert.match(
    css,
    /\.rq-shell\[data-sidebar-collapsed="true"\] \.rq-topbar__identity strong \{\s*display: none;/u,
  );
  const finalCss = css.slice(css.indexOf("RQ SHELL CONTRAER Y VOLVER V1"));
  assert.doesNotMatch(finalCss, /rotate\(/u);
  const collapse = finalCss.slice(
    finalCss.indexOf("  .rq-topbar__collapse {"),
    finalCss.indexOf("  .rq-topbar__collapse:hover"),
  );
  assert.match(collapse, /width: 44px;/u);
  assert.match(collapse, /height: 44px;/u);
  assert.match(collapse, /font-size: 28px;/u);
  assert.match(collapse, /font-weight: 900;/u);
  assert.match(collapse, /color: var\(--rq-color-text\);/u);
  assert.match(collapse, /border: 0;/u);
  assert.match(collapse, /border-radius: 0;/u);
  assert.match(collapse, /background: transparent;/u);
  assert.match(
    finalCss,
    /\.rq-topbar__collapse:hover \{\s*background: transparent;/u,
  );
  assert.match(
    finalCss,
    /\.rq-shell\[data-sidebar-collapsed="true"\] \.rq-topbar__collapse \{\s*display: inline-grid;/u,
  );
  assert.match(
    finalCss,
    /\.rq-sidebar__toggle-row \{\s*justify-content: flex-end;/u,
  );
  assert.doesNotMatch(
    finalCss,
    /\.rq-sidebar__toggle-row \{\s*justify-content: flex-start;/u,
  );
  assert.match(
    css,
    /\.rq-sidebar\[data-collapsed="true"\] \.rq-sidebar__toggle-row \{\s*justify-content: center;/u,
  );
});
