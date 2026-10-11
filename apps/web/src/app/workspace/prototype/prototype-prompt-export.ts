import type { PrototypePromptExport } from "@levantamiento-rq/shared-contracts";

/** Marca de orden de bytes para que Excel y el Bloc de notas lean bien los acentos. */
const BOM = String.fromCharCode(0xfeff);

const RULE = "=".repeat(72);
const DEVICE_NAME = { WEB: "Web", MOBILE: "Móvil" } as const;
const TARGET_NAME = {
  RESPONSIVE: "Web + móvil",
  WEB: "Solo web",
  MOBILE: "Solo móvil",
} as const;

function designGuide(system: PrototypePromptExport["designSystem"]): string[] {
  const c = system.colors;
  const t = system.typography;
  return [
    "GUÍA DE APARIENCIA (igual para TODAS las imágenes)",
    `Sistema: ${system.name} v${system.version}. Estilo corporativo sobrio, plano, sin degradados decorativos ni tarjetas sobredimensionadas.`,
    "",
    "Colores",
    `  Fondo ${c["background"]} · Superficie (sidebar, topbar, tarjetas) ${c["surface"]} · Bordes y separadores ${c["border"]}`,
    `  Primario (menú activo y acción principal) ${c["primary"]} · Primario oscuro ${c["primaryDark"]}`,
    `  Texto ${c["text"]} · Texto secundario ${c["textSecondary"]}`,
    `  Éxito ${c["success"]} · Advertencia ${c["warning"]} · Peligro ${c["danger"]} · Información ${c["info"]} (solo para su estado semántico)`,
    "",
    "Tipografía",
    `  Familia: ${t["family"]}`,
    `  Display ${t["display"]} · Título ${t["title"]} · Encabezado ${t["heading"]} · Cuerpo ${t["body"]} · Tabla ${t["table"]} · Etiqueta ${t["caption"]} · Botón ${t["button"]}`,
    "",
    "Medidas",
    `  Espaciado: ${system.spacing.join(", ")} px · Radios: pequeño ${system.borderRadius["small"]}, medio ${system.borderRadius["medium"]}, grande ${system.borderRadius["large"]} px`,
    `  Botones ${system.buttons.minHeight}px de alto (${system.buttons.mobileMinHeight}px en móvil) · Campos de formulario ${system.forms.controlHeight}px (${system.forms.mobileControlHeight}px en móvil), etiqueta arriba`,
    `  Tarjetas: fondo superficie, borde fino, padding ${system.cards.padding}px, sombra ${system.shadows["card"]} · Tablas: fila de ${system.tables.rowHeight}px con borde fino`,
    `  Insignias de estado: píldora (radio ${system.badges.radius}), ${system.badges.paddingVertical}/${system.badges.paddingHorizontal}px`,
    "",
    "Estructura común (idéntica en cada vista)",
    `  Web: barra lateral fija de ${system.navigation.sidebarWidth}px con el menú completo de la aplicación, barra superior de 64px con el nombre de la aplicación y el título de la pantalla, contenido a la derecha con 24px de padding y 16px de separación.`,
    "  Móvil: cabecera de 56px con identidad de la aplicación, título y control «Menú» visible que abre el mismo menú en un panel lateral; contenido en una columna con 16px de padding, 12px de separación y controles táctiles de 48px. Es la propia aplicación, no una pantalla de inicio del teléfono ni un mockup con marco.",
    "  El menú conserva etiquetas, orden y colores en todas las vistas (formularios, detalles, estados vacíos y de error); solo cambia el elemento activo. No muestres rutas ni códigos de pantalla como texto de la interfaz.",
    "  Idioma de la interfaz: español claro. Conserva las etiquetas de campos, columnas y acciones tal como se describen. No inventes registros, métricas ni módulos: usa valores vacíos neutros.",
    "",
  ];
}

/**
 * Archivo de texto autosuficiente para generar las imágenes en otra IA, una por pantalla.
 * Funciona con cualquier proyecto: todo el contenido sale del plan de pantallas y del sistema de
 * apariencia compartido.
 */
export function buildPromptExportTxt(
  exported: PrototypePromptExport,
  generatedAt: Date = new Date(),
): string {
  const total = exported.items.length;
  const lines: string[] = [
    `PROMPTS PARA GENERAR LAS IMÁGENES DEL PROTOTIPO${exported.applicationName ? ` · ${exported.applicationName}` : ""}`,
    `Generado: ${generatedAt.toISOString().slice(0, 10)} · ${total} ${total === 1 ? "imagen" : "imágenes"} · Formato: ${TARGET_NAME[exported.targetDevice]}`,
    "",
    RULE,
    "CÓMO USARLO",
    "1. Genera las imágenes en UNA sola conversación de tu IA: pega primero la «GUÍA DE APARIENCIA» y la «APLICACIÓN» de abajo, y luego un prompt por mensaje.",
    "2. Tras la primera imagen aprobada, adjúntala como referencia de estilo en las siguientes para que menú, colores y proporciones coincidan.",
    "3. Pide el tamaño indicado en cada bloque. Sin marcos de dispositivo, marcas de agua ni anotaciones.",
    "4. Descarga cada resultado en PNG y guárdalo con el nombre EXACTO de la línea «Archivo».",
    "5. En Generar prototipo → Imágenes pulsa «Importar imágenes» y selecciona los PNG: cada uno se asigna a su pantalla por el nombre.",
    "Cada bloque «PROMPT» ya es autosuficiente; la guía y la lista de pantallas solo ayudan a mantener la coherencia entre conversaciones.",
    "",
    RULE,
    "APLICACIÓN",
    `Nombre: ${exported.applicationName ?? "Sin nombre"}`,
    ...(exported.applicationSummary
      ? [`Propósito: ${exported.applicationSummary}`]
      : []),
    "Menú de la aplicación (mismo en todas las vistas):",
    ...exported.screens.map(
      (screen) =>
        `  ${String(screen.order).padStart(2, "0")}. ${screen.name}${screen.route ? `  (${screen.route})` : ""}`,
    ),
    "",
    RULE,
    ...designGuide(exported.designSystem),
  ];
  exported.items.forEach((item, index) => {
    const screen = exported.screens.find(
      (candidate) => candidate.screenCode === item.screenCode,
    );
    lines.push(
      RULE,
      `[${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}] ${item.screenName} · ${DEVICE_NAME[item.device]}`,
      `Archivo: ${item.fileName}`,
      `Tamaño: ${item.width}x${item.height}`,
      ...(screen
        ? [
            `Objetivo: ${screen.objective}`,
            ...(screen.components.length
              ? ["Componentes:", ...screen.components.map((component) => `  - ${component}`)]
              : []),
          ]
        : []),
      "PROMPT:",
      item.prompt,
      "FIN DEL PROMPT",
      "",
    );
  });
  lines.push(
    RULE,
    "LISTA DE ARCHIVOS A IMPORTAR",
    ...exported.items.map((item) => `  [ ] ${item.fileName}`),
    "",
  );
  return `${BOM}${lines.join("\r\n")}`;
}

export function promptExportFileName(applicationName: string | null): string {
  const base = (applicationName ?? "prototipo")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return `prompts-${base || "prototipo"}.txt`;
}

/** Lee un archivo como base64 (sin el prefijo data:). */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** Cuerpo de la importación de una imagen: el nombre del archivo decide a qué pantalla va. */
export async function importPayload(file: File) {
  return { fileName: file.name, imageBase64: await fileToBase64(file) };
}
