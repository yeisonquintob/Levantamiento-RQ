import assert from "node:assert/strict";
import test from "node:test";

import type { SidebarMenuId } from "../../apps/web/src/app/sidebar-navigation";
import {
  resolveWorkspaceNavigationDirection as resolve,
  type WorkspaceLocation,
} from "../../apps/web/src/app/workspace-navigation-transition";

const ORDER: SidebarMenuId[] = [
  "home",
  "projects",
  "discussion",
  "sources",
  "documents",
  "validation",
  "execution",
  "prototype",
  "settings",
  "notifications",
];

const at = (pathname: string, search = ""): WorkspaceLocation => ({
  pathname,
  search,
});

test("un destino de menú superior entra hacia arriba y uno inferior hacia abajo", () => {
  assert.equal(resolve(at("/workspace/documents"), at("/workspace/sources"), ORDER), "up");
  assert.equal(resolve(at("/workspace/sources"), at("/workspace/documents"), ORDER), "down");
  assert.equal(resolve(at("/workspace"), at("/workspace/settings/users"), ORDER), "down");
});

test("la dirección vertical respeta el orden configurado del sidebar", () => {
  const custom: SidebarMenuId[] = ["documents", "sources", "home"];
  assert.equal(resolve(at("/workspace/documents"), at("/workspace/sources"), custom), "down");
  assert.equal(resolve(at("/workspace"), at("/workspace/sources"), custom), "up");
  assert.equal(resolve(at("/workspace"), at("/workspace/validation"), custom), "none");
});

test("abrir o cambiar projectId en el mismo menú entra a la derecha y quitarlo a la izquierda", () => {
  const list = at("/workspace/sources");
  const detail = at("/workspace/sources", "projectId=a1");
  assert.equal(resolve(list, detail, ORDER), "right");
  assert.equal(resolve(detail, at("/workspace/sources", "projectId=b2"), ORDER), "right");
  assert.equal(resolve(detail, list, ORDER), "left");
});

test("rutas hijas entran a la derecha y rutas padre a la izquierda", () => {
  const parent = at("/workspace/documents");
  const child = at("/workspace/documents/doc-1");
  assert.equal(resolve(parent, child, ORDER), "right");
  assert.equal(resolve(child, parent, ORDER), "left");
  assert.equal(resolve(at("/workspace/projects"), at("/workspace/projects/p1"), ORDER), "right");
});

test("la misma ubicación no anima, ni cambios de query ajenos a projectId", () => {
  assert.equal(resolve(at("/workspace/sources", "projectId=a1"), at("/workspace/sources", "projectId=a1"), ORDER), "none");
  assert.equal(resolve(at("/workspace/documents"), at("/workspace/documents/"), ORDER), "none");
  assert.equal(resolve(at("/workspace/documents", "q=x"), at("/workspace/documents", "q=y"), ORDER), "none");
});
