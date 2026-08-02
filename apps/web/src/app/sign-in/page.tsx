import { AppearanceControls } from "../appearance-controls";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <div className="rq-auth-page">
      <a className="rq-skip-link" href="#inicio-sesion">
        Saltar al formulario
      </a>

      <header className="rq-auth-topbar">
        <div>
          <strong>Levantamiento RQ</strong>
          <span>Identidad y acceso seguro</span>
        </div>
        <AppearanceControls />
      </header>

      <main className="rq-auth-main" id="inicio-sesion">
        <section className="rq-auth-card" aria-labelledby="auth-title">
          <span className="rq-page-hero__eyebrow">Acceso seguro</span>
          <h1 id="auth-title">Iniciar sesión</h1>
          <p>
            Utiliza una cuenta activa registrada en RqIdentityDb. Las
            credenciales se validan exclusivamente por medio del Gateway.
          </p>

          <SignInForm />

          <aside className="rq-auth-note">
            La autenticación permanece deshabilitada hasta configurar la base
            de identidad y los secretos JWT del entorno.
          </aside>
        </section>
      </main>
    </div>
  );
}
