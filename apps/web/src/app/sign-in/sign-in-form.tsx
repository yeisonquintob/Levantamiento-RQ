"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { AppearanceControls } from "../appearance-controls";
import { applySignInUrlPolicy, type SignInReason } from "./sign-in-url-policy";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

type Mode = "sign-in" | "register";

function resolveMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    if ("detail" in payload && typeof payload.detail === "string")
      return payload.detail;
    if ("message" in payload && typeof payload.message === "string")
      return payload.message;
  }
  return fallback;
}

function FieldIcon({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

const SESSION_EXPIRED_MESSAGE = "La sesión expiró. Inicia sesión nuevamente.";

const MICROSOFT_REASON_MESSAGES: Partial<Record<SignInReason, string>> = {
  "microsoft-cancelled": "El acceso con Microsoft fue cancelado.",
  "microsoft-denied":
    "Tu cuenta de Microsoft no tiene acceso activo. Solicítalo a un administrador.",
  "microsoft-failed": "No fue posible completar el acceso con Microsoft.",
  "microsoft-unavailable":
    "El acceso con Microsoft no está disponible en este momento.",
};

const mailIcon = (
  <FieldIcon>
    <path
      d="M4 6h16v12H4zM4 7l8 6 8-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </FieldIcon>
);

const lockIcon = (
  <FieldIcon>
    <path
      d="M7 10V8a5 5 0 0110 0v2m-11 0h12v10H6z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </FieldIcon>
);

const userIcon = (
  <FieldIcon>
    <path
      d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </FieldIcon>
);

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="rq-auth-primary__arrow"
      viewBox="0 0 24 24"
    >
      <path
        d="M5 12h14m-5-5 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg aria-hidden="true" className="rq-auth-microsoft__logo" viewBox="0 0 24 24">
      <path d="M2 2h9.5v9.5H2z" fill="#f25022" />
      <path d="M12.5 2H22v9.5h-9.5z" fill="#7fba00" />
      <path d="M2 12.5h9.5V22H2z" fill="#00a4ef" />
      <path d="M12.5 12.5H22V22h-9.5z" fill="#ffb900" />
    </svg>
  );
}

function PasswordField({
  autoComplete,
  id,
  label,
  maxLength = 256,
  minLength,
  name,
  pattern,
  title,
}: Readonly<{
  autoComplete: string;
  id: string;
  label: string;
  maxLength?: number;
  minLength: number;
  name: string;
  pattern?: string;
  title?: string;
}>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="rq-auth-field">
      <label htmlFor={id}>{label}</label>
      <span className="rq-auth-field__control">
        {lockIcon}
        <input
          autoComplete={autoComplete}
          id={id}
          maxLength={maxLength}
          minLength={minLength}
          name={name}
          pattern={pattern}
          required
          title={title}
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          className="rq-auth-field__toggle"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path
              d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle
              cx="12"
              cy="12"
              fill="none"
              r="3"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            {visible ? (
              <path
                d="M4 20 20 4"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            ) : null}
          </svg>
        </button>
      </span>
    </div>
  );
}

export function SignInForm() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [redirectingToMicrosoft, setRedirectingToMicrosoft] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [inactivityNotice, setInactivityNotice] = useState(false);

  useEffect(() => {
    const policy = applySignInUrlPolicy(window.location.search);
    if (policy.changed) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${policy.safeSearch}`,
      );
      setMessage(
        "Por seguridad se eliminaron parámetros no permitidos de la URL.",
      );
    } else if (policy.reason === "inactivity") {
      setInactivityNotice(true);
    } else if (policy.reason === "expired") {
      setMessage(SESSION_EXPIRED_MESSAGE);
    } else if (policy.reason) {
      setMessage(MICROSOFT_REASON_MESSAGES[policy.reason] ?? "");
    }

    async function redirectAuthenticatedSession(): Promise<void> {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          setCheckingSession(false);
          return;
        }

        const user = (await response.json().catch(() => null)) as unknown;
        if (
          !user ||
          typeof user !== "object" ||
          !("mustChangePassword" in user) ||
          typeof user.mustChangePassword !== "boolean"
        ) {
          setCheckingSession(false);
          return;
        }

        window.location.replace(
          user.mustChangePassword ? "/change-password" : "/workspace",
        );
      } catch {
        // Una falla transitoria no debe impedir mostrar el formulario.
        setCheckingSession(false);
      }
    }

    function restoreFromHistory(event: PageTransitionEvent): void {
      if (event.persisted) {
        setCheckingSession(true);
        setRedirectingToMicrosoft(false);
        void redirectAuthenticatedSession();
      }
    }

    void redirectAuthenticatedSession();
    window.addEventListener("pageshow", restoreFromHistory);

    return () => window.removeEventListener("pageshow", restoreFromHistory);
  }, []);

  function dismissInactivityNotice(): void {
    if (!inactivityNotice) return;
    setInactivityNotice(false);

    const url = new URL(window.location.href);
    url.searchParams.delete("reason");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}`,
    );
  }

  function changeMode(nextMode: Mode): void {
    setMode(nextMode);
    setMessage("");
    setInactivityNotice(false);
    setMessageTone("error");
  }

  function startMicrosoftSignIn(): void {
    setRedirectingToMicrosoft(true);
    setMessage("");
    window.location.assign(
      `${GATEWAY_URL}/api/v1/auth/microsoft/start?origin=${encodeURIComponent(
        window.location.origin,
      )}`,
    );
  }

  async function signIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/auth/sign-in`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setMessage(resolveMessage(payload, "No fue posible iniciar sesión."));
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
      window.location.replace(
        mustChangePassword ? "/change-password" : "/workspace",
      );
    } catch {
      setMessage("El servicio de acceso no está disponible en este momento.");
    } finally {
      setSubmitting(false);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const password = String(form.get("registerPassword") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) {
      setMessageTone("error");
      setMessage("Las contraseñas no coinciden.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: String(form.get("displayName") ?? "").trim(),
          email: String(form.get("registerEmail") ?? "").trim(),
          password,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setMessageTone("error");
        setMessage(
          resolveMessage(payload, "No fue posible completar el registro."),
        );
        return;
      }
      element.reset();
      setMode("sign-in");
      setMessageTone("success");
      setMessage(
        "Registro recibido. Tu cuenta quedó pendiente de activación por un administrador.",
      );
    } catch {
      setMessageTone("error");
      setMessage("El servicio de registro no está disponible en este momento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rq-auth-experience"
      data-mode={mode}
      data-session-checking={checkingSession}
    >
      <section className="rq-auth-welcome" aria-label="Presentación">
        <span className="rq-auth-welcome__orb rq-auth-welcome__orb--large" />
        <span className="rq-auth-welcome__orb rq-auth-welcome__orb--small" />
        <div>
          <span className="rq-auth-welcome__kicker">BIENVENIDO</span>
          <h1>
            Levantamiento <em>RQ</em>
          </h1>
          <p>
            {mode === "sign-in"
              ? "Organiza, analiza y documenta cada etapa de tus proyectos en un solo lugar."
              : "Crea tu cuenta para comenzar a organizar, analizar y documentar tus requerimientos en un solo lugar."}
          </p>
        </div>
      </section>

      <section
        className="rq-auth-pane rq-auth-pane--signin"
        aria-hidden={mode !== "sign-in"}
        inert={mode !== "sign-in"}
      >
        <div className="rq-auth-pane__content">
          <h2>Iniciar sesión</h2>
          <p className="rq-auth-intro">Continúa con tu cuenta activa.</p>
          <form className="rq-auth-form" onSubmit={signIn}>
            <div className="rq-auth-field">
              <label htmlFor="email">Correo electrónico</label>
              <span className="rq-auth-field__control">
                {mailIcon}
                <input
                  autoComplete="username"
                  id="email"
                  maxLength={320}
                  name="email"
                  onClick={dismissInactivityNotice}
                  onFocus={dismissInactivityNotice}
                  placeholder="nombre@empresa.com"
                  required
                  spellCheck={false}
                  type="email"
                />
              </span>
            </div>
            <PasswordField
              autoComplete="current-password"
              id="password"
              label="Contraseña"
              minLength={8}
              name="password"
            />
            <button
              className="rq-auth-primary"
              disabled={submitting}
              type="submit"
            >
              <span>{submitting ? "Validando…" : "Iniciar sesión"}</span>
              <ArrowIcon />
            </button>
          </form>
          <div className="rq-auth-divider" role="separator">
            <span>o</span>
          </div>
          <button
            className="rq-auth-microsoft"
            disabled={redirectingToMicrosoft}
            onClick={startMicrosoftSignIn}
            type="button"
          >
            <MicrosoftLogo />
            <span>
              {redirectingToMicrosoft
                ? "Redirigiendo a Microsoft…"
                : "Ingresar con Microsoft"}
            </span>
          </button>
          <p className="rq-auth-switch">
            ¿Aún no tienes una cuenta?{" "}
            <button onClick={() => changeMode("register")} type="button">
              Regístrate
            </button>
          </p>
        </div>
      </section>

      <section
        className="rq-auth-pane rq-auth-pane--register"
        aria-hidden={mode !== "register"}
        inert={mode !== "register"}
      >
        <div className="rq-auth-pane__content">
          <h2>Crear cuenta</h2>
          <p className="rq-auth-intro">
            La activación será revisada por un administrador.
          </p>
          <form
            className="rq-auth-form rq-auth-form--register"
            onSubmit={register}
          >
            <div className="rq-auth-field">
              <label htmlFor="displayName">Nombre completo</label>
              <span className="rq-auth-field__control">
                {userIcon}
                <input
                  autoComplete="name"
                  id="displayName"
                  maxLength={200}
                  minLength={2}
                  name="displayName"
                  placeholder="Tu nombre completo"
                  required
                  type="text"
                />
              </span>
            </div>
            <div className="rq-auth-field">
              <label htmlFor="registerEmail">Correo electrónico</label>
              <span className="rq-auth-field__control">
                {mailIcon}
                <input
                  autoComplete="email"
                  id="registerEmail"
                  maxLength={320}
                  name="registerEmail"
                  placeholder="nombre@empresa.com"
                  required
                  spellCheck={false}
                  type="email"
                />
              </span>
            </div>
            <PasswordField
              autoComplete="new-password"
              id="registerPassword"
              label="Contraseña"
              minLength={12}
              name="registerPassword"
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,}"
              title="Mínimo 12 caracteres con mayúscula, minúscula, número y símbolo"
            />
            <PasswordField
              autoComplete="new-password"
              id="passwordConfirmation"
              label="Confirmar contraseña"
              minLength={12}
              name="passwordConfirmation"
            />
            <button
              className="rq-auth-primary"
              disabled={submitting}
              type="submit"
            >
              <span>{submitting ? "Registrando…" : "Crear cuenta"}</span>
              <ArrowIcon />
            </button>
          </form>
          <p className="rq-auth-switch">
            ¿Ya tienes una cuenta?{" "}
            <button onClick={() => changeMode("sign-in")} type="button">
              Inicia sesión
            </button>
          </p>
        </div>
      </section>

      {inactivityNotice ? (
        <div className="rq-auth-inactivity-notice" role="status">
          <span aria-hidden="true" className="rq-auth-inactivity-notice__icon">
            <svg viewBox="0 0 24 24">
              <circle
                cx="12"
                cy="12"
                fill="none"
                r="9"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M12 7v5l3 2"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </span>
          <p>
            Inactivo por <strong>30 minutos</strong>.
          </p>
          <button
            aria-label="Cerrar aviso"
            className="rq-auth-inactivity-notice__close"
            onClick={dismissInactivityNotice}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M6 6l12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>
      ) : null}

      <div className="rq-auth-appearance">
        <AppearanceControls />
      </div>

      <p
        aria-live="polite"
        className="rq-auth-message"
        data-session-expired={message === SESSION_EXPIRED_MESSAGE || undefined}
        data-tone={messageTone}
        role="status"
      >
        {message}
      </p>
    </div>
  );
}
