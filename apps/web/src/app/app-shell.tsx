"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { AppearanceControls } from "./appearance-controls";

interface AppShellProps {
  children: ReactNode;
}

const futureNavigation = [
  ["Proyectos", "P"],
  ["Fuentes", "F"],
  ["Documentos", "D"],
  ["Validación", "V"],
  ["Configuración", "C"],
] as const;

export function AppShell({ children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

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
          <span className="rq-status" data-rq-status="neutral">
            Base visual
          </span>
        </div>
      </header>

      <aside className="rq-sidebar" data-open={menuOpen}>
        <div className="rq-sidebar__brand">
          <strong>Levantamiento RQ</strong>
          <span>Plataforma de análisis y documentación</span>
        </div>

        <nav className="rq-nav" aria-label="Navegación principal">
          <span className="rq-nav__label">Gestión</span>

          <a
            aria-current="page"
            href="#inicio"
            onClick={() => setMenuOpen(false)}
          >
            <span aria-hidden="true" className="rq-nav__icon">
              ⌂
            </span>
            <span>Inicio</span>
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

      <footer className="rq-footer">Base responsive · Paso 9</footer>
    </div>
  );
}
