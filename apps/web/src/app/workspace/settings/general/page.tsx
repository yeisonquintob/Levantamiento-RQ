import { RqPageHero, RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { AppearanceControls } from "../../../appearance-controls";
import { PwaInstallControl } from "../../../pwa-install-control";
import { loadSettingsUser } from "../settings-user";

export default async function GeneralSettingsPage() {
  const user = await loadSettingsUser();

  return (
    <section className="rq-module-page rq-settings-workspace">
      <RqPageHero
        eyebrow="Configuración"
        title="General"
        description="Preferencias personales y parámetros existentes de la aplicación. Ningún secreto se muestra en esta vista."
      />

      <section aria-label="Configuración general" className="rq-settings-grid">
        <article className="rq-settings-card" id="session-security">
          <header>
            <span aria-hidden="true">S</span>
            <div>
              <h2>Sesión y seguridad</h2>
              <RqStatusBadge tone="success">Activa</RqStatusBadge>
            </div>
          </header>
          <p>
            Sesión con cookies HttpOnly, protección de origen y cierre por 30
            minutos de inactividad.
          </p>
          <dl>
            <div>
              <dt>Usuario</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Perfil</dt>
              <dd>{user.roles.join(", ") || "Usuario"}</dd>
            </div>
          </dl>
          <a className="rq-settings-card__link" href="/change-password">
            Cambiar contraseña
          </a>
        </article>

        <article className="rq-settings-card" id="notifications">
          <header>
            <span aria-hidden="true">N</span>
            <div>
              <h2>Notificaciones</h2>
              <RqStatusBadge tone="success">Internas</RqStatusBadge>
            </div>
          </header>
          <p>
            Los eventos de revisión, análisis y exportación generan avisos
            internos idempotentes. El correo depende de la configuración del
            entorno.
          </p>
          <a className="rq-settings-card__link" href="/workspace/notifications">
            Abrir notificaciones
          </a>
        </article>

        <article className="rq-settings-card" id="appearance">
          <header>
            <span aria-hidden="true">A</span>
            <div>
              <h2>Apariencia y accesibilidad</h2>
              <RqStatusBadge tone="neutral">Personal</RqStatusBadge>
            </div>
          </header>
          <p>
            El tema y el tamaño de texto se almacenan únicamente en este
            navegador.
          </p>
          <AppearanceControls />
        </article>

        <article className="rq-settings-card" id="pwa">
          <header>
            <span aria-hidden="true">PWA</span>
            <div>
              <h2>Aplicación instalable</h2>
              <RqStatusBadge tone="process">Segura</RqStatusBadge>
            </div>
          </header>
          <p>
            La instalación conserva solo recursos públicos. Sesiones, APIs,
            documentos y datos privados nunca se guardan para uso sin conexión.
          </p>
          <PwaInstallControl />
        </article>
      </section>
    </section>
  );
}
