"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { AppearanceControls } from "./appearance-controls";
import { ConfirmDialogProvider } from "./confirm-dialog";
import { NotificationsIndicator } from "./notifications-indicator";
import { SessionActivityManager } from "./session-activity-manager";
import { SignOutButton } from "./sign-out-button";
import { TableColumnResizer } from "./table-column-resizer";
import { TabListKeyboard } from "./tablist-keyboard-listener";
import {
  defaultSidebarConfiguration,
  loadSidebarConfiguration,
  SIDEBAR_CONFIGURATION_EVENT,
  SIDEBAR_CONFIGURATION_STORAGE_KEY,
  SIDEBAR_MENU_DEFINITIONS,
  type SidebarConfiguration,
  type SidebarMenuId,
} from "./sidebar-navigation";
import {
  resolveWorkspaceBackTarget,
  resolveWorkspaceNavigationDirection,
  workspaceLocationKey,
  type WorkspaceLocation,
  type WorkspaceNavigationDirection,
} from "./workspace-navigation-transition";

interface AppShellProps {
  children: ReactNode;
  user: {
    displayName: string;
    email: string;
    roles: readonly string[];
    permissions: readonly string[];
    mustChangePassword: boolean;
  };
}

interface WorkspacePageContext {
  eyebrow: string;
  title: string;
  description: string;
}

function isMenuActive(menuId: SidebarMenuId, pathname: string): boolean {
  if (menuId === "home") return pathname === "/workspace";
  if (menuId === "projects") {
    return (
      pathname.startsWith("/workspace/projects") &&
      !pathname.endsWith("/discussion")
    );
  }
  if (menuId === "discussion") {
    return (
      pathname.startsWith("/workspace/discussion") ||
      pathname.endsWith("/discussion")
    );
  }
  const definition = SIDEBAR_MENU_DEFINITIONS.find(
    (menu) => menu.id === menuId,
  );
  return definition ? pathname.startsWith(definition.href) : false;
}

function NavIcon({ name }: { name: SidebarMenuId }) {
  const icon = {
    home: (
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9 21v-7h6v7" />
      </>
    ),
    projects: (
      <>
        <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4" />
      </>
    ),
    discussion: (
      <>
        <path d="M4 5.5h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H10l-4.5 3v-3H4a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" />
        <path d="M7 9.5h7M7 12.5h5" />
      </>
    ),
    sources: (
      <>
        <ellipse cx="12" cy="5" rx="7.5" ry="3" />
        <path d="M4.5 5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5" />
        <path d="M4.5 11v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
      </>
    ),
    documents: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 12h6M9 15h6M9 18h4" />
      </>
    ),
    validation: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12.5 2.5 2.5 5.5-6" />
      </>
    ),
    notifications: (
      <>
        <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 6.5 2.5 6.5H4S6.5 15 6.5 9Z" />
        <path d="M9.5 19a2.7 2.7 0 0 0 5 0" />
      </>
    ),
    execution: (
      <>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
        <path d="m4 6 6-3 6 5 5-4" />
      </>
    ),
    prototype: (
      <>
        <rect height="18" rx="2" width="16" x="4" y="3" />
        <path d="M4 8h16M9 21v-4h6v4M8 5.5h.01M11 5.5h.01" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="10" cy="18" r="2" />
      </>
    ),
  }[name];

  return (
    <svg
      aria-hidden="true"
      className="rq-nav__svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {icon}
      </g>
    </svg>
  );
}

interface SidebarNavLinkProps {
  collapsed: boolean;
  menuId: SidebarMenuId;
  onNavigate: () => void;
  pathname: string;
}

function SidebarNavLink({
  collapsed,
  menuId,
  onNavigate,
  pathname,
}: SidebarNavLinkProps) {
  const definition = SIDEBAR_MENU_DEFINITIONS.find(
    (menu) => menu.id === menuId,
  );
  if (!definition) return null;

  return (
    <Link
      aria-current={isMenuActive(menuId, pathname) ? "page" : undefined}
      aria-label={collapsed ? definition.label : undefined}
      href={definition.href}
      onClick={onNavigate}
      title={collapsed ? definition.label : undefined}
    >
      <span aria-hidden="true" className="rq-nav__icon">
        <NavIcon name={menuId} />
      </span>
      <span>{definition.label}</span>
    </Link>
  );
}

function resolvePageContext(pathname: string): WorkspacePageContext {
  if (pathname.startsWith("/workspace/settings/templates")) {
    return {
      eyebrow: "Configuración",
      title: "Plantillas",
      description: "Catálogo documental versionado.",
    };
  }

  if (pathname.startsWith("/workspace/settings/users")) {
    return {
      eyebrow: "Configuración",
      title: "Usuarios y roles",
      description: "Cuentas, permisos y seguridad.",
    };
  }

  if (pathname.startsWith("/workspace/settings/ai-providers")) {
    return {
      eyebrow: "Configuración",
      title: "Proveedores de IA",
      description: "Modelos, límites y credenciales protegidas.",
    };
  }

  if (pathname.startsWith("/workspace/settings/audit")) {
    return {
      eyebrow: "Configuración",
      title: "Auditoría",
      description: "Trazabilidad de operaciones y eventos.",
    };
  }

  if (pathname.startsWith("/workspace/settings/general")) {
    return {
      eyebrow: "Configuración",
      title: "General",
      description: "Preferencias personales y parámetros existentes.",
    };
  }

  if (pathname.startsWith("/workspace/settings/sidebar")) {
    return {
      eyebrow: "Configuración",
      title: "Barra lateral",
      description: "Secciones, visibilidad y orden de la navegación.",
    };
  }

  if (pathname.startsWith("/workspace/sources")) {
    return {
      eyebrow: "Carga de datos",
      title: "Fuentes del levantamiento",
      description:
        "Notas, conversaciones y transcripciones vinculadas a cada proyecto.",
    };
  }

  if (
    pathname.startsWith("/workspace/discussion") ||
    (pathname.startsWith("/workspace/projects/") &&
      pathname.endsWith("/discussion"))
  ) {
    return {
      eyebrow: "Levantamiento guiado",
      title: "Discusión",
      description:
        "Preguntas, respuestas y conversación procesadas de forma controlada.",
    };
  }

  if (pathname.startsWith("/workspace/projects")) {
    return {
      eyebrow: "Gestión",
      title: "Proyectos",
      description:
        "Crea, consulta y administra los proyectos y sus participantes.",
    };
  }

  if (pathname.startsWith("/workspace/documents")) {
    return {
      eyebrow: "Documento",
      title: "Documentos",
      description: "Borradores, versiones y entregables del levantamiento.",
    };
  }

  if (pathname.startsWith("/workspace/validation")) {
    return {
      eyebrow: "Revisión",
      title: "Validación",
      description: "Observaciones, aprobación y cierre del documento.",
    };
  }

  if (pathname.startsWith("/workspace/notifications")) {
    return {
      eyebrow: "Actividad",
      title: "Notificaciones",
      description:
        "Consulta y atiende los avisos generados durante el avance de tus proyectos.",
    };
  }

  if (pathname.startsWith("/workspace/execution")) {
    return {
      eyebrow: "Seguimiento",
      title: "Ejecución",
      description:
        "Compara el plan de trabajo con el avance reportado desde Azure.",
    };
  }

  if (pathname.startsWith("/workspace/prototype")) {
    return {
      eyebrow: "Diseño",
      title: "Generar prototipo",
      description:
        "Convierte el Markdown aprobado en una propuesta visual navegable.",
    };
  }

  if (pathname.startsWith("/workspace/settings")) {
    return {
      eyebrow: "Sistema",
      title: "Configuración",
      description:
        "Personaliza tu experiencia y administra las opciones disponibles para tu perfil.",
    };
  }

  return {
    eyebrow: "Centro de trabajo",
    title: "Inicio",
    description:
      "Estado general de los proyectos y avance del flujo documental.",
  };
}

/** Icono de panel lateral (cuadro con la columna izquierda marcada). */
function SidebarIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="20"
    >
      <rect height="18" rx="3.5" width="18" x="3" y="3" />
      <path d="M9.5 3v18" />
    </svg>
  );
}

function BackArrow() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="m14 5-7 7 7 7M7.5 12H20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.2"
      />
    </svg>
  );
}

function resolveInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function resolveProfile(roles: readonly string[]): string {
  if (roles.some((role) => role.toUpperCase() === "ADMIN")) {
    return "Administrador";
  }

  const primaryRole = roles[0]?.trim();

  if (!primaryRole) {
    return "Usuario";
  }

  return primaryRole
    .toLowerCase()
    .replace(/(^|[\s_-])\p{L}/gu, (match) => match.toUpperCase())
    .replace(/[_-]+/g, " ");
}

export function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceReady, setSidebarPreferenceReady] = useState(false);
  const [sidebarConfiguration, setSidebarConfiguration] =
    useState<SidebarConfiguration>(defaultSidebarConfiguration);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const initials = resolveInitials(user.displayName);
  const profile = resolveProfile(user.roles);
  const pageContext = resolvePageContext(pathname);
  const backTarget = resolveWorkspaceBackTarget({ pathname, search });
  const topMenus = sidebarConfiguration.menus.filter(
    (menu) => menu.visible && menu.placement === "TOP",
  );
  const bottomMenus = sidebarConfiguration.menus.filter(
    (menu) => menu.visible && menu.placement === "BOTTOM",
  );

  const visibleMenuOrder: SidebarMenuId[] = [
    ...topMenus.map((menu) => menu.id),
    ...sidebarConfiguration.sections.flatMap((section) =>
      sidebarConfiguration.menus
        .filter(
          (menu) =>
            menu.visible &&
            menu.placement === "SECTION" &&
            menu.sectionId === section.id,
        )
        .map((menu) => menu.id),
    ),
    ...bottomMenus.map((menu) => menu.id),
  ];
  const currentLocation: WorkspaceLocation = { pathname, search };
  const [navigation, setNavigation] = useState<{
    location: WorkspaceLocation;
    direction: WorkspaceNavigationDirection;
  }>({ location: currentLocation, direction: "none" });
  if (
    workspaceLocationKey(navigation.location) !==
    workspaceLocationKey(currentLocation)
  ) {
    setNavigation({
      location: currentLocation,
      direction: resolveWorkspaceNavigationDirection(
        navigation.location,
        currentLocation,
        visibleMenuOrder,
      ),
    });
  }

  useEffect(() => {
    setSidebarCollapsed(
      window.localStorage.getItem("rq-sidebar-collapsed") === "true",
    );
    setSidebarPreferenceReady(true);
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceReady) return;
    window.localStorage.setItem(
      "rq-sidebar-collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed, sidebarPreferenceReady]);

  useEffect(() => {
    const refresh = (): void =>
      setSidebarConfiguration(loadSidebarConfiguration());
    const refreshFromStorage = (event: StorageEvent): void => {
      if (event.key === SIDEBAR_CONFIGURATION_STORAGE_KEY) refresh();
    };

    refresh();
    window.addEventListener(SIDEBAR_CONFIGURATION_EVENT, refresh);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      window.removeEventListener(SIDEBAR_CONFIGURATION_EVENT, refresh);
      window.removeEventListener("storage", refreshFromStorage);
    };
  }, []);

  useEffect(() => {
    function closeFromOutside(event: MouseEvent): void {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }

    function closeFromEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);

    return () => {
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, []);

  return (
    <div className="rq-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <SessionActivityManager />
      <TabListKeyboard />
      <a className="rq-skip-link" href="#contenido-principal">
        Saltar al contenido
      </a>

      <header className="rq-topbar">
        <button
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          className="rq-menu-button"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          {menuOpen ? <span aria-hidden="true">×</span> : <SidebarIcon />}
        </button>

        <div className="rq-topbar__identity">
          <button
            aria-controls="rq-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
            className="rq-topbar__collapse"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
            type="button"
          >
            <SidebarIcon />
          </button>
          <strong>Levantamiento RQ</strong>
        </div>

        <div className="rq-topbar__page">
          <span>{pageContext.eyebrow}</span>
          <h1>{pageContext.title}</h1>
          <small>{pageContext.description}</small>
        </div>

        <div className="rq-topbar__actions">
          <NotificationsIndicator />
          <AppearanceControls />

          <div className="rq-user-menu" ref={userMenuRef}>
            <button
              aria-controls="rq-user-menu-panel"
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label={
                userMenuOpen
                  ? "Cerrar menú del usuario"
                  : "Abrir menú del usuario"
              }
              className="rq-user-menu__trigger"
              onClick={() => setUserMenuOpen((current) => !current)}
              type="button"
            >
              <span className="rq-user-menu__trigger-name">
                {user.displayName}
              </span>
              <span aria-hidden="true" className="rq-user-avatar">
                {initials}
              </span>
            </button>

            {userMenuOpen ? (
              <section
                aria-label="Información del usuario"
                className="rq-user-menu__panel"
                id="rq-user-menu-panel"
                role="menu"
              >
                <header className="rq-user-menu__header">
                  <span
                    aria-hidden="true"
                    className="rq-user-avatar rq-user-avatar--large"
                  >
                    {initials}
                  </span>

                  <div className="rq-user-menu__identity">
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                  </div>
                </header>

                <div className="rq-user-menu__content">
                  <article className="rq-user-menu__profile">
                    <span>Perfil</span>
                    <strong>{profile}</strong>
                  </article>

                  <div className="rq-user-menu__signout">
                    <SignOutButton />
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </header>

      <aside
        className="rq-sidebar"
        data-collapsed={sidebarCollapsed}
        data-open={menuOpen}
        id="rq-sidebar"
      >
        <div className="rq-sidebar__toggle-row">
          {backTarget ? (
            <Link
              aria-label="Volver"
              className="rq-sidebar__back"
              href={backTarget}
              onClick={() => setMenuOpen(false)}
              title="Volver"
            >
              <BackArrow />
            </Link>
          ) : (
            <button
              aria-label="Volver"
              className="rq-sidebar__back"
              disabled
              type="button"
            >
              <BackArrow />
            </button>
          )}
        </div>

        <nav className="rq-nav" aria-label="Navegación principal">
          {topMenus.map((menu) => (
            <SidebarNavLink
              collapsed={sidebarCollapsed}
              key={menu.id}
              menuId={menu.id}
              onNavigate={() => setMenuOpen(false)}
              pathname={pathname}
            />
          ))}

          {sidebarConfiguration.sections.map((section) => {
            const menus = sidebarConfiguration.menus.filter(
              (menu) =>
                menu.visible &&
                menu.placement === "SECTION" &&
                menu.sectionId === section.id,
            );
            if (menus.length === 0) return null;
            return (
              <Fragment key={section.id}>
                <span className="rq-nav__label">{section.name}</span>
                {menus.map((menu) => (
                  <SidebarNavLink
                    collapsed={sidebarCollapsed}
                    key={menu.id}
                    menuId={menu.id}
                    onNavigate={() => setMenuOpen(false)}
                    pathname={pathname}
                  />
                ))}
              </Fragment>
            );
          })}

          {bottomMenus.length > 0 ? <hr className="rq-nav__separator" /> : null}
          {bottomMenus.map((menu) => (
            <SidebarNavLink
              collapsed={sidebarCollapsed}
              key={menu.id}
              menuId={menu.id}
              onNavigate={() => setMenuOpen(false)}
              pathname={pathname}
            />
          ))}
        </nav>
      </aside>

      <button
        aria-label="Cerrar menú"
        className="rq-sidebar-overlay"
        data-open={menuOpen}
        onClick={() => setMenuOpen(false)}
        type="button"
      />

      <main className="rq-main" id="contenido-principal">
        <div
          className="rq-content"
          data-rq-navigation-direction={
            navigation.direction === "none" ? undefined : navigation.direction
          }
          key={workspaceLocationKey(currentLocation)}
        >
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </div>
        <TableColumnResizer />
      </main>

      <footer className="rq-footer">
        {pathname.startsWith("/workspace/discussion") ||
        pathname.endsWith("/discussion")
          ? "Discusión: captura de respuestas, procesamiento con IA y selección de evidencia"
          : pathname.startsWith("/workspace/documents")
            ? "Editor documental, versiones e historial · Paso 17"
            : pathname.startsWith("/workspace/validation")
              ? "Revisión, observaciones y aprobación documental · Paso 17"
              : pathname.startsWith("/workspace/notifications")
                ? "Actividad reciente y avisos pendientes de tus proyectos"
                : pathname.startsWith("/workspace/settings/audit")
                  ? "Auditoría funcional y correlación por proyecto"
                  : pathname.startsWith("/workspace/settings/templates")
                    ? "Catálogo de plantillas configurables y versionadas · Paso 14"
                    : pathname.startsWith("/workspace/settings/users")
                      ? "Administración segura de usuarios, roles y sesiones"
                      : pathname.startsWith("/workspace/settings/ai-providers")
                        ? "Configuración segura de proveedores de inteligencia artificial"
                        : pathname.startsWith("/workspace/settings")
                          ? "Preferencias personales y administración segura del sistema"
                          : pathname.startsWith("/workspace/sources")
                            ? "Flujo documental: datos, análisis, borradores y aprobación"
                            : pathname.startsWith("/workspace/projects")
                              ? "Flujo documental: datos, análisis, borradores y aprobación"
                              : "Flujo documental: datos, análisis, borradores y aprobación"}
      </footer>
    </div>
  );
}
