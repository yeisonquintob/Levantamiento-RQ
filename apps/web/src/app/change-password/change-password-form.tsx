"use client";

import { useState, type FormEvent } from "react";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

function messageOf(payload: unknown): string {
  if (payload && typeof payload === "object") {
    if ("detail" in payload && typeof payload.detail === "string") {
      return payload.detail;
    }
    if ("message" in payload && typeof payload.message === "string") {
      return payload.message;
    }
  }

  return "No fue posible cambiar la contraseña.";
}

export function ChangePasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");

    if (newPassword !== confirmation) {
      setMessage("La confirmación no coincide con la nueva contraseña.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/auth/change-password`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        },
      );
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setMessage(messageOf(payload));
        return;
      }

      window.location.assign("/workspace");
    } catch {
      setMessage("El Gateway no está disponible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rq-auth-form" onSubmit={submit}>
      <label className="rq-field">
        <span>Contraseña temporal actual</span>
        <input
          autoComplete="current-password"
          maxLength={256}
          minLength={8}
          name="currentPassword"
          required
          type="password"
        />
      </label>

      <label className="rq-field">
        <span>Nueva contraseña</span>
        <input
          autoComplete="new-password"
          maxLength={256}
          minLength={12}
          name="newPassword"
          required
          type="password"
        />
      </label>

      <label className="rq-field">
        <span>Confirmar nueva contraseña</span>
        <input
          autoComplete="new-password"
          maxLength={256}
          minLength={12}
          name="confirmation"
          required
          type="password"
        />
      </label>

      <button
        className="rq-action rq-auth-submit"
        data-rq-tone="affirmative"
        disabled={busy}
        type="submit"
      >
        {busy ? "Actualizando…" : "Cambiar contraseña"}
      </button>

      <p aria-live="polite" className="rq-auth-message" role="status">
        {message}
      </p>
    </form>
  );
}
