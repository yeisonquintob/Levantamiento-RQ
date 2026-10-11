export const SIDEBAR_CONFIGURATION_STORAGE_KEY = "rq-sidebar-configuration-v1";
export const SIDEBAR_CONFIGURATION_EVENT = "rq-sidebar-configuration-change";

export type SidebarMenuId =
  | "home"
  | "projects"
  | "discussion"
  | "sources"
  | "documents"
  | "validation"
  | "execution"
  | "prototype"
  | "settings"
  | "notifications";

export interface SidebarSectionConfiguration {
  id: string;
  name: string;
}

export interface SidebarMenuConfiguration {
  id: SidebarMenuId;
  placement: "TOP" | "SECTION" | "BOTTOM";
  sectionId: string | null;
  visible: boolean;
}

export interface SidebarConfiguration {
  sections: SidebarSectionConfiguration[];
  menus: SidebarMenuConfiguration[];
}

export interface SidebarMenuDefinition {
  id: SidebarMenuId;
  href: string;
  label: string;
}

export const SIDEBAR_MENU_DEFINITIONS: readonly SidebarMenuDefinition[] = [
  { id: "home", href: "/workspace", label: "Inicio" },
  { id: "projects", href: "/workspace/projects", label: "Proyectos" },
  { id: "discussion", href: "/workspace/discussion", label: "Discusión" },
  { id: "sources", href: "/workspace/sources", label: "Fuentes" },
  { id: "documents", href: "/workspace/documents", label: "Documentos" },
  { id: "validation", href: "/workspace/validation", label: "Validación" },
  { id: "execution", href: "/workspace/execution", label: "Ejecución" },
  { id: "prototype", href: "/workspace/prototype", label: "Generar prototipo" },
  { id: "settings", href: "/workspace/settings", label: "Configuración" },
  {
    id: "notifications",
    href: "/workspace/notifications",
    label: "Notificaciones",
  },
] as const;

export function defaultSidebarConfiguration(): SidebarConfiguration {
  return {
    sections: [
      { id: "section-1", name: "Sección 1" },
      { id: "section-2", name: "Sección 2" },
      { id: "section-3", name: "Sección 3" },
      { id: "section-4", name: "Sección 4" },
      { id: "administration", name: "Administración" },
    ],
    menus: [
      {
        id: "home",
        placement: "SECTION",
        sectionId: "section-1",
        visible: true,
      },
      {
        id: "projects",
        placement: "SECTION",
        sectionId: "section-1",
        visible: true,
      },
      {
        id: "discussion",
        placement: "SECTION",
        sectionId: "section-2",
        visible: true,
      },
      {
        id: "sources",
        placement: "SECTION",
        sectionId: "section-2",
        visible: true,
      },
      {
        id: "documents",
        placement: "SECTION",
        sectionId: "section-3",
        visible: true,
      },
      {
        id: "validation",
        placement: "SECTION",
        sectionId: "section-3",
        visible: true,
      },
      {
        id: "execution",
        placement: "SECTION",
        sectionId: "section-4",
        visible: true,
      },
      {
        id: "prototype",
        placement: "SECTION",
        sectionId: "section-4",
        visible: true,
      },
      {
        id: "settings",
        placement: "SECTION",
        sectionId: "administration",
        visible: true,
      },
      {
        id: "notifications",
        placement: "BOTTOM",
        sectionId: null,
        visible: true,
      },
    ],
  };
}

function isMenuId(value: unknown): value is SidebarMenuId {
  return SIDEBAR_MENU_DEFINITIONS.some((menu) => menu.id === value);
}

export function parseSidebarConfiguration(
  value: unknown,
): SidebarConfiguration {
  const fallback = defaultSidebarConfiguration();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fallback;

  const candidate = value as { sections?: unknown; menus?: unknown };
  if (!Array.isArray(candidate.sections) || !Array.isArray(candidate.menus))
    return fallback;

  const ids = new Set<string>();
  const sections = candidate.sections.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const section = item as { id?: unknown; name?: unknown };
    const id = typeof section.id === "string" ? section.id.trim() : "";
    const name = typeof section.name === "string" ? section.name.trim() : "";
    if (!id || !name || ids.has(id)) return [];
    ids.add(id);
    return [{ id, name: name.slice(0, 60) }];
  });

  const configured = new Map<SidebarMenuId, SidebarMenuConfiguration>();
  for (const item of candidate.menus) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const menu = item as {
      id?: unknown;
      placement?: unknown;
      sectionId?: unknown;
      visible?: unknown;
    };
    if (!isMenuId(menu.id) || configured.has(menu.id)) continue;
    const sectionId =
      typeof menu.sectionId === "string" && ids.has(menu.sectionId)
        ? menu.sectionId
        : null;
    const placement =
      sectionId !== null
        ? "SECTION"
        : menu.placement === "TOP"
          ? "TOP"
          : "BOTTOM";
    configured.set(menu.id, {
      id: menu.id,
      placement,
      sectionId,
      visible: menu.visible !== false,
    });
  }

  const fallbackById = new Map(fallback.menus.map((menu) => [menu.id, menu]));
  const menus = [
    ...configured.values(),
    ...SIDEBAR_MENU_DEFINITIONS.filter((menu) => !configured.has(menu.id)).map(
      (menu) => {
        const defaultMenu = fallbackById.get(menu.id);
        return {
          id: menu.id,
          placement:
            defaultMenu?.sectionId && ids.has(defaultMenu.sectionId)
              ? ("SECTION" as const)
              : (defaultMenu?.placement ?? "BOTTOM"),
          sectionId:
            defaultMenu?.sectionId && ids.has(defaultMenu.sectionId)
              ? defaultMenu.sectionId
              : null,
          visible: true,
        };
      },
    ),
  ];

  return { sections, menus };
}

export function loadSidebarConfiguration(): SidebarConfiguration {
  try {
    const stored = window.localStorage.getItem(
      SIDEBAR_CONFIGURATION_STORAGE_KEY,
    );
    return stored
      ? parseSidebarConfiguration(JSON.parse(stored))
      : defaultSidebarConfiguration();
  } catch {
    return defaultSidebarConfiguration();
  }
}

export function saveSidebarConfiguration(
  configuration: SidebarConfiguration,
): void {
  const parsed = parseSidebarConfiguration(configuration);
  window.localStorage.setItem(
    SIDEBAR_CONFIGURATION_STORAGE_KEY,
    JSON.stringify(parsed),
  );
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_CONFIGURATION_EVENT, { detail: parsed }),
  );
}
