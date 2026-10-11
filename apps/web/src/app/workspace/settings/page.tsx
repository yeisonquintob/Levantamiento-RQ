import { RqStatusBadge } from "@levantamiento-rq/shared-ui";

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
      <section aria-labelledby="system-settings-heading">
        <header className="rq-settings-section-heading">
          <div>
            <span>Centro de administración</span>
            <h2 id="system-settings-heading">Opciones de configuración</h2>
          </div>
          <p>Se muestran únicamente las opciones disponibles para tu perfil.</p>
        </header>

        <div className="rq-settings-hub-grid">
          <SettingsCard
            description="Personaliza la apariencia, accesibilidad, seguridad de la sesión y comportamiento de la aplicación."
            href="/workspace/settings/general"
            icon="G"
            status="Disponible"
            title="General"
          />

          <SettingsCard
            description="Barra lateral (secciones, visibilidad y orden de los menús) y áreas solicitantes de los proyectos."
            href="/workspace/settings/parameters"
            icon="M"
            title="Parámetros"
          />

          {showTemplates ? (
            <SettingsCard
              description="Crea y publica estructuras reutilizables para estandarizar los documentos de requerimientos."
              href="/workspace/settings/templates"
              icon="T"
              title="Plantillas"
            />
          ) : null}

          {showSystemAdministration ? (
            <>
              <SettingsCard
                description="Administra accesos, estados de cuenta, roles asignados, contraseñas y sesiones activas."
                href="/workspace/settings/users"
                icon="U"
                title="Usuarios y roles"
              />
              <SettingsCard
                description="Define proveedores, modelos, límites de uso y credenciales protegidas para los análisis."
                href="/workspace/settings/ai-providers"
                icon="IA"
                title="Proveedores de IA"
              />
              <SettingsCard
                description="Administra los rangos, recomendaciones y umbral usados para evaluar la viabilidad del levantamiento."
                href="/workspace/settings/viability"
                icon="V"
                title="Criterios de viabilidad"
              />
            </>
          ) : null}

          <SettingsCard
            description="Consulta quién realizó cada operación, cuándo ocurrió y cuál fue su resultado."
            href="/workspace/settings/audit"
            icon="A"
            title="Auditoría"
          />
        </div>
      </section>
    </section>
  );
}
