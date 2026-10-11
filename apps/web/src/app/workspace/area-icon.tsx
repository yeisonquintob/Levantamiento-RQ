import type { ReactNode } from "react";

import type {
  ProjectAreaColor,
  ProjectAreaIcon,
} from "@levantamiento-rq/shared-contracts";

/** Nombre legible de cada icono de área (para el selector). */
export const AREA_ICON_LABELS: Readonly<Record<ProjectAreaIcon, string>> = {
  wallet: "Cartera",
  calculator: "Contabilidad",
  chart: "Finanzas",
  laptop: "Tecnología",
  truck: "Logística",
  gear: "Operaciones",
  users: "Personas",
  scale: "Jurídico",
  cart: "Compras y comercial",
  wrench: "Servicios",
  calendar: "Planificación",
  megaphone: "Mercadeo",
  shield: "Seguridad",
  headset: "Atención al cliente",
  box: "Producto",
  building: "General",
};

function paths(name: ProjectAreaIcon): ReactNode {
  switch (name) {
    case "wallet":
      return (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h12v4" />
          <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" />
          <path d="M16 14.5h.01" />
        </>
      );
    case "calculator":
      return (
        <>
          <rect height="18" rx="2" width="14" x="5" y="3" />
          <path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
        </>
      );
    case "chart":
      return <path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6" />;
    case "laptop":
      return (
        <>
          <rect height="11" rx="1.5" width="16" x="4" y="5" />
          <path d="M2 19h20" />
        </>
      );
    case "truck":
      return (
        <>
          <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
          <circle cx="7" cy="17.5" r="1.8" />
          <circle cx="17" cy="17.5" r="1.8" />
        </>
      );
    case "gear":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </>
      );
    case "users":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0M16 5.2a3 3 0 0 1 0 5.6M18 14a5.5 5.5 0 0 1 3 5" />
        </>
      );
    case "scale":
      return (
        <path d="M12 4v16M6 20h12M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0L5 7ZM19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z" />
      );
    case "cart":
      return (
        <>
          <path d="M3 4h2.5l2 11h10l2-8H7" />
          <circle cx="9" cy="19" r="1.4" />
          <circle cx="17" cy="19" r="1.4" />
        </>
      );
    case "wrench":
      return (
        <path d="M14.5 6a4 4 0 0 0-5.2 5.2L3.5 17a2 2 0 0 0 3 3l5.8-5.8A4 4 0 0 0 18 9l-2.5 2.5-2-2L16 7a4 4 0 0 0-1.5-1Z" />
      );
    case "calendar":
      return (
        <>
          <rect height="16" rx="2" width="18" x="3" y="5" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </>
      );
    case "megaphone":
      return (
        <path d="M3 10v4l11 4V6L3 10ZM14 8.5a3.5 3.5 0 0 1 0 7M6 14v4a1.5 1.5 0 0 0 3 0v-2.5" />
      );
    case "shield":
      return (
        <>
          <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </>
      );
    case "headset":
      return (
        <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1v-4ZM20 14h-3v5h2a1 1 0 0 0 1-1v-4ZM17 19c0 1.5-2 2-5 2" />
      );
    case "box":
      return <path d="M12 3 4 7v10l8 4 8-4V7l-8-4ZM4 7l8 4 8-4M12 11v10" />;
    case "building":
      return <path d="M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3" />;
  }
}

/** Nombre legible de cada color (para el selector). */
export const AREA_COLOR_LABELS: Readonly<Record<ProjectAreaColor, string>> = {
  purple: "Morado",
  blue: "Azul",
  teal: "Turquesa",
  green: "Verde",
  orange: "Naranja",
  red: "Rojo",
  brown: "Café",
  slate: "Gris",
};

/** Clase que fija el color del icono; sin color se usa el del texto. */
export function areaColorClass(color: ProjectAreaColor | null): string {
  return color ? `rq-area-color--${color}` : "";
}

export function AreaIcon({
  color = null,
  name,
  size = 16,
}: {
  color?: ProjectAreaColor | null;
  name: ProjectAreaIcon | null;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`rq-area-icon ${areaColorClass(color)}`.trim()}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths(name ?? "building")}
    </svg>
  );
}
