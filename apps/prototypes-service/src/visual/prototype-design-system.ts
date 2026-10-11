import type { PrototypeDesignSystem } from "@levantamiento-rq/shared-contracts";

export const CORPORATE_DEFAULT_V1: PrototypeDesignSystem = Object.freeze({
  id: "corporate-default-v1",
  code: "CORPORATE_DEFAULT_V1",
  version: "1.0.0",
  name: "Corporate Default V1",
  typography: {
    family:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    display: "700 32px/40px",
    title: "700 24px/32px",
    heading: "600 18px/26px",
    body: "400 14px/22px",
    caption: "400 12px/18px",
    table: "400 13px/20px",
    button: "600 14px/20px",
  },
  colors: {
    background: "#F7F8FA",
    surface: "#FFFFFF",
    primary: "#675579",
    primaryDark: "#50415F",
    text: "#27313A",
    textSecondary: "#66727D",
    border: "#D8DEE3",
    success: "#2E7D5B",
    warning: "#B7791F",
    danger: "#C24141",
    info: "#3B6E8F",
  },
  spacing: [4, 8, 12, 16, 24, 32, 48],
  borderRadius: { small: 6, medium: 10, large: 16 },
  shadows: {
    card: "0 1px 3px rgba(39,49,58,.12)",
    modal: "0 16px 40px rgba(39,49,58,.2)",
  },
  buttons: {
    minHeight: 40,
    mobileMinHeight: 48,
    primary: "primary",
    secondary: "surface",
  },
  cards: { background: "surface", border: "border", padding: 16 },
  tables: { header: "surface", rowHeight: 44, border: "border" },
  forms: { labelPosition: "top", controlHeight: 40, mobileControlHeight: 48 },
  navigation: {
    sidebarWidth: 240,
    activeColor: "primary",
    mobilePattern: "adaptive",
  },
  badges: { radius: 999, paddingHorizontal: 8, paddingVertical: 4 },
});
