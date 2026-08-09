import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RqPageHero, RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { AppearanceControls } from "../../appearance-controls";
import { PwaInstallControl } from "../../pwa-install-control";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

interface SettingsUser {
  displayName: string;
  email: string;
  roles: readonly string[];
  permissions: readonly string[];
}

async function loadUser(): Promise<SettingsUser> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
      cache: "no-store",
      headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
    });
    if (!response.ok) redirect("/sign-in");
    return (await response.json()) as SettingsUser;
  } catch {
    redirect("/sign-in");
  }
}

export default async function SettingsPage() {
  const user = await loadUser();
  const canAdminister = user.permissions.includes("system.admin");

  return (
    <section className="rq-module-page rq-settings-workspace">
      <RqPageHero
        eyebrow="Preferencias y administración"
        title="Configuración"
        description="Consulta los controles activos y accede únicamente a las opciones permitidas para tu perfil. Ningún secreto se muestra en esta vista."
      />

      <section aria-label="Configuración personal" className="rq-settings-grid">
        <article className="rq-settings-card">
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

        <article className="rq-settings-card">
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

        <article className="rq-settings-card">
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

        <article className="rq-settings-card">
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

      {canAdminister ? (
        <section
          aria-label="Administración del sistema"
          className="rq-settings-admin"
        >
          <h2>Administración del sistema</h2>
          <p>Estas opciones requieren el permiso global de administración.</p>
          <div>
            <a
              className="rq-settings-admin__link"
              href="/workspace/settings/users"
            >
              <strong>Usuarios y roles</strong>
              <span>Altas, estado, roles y contraseña temporal.</span>
            </a>
            <a
              className="rq-settings-admin__link"
              href="/workspace/settings/ai-providers"
            >
              <strong>Proveedores de IA</strong>
              <span>
                Proveedor, modelo, límites, prueba y secreto protegido.
              </span>
            </a>
          </div>
        </section>
      ) : null}
    </section>
  );
}
