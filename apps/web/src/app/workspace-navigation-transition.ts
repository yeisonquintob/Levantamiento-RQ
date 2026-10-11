import type { SidebarMenuId } from "./sidebar-navigation";

export type WorkspaceNavigationDirection =
  | "up"
  | "down"
  | "right"
  | "left"
  | "none";

export interface WorkspaceLocation {
  pathname: string;
  search: string;
}

const MENU_ROOTS: ReadonlyArray<readonly [SidebarMenuId, string]> = [
  ["notifications", "/workspace/notifications"],
  ["sources", "/workspace/sources"],
  ["documents", "/workspace/documents"],
  ["validation", "/workspace/validation"],
  ["execution", "/workspace/execution"],
  ["prototype", "/workspace/prototype"],
  ["settings", "/workspace/settings"],
];

function resolveMenuId(pathname: string): SidebarMenuId | null {
  if (pathname === "/workspace") return "home";
  if (
    pathname.startsWith("/workspace/discussion") ||
    (pathname.startsWith("/workspace/projects") &&
      pathname.endsWith("/discussion"))
  ) {
    return "discussion";
  }
  if (pathname.startsWith("/workspace/projects")) return "projects";
  return MENU_ROOTS.find(([, root]) => pathname.startsWith(root))?.[0] ?? null;
}

function readProjectId(search: string): string | null {
  return new URLSearchParams(search).get("projectId");
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

export function workspaceLocationKey(location: WorkspaceLocation): string {
  return `${normalizePath(location.pathname)}?projectId=${readProjectId(location.search) ?? ""}`;
}

export function resolveWorkspaceNavigationDirection(
  previous: WorkspaceLocation,
  next: WorkspaceLocation,
  visibleMenuOrder: readonly SidebarMenuId[],
): WorkspaceNavigationDirection {
  if (workspaceLocationKey(previous) === workspaceLocationKey(next)) {
    return "none";
  }

  const previousMenu = resolveMenuId(previous.pathname);
  const nextMenu = resolveMenuId(next.pathname);

  if (previousMenu !== nextMenu) {
    if (!previousMenu || !nextMenu) return "none";
    const previousRank = visibleMenuOrder.indexOf(previousMenu);
    const nextRank = visibleMenuOrder.indexOf(nextMenu);
    if (previousRank === -1 || nextRank === -1) return "none";
    return nextRank < previousRank ? "up" : "down";
  }

  const previousPath = normalizePath(previous.pathname);
  const nextPath = normalizePath(next.pathname);
  if (previousPath !== nextPath) {
    if (nextPath.startsWith(`${previousPath}/`)) return "right";
    if (previousPath.startsWith(`${nextPath}/`)) return "left";
    return "none";
  }

  const previousProject = readProjectId(previous.search);
  const nextProject = readProjectId(next.search);
  if (nextProject && nextProject !== previousProject) return "right";
  if (!nextProject && previousProject) return "left";
  return "none";
}

const MODULE_ROOTS: readonly string[] = [
  "/workspace/projects",
  "/workspace/discussion",
  ...MENU_ROOTS.map(([, root]) => root),
];

/**
 * Destino semántico del retorno lateral, derivado solo de la ruta y de
 * `projectId`. `null` en Inicio, donde no hay a dónde volver.
 */
export function resolveWorkspaceBackTarget(
  location: WorkspaceLocation,
): string | null {
  const path = normalizePath(location.pathname);

  if (path === "/workspace" || !path.startsWith("/workspace/")) {
    return path === "/workspace" ? null : "/workspace";
  }
  if (/^\/workspace\/projects\/[^/]+\/discussion$/u.test(path)) {
    return "/workspace/discussion";
  }
  if (path.startsWith("/workspace/settings/")) return "/workspace/settings";
  if (path.startsWith("/workspace/documents/")) return "/workspace/documents";
  if (
    path === "/workspace/prototype" &&
    new URLSearchParams(location.search).get("view") === "source"
  ) {
    return path;
  }
  if (MODULE_ROOTS.includes(path)) {
    return readProjectId(location.search) ? path : "/workspace";
  }
  if (path.startsWith("/workspace/projects/")) return "/workspace/projects";
  return "/workspace";
}
