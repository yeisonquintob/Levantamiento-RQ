import { AppearanceControls } from "../appearance-controls";
import { ChangePasswordForm } from "./change-password-form";

export default function ChangePasswordPage() {
  return (
    <div className="rq-auth-page">
      <header className="rq-auth-topbar">
        <div>
          <strong>Levantamiento RQ</strong>
          <span>Actualización segura de credenciales</span>
        </div>
        <AppearanceControls />
      </header>

      <main className="rq-auth-main">
        <section className="rq-auth-card" aria-labelledby="password-title">
          <span className="rq-page-hero__eyebrow">Cambio obligatorio</span>
          <h1 id="password-title">Cambiar contraseña</h1>
          <p>
            Tu contraseña actual es temporal. Define una nueva para habilitar el
            acceso normal al Workspace.
          </p>
          <ChangePasswordForm />
        </section>
      </main>
    </div>
  );
}
