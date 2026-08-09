"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { applySignInUrlPolicy } from "./sign-in-url-policy";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

function resolveMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof payload.detail === "string"
  ) {
    return payload.detail;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  return "No fue posible iniciar sesión.";
}

export function SignInForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const policy = applySignInUrlPolicy(window.location.search);

    if (policy.changed) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${policy.safeSearch}`,
      );
      setMessage(
        "Por seguridad se eliminaron parámetros no permitidos de la URL. Ingresa las credenciales únicamente en el formulario.",
      );
      return;
    }

    if (policy.reason === "inactivity") {
      setMessage("La sesión se cerró después de 30 minutos de inactividad.");
    } else if (policy.reason === "expired") {
      setMessage("La sesión expiró. Inicia sesión nuevamente.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/auth/sign-in`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        setMessage(resolveMessage(payload));
        return;
      }

      const mustChangePassword = Boolean(
        payload &&
        typeof payload === "object" &&
        "user" in payload &&
        payload.user &&
        typeof payload.user === "object" &&
        "mustChangePassword" in payload.user &&
        payload.user.mustChangePassword === true,
      );

      window.location.assign(
        mustChangePassword ? "/change-password" : "/workspace",
      );
    } catch {
      setMessage(
        "El Gateway no está disponible. Verifica que los servicios estén ejecutándose.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rq-auth-form" onSubmit={submit}>
      <div className="rq-field">
        <label htmlFor="email">Correo electrónico</label>
        <input
          autoComplete="username"
          id="email"
          maxLength={320}
          name="email"
          placeholder="nombre@empresa.com"
          required
          type="email"
        />
      </div>

      <div className="rq-field">
        <label htmlFor="password">Contraseña</label>
        <input
          autoComplete="current-password"
          id="password"
          maxLength={256}
          minLength={8}
          name="password"
          required
          type="password"
        />
      </div>

      <button
        className="rq-action rq-auth-submit"
        data-rq-tone="affirmative"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Validando…" : "Iniciar sesión"}
      </button>

      <p aria-live="polite" className="rq-auth-message" role="status">
        {message}
      </p>
    </form>
  );
}
