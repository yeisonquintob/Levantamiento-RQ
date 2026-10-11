"use client";

import { useEffect } from "react";

const TABLE_SELECTOR = "table.rq-table, table.rq-document-export-table";
const HANDLE_CLASS = "rq-col-resizer";
const MIN_COLUMN_WIDTH = 60;

function ensureHandles(table: HTMLTableElement): void {
  const headers = table.querySelectorAll<HTMLTableCellElement>("thead th");

  headers.forEach((th) => {
    if (th.querySelector(`:scope > .${HANDLE_CLASS}`)) return;
    const handle = document.createElement("span");
    handle.className = HANDLE_CLASS;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-hidden", "true");
    th.appendChild(handle);
  });
}

function freezeColumns(table: HTMLTableElement): void {
  if (table.dataset.rqResized === "true") return;

  const headers = Array.from(
    table.querySelectorAll<HTMLTableCellElement>("thead th"),
  );
  const widths = headers.map((th) => th.getBoundingClientRect().width);
  const total = widths.reduce((sum, width) => sum + width, 0);

  table.dataset.rqResized = "true";
  table.style.setProperty("table-layout", "fixed", "important");
  table.style.setProperty("width", `${total}px`, "important");
  table.style.setProperty("min-width", "0", "important");

  headers.forEach((th, index) => {
    const width = `${widths[index]}px`;
    th.style.setProperty("width", width, "important");
    th.style.setProperty("min-width", "0", "important");
    th.style.setProperty("max-width", "none", "important");
  });
}

function startResize(event: PointerEvent, handle: HTMLElement): void {
  const th = handle.parentElement as HTMLTableCellElement | null;
  const table = th?.closest("table") as HTMLTableElement | null;
  if (!th || !table) return;

  event.preventDefault();
  event.stopPropagation();
  freezeColumns(table);

  const startX = event.clientX;
  const startWidth = th.getBoundingClientRect().width;
  const startTableWidth = table.getBoundingClientRect().width;

  handle.setPointerCapture(event.pointerId);
  document.body.classList.add("rq-col-resizing");
  th.dataset.rqResizing = "true";

  const onMove = (moveEvent: PointerEvent) => {
    const nextWidth = Math.max(
      MIN_COLUMN_WIDTH,
      startWidth + (moveEvent.clientX - startX),
    );
    const delta = nextWidth - startWidth;
    th.style.setProperty("width", `${nextWidth}px`, "important");
    table.style.setProperty(
      "width",
      `${startTableWidth + delta}px`,
      "important",
    );
  };

  const onEnd = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onEnd);
    handle.removeEventListener("pointercancel", onEnd);
    document.body.classList.remove("rq-col-resizing");
    delete th.dataset.rqResizing;
  };

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onEnd);
  handle.addEventListener("pointercancel", onEnd);
}

function resetColumns(table: HTMLTableElement): void {
  delete table.dataset.rqResized;
  table.style.removeProperty("table-layout");
  table.style.removeProperty("width");
  table.style.removeProperty("min-width");
  table.querySelectorAll<HTMLTableCellElement>("thead th").forEach((th) => {
    th.style.removeProperty("width");
    th.style.removeProperty("min-width");
    th.style.removeProperty("max-width");
  });
}

/**
 * Permite ajustar el ancho de las columnas de cualquier tabla del sistema
 * arrastrando el borde derecho del encabezado. Doble clic restablece.
 * Solo modifica la presentacion; no toca datos ni comportamiento.
 */
export function TableColumnResizer() {
  useEffect(() => {
    const scan = () => {
      document
        .querySelectorAll<HTMLTableElement>(TABLE_SELECTOR)
        .forEach(ensureHandles);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains(HANDLE_CLASS)
      ) {
        startResize(event, target);
      }
    };

    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains(HANDLE_CLASS)
      ) {
        const table = target.closest("table") as HTMLTableElement | null;
        if (table) resetColumns(table);
      }
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("dblclick", onDoubleClick);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  return null;
}
