"use client";

import { useEffect, useState } from "react";

type Theme = "normal" | "cold" | "warm" | "dark";
type FontScale = "compact" | "normal" | "large" | "extra-large";

const THEME_KEY = "rq-theme";
const FONT_KEY = "rq-font";

function applyPreferences(theme: Theme, font: FontScale): void {
  document.documentElement.dataset.rqTheme = theme;
  document.documentElement.dataset.rqFont = font;
}

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>("normal");
  const [font, setFont] = useState<FontScale>("normal");

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    const savedFont = localStorage.getItem(FONT_KEY) as FontScale | null;
    const resolvedTheme = savedTheme ?? "normal";
    const resolvedFont = savedFont ?? "normal";

    setTheme(resolvedTheme);
    setFont(resolvedFont);
    applyPreferences(resolvedTheme, resolvedFont);
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
    <div className="rq-appearance" aria-label="Apariencia y accesibilidad">
      <label>
        Tema
        <select
          aria-label="Tema visual"
          value={theme}
          onChange={(event) => changeTheme(event.target.value as Theme)}
        >
          <option value="normal">Normal</option>
          <option value="cold">Frío</option>
          <option value="warm">Cálido</option>
          <option value="dark">Oscuro</option>
        </select>
      </label>

      <label>
        Texto
        <select
          aria-label="Escala del texto"
          value={font}
          onChange={(event) => changeFont(event.target.value as FontScale)}
        >
          <option value="compact">Compacto</option>
          <option value="normal">Normal</option>
          <option value="large">Grande</option>
          <option value="extra-large">Muy grande</option>
        </select>
      </label>
    </div>
  );
}
