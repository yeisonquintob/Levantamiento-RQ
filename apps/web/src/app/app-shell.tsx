"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { AppearanceControls } from "./appearance-controls";
import { SignOutButton } from "./sign-out-button";

interface AppShellProps {
  children: ReactNode;
  user: {
    displayName: string;
    email: string;
    roles: readonly string[];
  };
}

const futureNavigation = [
  ["Documentos", "D"],
  ["Validación", "V"],
  ["Configuración", "C"],
] as const;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const initials = resolveInitials(user.displayName);
  const profile = resolveProfile(user.roles);

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
    <div className="rq-shell">
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
          <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
        </button>

        <div className="rq-topbar__identity">
          <strong>Levantamiento RQ</strong>
          <span>
            Requerimientos con trazabilidad, revisión humana y apoyo de IA
          </span>
        </div>

        <div className="rq-topbar__actions">
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

      <aside className="rq-sidebar" data-open={menuOpen}>
        <div className="rq-sidebar__brand">
          <strong>Levantamiento RQ</strong>
          <span>Plataforma de análisis y documentación</span>
        </div>

        <nav className="rq-nav" aria-label="Navegación principal">
          <span className="rq-nav__label">Gestión</span>

          <a href="/workspace#inicio" onClick={() => setMenuOpen(false)}>
            <span aria-hidden="true" className="rq-nav__icon">
              ⌂
            </span>
            <span>Inicio</span>
          </a>

          <a
            aria-current={pathname === "/workspace" ? "page" : undefined}
            href="/workspace#proyectos"
            onClick={() => setMenuOpen(false)}
          >
            <span aria-hidden="true" className="rq-nav__icon">
              P
            </span>
            <span>Proyectos</span>
          </a>

          <a
            aria-current={
              pathname.startsWith("/workspace/sources") ? "page" : undefined
            }
            href="/workspace/sources"
            onClick={() => setMenuOpen(false)}
          >
            <span aria-hidden="true" className="rq-nav__icon">
              F
            </span>
            <span>Fuentes</span>
          </a>

          {futureNavigation.map(([label, icon]) => (
            <span
              aria-disabled="true"
              className="rq-nav__disabled"
              key={label}
              title="Se habilitará en un paso posterior"
            >
              <span aria-hidden="true" className="rq-nav__icon">
                {icon}
              </span>
              <span>{label}</span>
            </span>
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
        <div className="rq-content" id="inicio">
          {children}
        </div>
      </main>

      <footer className="rq-footer">
        Fuentes textuales y trazabilidad por proyecto · Paso 13.1
      </footer>
    </div>
  );
}
