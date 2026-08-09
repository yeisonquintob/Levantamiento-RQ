import type { ReactNode } from "react";

import { canManageSystem, canManageTemplates } from "./settings-access";
import { SettingsNavigation } from "./settings-navigation";
import { loadSettingsUser } from "./settings-user";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await loadSettingsUser();

  return (
    <div className="rq-settings-area">
      <SettingsNavigation
        canManageSystem={canManageSystem(user)}
        canManageTemplates={canManageTemplates(user)}
      />
      {children}
    </div>
  );
}
