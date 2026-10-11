import type {
  PrototypeVisualDevice,
  PrototypeVisualLayout,
  PrototypeVisualNavigation,
  PrototypeVisualTemplateCode,
  PrototypeVisualViewport,
} from "@levantamiento-rq/shared-contracts";
export interface PrototypeVisualTemplate {
  code: PrototypeVisualTemplateCode;
  device: PrototypeVisualDevice;
  viewport: PrototypeVisualViewport;
  layout: PrototypeVisualLayout;
  navigation: PrototypeVisualNavigation;
}
export const WEB_TEMPLATE_V1: PrototypeVisualTemplate =
  Object.freeze<PrototypeVisualTemplate>({
    code: "WEB_TEMPLATE_V1",
    device: "WEB",
    viewport: { width: 1440, height: 900 },
    layout: {
      shell: "DESKTOP_SHELL",
      contentDirection: "ROW",
      columns: 2,
      padding: 24,
      gap: 16,
    },
    navigation: { primary: "SIDEBAR", secondary: "TOPBAR" },
  });
export const MOBILE_TEMPLATE_V1: PrototypeVisualTemplate =
  Object.freeze<PrototypeVisualTemplate>({
    code: "MOBILE_TEMPLATE_V1",
    device: "MOBILE",
    viewport: { width: 390, height: 844 },
    layout: {
      shell: "MOBILE_SHELL",
      contentDirection: "COLUMN",
      columns: 1,
      padding: 16,
      gap: 12,
    },
    navigation: { primary: "MOBILE_HEADER", secondary: "MOBILE_NAVIGATION" },
  });
export function templateFor(
  device: PrototypeVisualDevice,
): PrototypeVisualTemplate {
  return device === "WEB" ? WEB_TEMPLATE_V1 : MOBILE_TEMPLATE_V1;
}
