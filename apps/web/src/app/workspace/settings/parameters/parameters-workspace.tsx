"use client";

import { useState } from "react";

import { SidebarSettings } from "../sidebar/sidebar-settings";
import { AreasSettings } from "./areas-settings";

export type ParametersTab = "sidebar" | "areas";

const TABS: ReadonlyArray<{ id: ParametersTab; label: string }> = [
  { id: "sidebar", label: "Barra lateral" },
  { id: "areas", label: "Área" },
];

export function ParametersWorkspace({
  canManage,
  initialTab,
}: {
  canManage: boolean;
  initialTab: ParametersTab;
}) {
  const [tab, setTab] = useState<ParametersTab>(initialTab);

  return (
    <div className="rq-params">
      <div aria-label="Parámetros" className="rq-params__tabs" role="tablist">
        {TABS.map((item) => (
          <button
            aria-controls={`rq-params-panel-${item.id}`}
            aria-selected={tab === item.id}
            className="rq-params__tab"
            id={`rq-params-tab-${item.id}`}
            key={item.id}
            onClick={() => setTab(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`rq-params-tab-${tab}`}
        id={`rq-params-panel-${tab}`}
        role="tabpanel"
      >
        {tab === "sidebar" ? (
          <SidebarSettings />
        ) : (
          <AreasSettings canManage={canManage} />
        )}
      </div>
    </div>
  );
}
