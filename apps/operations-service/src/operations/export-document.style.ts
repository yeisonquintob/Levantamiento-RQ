export const NAVI_DOCUMENT_FONT = "Inter";

export const NAVI_DOCUMENT_COLORS = {
  text: "363534",
  muted: "637077",
  border: "C3CAC8",
  institutional: "354550",
  operation: "675579",
  surfaceSoft: "F7F8F8",
  white: "FFFFFF",
} as const;

export const NAVI_DOCUMENT_PDF_COLORS = {
  text: [0.212, 0.208, 0.204],
  muted: [0.388, 0.439, 0.467],
  border: [0.765, 0.792, 0.784],
  institutional: [0.208, 0.271, 0.314],
  operation: [0.404, 0.333, 0.475],
  surfaceSoft: [0.969, 0.973, 0.973],
  white: [1, 1, 1],
} as const satisfies Readonly<
  Record<string, readonly [number, number, number]>
>;
