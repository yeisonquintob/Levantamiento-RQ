"use client";

import { useEffect, useRef, useState } from "react";

import { useDialogAccessibility } from "./use-dialog-accessibility";

type Theme = "normal" | "cold" | "warm" | "dark";
type FontScale = "compact" | "normal" | "large" | "extra-large";

const THEME_KEY = "rq-theme";
const FONT_KEY = "rq-font";

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

function applyPreferences(theme: Theme, font: FontScale): void {
  document.documentElement.dataset.rqTheme = theme;
  document.documentElement.dataset.rqFont = font;
}

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>("normal");
  const [font, setFont] = useState<FontScale>("normal");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogAccessibility<HTMLElement>(open, () =>
    setOpen(false),
  );

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    const savedFont = localStorage.getItem(FONT_KEY) as FontScale | null;
    const resolvedTheme = savedTheme ?? "normal";
    const resolvedFont = savedFont ?? "normal";

    setTheme(resolvedTheme);
    setFont(resolvedFont);
    applyPreferences(resolvedTheme, resolvedFont);
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
    localStorage.setItem(THEME_KEY, value);
    applyPreferences(value, font);
  }

  function changeFont(value: FontScale): void {
    setFont(value);
    localStorage.setItem(FONT_KEY, value);
    applyPreferences(theme, value);
  }

  return (
    <div
      className="rq-appearance"
      aria-label="Apariencia y accesibilidad"
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="rq-appearance__trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">◐</span>
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
        </section>
      ) : null}
    </div>
  );
}
