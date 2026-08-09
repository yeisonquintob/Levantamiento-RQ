import { RqPageHero, RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { canManageSystem, canManageTemplates } from "./settings-access";
import { loadSettingsUser } from "./settings-user";

interface SettingsCardProps {
  description: string;
  href: string;
  icon: string;
  status?: string;
  title: string;
}

function SettingsCard({
  description,
  href,
  icon,
  status,
  title,
}: SettingsCardProps) {
  return (
    <article className="rq-settings-hub-card">
      <a aria-label={`Abrir ${title}`} href={href}>
        <span aria-hidden="true" className="rq-settings-hub-card__icon">
          {icon}
        </span>
        <span className="rq-settings-hub-card__content">
          <span className="rq-settings-hub-card__title">
            <strong>{title}</strong>
            {status ? (
              <RqStatusBadge tone="success">{status}</RqStatusBadge>
            ) : null}
          </span>
          <span>{description}</span>
        </span>
        <span aria-hidden="true" className="rq-settings-hub-card__arrow">
          →
        </span>
      </a>
    </article>
  );
}

export default async function SettingsPage() {
  const user = await loadSettingsUser();
  const showTemplates = canManageTemplates(user);
  const showSystemAdministration = canManageSystem(user);

  return (
    <section className="rq-module-page rq-settings-workspace">
      <RqPageHero
        eyebrow="Sistema"
        title="Configuración"
        description="Administración y parámetros de la plataforma. Las opciones visibles respetan los permisos actuales de tu cuenta."
      />

      <section
        aria-labelledby="personal-settings-heading"
        className="rq-settings-personal"
      >
        <div>
          <h2 id="personal-settings-heading">Preferencias personales</h2>
          <p>
            Sesión y seguridad, apariencia, accesibilidad y aplicación
            instalable.
          </p>
        </div>
        <a href="/workspace/settings/general">
          Administrar preferencias <span aria-hidden="true">→</span>
        </a>
      </section>

      <section aria-labelledby="system-settings-heading">
        <header className="rq-settings-section-heading">
          <div>
            <span>Administración del sistema</span>
            <h2 id="system-settings-heading">Administración</h2>
          </div>
          <p>
            Configura únicamente las capacidades autorizadas para tu perfil.
          </p>
        </header>

        <div className="rq-settings-hub-grid">
          <SettingsCard
            description="Configuración general y preferencias administrativas."
            href="/workspace/settings/general"
            icon="G"
            status="Disponible"
            title="General"
          />

          {showTemplates ? (
            <SettingsCard
              description="Plantillas documentales, versiones y publicación."
              href="/workspace/settings/templates"
              icon="T"
              title="Plantillas"
            />
          ) : null}

          {showSystemAdministration ? (
            <>
              <SettingsCard
                description="Usuarios, estados, roles, contraseñas y sesiones."
                href="/workspace/settings/users"
                icon="U"
                title="Usuarios y roles"
              />
              <SettingsCard
                description="Proveedor, modelo, límites y credenciales protegidas."
                href="/workspace/settings/ai-providers"
                icon="IA"
                title="Proveedores de IA"
              />
            </>
          ) : null}

          <SettingsCard
            description="Trazabilidad de operaciones y eventos del sistema."
            href="/workspace/settings/audit"
            icon="A"
            title="Auditoría"
          />
        </div>
      </section>
    </section>
  );
}
