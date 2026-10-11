"use client";

import { useEffect, useState } from "react";

import { RqKpiCard, RqKpiGrid } from "@levantamiento-rq/shared-ui";

import {
  defaultSidebarConfiguration,
  loadSidebarConfiguration,
  saveSidebarConfiguration,
  SIDEBAR_MENU_DEFINITIONS,
  type SidebarConfiguration,
  type SidebarMenuConfiguration,
  type SidebarSectionConfiguration,
} from "../../../sidebar-navigation";
import { WorkspaceKpiIcon } from "../../workspace-kpi-icon";

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function SidebarSettings() {
  const [configuration, setConfiguration] = useState<SidebarConfiguration>(
    defaultSidebarConfiguration,
  );
  const [ready, setReady] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setConfiguration(loadSidebarConfiguration());
    setReady(true);
  }, []);

  function update(
    recipe: (current: SidebarConfiguration) => SidebarConfiguration,
  ): void {
    setConfiguration(recipe);
    setMessage("");
  }

  function updateSections(
    recipe: (
      sections: SidebarSectionConfiguration[],
    ) => SidebarSectionConfiguration[],
  ): void {
    update((current) => ({
      ...current,
      sections: recipe(current.sections),
    }));
  }

  function updateMenus(
    recipe: (menus: SidebarMenuConfiguration[]) => SidebarMenuConfiguration[],
  ): void {
    update((current) => ({
      ...current,
      menus: recipe(current.menus),
    }));
  }

  function addSection(): void {
    const name = newSectionName.trim();
    if (!name) return;
    updateSections((sections) => [
      ...sections,
      { id: `section-${Date.now().toString(36)}`, name: name.slice(0, 60) },
    ]);
    setNewSectionName("");
  }

  function removeSection(sectionId: string): void {
    update((current) => ({
      sections: current.sections.filter((section) => section.id !== sectionId),
      menus: current.menus.map((menu) =>
        menu.sectionId === sectionId
          ? { ...menu, placement: "BOTTOM", sectionId: null }
          : menu,
      ),
    }));
  }

  function save(): void {
    saveSidebarConfiguration(configuration);
    setConfiguration(loadSidebarConfiguration());
    setMessage("Organización guardada. La barra lateral ya fue actualizada.");
  }

  function restore(): void {
    const defaults = defaultSidebarConfiguration();
    setConfiguration(defaults);
    saveSidebarConfiguration(defaults);
    setMessage("Se restauró la organización predeterminada.");
  }

  if (!ready) return <p>Cargando organización…</p>;

  return (
    <div className="rq-sidebar-settings">
      <RqKpiGrid label="Resumen de la barra lateral">
        <RqKpiCard
          description="Grupos de navegación"
          icon={<WorkspaceKpiIcon name="layers" />}
          title="Secciones"
          value={String(configuration.sections.length)}
        />
        <RqKpiCard
          description="Menús que se muestran"
          icon={<WorkspaceKpiIcon name="eye" />}
          title="Visibles"
          value={String(
            configuration.menus.filter((menu) => menu.visible).length,
          )}
        />
        <RqKpiCard
          description="Menús ocultos"
          icon={<WorkspaceKpiIcon name="alert" />}
          title="Ocultos"
          value={String(
            configuration.menus.filter((menu) => !menu.visible).length,
          )}
        />
      </RqKpiGrid>

      <section
        className="rq-sidebar-settings__panel"
        aria-labelledby="sidebar-sections-title"
      >
        <header>
          <div>
            <span>Grupos</span>
            <h2 id="sidebar-sections-title">Secciones</h2>
          </div>
          <p>Crea, cambia el nombre y ordena los grupos de navegación.</p>
        </header>

        <ol className="rq-sidebar-settings__list">
          {configuration.sections.map((section, index) => (
            <li key={section.id}>
              <input
                aria-label={`Nombre de ${section.name}`}
                maxLength={60}
                onChange={(event) =>
                  updateSections((sections) =>
                    sections.map((item) =>
                      item.id === section.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
                value={section.name}
              />
              <div className="rq-sidebar-settings__actions">
                <button
                  disabled={index === 0}
                  onClick={() =>
                    updateSections((sections) => move(sections, index, -1))
                  }
                  type="button"
                  aria-label={`Subir ${section.name}`}
                >
                  ↑
                </button>
                <button
                  disabled={index === configuration.sections.length - 1}
                  onClick={() =>
                    updateSections((sections) => move(sections, index, 1))
                  }
                  type="button"
                  aria-label={`Bajar ${section.name}`}
                >
                  ↓
                </button>
                <button
                  className="rq-sidebar-settings__remove"
                  onClick={() => removeSection(section.id)}
                  type="button"
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ol>

        <div className="rq-sidebar-settings__add">
          <input
            aria-label="Nombre de la nueva sección"
            maxLength={60}
            onChange={(event) => setNewSectionName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSection();
              }
            }}
            placeholder="Nombre de la nueva sección"
            value={newSectionName}
          />
          <button
            disabled={!newSectionName.trim()}
            onClick={addSection}
            type="button"
          >
            Agregar sección
          </button>
        </div>
      </section>

      <section
        className="rq-sidebar-settings__panel"
        aria-labelledby="sidebar-menus-title"
      >
        <header>
          <div>
            <span>Navegación</span>
            <h2 id="sidebar-menus-title">Menús</h2>
          </div>
          <p>
            Asigna cada menú a una sección, ubícalo arriba o abajo, u ocúltalo.
          </p>
        </header>

        <ol className="rq-sidebar-settings__list rq-sidebar-settings__menus">
          {configuration.menus.map((menu, index) => {
            const definition = SIDEBAR_MENU_DEFINITIONS.find(
              (item) => item.id === menu.id,
            );
            if (!definition) return null;
            return (
              <li key={menu.id}>
                <div className="rq-sidebar-settings__menu-name">
                  <strong>{definition.label}</strong>
                  <small>{definition.href}</small>
                </div>
                <label>
                  <span>Ubicación</span>
                  <select
                    onChange={(event) => {
                      const location = event.target.value;
                      updateMenus((menus) =>
                        menus.map((item) => {
                          if (item.id !== menu.id) return item;
                          if (location === "__top") {
                            return {
                              ...item,
                              placement: "TOP",
                              sectionId: null,
                            };
                          }
                          if (location === "__bottom") {
                            return {
                              ...item,
                              placement: "BOTTOM",
                              sectionId: null,
                            };
                          }
                          return {
                            ...item,
                            placement: "SECTION",
                            sectionId: location,
                          };
                        }),
                      );
                    }}
                    value={
                      menu.placement === "TOP"
                        ? "__top"
                        : menu.placement === "BOTTOM"
                          ? "__bottom"
                          : (menu.sectionId ?? "__bottom")
                    }
                  >
                    <option value="__top">Arriba</option>
                    {configuration.sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name || "Sección sin nombre"}
                      </option>
                    ))}
                    <option value="__bottom">Abajo</option>
                  </select>
                </label>
                <label className="rq-sidebar-settings__visibility">
                  <input
                    checked={menu.visible}
                    onChange={(event) =>
                      updateMenus((menus) =>
                        menus.map((item) =>
                          item.id === menu.id
                            ? { ...item, visible: event.target.checked }
                            : item,
                        ),
                      )
                    }
                    type="checkbox"
                  />
                  Mostrar
                </label>
                <div className="rq-sidebar-settings__actions">
                  <button
                    disabled={index === 0}
                    onClick={() =>
                      updateMenus((menus) => move(menus, index, -1))
                    }
                    type="button"
                    aria-label={`Subir ${definition.label}`}
                  >
                    ↑
                  </button>
                  <button
                    disabled={index === configuration.menus.length - 1}
                    onClick={() =>
                      updateMenus((menus) => move(menus, index, 1))
                    }
                    type="button"
                    aria-label={`Bajar ${definition.label}`}
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="rq-sidebar-settings__footer">
        <button
          className="rq-sidebar-settings__secondary"
          onClick={restore}
          type="button"
        >
          Restaurar valores predeterminados
        </button>
        <button
          className="rq-sidebar-settings__save"
          onClick={save}
          type="button"
        >
          Guardar organización
        </button>
        {message ? <p role="status">{message}</p> : null}
      </footer>
    </div>
  );
}
