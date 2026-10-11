import React from "react";
import type { ReactNode } from "react";

/** Iconos lineales de los indicadores (mismo trazo que Inicio). */
export type WorkspaceKpiIconName =
  | "projects"
  | "drafts"
  | "progress"
  | "answers"
  | "processed"
  | "viable"
  | "users"
  | "check"
  | "clock"
  | "spinner"
  | "alert"
  | "file"
  | "bell"
  | "key"
  | "server"
  | "star"
  | "eye"
  | "layers"
  | "play";

function paths(): Record<WorkspaceKpiIconName, ReactNode> {
  return {
    projects: (
      <>
        <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4" />
      </>
    ),
    drafts: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 13h6M9 16h4" />
      </>
    ),
    progress: <path d="M5 20V12M12 20V5M19 20v-9M3 20h18" />,
    answers: (
      <>
        <path d="M4 5.5h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H10l-4.5 3v-3H4a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" />
        <path d="M7 9.5h7M7 12.5h5" />
      </>
    ),
    processed: (
      <>
        <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    viable: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12.5 2.5 2.5 5.5-6" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0M16 5.2a3 3 0 0 1 0 5.6M18 14a5.5 5.5 0 0 1 3 5" />
      </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    spinner: (
      <>
        <path d="M12 3a9 9 0 1 0 9 9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 10v4M12 17.5h.01" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </>
    ),
    bell: (
      <>
        <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 6.5 2.5 6.5H4S6.5 15 6.5 9Z" />
        <path d="M9.5 19a2.7 2.7 0 0 0 5 0" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="15" r="4" />
        <path d="m11 12 9-9M16 7l2.5 2.5M14 9l2 2" />
      </>
    ),
    server: (
      <>
        <rect height="7" rx="1.5" width="18" x="3" y="4" />
        <rect height="7" rx="1.5" width="18" x="3" y="13" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </>
    ),
    star: (
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
    ),
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
    play: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  };
}

export function WorkspaceKpiIcon({ name }: { name: WorkspaceKpiIconName }) {
  return (
    <svg
      aria-hidden="true"
      className={`rq-kpi-icon rq-kpi-icon--${name}`}
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="20"
    >
      {paths()[name]}
    </svg>
  );
}
