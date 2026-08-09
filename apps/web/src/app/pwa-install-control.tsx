"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallControl() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);

    function capture(event: Event): void {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function markInstalled(): void {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage("La aplicación quedó instalada en este dispositivo.");
    }

    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  async function install(): Promise<void> {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setMessage(
      choice.outcome === "accepted"
        ? "Instalación aceptada."
        : "La instalación fue cancelada.",
    );
  }

  return (
    <div className="rq-settings-action">
      <button
        className="rq-action"
        data-rq-tone="consult"
        disabled={installed || !installPrompt}
        onClick={() => void install()}
        type="button"
      >
        {installed ? "Aplicación instalada" : "Instalar aplicación"}
      </button>
      <small aria-live="polite">
        {message ||
          (installPrompt
            ? "La instalación está disponible en este navegador."
            : "El navegador mostrará esta opción cuando cumpla sus criterios de instalación.")}
      </small>
    </div>
  );
}
