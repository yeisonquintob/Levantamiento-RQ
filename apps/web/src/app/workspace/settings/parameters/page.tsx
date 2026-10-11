import { RqPageHero } from "@levantamiento-rq/shared-ui";

import { canManageSystem } from "../settings-access";
import { loadSettingsUser } from "../settings-user";
import {
  ParametersWorkspace,
  type ParametersTab,
} from "./parameters-workspace";

export default async function ParametersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ tab?: string }> }>) {
  const [{ tab }, user] = await Promise.all([searchParams, loadSettingsUser()]);
  const initialTab: ParametersTab = tab === "areas" ? "areas" : "sidebar";

  return (
    <section className="rq-module-page rq-settings-workspace">
      <RqPageHero
        eyebrow="Configuración"
        title="Parámetros"
        description="Listas y opciones que alimentan las pantallas: barra lateral y áreas solicitantes."
      />
      <ParametersWorkspace
        canManage={canManageSystem(user)}
        initialTab={initialTab}
      />
    </section>
  );
}
