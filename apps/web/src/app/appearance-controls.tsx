"use client";

import { useEffect, useRef, useState } from "react";

import { useDialogAccessibility } from "./use-dialog-accessibility";

type Theme = "normal" | "cold" | "warm" | "dark";
type FontScale = "compact" | "normal" | "large" | "extra-large";
type MotionSpeed = "reduced" | "fast" | "normal" | "slow";

const THEME_KEY = "rq-theme";
const FONT_KEY = "rq-font";
const MOTION_KEY = "rq-motion";

const THEME_OPTIONS: readonly {
  value: Theme;
  label: string;
  symbol: string;
}[] = [
  { value: "normal", label: "Claro", symbol: "○" },
  { value: "cold", label: "Frío", symbol: "◐" },
  { value: "warm", label: "Cálido", symbol: "◒" },
  { value: "dark", label: "Oscuro", symbol: "●" },
];

const FONT_OPTIONS: readonly {
  value: FontScale;
  label: string;
  symbol: string;
}[] = [
  { value: "compact", label: "Compacto", symbol: "A−" },
  { value: "normal", label: "Normal", symbol: "A" },
  { value: "large", label: "Grande", symbol: "A+" },
  { value: "extra-large", label: "Muy grande", symbol: "A++" },
];

const MOTION_OPTIONS: readonly {
  value: MotionSpeed;
  label: string;
  symbol: string;
}[] = [
  { value: "reduced", label: "Reducido", symbol: "◦" },
  { value: "fast", label: "Rápido", symbol: "»" },
  { value: "normal", label: "Normal", symbol: "›" },
  { value: "slow", label: "Lento", symbol: "…" },
];

function applyPreferences(
  theme: Theme,
  font: FontScale,
  motion: MotionSpeed,
): void {
  document.documentElement.dataset.rqTheme = theme;
  document.documentElement.dataset.rqFont = font;
  document.documentElement.dataset.rqMotion = motion;
}

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>("normal");
  const [font, setFont] = useState<FontScale>("normal");
  const [motion, setMotion] = useState<MotionSpeed>("normal");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogAccessibility<HTMLElement>(open, () =>
    setOpen(false),
  );

  useEffect(() => {
    const resolvedTheme = (document.documentElement.dataset.rqTheme ??
      "normal") as Theme;
    const resolvedFont = (document.documentElement.dataset.rqFont ??
      "normal") as FontScale;

    const resolvedMotion = (document.documentElement.dataset.rqMotion ??
      "normal") as MotionSpeed;

    setTheme(resolvedTheme);
    setFont(resolvedFont);
    setMotion(resolvedMotion);
  }, []);

  useEffect(() => {
    function closeFromOutside(event: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function closeFromEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);

    return () => {
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, []);

  function changeTheme(value: Theme): void {
    setTheme(value);
    applyPreferences(value, font, motion);
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      /* Keep the selected theme when browser storage is unavailable. */
    }
  }

  function changeFont(value: FontScale): void {
    setFont(value);
    applyPreferences(theme, value, motion);
    try {
      localStorage.setItem(FONT_KEY, value);
    } catch {
      /* Keep the selected font when browser storage is unavailable. */
    }
  }

  function changeMotion(value: MotionSpeed): void {
    setMotion(value);
    applyPreferences(theme, font, value);
    try {
      localStorage.setItem(MOTION_KEY, value);
    } catch {
      /* Keep the selected motion when browser storage is unavailable. */
    }
  }

  return (
    <div
      className="rq-appearance"
      aria-label="Apariencia y accesibilidad"
      ref={containerRef}
    >
      <button
        aria-label="Apariencia"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="rq-appearance__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">◐</span>
        <svg aria-hidden="true" className="rq-appearance__sun" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            fill="none"
            r="4"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M12 2.5v2.5M12 19v2.5M2.5 12H5m14 0h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
        <strong>Apariencia</strong>
      </button>

      {open ? (
        <section
          aria-label="Preferencias visuales"
          className="rq-appearance__panel"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <header>
            <strong>Apariencia y texto</strong>
            <button
              aria-label="Cerrar preferencias"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
          </header>

          <fieldset>
            <legend>Tema visual</legend>
            <div className="rq-appearance__options">
              {THEME_OPTIONS.map((option) => (
                <button
                  aria-pressed={theme === option.value}
                  data-active={theme === option.value}
                  key={option.value}
                  onClick={() => changeTheme(option.value)}
                  type="button"
                >
                  <span aria-hidden="true">{option.symbol}</span>
                  <small>{option.label}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Tamaño del texto</legend>
            <div className="rq-appearance__options rq-appearance__options--text">
              {FONT_OPTIONS.map((option) => (
                <button
                  aria-pressed={font === option.value}
                  data-active={font === option.value}
                  key={option.value}
                  onClick={() => changeFont(option.value)}
                  type="button"
                >
                  <span aria-hidden="true">{option.symbol}</span>
                  <small>{option.label}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Velocidad de transición</legend>
            <div className="rq-appearance__options">
              {MOTION_OPTIONS.map((option) => (
                <button
                  aria-pressed={motion === option.value}
                  data-active={motion === option.value}
                  key={option.value}
                  onClick={() => changeMotion(option.value)}
                  type="button"
                >
                  <span aria-hidden="true">{option.symbol}</span>
                  <small>{option.label}</small>
                </button>
              ))}
            </div>
          </fieldset>
        </section>
      ) : null}
    </div>
  );
}
