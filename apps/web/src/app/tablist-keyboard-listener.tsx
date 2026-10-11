"use client";

import { useEffect } from "react";

import { nextTabIndex } from "./tablist-keyboard";

/**
 * Navegación por teclado común a todas las listas de pestañas (`role="tablist"`): flechas,
 * Inicio y Fin mueven el foco y activan la pestaña, como pide el patrón ARIA de pestañas.
 */
export function TabListKeyboard() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return;
      const list = target.closest('[role="tablist"]');
      if (!list || event.altKey || event.ctrlKey || event.metaKey) return;
      const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
      const next = nextTabIndex(
        event.key,
        tabs.indexOf(target),
        tabs.map((tab) => !tab.hasAttribute("disabled") && tab.getAttribute("aria-disabled") !== "true"),
      );
      if (next === null) return;
      event.preventDefault();
      const tab = tabs[next];
      tab?.focus();
      tab?.click();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
