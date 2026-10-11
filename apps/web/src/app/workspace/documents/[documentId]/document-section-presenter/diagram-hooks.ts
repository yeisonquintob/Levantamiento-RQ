"use client";

import React, { useEffect, useState } from "react";

/**
 * Arrastrar con clic sostenido desplaza el visor del diagrama (sin tocar los
 * nodos si el puntero apenas se movió).
 */
export function useDragPan() {
  const drag = React.useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  return {
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      const element = event.currentTarget;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
        moved: false,
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
      const state = drag.current;
      if (!state) return;
      const element = event.currentTarget;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;
        state.moved = true;
        element.setPointerCapture(event.pointerId);
        element.dataset.panning = "true";
      }
      element.scrollLeft = state.left - dx;
      element.scrollTop = state.top - dy;
    },
    onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
      drag.current = null;
      delete event.currentTarget.dataset.panning;
    },
    onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
      drag.current = null;
      delete event.currentTarget.dataset.panning;
    },
  };
}

/** Vista ampliada de un diagrama (pantalla completa); Esc la cierra. */
export function useDiagramExpand(): [
  boolean,
  (value: boolean | ((current: boolean) => boolean)) => void,
] {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  return [expanded, setExpanded];
}
