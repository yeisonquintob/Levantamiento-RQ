"use client";

import { usePathname } from "next/navigation";

interface SettingsNavigationProps {
  canManageTemplates: boolean;
  canManageSystem: boolean;
}

interface SettingsNavigationItem {
  href: string;
  label: string;
  visible: boolean;
}

export function SettingsNavigation({
  canManageTemplates,
  canManageSystem,
}: SettingsNavigationProps) {
  const pathname = usePathname();
  const items: readonly SettingsNavigationItem[] = [
    {
      href: "/workspace/settings/general",
      label: "General",
      visible: true,
    },
    {
      href: "/workspace/settings/templates",
      label: "Plantillas",
      visible: canManageTemplates,
    },
    {
      href: "/workspace/settings/users",
      label: "Usuarios y roles",
      visible: canManageSystem,
    },
    {
      href: "/workspace/settings/ai-providers",
      label: "Proveedores de IA",
      visible: canManageSystem,
    },
    {
      href: "/workspace/settings/audit",
      label: "Auditoría",
      visible: true,
    },
  ];

  return (
    <nav aria-label="Secciones de Configuración" className="rq-settings-nav">
      <a
        aria-current={pathname === "/workspace/settings" ? "page" : undefined}
        className="rq-settings-nav__home"
        href="/workspace/settings"
        aria-label="Volver al resumen de Configuración"
      >
        Configuración
      </a>
      <span aria-hidden="true" className="rq-settings-nav__separator">
        /
      </span>
      <div className="rq-settings-nav__links">
        {items
          .filter((item) => item.visible)
          .map((item) => {
            const isCurrent = pathname.startsWith(item.href);

            return (
              <a
                aria-current={isCurrent ? "page" : undefined}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </a>
            );
          })}
      </div>
    </nav>
  );
}
