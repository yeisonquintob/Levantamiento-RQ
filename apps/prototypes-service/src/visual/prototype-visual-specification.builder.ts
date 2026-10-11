import { Injectable } from "@nestjs/common";
import type {
  PrototypeCanonicalComponent,
  PrototypeScreenDetail,
  PrototypeTargetDevice,
  PrototypeVisualAction,
  PrototypeVisualComponentSpecification,
  PrototypeVisualDevice,
  PrototypeVisualSpecification,
  PrototypeVisualState,
  PrototypeVisualNavigation,
} from "@levantamiento-rq/shared-contracts";
import { CORPORATE_DEFAULT_V1 } from "./prototype-design-system";
import { templateFor } from "./prototype-visual-templates";
type VisualDraft = Omit<
  PrototypeVisualSpecification,
  "id" | "createdAt" | "updatedAt"
>;

const rules: ReadonlyArray<{
  pattern: RegExp;
  web: PrototypeCanonicalComponent;
  mobile: PrototypeCanonicalComponent;
}> = [
  {
    pattern: /table|tabla|grid|listado|listing/i,
    web: "TABLE",
    mobile: "LIST",
  },
  { pattern: /filter|filtro/i, web: "FILTER_BAR", mobile: "DRAWER" },
  {
    pattern: /sidebar|menu lateral/i,
    web: "SIDEBAR",
    mobile: "MOBILE_NAVIGATION",
  },
  { pattern: /modal|dialog|confirm/i, web: "MODAL", mobile: "BOTTOM_SHEET" },
  { pattern: /form|formulario/i, web: "FORM", mobile: "FORM" },
  { pattern: /search|buscar|buscador/i, web: "SEARCH", mobile: "SEARCH" },
  { pattern: /date|fecha/i, web: "DATE_PICKER", mobile: "DATE_PICKER" },
  { pattern: /select|selector|dropdown/i, web: "SELECT", mobile: "SELECT" },
  { pattern: /input|campo|texto/i, web: "TEXT_INPUT", mobile: "TEXT_INPUT" },
  { pattern: /kpi|indicador|metric/i, web: "KPI", mobile: "CARD" },
  { pattern: /tab|pestaña/i, web: "TABS", mobile: "TABS" },
  { pattern: /badge|estado|status/i, web: "BADGE", mobile: "BADGE" },
  { pattern: /pagin/i, web: "PAGINATION", mobile: "PAGINATION" },
  { pattern: /detalle|detail/i, web: "DETAIL_PANEL", mobile: "CARD" },
  { pattern: /card|tarjeta/i, web: "CARD", mobile: "CARD" },
  {
    pattern:
      /button|bot[oó]n|action|acci[oó]n|export|actualizar|guardar|eliminar/i,
    web: "BUTTON",
    mobile: "BUTTON",
  },
];
function devices(target: PrototypeTargetDevice): PrototypeVisualDevice[] {
  return target === "RESPONSIVE" ? ["WEB", "MOBILE"] : [target];
}
function canonical(
  role: string,
  device: PrototypeVisualDevice,
): PrototypeCanonicalComponent {
  // Detailed descriptions may mention other controls; classify the declared type.
  const rule = rules.find((item) =>
    item.pattern.test(role.split(":", 1)[0] ?? role),
  );
  return rule ? (device === "WEB" ? rule.web : rule.mobile) : "CARD";
}
function presentation(
  type: PrototypeCanonicalComponent,
  device: PrototypeVisualDevice,
): PrototypeVisualComponentSpecification["presentation"] {
  if (device === "MOBILE")
    return type === "LIST" || type === "CARD" ? "CARD_COLLECTION" : "TOUCH";
  return type === "TABLE" || type === "FILTER_BAR" || type === "FORM"
    ? "FULL_WIDTH"
    : "COMPACT";
}
function actions(
  roles: readonly string[],
  device: PrototypeVisualDevice,
): PrototypeVisualAction[] {
  return roles
    .filter((role) =>
      /button|bot[oó]n|action|acci[oó]n|export|actualizar|guardar|eliminar/i.test(
        role.split(":", 1)[0] ?? role,
      ),
    )
    .map((role) => ({
      semanticRole: role,
      component: device === "MOBILE" ? "BUTTON" : "BUTTON",
      emphasis: /eliminar|delete|remove/i.test(role)
        ? "DANGER"
        : /guardar|crear|actualizar|export/i.test(role)
          ? "PRIMARY"
          : "SECONDARY",
    }));
}
function states(roles: readonly string[]): PrototypeVisualState[] {
  const result: PrototypeVisualState[] = [];
  if (roles.some((role) => /empty|vac[ií]o|sin resultados/i.test(role)))
    result.push({ type: "EMPTY", component: "EMPTY_STATE" });
  if (roles.some((role) => /error/i.test(role)))
    result.push({ type: "ERROR", component: "ERROR_STATE" });
  if (roles.some((role) => /success|éxito|confirm/i.test(role)))
    result.push({ type: "SUCCESS", component: "SUCCESS_STATE" });
  return result;
}

@Injectable()
export class PrototypeVisualSpecificationBuilder {
  build(
    screen: PrototypeScreenDetail,
    targetDevice: PrototypeTargetDevice,
    context?: {
      applicationName: string | null;
      applicationSummary?: string | null;
      screens: readonly Pick<
        PrototypeScreenDetail,
        "code" | "name" | "route"
      >[];
    },
  ): VisualDraft[] {
    return devices(targetDevice).map((device) => {
      const template = templateFor(device);
      const shell: PrototypeVisualComponentSpecification[] =
        device === "WEB"
          ? [
              {
                type: "APP_SHELL",
                semanticRole: "applicationShell",
                presentation: "FULL_WIDTH",
              },
              {
                type: "SIDEBAR",
                semanticRole: "primaryNavigation",
                presentation: "COMPACT",
              },
              {
                type: "TOPBAR",
                semanticRole: "screenHeader",
                presentation: "FULL_WIDTH",
              },
            ]
          : [
              {
                type: "APP_SHELL",
                semanticRole: "applicationShell",
                presentation: "TOUCH",
              },
              {
                type: "MOBILE_HEADER",
                semanticRole: "screenHeader",
                presentation: "TOUCH",
              },
              {
                type: "MOBILE_NAVIGATION",
                semanticRole: "primaryNavigation",
                presentation: "TOUCH",
              },
            ];
      const semantic = screen.components.map((role) => {
        const type = canonical(role, device);
        return {
          type,
          semanticRole: role,
          presentation: presentation(type, device),
        };
      });
      const navigation: PrototypeVisualNavigation = {
        ...template.navigation,
        items: (context?.screens ?? [screen]).map((item) => ({
          screenCode: item.code,
          label: item.name,
          route: item.route,
        })),
        activeScreenCode: screen.code,
      };
      return {
        generationId: screen.generationId,
        screenId: screen.id,
        screenCode: screen.code,
        screenOrigin: screen.origin,
        device,
        templateCode: template.code,
        designSystemCode: CORPORATE_DEFAULT_V1.code,
        ...(context?.applicationName
          ? { applicationName: context.applicationName }
          : {}),
        ...(context?.applicationSummary
          ? { applicationSummary: context.applicationSummary }
          : {}),
        ...(screen.route ? { route: screen.route } : {}),
        title: screen.name,
        objective: screen.objective,
        viewport: { ...template.viewport },
        layout: { ...template.layout },
        navigation,
        components: [...shell, ...semantic],
        contentHierarchy: [screen.name, ...screen.components],
        actions: actions(screen.components, device),
        states: states(screen.components),
      };
    });
  }
}
